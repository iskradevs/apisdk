import asyncio
import io
import json
import time

import httpx
import pytest

import iskra_sdk as sdk


def client_for(handler, **kwargs):
    http_client = httpx.Client(transport=httpx.MockTransport(handler), follow_redirects=True)
    return sdk.Iskra(
        api_key="isk_secret",
        base_url="https://test.invalid/prefix/",
        http_client=http_client,
        **kwargs,
    )


def test_chat_preserves_wire_fields_and_options():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "conversation_id": "c",
                "status": "completed",
                "answer": "ok",
                "usage": {"input_tokens": 1, "output_tokens": 2},
            },
        )

    with client_for(handler) as client:
        for skills in ({}, {"skills": None}, {"skills": []}):
            result = client.chat.create(
                {"message": "hi", "iskra_exec": skills},
                options=sdk.RequestOptions(idempotency_key="key", run_as="p", timeout_seconds=4),
            )
            assert result["answer"] == "ok"
    assert [json.loads(r.content)["iskra_exec"] for r in requests] == [
        {},
        {"skills": None},
        {"skills": []},
    ]
    assert all(r.url == "https://test.invalid/prefix/api/v1/chat" for r in requests)
    assert all(r.headers["authorization"] == "Bearer isk_secret" for r in requests)
    assert all(r.headers["x-iskra-run-as"] == "p" for r in requests)
    assert all(r.headers["idempotency-key"] == "key" for r in requests)
    assert requests[0].extensions["timeout"]["read"] == 4


@pytest.mark.parametrize(
    "operation,method,path,kwargs,body",
    [
        ("chat.delete", "DELETE", "/api/v1/chat/a%2Fb", {"conversation_id": "a/b"}, None),
        (
            "runs.create",
            "POST",
            "/api/v1/runs",
            {"request": {"message": "hi", "files": [{"id": "f"}]}},
            {"message": "hi", "files": [{"id": "f"}]},
        ),
        ("runs.get", "GET", "/api/v1/runs/a%2Fb?after=9", {"run_id": "a/b", "after": 9}, None),
        ("runs.cancel", "DELETE", "/api/v1/runs/r", {"run_id": "r"}, None),
        ("skills.list", "GET", "/api/v1/skills", {}, None),
        ("specialists.list", "GET", "/api/v1/specialists", {}, None),
        ("exec_plan.defaults", "GET", "/api/v1/exec-plan/defaults", {}, None),
        (
            "conversations.create",
            "POST",
            "/api/v1/conversations",
            {"request": {"memory_refs": [], "ttl_seconds": 0}},
            {"memory_refs": [], "ttl_seconds": 0},
        ),
        ("conversations.context", "GET", "/api/v1/chat/c/context", {"conversation_id": "c"}, None),
        (
            "conversations.set_workspace",
            "PUT",
            "/api/v1/chat/c/workspace",
            {"conversation_id": "c", "directory_id": "d"},
            {"directory_id": "d"},
        ),
        (
            "conversations.clear_workspace",
            "DELETE",
            "/api/v1/chat/c/workspace",
            {"conversation_id": "c"},
            None,
        ),
        (
            "conversations.add_memory_ref",
            "POST",
            "/api/v1/chat/c/memory-refs",
            {"conversation_id": "c", "reference": {"collection_id": "col", "access_mode": "read"}},
            {"collection_id": "col", "access_mode": "read"},
        ),
        (
            "conversations.update_memory_ref",
            "PATCH",
            "/api/v1/chat/c/memory-refs/ref%2Fid",
            {"conversation_id": "c", "ref_id": "ref/id", "access_mode": "write"},
            {"access_mode": "write"},
        ),
        (
            "conversations.delete_memory_ref",
            "DELETE",
            "/api/v1/chat/c/memory-refs/ref",
            {"conversation_id": "c", "ref_id": "ref"},
            None,
        ),
        (
            "memory.browse",
            "GET",
            "/api/v1/memory/browse?q=a%26b&limit=2&candidates=true",
            {"query": {"q": "a&b", "limit": 2, "candidates": True}},
            None,
        ),
        ("memory.collections", "GET", "/api/v1/memory/collections", {}, None),
        (
            "memory.collection_members",
            "GET",
            "/api/v1/memory/collections/col%2Fid/members",
            {"collection_id": "col/id"},
            None,
        ),
        (
            "memory.create_root",
            "POST",
            "/api/v1/memory/resources/roots",
            {"name": "Root"},
            {"name": "Root"},
        ),
        (
            "memory.create_folder",
            "POST",
            "/api/v1/memory/resources/folders",
            {"directory_id": "d", "path": "a/b"},
            {"directory_id": "d", "path": "a/b"},
        ),
        (
            "apps.get",
            "GET",
            "/api/v1/apps/app%2Fid?version=1%2B2",
            {"app_id": "app/id", "version": "1+2"},
            None,
        ),
        ("openai.models", "GET", "/api/openai/v1/models", {}, None),
        (
            "openai.chat_completions",
            "POST",
            "/api/openai/v1/chat/completions",
            {"request": {"model": "iskra", "messages": [{"role": "user", "content": "hi"}]}},
            {"model": "iskra", "messages": [{"role": "user", "content": "hi"}], "stream": False},
        ),
    ],
)
def test_all_json_routes(operation, method, path, kwargs, body):
    seen = []

    def handler(request):
        seen.append(request)
        return (
            httpx.Response(204)
            if operation.endswith(("delete", "delete_memory_ref"))
            else httpx.Response(200, json={"ok": True})
        )

    with client_for(handler) as client:
        namespace, name = operation.split(".")
        result = getattr(getattr(client, namespace), name)(**kwargs)
    assert len(seen) == 1
    assert seen[0].method == method
    assert seen[0].url.raw_path.decode() == "/prefix" + path
    assert (json.loads(seen[0].content) if seen[0].content else None) == body
    assert result is None or result == {"ok": True}


