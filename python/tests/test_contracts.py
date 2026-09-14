"""Both clients consume the shared, independently source-audited wire fixtures."""

import inspect
import io
import json
from email.parser import BytesParser
from email.policy import default
from pathlib import Path

import httpx
import pytest

from iskra_sdk import APIError, AsyncIskra, Iskra, RequestOptions, UploadFile

CONTRACTS = Path(__file__).resolve().parents[2] / "contracts"
CASES = json.loads((CONTRACTS / "fixtures.json").read_text())["cases"]
ROUTES = {r["id"]: r for r in json.loads((CONTRACTS / "routes.json").read_text())["operations"]}


def invoke(client, case):
    operation = case["operation"]
    request = case.get("request")
    query = case.get("query", {})
    headers = case.get("request_headers", {})
    options = RequestOptions(
        run_as=headers.get("X-Iskra-Run-As"),
        idempotency_key=headers.get("Idempotency-Key"),
        last_event_id=headers.get("Last-Event-ID"),
    )
    parts = case["path"].split("/")
    namespace, method = ROUTES[operation]["sdk_python"].split(".")
    target = getattr(getattr(client, namespace), method)
    args = []
    kwargs = {"options": options}
    if operation in {
        "chat.create",
        "runs.create",
        "conversations.create",
        "openai.chatCompletions",
    }:
        args = [request]
        if operation == "openai.chatCompletions" and request.get("stream"):
            target = client.openai.stream_chat_completions
    elif operation == "chat.delete":
        args = [parts[4]]
    elif operation.startswith("runs."):
        args = [parts[4]]
        if "after" in query:
            kwargs["after"] = int(query["after"])
    elif operation == "files.download":
        args = [parts[4], "/".join(parts[6:])]
    elif operation.startswith("conversations."):
        args = [parts[4]]
        if operation == "conversations.setWorkspace":
            args += [request["directory_id"]]
        if operation == "conversations.addMemoryRef":
            args += [request]
        if operation in {"conversations.updateMemoryRef", "conversations.deleteMemoryRef"}:
            args += [parts[6]]
        if operation == "conversations.updateMemoryRef":
            args += [request["access_mode"]]
    elif operation == "memory.browse":
        args = [query]
    elif operation == "memory.collectionMembers":
        args = [parts[5]]
    elif operation in {"memory.createRoot", "memory.createFolder"}:
        kwargs.update(request)
    elif operation == "memory.download":
        args = [parts[6]]
        kwargs["directory_id"] = query["directory_id"]
        if "download" in query:
            kwargs["download"] = query["download"] == "1"
    elif operation == "apps.get":
        args = [parts[4]]
        kwargs.update(query)
    if request and "multipart" in request:
        multipart = request["multipart"]
        files = [
            UploadFile(f["filename"], io.BytesIO(f["content"].encode()), f["content_type"])
            for f in multipart["files"]
        ]
        kwargs.update(multipart["fields"])
        if "ttl_seconds" in kwargs:
            kwargs["ttl_seconds"] = int(kwargs["ttl_seconds"])
        if operation == "files.upload":
            args = [files]
        elif operation == "memory.upload":
            args = [kwargs.pop("directory_id"), files[0]]
        elif operation == "apps.create":
            args = [files[0]]
        else:
            args = [parts[4], files[0]]
        if "activate" in query:
            kwargs["activate"] = query["activate"] == "true"
    return target(*args, **kwargs)


def respond(case, seen, request):
    seen.append(request)
    assert request.method == case["method"]
    assert request.url.path == "/prefix" + case["path"]
    assert dict(request.url.params) == case.get("query", {})
    assert request.headers["authorization"] == "Bearer fixture-key"
    for key, value in case.get("request_headers", {}).items():
        assert request.headers[key] == value
    body = case.get("request")
    if body and "multipart" in body:
        message = BytesParser(policy=default).parsebytes(
            b"Content-Type: "
            + request.headers["content-type"].encode()
            + b"\r\n\r\n"
            + request.content
        )
        parts = list(message.iter_parts())
        actual_fields = {
            p.get_param("name", header="content-disposition"): p.get_payload(decode=True).decode()
            for p in parts
            if not p.get_filename()
        }
        assert actual_fields == body["multipart"]["fields"]
        actual_files = [
            {
                "field": p.get_param("name", header="content-disposition"),
                "filename": p.get_filename(),
                "content_type": p.get_content_type(),
                "content": p.get_payload(decode=True).decode(),
            }
            for p in parts
            if p.get_filename()
        ]
        assert actual_files == body["multipart"]["files"]
    elif body is not None:
        expected = dict(body)
        if case["operation"] == "openai.chatCompletions":
            expected.setdefault("stream", False)
        assert json.loads(request.content) == expected
    spec = case["response"]
    response_body = spec.get("body")
    if isinstance(response_body, (dict, list)):
        return httpx.Response(spec["status"], headers=spec.get("headers"), json=response_body)
    return httpx.Response(spec["status"], headers=spec.get("headers"), content=response_body or b"")


def assert_result(case, result):
    if isinstance(case["response"].get("body"), (dict, list)):
        assert result == case["response"]["body"]
    elif case["operation"] in {"files.download", "memory.download"}:
        assert result.decode() == case["response"]["body"]
    elif case["response"]["status"] == 204:
        assert result is None


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["id"])
def test_shared_sync(case):
    seen = []
    with httpx.Client(
        transport=httpx.MockTransport(lambda request: respond(case, seen, request))
    ) as external:
        with Iskra(
            api_key="fixture-key", base_url="https://test.invalid/prefix", http_client=external
        ) as client:
            if case["id"] in {"runs.rejectInline", "apps.versionRequired"}:
                with pytest.raises((ValueError, TypeError)):
                    invoke(client, case)
                assert not seen
                return
            if case["response"]["status"] >= 400:
                with pytest.raises(APIError) as exc:
                    invoke(client, case)
                assert exc.value.body == case["response"]["body"]
            else:
                result = invoke(client, case)
                if hasattr(result, "__enter__"):
                    with result as stream:
                        result = (
                            stream.read() if isinstance(stream, httpx.Response) else list(stream)
                        )
                assert_result(case, result)
            assert len(seen) == 1


@pytest.mark.parametrize("case", CASES, ids=lambda c: c["id"])
async def test_shared_async(case):
    seen = []
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda request: respond(case, seen, request))
    ) as external:
        async with AsyncIskra(
            api_key="fixture-key", base_url="https://test.invalid/prefix", http_client=external
        ) as client:

            async def call():
                value = invoke(client, case)
                return await value if inspect.isawaitable(value) else value

            if case["id"] in {"runs.rejectInline", "apps.versionRequired"}:
                with pytest.raises((ValueError, TypeError)):
                    await call()
                assert not seen
                return
            if case["response"]["status"] >= 400:
                with pytest.raises(APIError) as exc:
                    await call()
                assert exc.value.body == case["response"]["body"]
            else:
                result = await call()
                if hasattr(result, "__aenter__"):
                    async with result as stream:
                        result = (
                            await stream.aread()
                            if isinstance(stream, httpx.Response)
                            else [e async for e in stream]
                        )
                assert_result(case, result)
            assert len(seen) == 1


def test_shared_examples_cover_every_bearer_operation():
    assert {c["operation"] for c in CASES} == set(ROUTES)
