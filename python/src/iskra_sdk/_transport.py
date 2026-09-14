from __future__ import annotations

import json
import math
import time
from collections.abc import AsyncIterator, Iterator, Mapping
from contextlib import asynccontextmanager, contextmanager
from typing import Any
from urllib.parse import quote, urlsplit

import httpx

from .errors import APIError, NetworkError, ProtocolError, RequestTimeoutError
from .types import RequestOptions, UploadFile

TERMINAL = frozenset({"completed", "failed", "cancelled", "interaction_required"})


def positive(value: float, name: str) -> float:
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be finite and positive")
    return value


def segment(value: str) -> str:
    if not value or value in {".", ".."}:
        raise ValueError("Path segment must be nonempty and cannot be '.' or '..'")
    return quote(value, safe="")


def artifact_path(value: str) -> str:
    if "\\" in value or urlsplit(value).scheme:
        raise ValueError("Artifact path must be a relative path using forward slashes")
    return "/".join(segment(part) for part in value.split("/"))


def multipart(file: UploadFile) -> tuple[str, Any, str]:
    return (file.filename, file.content, file.content_type)


def query_values(query: Mapping[str, Any] | None) -> dict[str, str]:
    return {
        k: str(v).lower() if isinstance(v, bool) else str(v)
        for k, v in (query or {}).items()
        if v is not None
    }


def decode(response: httpx.Response, content: bytes | None = None) -> Any:
    if response.status_code == 204:
        return None
    try:
        return response.json() if content is None else json.loads(content)
    except (ValueError, UnicodeError):
        raise ProtocolError("Expected a JSON response") from None


class _Config:
    def __init__(
        self, *, api_key: str, base_url: str, timeout_seconds: float, run_as: str | None
    ) -> None:
        parsed = urlsplit(base_url)
        if (
            parsed.scheme not in {"https", "http"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError(
                "base_url must be an HTTP(S) URL without credentials, query or fragment"
            )
        if not api_key or "\r" in api_key or "\n" in api_key:
            raise ValueError("api_key must be a nonempty single-line token")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = positive(timeout_seconds, "timeout_seconds")
        self._run_as = run_as
        self._closed = False

    def __repr__(self) -> str:
        return f"{type(self).__name__}()"

    def args(
        self,
        path: str,
        options: RequestOptions | None,
        *,
        apps: bool = False,
        sse: bool = False,
        query: Mapping[str, Any] | None = None,
        body: Any = None,
        files: Any = None,
        data: Any = None,
    ) -> dict[str, Any]:
        if self._closed:
            raise RuntimeError("SDK client is closed")
        if not path.startswith("/api/") or path.startswith("//"):
            raise ValueError("Only configured API paths are supported")
        opts = options or RequestOptions()
        run_as = opts.run_as if opts.run_as is not None else self._run_as
        if apps and run_as is not None:
            raise ValueError("Apps publication does not support run_as")
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Accept": "text/event-stream" if sse else "application/json",
        }
        if run_as is not None:
            headers["X-Iskra-Run-As"] = run_as
        if sse and opts.last_event_id is not None:
            headers["Last-Event-ID"] = opts.last_event_id
        if opts.idempotency_key is not None:
            headers["Idempotency-Key"] = opts.idempotency_key
        return dict(
            url=self._base_url + path,
            headers=headers,
            timeout=positive(
                opts.timeout_seconds if opts.timeout_seconds is not None else self._timeout,
                "timeout_seconds",
            ),
            params=query_values(query),
            json=body,
            files=files,
            data=data,
            follow_redirects=False,
            auth=None,
        )

    def error(self, response: httpx.Response, content: bytes) -> APIError:
        try:
            body = json.loads(content)
        except (ValueError, UnicodeError):
            body = content[:8192].decode("utf-8", errors="replace")[:8192]
        return APIError(
            response.status_code,
            body,
            request_id=response.headers.get("x-request-id"),
            retry_after=response.headers.get("retry-after"),
            secret=self._api_key,
        )


class SyncTransport(_Config):
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        timeout_seconds: float,
        run_as: str | None,
        http_client: httpx.Client | None,
    ) -> None:
        super().__init__(
            api_key=api_key, base_url=base_url, timeout_seconds=timeout_seconds, run_as=run_as
        )
        self.http = http_client if http_client is not None else httpx.Client(follow_redirects=False)
        self.owned = http_client is None

    def close(self) -> None:
        self._closed = True
        if self.owned:
            self.http.close()

    def request(
        self,
        method: str,
        path: str,
        options: RequestOptions | None = None,
        deadline: float | None = None,
        **kwargs: Any,
    ) -> Any:
        with self.stream(method, path, options, deadline=deadline, **kwargs) as response:
            if deadline is None:
                response.read()
                return decode(response)
            content = bytearray()
            for chunk in response.iter_bytes():
                if time.monotonic() >= deadline:
                    raise RequestTimeoutError("HTTP polling deadline exceeded")
                content.extend(chunk)
            return decode(response, bytes(content))

    @contextmanager
    def stream(
        self,
        method: str,
        path: str,
        options: RequestOptions | None = None,
        deadline: float | None = None,
        **kwargs: Any,
    ) -> Iterator[httpx.Response]:
        try:
            with self.http.stream(method, **self.args(path, options, **kwargs)) as response:
                if not response.is_success:
                    is_json = "json" in response.headers.get("content-type", "").lower()
                    content = bytearray()
                    for chunk in response.iter_bytes():
                        if deadline is not None and time.monotonic() >= deadline:
                            raise RequestTimeoutError("HTTP polling deadline exceeded")
                        content.extend(chunk if is_json else chunk[: 8192 - len(content)])
                        if not is_json and len(content) >= 8192:
                            break
                    raise self.error(response, bytes(content))
                yield response
        except httpx.TimeoutException:
            raise RequestTimeoutError("HTTP request timed out; no retry was attempted") from None
        except httpx.RequestError:
            raise NetworkError("HTTP transport failed; no retry was attempted") from None


class AsyncTransport(_Config):
    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        timeout_seconds: float,
        run_as: str | None,
        http_client: httpx.AsyncClient | None,
    ) -> None:
        super().__init__(
            api_key=api_key, base_url=base_url, timeout_seconds=timeout_seconds, run_as=run_as
        )
        self.http = (
            http_client if http_client is not None else httpx.AsyncClient(follow_redirects=False)
        )
        self.owned = http_client is None

    async def close(self) -> None:
        self._closed = True
        if self.owned:
            await self.http.aclose()

    async def request(
        self, method: str, path: str, options: RequestOptions | None = None, **kwargs: Any
    ) -> Any:
        async with self.stream(method, path, options, **kwargs) as response:
            await response.aread()
            return decode(response)

    @asynccontextmanager
    async def stream(
        self, method: str, path: str, options: RequestOptions | None = None, **kwargs: Any
    ) -> AsyncIterator[httpx.Response]:
        try:
            async with self.http.stream(method, **self.args(path, options, **kwargs)) as response:
                if not response.is_success:
                    if "json" in response.headers.get("content-type", "").lower():
                        raise self.error(response, await response.aread())
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk[: 8192 - len(content)])
                        if len(content) >= 8192:
                            break
                    raise self.error(response, bytes(content))
                yield response
        except httpx.TimeoutException:
            raise RequestTimeoutError("HTTP request timed out; no retry was attempted") from None
        except httpx.RequestError:
            raise NetworkError("HTTP transport failed; no retry was attempted") from None
