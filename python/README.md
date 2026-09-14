# Искра Python SDK

`iskra-api-sdk` provides typed synchronous and asynchronous clients for the
Искра bearer API. Python 3.11 or newer is required. Responses are ordinary
Python dictionaries; unknown server fields remain available at runtime.

```bash
pip install iskra-api-sdk
```

```python
import os
from iskra_sdk import Iskra

with Iskra(api_key=os.environ["ISKRA_API_KEY"], base_url=os.environ["ISKRA_BASE_URL"]) as client:
    answer = client.chat.create({"message": "Составь план встречи"})
    print(answer.get("answer", ""))
```

`base_url` is the deployment origin with an optional reverse-proxy prefix,
for example `https://iskra.example/team`; omit `/api/v1`. Both `base_url` and
`api_key` are required. The SDK preserves the prefix, encodes path segments
and queries, and disables redirects, including for injected HTTPX clients.
Artifact downloads take a conversation ID and a relative path, rather than
an arbitrary URL.

The default `timeout_seconds=120` is an HTTPX **per-phase timeout** (connect,
read, write and pool), not a total request deadline. Override it on the client
or with `RequestOptions(timeout_seconds=...)`. The SDK performs **zero automatic
retries**, including on connection errors, 429/503, and SSE disconnects.

```python
from iskra_sdk import RequestOptions

options = RequestOptions(idempotency_key="job-2026-09-14", run_as="profile-id")
```

A client-level `run_as="profile-id"` applies consistently to upload, create,
poll, events, cancel and download. Per-call `RequestOptions.run_as` overrides
it; `None` inherits the client value. Keep the same delegation context for
an entire workflow. Apps publication rejects `run_as` locally; use a client
without delegation for Apps. `Idempotency-Key` on native chat deduplicates
conversation creation and **does not guarantee replay of the turn**. Creating
an async run with the same key returns its previous `run_id`; the SDK never
resubmits it automatically.

Both clients own the HTTPX client they create. `with Iskra(...)` closes it;
`async with AsyncIskra(...)` awaits closure. You can also call `close()` or
`aclose()`. An injected `http_client=httpx.Client(...)` or `httpx.AsyncClient(...)`
remains caller-owned. Its transport, proxy settings and event hooks remain the
caller's responsibility.

## Methods

Async methods mirror the sync names; await calls that return JSON. Download
and SSE methods return context managers: use `with` or `async with` directly.

| Namespace | Methods |
| --- | --- |
| `chat` | `create(request)`, `delete(conversation_id)` |
| `files` | `upload(files, ...)`, `download(conversation_id, path)` |
| `runs` | `create(request)`, `get(run_id, after=...)`, `cancel(run_id)`, `events(run_id, after=...)`, `wait(run_id, ...)` |
| `skills` | `list()` |
| `specialists` | `list()` |
| `exec_plan` | `defaults()` |
| `conversations` | `create(request)`, `context(id)`, `set_workspace(id, directory_id)`, `clear_workspace(id)`, `add_memory_ref(id, reference)`, `update_memory_ref(id, ref_id, access_mode)`, `delete_memory_ref(id, ref_id)` |
| `memory` | `browse(query)`, `collections()`, `collection_members(id)`, `create_root(name)`, `create_folder(directory_id, path)`, `upload(directory_id, file, ...)`, `download(file_id, directory_id=...)` |
| `apps` | `create(bundle, ...)`, `publish_version(id, bundle, ...)`, `get(id, version=...)` |
| `openai` | `models()`, `chat_completions(request)`, `stream_chat_completions(request)` |

Every method accepts `options=RequestOptions(...)`. Request and response types
are exported from `iskra_sdk.types`, including `ChatRequest`, `RunRequest`,
`IskraExec`, `RunSnapshot` and `ConversationRequest`. Wire keys use `snake_case`.
`{"iskra_exec": {}}`, `{"iskra_exec": {"skills": None}}` and
`{"iskra_exec": {"skills": []}}` remain distinct JSON bodies. Omitted/null
skills select automatically; `[]` explicitly selects no skills, subject to
mandatory skills enforced by the server. Specialist IDs must be strings.

Native chat supports inline base64 files or uploaded file IDs. Async server
runs accept only uploaded file IDs; an inline file is rejected before HTTP.
Uploaded IDs are **version IDs for one next turn of that conversation**. Use
returned conversation and file IDs together, and upload again for another turn
when needed. `UploadFile(filename, binary_handle, content_type)` streams a
caller-owned binary file; the SDK never closes it. HTTPX rewinds seekable
streams to their beginning and uploads the whole file, regardless of their
initial position. For a selected slice, pass bytes containing that slice. Multipart chat uses repeated `file` parts; Memory
uses `file`, Apps uses `bundle`. Memory `conflict_policy` is `create` or `rename`.
Memory downloads also accept `download=True` and representation query options
`format="pdf"`, `"spreadsheet"` or `"spreadsheet-asset"`, with `asset` for
spreadsheet assets.

## Async workflow

```python
import asyncio
import os
from iskra_sdk import AsyncIskra, RequestOptions, UploadFile


async def main():
    async with AsyncIskra(
        api_key=os.environ["ISKRA_API_KEY"], base_url=os.environ["ISKRA_BASE_URL"]
    ) as client:
        conversation = await client.conversations.create({})
        conversation_id = conversation["conversation_id"]
        with open("brief.txt", "rb") as source:
            uploaded = await client.files.upload(
                [UploadFile("brief.txt", source, "text/plain")],
                conversation_id=conversation_id,
            )
        run = await client.runs.create(
            {
                "conversation_id": conversation_id,
                "message": "Прочитай brief.txt и составь план.",
                "files": [{"id": file["id"]} for file in uploaded["files"]],
            },
            options=RequestOptions(idempotency_key="brief-plan-1"),
        )
        snapshot = await client.runs.wait(run["run_id"], timeout_seconds=900)
        print(snapshot["status"], snapshot["result"], snapshot["error"])


asyncio.run(main())
```