@pytest.mark.parametrize(
    "body,status,code",
    [
        (
            {
                "error": {"code": "structured_output_failed", "message": "bad"},
                "answer": "partial",
                "conversation_id": "c",
            },
            422,
            "structured_output_failed",
        ),
        (
            {
                "type": "about:blank",
                "title": "Unavailable",
                "status": 503,
                "code": "dependency",
                "request_id": "body-rid",
            },
            503,
            "dependency",
        ),
        (
            {"error": {"code": "rate_limited", "type": "rate_limit_error", "message": "slow"}},
            429,
            "rate_limited",
        ),
    ],
)
def test_http_errors_preserve_body_and_never_retry(body, status, code):
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(
            status, json=body, headers={"X-Request-ID": "rid", "Retry-After": "17"}
        )

    with client_for(handler) as client, pytest.raises(sdk.APIError) as exc:
        client.chat.create({"message": "hi"})
    assert len(requests) == 1
    assert exc.value.status_code == status
    assert exc.value.code == code
    assert exc.value.request_id == "rid"
    assert exc.value.retry_after == "17"
    assert exc.value.body == body
    assert "isk_secret" not in repr(exc.value)
    if status == 422:
        assert exc.value.answer == "partial"
        assert exc.value.conversation_id == "c"


def test_bounded_malformed_error_and_redaction():
    with client_for(lambda _: httpx.Response(502, text="<html>isk_secret" + "x" * 30000)) as client:
        with pytest.raises(sdk.APIError) as exc:
            client.skills.list()
        assert len(exc.value.body) <= 8192
        assert "isk_secret" not in str(exc.value)
        assert "isk_secret" not in repr(client)


@pytest.mark.parametrize(
    "exception,expected",
    [(httpx.ReadTimeout, "RequestTimeoutError"), (httpx.ConnectError, "NetworkError")],
)
def test_transport_errors_are_distinct(exception, expected):
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        raise exception("isk_secret", request=request)

    with client_for(handler) as client, pytest.raises(getattr(sdk, expected)) as exc:
        client.runs.create({"message": "hi"})
    assert calls == 1
    assert "isk_secret" not in repr(exc.value)


def test_redirect_is_not_followed_even_with_injected_client():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(307, headers={"location": "https://evil.invalid/steal"})

    with client_for(handler) as client, pytest.raises(sdk.APIError):
        client.skills.list()
    assert len(calls) == 1


