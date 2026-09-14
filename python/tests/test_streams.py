import asyncio
import json

import httpx
import pytest

from iskra_sdk import AsyncIskra, Iskra, OpenAIChunk, OpenAIDone, ProtocolError, RequestOptions


class Chunks(httpx.SyncByteStream):
    def __init__(self, payload):
        self.payload = payload
        self.closed = False

    def __iter__(self):
        for byte in self.payload:
            yield bytes([byte])

    def close(self):
        self.closed = True


class AsyncChunks(httpx.AsyncByteStream):
    def __init__(self, payload, block=False):
        self.payload = payload
        self.closed = False
        self.block = block
        self.started = asyncio.Event()

    async def __aiter__(self):
        for byte in self.payload:
            yield bytes([byte])
        self.started.set()
        if self.block:
            await asyncio.Event().wait()

    async def aclose(self):
        self.closed = True


RUN_SSE = ': keepalive\r\n\r\nid: 4\r\nevent: tool\r\ndata: {"name":\r\ndata: "файл"}\r\n\r\nid: 7\nevent: completed\ndata: {"status":"completed"}\n\nevent: tool\ndata: {"name":"ignored"}\n\n'.encode()


def test_run_events_parse_chunked_utf8_comments_multiline_and_close_at_terminal():
    body = Chunks(RUN_SSE)
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=body)

    with httpx.Client(transport=httpx.MockTransport(handler)) as http_client:
        with Iskra(
            api_key="key",
            base_url="http://test.invalid/prefix",
            http_client=http_client,
            run_as="p",
        ) as client:
            with client.runs.events("r/a", after=4) as events:
                result = list(events)
    assert [e.event for e in result] == ["tool", "completed"]
    assert result[0].data == {"name": "файл"}
    assert result[1].id == "7"
    assert body.closed
    assert len(seen) == 1
    assert seen[0].url.raw_path == b"/prefix/api/v1/runs/r%2Fa/events?after=4"
    assert seen[0].headers["accept"] == "text/event-stream"
    assert seen[0].headers["x-iskra-run-as"] == "p"


def test_sync_sse_early_exit_closes_and_does_not_reconnect():
    body = Chunks(RUN_SSE)
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=body)

    with httpx.Client(transport=httpx.MockTransport(handler)) as external:
        with Iskra(api_key="k", base_url="http://test.invalid", http_client=external) as client:
            with client.runs.events("r") as events:
                for event in events:
                    assert event.event == "tool"
                    break
            assert body.closed
    assert len(calls) == 1


def test_openai_stream_emits_json_and_distinct_done():
    body = Chunks(
        'data: {"choices":[{"delta":{"content":"Привет"}}]}\n\ndata: {"error":{"code":"internal"}}\n\ndata: [DONE]\n\n'.encode()
    )
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=body)

    with httpx.Client(transport=httpx.MockTransport(handler)) as external:
        with Iskra(api_key="k", base_url="http://test.invalid", http_client=external) as client:
            with client.openai.stream_chat_completions(
                {"model": "iskra", "messages": [{"role": "user", "content": "hi"}]}
            ) as events:
                result = list(events)
    assert isinstance(result[0], OpenAIChunk)
    assert result[0].data["choices"][0]["delta"]["content"] == "Привет"
    assert result[1].data["error"]["code"] == "internal"
    assert isinstance(result[2], OpenAIDone)
    assert json.loads(seen[0].content)["stream"] is True
    assert body.closed


@pytest.mark.parametrize(
    "content_type,payload",
    [("text/html", b"<html>bad"), ("text/event-stream", b"data: invalid\n\n")],
)
def test_invalid_stream_is_protocol_error(content_type, payload):
    body = Chunks(payload)
    with httpx.Client(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, headers={"content-type": content_type}, stream=body)
        )
    ) as external:
        with Iskra(api_key="k", base_url="http://test.invalid", http_client=external) as client:
            with pytest.raises(ProtocolError):
                with client.runs.events("r") as events:
                    list(events)
    assert body.closed


