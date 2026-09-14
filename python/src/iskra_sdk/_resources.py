from __future__ import annotations

from collections.abc import Iterator, Sequence
from contextlib import AbstractContextManager
from typing import Literal, cast

import httpx

from ._streams import events
from ._transport import SyncTransport, artifact_path, multipart, query_values, segment
from .types import (
    AccessMode,
    AppPublished,
    AppStatus,
    ChatRequest,
    ChatResponse,
    ContextSnapshot,
    ConversationCreated,
    ConversationRequest,
    ExecPlanDefaults,
    MemoryBrowsePage,
    MemoryBrowseQuery,
    MemoryCollections,
    MemoryFolder,
    MemoryMembers,
    MemoryReferenceInput,
    MemoryRoot,
    MemoryUpload,
    OpenAIChatRequest,
    OpenAIChatResponse,
    OpenAIChunk,
    OpenAIDone,
    OpenAIModels,
    RequestOptions,
    RunCancelled,
    RunCreated,
    RunRequest,
    RunSnapshot,
    RunSSEEvent,
    SkillsResponse,
    SpecialistsResponse,
    UploadFile,
    UploadResponse,
)


class Chat:
    def __init__(self, transport: SyncTransport) -> None:
        self._transport = transport

    def create(
        self, request: ChatRequest, *, options: RequestOptions | None = None
    ) -> ChatResponse:
        return cast(
            ChatResponse, self._transport.request("POST", "/api/v1/chat", options, body=request)
        )

    def delete(self, conversation_id: str, *, options: RequestOptions | None = None) -> None:
        return cast(
            None,
            self._transport.request("DELETE", f"/api/v1/chat/{segment(conversation_id)}", options),
        )


class Skills:
    def __init__(self, transport: SyncTransport) -> None:
        self._transport = transport

    def list(self, *, options: RequestOptions | None = None) -> SkillsResponse:
        return cast(SkillsResponse, self._transport.request("GET", "/api/v1/skills", options))


class Specialists:
    def __init__(self, transport: SyncTransport) -> None:
        self._transport = transport

    def list(self, *, options: RequestOptions | None = None) -> SpecialistsResponse:
        return cast(
            SpecialistsResponse, self._transport.request("GET", "/api/v1/specialists", options)
        )


class ExecPlan:
    def __init__(self, transport: SyncTransport) -> None:
        self._transport = transport

    def defaults(self, *, options: RequestOptions | None = None) -> ExecPlanDefaults:
        return cast(
            ExecPlanDefaults, self._transport.request("GET", "/api/v1/exec-plan/defaults", options)
        )


class Conversations:
    def __init__(self, transport: SyncTransport) -> None:
        self._transport = transport

    def create(
        self, request: ConversationRequest, *, options: RequestOptions | None = None
    ) -> ConversationCreated:
        return cast(
            ConversationCreated,
            self._transport.request("POST", "/api/v1/conversations", options, body=request),
        )

    def context(
        self, conversation_id: str, *, options: RequestOptions | None = None
    ) -> ContextSnapshot:
        return cast(
            ContextSnapshot,
            self._transport.request(
                "GET", f"/api/v1/chat/{segment(conversation_id)}/context", options
            ),
        )

    def set_workspace(
        self, conversation_id: str, directory_id: str, *, options: RequestOptions | None = None
    ) -> ContextSnapshot:
        return cast(
            ContextSnapshot,
            self._transport.request(
                "PUT",
                f"/api/v1/chat/{segment(conversation_id)}/workspace",
                options,
                body={"directory_id": directory_id},
            ),
        )

    def clear_workspace(
        self, conversation_id: str, *, options: RequestOptions | None = None
    ) -> ContextSnapshot:
        return cast(
            ContextSnapshot,
            self._transport.request(
                "DELETE", f"/api/v1/chat/{segment(conversation_id)}/workspace", options
            ),
        )

    def add_memory_ref(
        self,
        conversation_id: str,
        reference: MemoryReferenceInput,
        *,
        options: RequestOptions | None = None,
    ) -> ContextSnapshot:
        return cast(
            ContextSnapshot,
            self._transport.request(
                "POST",
                f"/api/v1/chat/{segment(conversation_id)}/memory-refs",
                options,
                body=reference,
            ),
        )

    def update_memory_ref(
        self,
        conversation_id: str,
        ref_id: str,
        access_mode: AccessMode,
        *,
        options: RequestOptions | None = None,
    ) -> ContextSnapshot:
        return cast(
            ContextSnapshot,
            self._transport.request(
                "PATCH",
                f"/api/v1/chat/{segment(conversation_id)}/memory-refs/{segment(ref_id)}",
                options,
                body={"access_mode": access_mode},
            ),
        )

    def delete_memory_ref(
        self, conversation_id: str, ref_id: str, *, options: RequestOptions | None = None
    ) -> None:
        return cast(
            None,
            self._transport.request(
                "DELETE",
                f"/api/v1/chat/{segment(conversation_id)}/memory-refs/{segment(ref_id)}",
                options,
            ),
        )