def test_clients_keep_injected_http_client_open_and_close_owned():
    external = httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json={})))
    with sdk.Iskra(api_key="k", base_url="http://test.invalid", http_client=external):
        pass
    assert not external.is_closed
    external.close()
    with sdk.Iskra(api_key="k", base_url="http://test.invalid") as owned:
        pass
    with pytest.raises(RuntimeError):
        owned.skills.list()


@pytest.mark.parametrize(
    "url",
    [
        "ftp://test.invalid",
        "https://u:p@test.invalid",
        "https://test.invalid?q=x",
        "https://test.invalid/#frag",
    ],
)
def test_invalid_base_url_rejected(url):
    with pytest.raises(ValueError):
        sdk.Iskra(api_key="k", base_url=url)


def test_apps_reject_delegation_and_runs_reject_inline_files():
    with client_for(
        lambda _: pytest.fail("HTTP request should not be sent"), run_as="delegate"
    ) as client:
        with pytest.raises(ValueError, match="run_as"):
            client.apps.get("a", version="1")
        with pytest.raises(ValueError, match="file"):
            client.runs.create(
                {
                    "message": "x",
                    "files": [{"content_base64": "eA==", "name": "x", "mime": "text/plain"}],
                }
            )


def test_multipart_uploads_and_downloads():
    seen = []

    def handler(request):
        seen.append(request)
        return (
            httpx.Response(200, content=b"binary\x00")
            if request.method == "GET"
            else httpx.Response(201, json={"files": [{"id": "f"}]})
        )

    file = io.BytesIO(b"hello\x00")
    with client_for(handler) as client:
        client.files.upload(
            [sdk.UploadFile("source.txt", file, "text/plain")], conversation_id="c", ttl_seconds=0
        )
        client.memory.upload(
            "d",
            sdk.UploadFile("source.txt", file),
            path="input/source.txt",
            conflict_policy="rename",
        )
        client.apps.create(sdk.UploadFile("bundle.zip", file), title="Title", activate=False)
        client.apps.publish_version("a/b", sdk.UploadFile("bundle.zip", file), activate=True)
        with client.files.download("c/id", "folder/файл #?.txt") as response:
            assert b"".join(response.iter_bytes()) == b"binary\x00"
        with client.memory.download("f/id", directory_id="d&x") as response:
            assert response.read() == b"binary\x00"
    assert not file.closed
    assert b'name="file"; filename="source.txt"' in seen[0].content
    assert b'name="conversation_id"\r\n\r\nc' in seen[0].content
    assert b'name="ttl_seconds"\r\n\r\n0' in seen[0].content
    assert b'name="directory_id"\r\n\r\nd' in seen[1].content
    assert b'name="bundle"; filename="bundle.zip"' in seen[2].content
    assert seen[2].url.raw_path == b"/prefix/api/v1/apps?activate=false"
    assert seen[3].url.raw_path == b"/prefix/api/v1/apps/a%2Fb/versions?activate=true"
    assert (
        seen[4].url.raw_path
        == b"/prefix/api/v1/chat/c%2Fid/files/folder/%D1%84%D0%B0%D0%B9%D0%BB%20%23%3F.txt"
    )
    assert (
        seen[5].url.raw_path
        == b"/prefix/api/v1/memory/resources/files/f%2Fid/content?directory_id=d%26x"
    )


@pytest.mark.parametrize("status", ["completed", "failed", "cancelled", "interaction_required"])
def test_wait_uses_cursor_and_run_as_and_returns_every_terminal(status):
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(
            200,
            json={
                "run_id": "r",
                "status": "running" if len(seen) == 1 else status,
                "next_after": 8,
                "events": [],
            },
        )

    with client_for(handler, run_as="p") as client:
        result = client.runs.wait("r", timeout_seconds=1, poll_interval_seconds=0.001, after=3)
    assert result["status"] == status
    assert [r.url.params["after"] for r in seen] == ["3", "8"]
    assert all(r.headers["x-iskra-run-as"] == "p" for r in seen)