async def test_async_events_parse_and_close_early():
    body = AsyncChunks(RUN_SSE)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200, headers={"content-type": "text/event-stream"}, stream=body
            )
        )
    ) as external:
        async with AsyncIskra(
            api_key="k", base_url="http://test.invalid", http_client=external
        ) as client:
            async with client.runs.events(
                "r", after=4, options=RequestOptions(run_as="p")
            ) as events:
                async for event in events:
                    assert event.data == {"name": "файл"}
                    break
            assert body.closed


async def test_async_sse_task_cancellation_closes_response():
    body = AsyncChunks(b": keepalive\n\n", block=True)
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200, headers={"content-type": "text/event-stream"}, stream=body
            )
        )
    ) as external:
        async with AsyncIskra(
            api_key="k", base_url="http://test.invalid", http_client=external
        ) as client:

            async def consume():
                async with client.runs.events("r") as events:
                    async for _ in events:
                        pass

            task = asyncio.create_task(consume())
            await asyncio.wait_for(body.started.wait(), timeout=1)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert body.closed


async def test_async_openai_done_and_run_synthetic_terminal():
    responses = [b'id: -1\nevent: failed\ndata: {"status":"failed"}\n\n', b"data: [DONE]\n\n"]
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                headers={"content-type": "text/event-stream"},
                stream=AsyncChunks(responses.pop(0)),
            )
        )
    ) as external:
        async with AsyncIskra(
            api_key="k", base_url="http://test.invalid", http_client=external
        ) as client:
            async with client.runs.events("r") as events:
                result = [event async for event in events]
            assert result[0].id == "-1"
            async with client.openai.stream_chat_completions(
                {"model": "iskra", "messages": []}
            ) as events:
                result = [event async for event in events]
            assert isinstance(result[0], OpenAIDone)


@pytest.mark.parametrize("openai", [False, True])
@pytest.mark.parametrize("empty", [False, True])
def test_sync_premature_eof_is_error_and_keeps_last_event(openai, empty):
    payload = (
        b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
        if openai
        else b'id: 7\nevent: tool\ndata: {"name":"partial"}\n\n'
    )
    body = Chunks(b": keepalive\n\n" if empty else payload)
    seen = []
    emitted = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=body)

    with httpx.Client(transport=httpx.MockTransport(handler)) as external:
        with Iskra(api_key="k", base_url="http://test.invalid", http_client=external) as client:
            stream = (
                client.openai.stream_chat_completions({"model": "iskra", "messages": []})
                if openai
                else client.runs.events("r")
            )
            with pytest.raises(ProtocolError):
                with stream as events:
                    emitted.extend(events)
    assert body.closed
    assert len(seen) == 1
    assert len(emitted) == (0 if empty else 1)
    if emitted and not openai:
        assert emitted[0].id == "7"


@pytest.mark.parametrize("openai", [False, True])
@pytest.mark.parametrize("empty", [False, True])
async def test_async_premature_eof_is_error_and_keeps_last_event(openai, empty):
    payload = (
        b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
        if openai
        else b'id: 7\nevent: tool\ndata: {"name":"partial"}\n\n'
    )
    body = AsyncChunks(b": keepalive\n\n" if empty else payload)
    seen = []
    emitted = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=body)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as external:
        async with AsyncIskra(
            api_key="k", base_url="http://test.invalid", http_client=external
        ) as client:
            stream = (
                client.openai.stream_chat_completions({"model": "iskra", "messages": []})
                if openai
                else client.runs.events("r")
            )
            with pytest.raises(ProtocolError):
                async with stream as events:
                    async for event in events:
                        emitted.append(event)
    assert body.closed
    assert len(seen) == 1
    assert len(emitted) == (0 if empty else 1)
    if emitted and not openai:
        assert emitted[0].id == "7"