class Files:
    def __init__(self, transport: SyncTransport) -> None:
        self._transport = transport

    def upload(
        self,
        files: Sequence[UploadFile],
        *,
        conversation_id: str | None = None,
        ttl_seconds: int | None = None,
        options: RequestOptions | None = None,
    ) -> UploadResponse:
        return cast(
            UploadResponse,
            self._transport.request(
                "POST",
                "/api/v1/chat/files",
                options,
                files=[("file", multipart(f)) for f in files],
                data=query_values({"conversation_id": conversation_id, "ttl_seconds": ttl_seconds}),
            ),
        )

    def download(
        self, conversation_id: str, path: str, *, options: RequestOptions | None = None
    ) -> AbstractContextManager[httpx.Response]:
        """Stream bytes inside a with block; close the response on early exit."""
        return self._transport.stream(
            "GET", f"/api/v1/chat/{segment(conversation_id)}/files/{artifact_path(path)}", options
        )


class Memory:
    def __init__(self, transport: SyncTransport) -> None:
        self._transport = transport

    def browse(
        self, query: MemoryBrowseQuery | None = None, *, options: RequestOptions | None = None
    ) -> MemoryBrowsePage:
        return cast(
            MemoryBrowsePage,
            self._transport.request("GET", "/api/v1/memory/browse", options, query=query),
        )

    def collections(self, *, options: RequestOptions | None = None) -> MemoryCollections:
        return cast(
            MemoryCollections, self._transport.request("GET", "/api/v1/memory/collections", options)
        )

    def collection_members(
        self, collection_id: str, *, options: RequestOptions | None = None
    ) -> MemoryMembers:
        return cast(
            MemoryMembers,
            self._transport.request(
                "GET", f"/api/v1/memory/collections/{segment(collection_id)}/members", options
            ),
        )

    def create_root(self, name: str, *, options: RequestOptions | None = None) -> MemoryRoot:
        return cast(
            MemoryRoot,
            self._transport.request(
                "POST", "/api/v1/memory/resources/roots", options, body={"name": name}
            ),
        )

    def create_folder(
        self, directory_id: str, path: str, *, options: RequestOptions | None = None
    ) -> MemoryFolder:
        return cast(
            MemoryFolder,
            self._transport.request(
                "POST",
                "/api/v1/memory/resources/folders",
                options,
                body={"directory_id": directory_id, "path": path},
            ),
        )

    def upload(
        self,
        directory_id: str,
        file: UploadFile,
        *,
        path: str | None = None,
        conflict_policy: Literal["create", "rename"] | None = None,
        options: RequestOptions | None = None,
    ) -> MemoryUpload:
        return cast(
            MemoryUpload,
            self._transport.request(
                "POST",
                "/api/v1/memory/resources/files",
                options,
                files={"file": multipart(file)},
                data=query_values(
                    {"directory_id": directory_id, "path": path, "conflict_policy": conflict_policy}
                ),
            ),
        )

    def download(
        self,
        file_id: str,
        *,
        directory_id: str,
        download: bool | None = None,
        format: Literal["pdf", "spreadsheet", "spreadsheet-asset"] | None = None,
        asset: str | None = None,
        options: RequestOptions | None = None,
    ) -> AbstractContextManager[httpx.Response]:
        """Stream bytes inside a with block; close the response on early exit."""
        return self._transport.stream(
            "GET",
            f"/api/v1/memory/resources/files/{segment(file_id)}/content",
            options,
            query={
                "directory_id": directory_id,
                "download": int(download) if download is not None else None,
                "format": format,
                "asset": asset,
            },
        )


class Apps:
    def __init__(self, transport: SyncTransport) -> None:
        self._transport = transport

    def create(
        self,
        bundle: UploadFile,
        *,
        title: str | None = None,
        activate: bool | None = None,
        options: RequestOptions | None = None,
    ) -> AppPublished:
        return cast(
            AppPublished,
            self._transport.request(
                "POST",
                "/api/v1/apps",
                options,
                apps=True,
                files={"bundle": multipart(bundle)},
                data=query_values({"title": title}),
                query={"activate": activate},
            ),
        )

    def publish_version(
        self,
        app_id: str,
        bundle: UploadFile,
        *,
        activate: bool | None = None,
        options: RequestOptions | None = None,
    ) -> AppPublished:
        return cast(
            AppPublished,
            self._transport.request(
                "POST",
                f"/api/v1/apps/{segment(app_id)}/versions",
                options,
                apps=True,
                files={"bundle": multipart(bundle)},
                query={"activate": activate},
            ),
        )

    def get(self, app_id: str, *, version: str, options: RequestOptions | None = None) -> AppStatus:
        return cast(
            AppStatus,
            self._transport.request(
                "GET",
                f"/api/v1/apps/{segment(app_id)}",
                options,
                apps=True,
                query={"version": version},
            ),
        )