def test_wait_timeout_is_bounded_and_never_cancels():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(
            200, json={"run_id": "r", "status": "running", "next_after": 2, "events": []}
        )

    start = time.monotonic()
    with client_for(handler) as client, pytest.raises(sdk.WaitTimeoutError) as exc:
        client.runs.wait("r", timeout_seconds=0.025, poll_interval_seconds=10)
    assert time.monotonic() - start < 0.5
    assert exc.value.run_id == "r"
    assert all(r.method == "GET" for r in seen)
    assert seen[0].extensions["timeout"]["read"] <= 0.025


async def test_async_client_routes_and_ownership():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, json={"status": "completed", "next_after": 0})

    external = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    async with sdk.AsyncIskra(
        api_key="key", base_url="https://test.invalid", http_client=external, run_as="p"
    ) as client:
        await client.files.upload([sdk.UploadFile("x", io.BytesIO(b"data"))])
        await client.chat.create({"message": "hi"})
        result = await client.runs.wait("r", timeout_seconds=1)
        assert result["status"] == "completed"
    assert not external.is_closed
    assert all(r.headers["x-iskra-run-as"] == "p" for r in seen)
    await external.aclose()


async def test_async_wait_deadline_cancels_local_request_only():
    seen = []

    async def handler(request):
        seen.append(request)
        await asyncio.sleep(1)
        return httpx.Response(200, json={})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as external:
        async with sdk.AsyncIskra(
            api_key="k", base_url="http://test.invalid", http_client=external
        ) as client:
            with pytest.raises(sdk.WaitTimeoutError):
                await client.runs.wait("r", timeout_seconds=0.01)
    assert [r.method for r in seen] == ["GET"]


@pytest.mark.parametrize(
    "path",
    [
        "https://evil.invalid/a",
        "data:text/plain,x",
        "C:foo",
        "//evil.invalid/a",
        "a\\b",
        "a/../b",
        "/abs",
        "a//b",
    ],
)
def test_artifact_download_rejects_nonrelative_paths(path):
    with client_for(lambda _: pytest.fail("must not request")) as client, pytest.raises(ValueError):
        with client.files.download("c", path):
            pass


def test_malformed_error_stream_read_is_bounded():
    class EndlessHTML(httpx.SyncByteStream):
        count = 0
        closed = False

        def __iter__(self):
            for _ in range(50):
                self.count += 1
                yield b"<html>" * 1024

        def close(self):
            self.closed = True

    body = EndlessHTML()
    with (
        client_for(
            lambda _: httpx.Response(502, headers={"content-type": "text/html"}, stream=body)
        ) as client,
        pytest.raises(sdk.APIError),
    ):
        client.runs.get("r")
    assert body.closed
    assert body.count <= 2


async def test_async_error_stream_read_is_bounded():
    class EndlessHTML(httpx.AsyncByteStream):
        count = 0
        closed = False

        async def __aiter__(self):
            for _ in range(50):
                self.count += 1
                yield b"<html>" * 1024

        async def aclose(self):
            self.closed = True

    body = EndlessHTML()
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(502, headers={"content-type": "text/html"}, stream=body)
        )
    ) as external:
        async with sdk.AsyncIskra(
            api_key="k", base_url="http://test.invalid", http_client=external
        ) as client:
            with pytest.raises(sdk.APIError):
                await client.runs.get("r")
    assert body.closed
    assert body.count <= 2


def test_json_error_preserves_long_partial_answer():
    answer = "Материал " * 3000
    body = {
        "error": {"code": "structured_output_failed", "message": "failed"},
        "conversation_id": "c",
        "answer": answer,
    }
    with (
        client_for(lambda _: httpx.Response(422, json=body)) as client,
        pytest.raises(sdk.APIError) as exc,
    ):
        client.chat.create({"message": "x"})
    assert exc.value.answer == answer
    assert exc.value.body == body


def test_memory_download_encodes_representation_query():
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(200, content=b"asset")

    with client_for(handler) as client:
        with client.memory.download(
            "f", directory_id="d", format="spreadsheet-asset", asset="styles/a&b.css", download=True
        ) as response:
            assert response.read() == b"asset"
    assert dict(seen[0].url.params) == {
        "directory_id": "d",
        "format": "spreadsheet-asset",
        "asset": "styles/a&b.css",
        "download": "1",
    }