See [examples/async_workflow.py](examples/async_workflow.py) for a scenario with
persistent Memory, prepared workspace, chat uploads and streamed artifact
downloads. Those Memory operations require `memory:read` and `memory:write` in
addition to the chat/file scopes. Catalogs expose available skill bundles and
specialist IDs; installation and secret setup remain in the Искра UI.

`runs.wait` returns the terminal snapshot for `completed`, `failed`, `cancelled`
and `interaction_required`; inspect `status`, `result` and `error`. It advances
using the server's `next_after`, including gaps in event positions. Defaults:
900 seconds total wait budget, one second between polls, `after=0`.
`WaitTimeoutError` and cancellation stop local waiting and **never DELETE the
remote run**. Call `runs.cancel(run_id)` explicitly when that is your intent.

Async wait has a strict wall-clock deadline via `asyncio.timeout`. Sync wait
checks its deadline between requests and each response-body chunk, and limits
each HTTPX phase to the remaining budget. An in-flight blocking phase may
finish after the total budget; the next deadline check closes the response.
Sync wait creates no background worker.

## Streaming and downloads

```python
with client.runs.events(run_id, after=0) as events:
    for event in events:
        print(event.event, event.data)
        next_after = int(event.id) + 1  # synthetic terminal id=-1 gives 0
        if should_stop:
            break  # exiting the with block closes the response

# Reconnect only when your application chooses to:
with client.runs.events(run_id, after=next_after) as events:
    for event in events:
        print(event)
```

Run SSE contains **progress metadata, not answer tokens**. Fetch the final
answer with `runs.get`/`runs.wait`. The SSE parser is
[httpx-sse](https://github.com/florimondmanca/httpx-sse); comments, multiline data,
UTF-8 and arbitrary network chunk boundaries are handled by the library.
Terminal events close iteration. EOF before a run terminal event or OpenAI
`[DONE]` raises `ProtocolError`, including a stream that only sent keepalives.
Previously yielded events remain available for your explicit resume decision.
For an existing SSE cursor you may instead
pass `RequestOptions(last_event_id="7")`; an explicit `after` query takes
precedence on the server. No implicit reconnect occurs.

```python
from iskra_sdk import OpenAIChunk, OpenAIDone

with client.openai.stream_chat_completions(
    {
        "model": "iskra",
        "messages": [{"role": "user", "content": "Привет"}],
    }
) as events:
    for event in events:
        if isinstance(event, OpenAIChunk):
            print(event.data)  # includes in-band error envelopes, when sent
        elif isinstance(event, OpenAIDone):
            break

with client.files.download(conversation_id, "reports/answer.md") as response:
    with open("answer.md", "wb") as output:
        for chunk in response.iter_bytes():
            output.write(chunk)
```

Use `async with` and `async for` for async SSE. Async downloads expose HTTPX
`response.aiter_bytes()` and `await response.aread()`. Context managers close
connections on early exit, errors and task cancellation. Download errors and
network failures are normalized by the SDK while inside the context.

OpenAI agent models accept server conversation/`policy`/`iskra_exec` fields
and `response_format.type="text"`. Raw `iskra-llm*` models require `chat:run`
and `llm:raw`; they support client tools and `response_format.type="json_object"`,
and reject the server conversation extensions. `json_schema` belongs to native
chat/run requests, not the OpenAI facade. Availability depends on your deployment.

## Errors

```python
from iskra_sdk import APIError, NetworkError, RequestTimeoutError, WaitTimeoutError

try:
    result = client.chat.create({"message": "Привет"})
except APIError as error:
    print(error.status_code, error.code, error.request_id, error.retry_after)
    # For structured_output_failed (422), the completed turn is retained:
    print(error.conversation_id, error.answer)
    # error.body retains native, Problem Details and OpenAI error fields.
```

`APIError.retry_after` retains the header string (seconds or HTTP-date).
`RequestTimeoutError` subclasses `NetworkError`; catch it first if you need to
distinguish timeout from other transport failures. `ProtocolError` reports
invalid JSON/SSE. Non-JSON error bodies are read up to 8 KiB; malformed JSON
gets an 8 KiB diagnostic preview. JSON error bodies preserve fields such as
partial answers and Apps `approval_required` parameters. Error/client reprs
omit credentials; the server response body is retained as data, so apply your
own logging policy to it. HTTP 409 Apps approval errors may represent an
accepted version awaiting approval; inspect the error parameters and read
`apps.get(app_id, version=...)` explicitly.

The package covers bearer chat, files, runs, catalogs, context, Memory,
publication and OpenAI routes. Session key management and app viewer JWT/secret
routes are outside its scope.

## Development

The public repository is a publish-only mirror. Changes originate in the
private platform repository; no publication occurs during build or tests.

```bash
uv sync --frozen
uv run --frozen pytest
uv run --frozen mypy
uv run --frozen ruff check .
uv build
```

The shared `../contracts/` fixtures are required to run the full test suite.
Wheel and sdist include the MIT license and `py.typed` marker.
