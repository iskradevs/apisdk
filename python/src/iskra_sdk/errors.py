"""SDK exceptions with safe representations and preserved HTTP error bodies."""

from __future__ import annotations

from typing import Any


class IskraError(Exception):
    """Base SDK error."""


class APIError(IskraError):
    def __init__(
        self,
        status_code: int,
        body: Any,
        *,
        request_id: str | None = None,
        retry_after: str | None = None,
        secret: str = "",
    ) -> None:
        envelope = body if isinstance(body, dict) else {}
        error = envelope.get("error")
        detail = error if isinstance(error, dict) else envelope
        self.status_code = status_code
        self.body = body
        self.code: str | None = detail.get("code")
        self.request_id = request_id or envelope.get("request_id")
        self.retry_after = retry_after
        self.conversation_id: str | None = envelope.get("conversation_id")
        self.answer: str | None = envelope.get("answer")
        message = str(
            detail.get("message")
            or detail.get("detail")
            or detail.get("title")
            or f"HTTP {status_code}"
        )
        if secret:
            message = message.replace(secret, "[REDACTED]")
        self.message = message[:8192]
        super().__init__(self.message)

    def __repr__(self) -> str:
        return f"APIError(status_code={self.status_code})"


class NetworkError(IskraError):
    """Transport failed; the server may already have accepted the request."""


class RequestTimeoutError(NetworkError):
    """An HTTP operation exceeded its timeout; no retry was attempted."""


class ProtocolError(IskraError):
    """The server returned invalid JSON or an invalid event stream."""


class WaitTimeoutError(IskraError):
    """The local wait deadline expired. The remote run was not cancelled."""

    def __init__(self, run_id: str) -> None:
        self.run_id = run_id
        super().__init__("Run wait deadline exceeded; the remote run was not cancelled")
