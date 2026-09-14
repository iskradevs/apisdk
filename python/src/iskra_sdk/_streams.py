"""One connection per context; httpx-sse owns SSE framing and UTF-8 parsing."""

from __future__ import annotations

from collections.abc import AsyncGenerator, AsyncIterator, Generator, Iterator
from contextlib import asynccontextmanager, contextmanager
from typing import Any, cast

from httpx_sse import EventSource, ServerSentEvent, SSEError

from ._transport import TERMINAL, AsyncTransport, SyncTransport
from .errors import ProtocolError
from .types import JSONObject, OpenAIChunk, OpenAIDone, RequestOptions, RunSSEEvent


def event_value(event: ServerSentEvent, openai: bool) -> RunSSEEvent | OpenAIChunk | OpenAIDone:
    if openai and event.data == "[DONE]":
        return OpenAIDone()
    try:
        data = event.json()
    except (ValueError, UnicodeError):
        raise ProtocolError("Invalid JSON in SSE event") from None
    if openai:
        if not isinstance(data, dict):
            raise ProtocolError("Expected an OpenAI JSON object in SSE event")
        return OpenAIChunk(cast(JSONObject, data), event.event, event.id)
    return RunSSEEvent(event.event, data, event.id, event.retry)


def is_terminal(value: RunSSEEvent | OpenAIChunk | OpenAIDone) -> bool:
    return (
        isinstance(value, OpenAIDone) or isinstance(value, RunSSEEvent) and value.event in TERMINAL
    )


@contextmanager
def events(
    transport: SyncTransport,
    method: str,
    path: str,
    options: RequestOptions | None,
    *,
    openai: bool = False,
    **kwargs: Any,
) -> Iterator[Iterator[RunSSEEvent | OpenAIChunk | OpenAIDone]]:
    with transport.stream(method, path, options, sse=True, **kwargs) as response:
        source = EventSource(response)

        def iterate() -> Generator[RunSSEEvent | OpenAIChunk | OpenAIDone, None, None]:
            try:
                for raw in source.iter_sse():
                    value = event_value(raw, openai)
                    yield value
                    if is_terminal(value):
                        return
                raise ProtocolError("SSE stream ended before its terminal marker")
            except SSEError:
                raise ProtocolError("Expected a text/event-stream response") from None

        iterator = iterate()
        try:
            yield iterator
        finally:
            iterator.close()


@asynccontextmanager
async def async_events(
    transport: AsyncTransport,
    method: str,
    path: str,
    options: RequestOptions | None,
    *,
    openai: bool = False,
    **kwargs: Any,
) -> AsyncIterator[AsyncIterator[RunSSEEvent | OpenAIChunk | OpenAIDone]]:
    async with transport.stream(method, path, options, sse=True, **kwargs) as response:
        source = EventSource(response)

        async def iterate() -> AsyncGenerator[RunSSEEvent | OpenAIChunk | OpenAIDone, None]:
            try:
                async for raw in source.aiter_sse():
                    value = event_value(raw, openai)
                    yield value
                    if is_terminal(value):
                        return
                raise ProtocolError("SSE stream ended before its terminal marker")
            except SSEError:
                raise ProtocolError("Expected a text/event-stream response") from None

        iterator = iterate()
        try:
            yield iterator
        finally:
            await iterator.aclose()