class OpenAI:
    def __init__(self, transport: SyncTransport) -> None:
        self._transport = transport

    def models(self, *, options: RequestOptions | None = None) -> OpenAIModels:
        return cast(OpenAIModels, self._transport.request("GET", "/api/openai/v1/models", options))

    def chat_completions(
        self, request: OpenAIChatRequest, *, options: RequestOptions | None = None
    ) -> OpenAIChatResponse:
        return cast(
            OpenAIChatResponse,
            self._transport.request(
                "POST",
                "/api/openai/v1/chat/completions",
                options,
                body={**request, "stream": False},
            ),
        )

    def stream_chat_completions(
        self, request: OpenAIChatRequest, *, options: RequestOptions | None = None
    ) -> AbstractContextManager[Iterator[OpenAIChunk | OpenAIDone]]:
        """Yield parsed JSON frames (including in-band errors) and a distinct DONE."""
        return cast(
            AbstractContextManager[Iterator[OpenAIChunk | OpenAIDone]],
            events(
                self._transport,
                "POST",
                "/api/openai/v1/chat/completions",
                options,
                openai=True,
                body={**request, "stream": True},
            ),
        )


class Runs:
    def __init__(self, transport: SyncTransport) -> None:
        self._transport = transport

    def create(self, request: RunRequest, *, options: RequestOptions | None = None) -> RunCreated:
        for file in request.get("files", []):
            if not file.get("id") or "content_base64" in file:
                raise ValueError("Async runs accept only uploaded file IDs")
        return cast(
            RunCreated, self._transport.request("POST", "/api/v1/runs", options, body=request)
        )

    def get(
        self, run_id: str, *, after: int | None = None, options: RequestOptions | None = None
    ) -> RunSnapshot:
        return cast(
            RunSnapshot,
            self._transport.request(
                "GET", f"/api/v1/runs/{segment(run_id)}", options, query={"after": after}
            ),
        )

    def cancel(self, run_id: str, *, options: RequestOptions | None = None) -> RunCancelled:
        return cast(
            RunCancelled,
            self._transport.request("DELETE", f"/api/v1/runs/{segment(run_id)}", options),
        )

    def wait(
        self,
        run_id: str,
        *,
        timeout_seconds: float = 900,
        poll_interval_seconds: float = 1,
        after: int = 0,
        options: RequestOptions | None = None,
    ) -> RunSnapshot:
        """Poll to a terminal snapshot. Local timeout leaves the remote run intact."""
        import time
        from dataclasses import replace

        from ._transport import TERMINAL, positive
        from .errors import RequestTimeoutError, WaitTimeoutError

        positive(timeout_seconds, "timeout_seconds")
        positive(poll_interval_seconds, "poll_interval_seconds")
        deadline = time.monotonic() + timeout_seconds
        opts = options or RequestOptions()
        request_timeout = (
            opts.timeout_seconds if opts.timeout_seconds is not None else self._transport._timeout
        )
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise WaitTimeoutError(run_id)
            try:
                snapshot = cast(
                    RunSnapshot,
                    self._transport.request(
                        "GET",
                        f"/api/v1/runs/{segment(run_id)}",
                        replace(opts, timeout_seconds=min(request_timeout, remaining)),
                        query={"after": after},
                        deadline=deadline,
                    ),
                )
            except RequestTimeoutError:
                if time.monotonic() >= deadline:
                    raise WaitTimeoutError(run_id) from None
                raise
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise WaitTimeoutError(run_id)
            if snapshot["status"] in TERMINAL:
                return snapshot
            after = snapshot["next_after"]
            time.sleep(min(poll_interval_seconds, remaining))

    def events(
        self, run_id: str, *, after: int | None = None, options: RequestOptions | None = None
    ) -> AbstractContextManager[Iterator[RunSSEEvent]]:
        """Progress stream; resume explicitly with after=int(last_event.id)+1."""
        return cast(
            AbstractContextManager[Iterator[RunSSEEvent]],
            events(
                self._transport,
                "GET",
                f"/api/v1/runs/{segment(run_id)}/events",
                options,
                query={"after": after},
            ),
        )
