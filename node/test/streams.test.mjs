import assert from "node:assert/strict";
import { test } from "node:test";
import * as sdk from "../dist/esm/index.js";
const encoder = new TextEncoder();
const config = { apiKey: "key", baseUrl: "https://host.invalid/prefix", runAs: "profile1" };
function streamResponse(text, onCancel = () => {}, keepOpen = false) {
  const bytes = encoder.encode(text);
  let offset = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset < bytes.length) controller.enqueue(bytes.slice(offset, ++offset));
        else if (!keepOpen) controller.close();
      },
      cancel: onCancel,
    }),
    { headers: { "content-type": "text/event-stream; charset=utf-8" } },
  );
}

test("run SSE parses partial UTF8, CRLF, multiline data, comments and unknown JSON", async () => {
  const client = new sdk.Iskra({
    ...config,
    fetch: async (url, init) => {
      assert.equal(String(url), config.baseUrl + "/api/v1/runs/run%2F1/events?after=7");
      assert.equal(new Headers(init.headers).get("x-iskra-run-as"), "profile1");
      return streamResponse(
        ': ping\r\n\r\nid: 7\r\nevent: content\r\ndata: {"text":"Привет",\r\ndata: "len":6,"unknown":[1]}\r\n\r\nid: -1\nevent: completed\ndata: {"future":true}\n\n',
      );
    },
  });
  const events = [];
  for await (const event of client.runs.events("run/1", { after: 7 })) events.push(event);
  assert.deepEqual(events, [
    { id: "7", kind: "content", data: { text: "Привет", len: 6, unknown: [1] } },
    { id: "-1", kind: "completed", data: { future: true } },
  ]);
});

test("OpenAI SSE yields JSON chunks and stops at DONE separately from run events", async () => {
  let cancelled = false;
  const client = new sdk.Iskra({
    ...config,
    fetch: async (url, init) => {
      assert.equal(String(url), config.baseUrl + "/api/openai/v1/chat/completions");
      assert.equal(JSON.parse(init.body).stream, true);
      return streamResponse(
        'data: {"choices":[{"delta":{"content":"Ж"}}]}\n\ndata: [DONE]\n\ndata: {"ignored":true}\n\n',
        () => {
          cancelled = true;
        },
        true,
      );
    },
  });
  const chunks = [];
  for await (const chunk of client.openai.chatCompletions({
    model: "iskra",
    messages: [],
    stream: true,
  }))
    chunks.push(chunk);
  assert.deepEqual(chunks, [{ choices: [{ delta: { content: "Ж" } }] }]);
  assert.equal(cancelled, true);
});

test("run SSE exposes non-JSON data without losing it and never reconnects", async () => {
  let calls = 0;
  const client = new sdk.Iskra({
    ...config,
    fetch: async () => {
      calls++;
      return streamResponse("event: future\ndata: plain\n\nevent: completed\ndata: {}\n\n");
    },
  });
  const events = [];
  for await (const event of client.runs.events("r1")) events.push(event);
  assert.deepEqual(events, [
    { kind: "future", data: "plain" },
    { kind: "completed", data: {} },
  ]);
  assert.equal(calls, 1);
});

test("breaking run stream releases response body", async () => {
  let cancelled = false;
  const client = new sdk.Iskra({
    ...config,
    fetch: async () =>
      streamResponse(
        "id: 1\nevent: started\ndata: {}\n\n",
        () => {
          cancelled = true;
        },
        true,
      ),
  });
  for await (const event of client.runs.events("r1")) {
    assert.equal(event.kind, "started");
    break;
  }
  assert.equal(cancelled, true);
});

test("aborting SSE and its deadline release a stalled response body", async () => {
  for (const mode of ["abort", "timeout"]) {
    let cancelled = false;
    const controller = new AbortController();
    const client = new sdk.Iskra({
      ...config,
      timeoutMs: mode === "timeout" ? 15 : 1000,
      fetch: async () =>
        streamResponse(
          "",
          () => {
            cancelled = true;
          },
          true,
        ),
    });
    const iterator = client.runs.events("r1", {}, { signal: controller.signal });
    const next = iterator.next();
    if (mode === "abort") setTimeout(() => controller.abort(), 5);
    await assert.rejects(next, mode === "abort" ? sdk.AbortError : sdk.TimeoutError);
    assert.equal(cancelled, true);
  }
});

test("download is streaming, early cancel releases body and timeout remains active", async () => {
  for (const mode of ["cancel", "timeout"]) {
    let cancelled = false;
    const client = new sdk.Iskra({
      ...config,
      timeoutMs: mode === "timeout" ? 15 : 1000,
      fetch: async () =>
        streamResponse(
          "",
          () => {
            cancelled = true;
          },
          true,
        ),
    });
    const response = await client.files.download("c1", "result.txt");
    assert.equal(response.bodyUsed, false);
    if (mode === "cancel") await response.body.cancel();
    else await assert.rejects(response.text(), sdk.TimeoutError);
    assert.equal(cancelled, true);
  }
});

for (const status of ["completed", "failed", "cancelled", "interaction_required"])
  test(`wait returns ${status} snapshot and uses server next_after`, async () => {
    const seen = [];
    const final = {
      run_id: "r1",
      conversation_id: "c1",
      status,
      next_after: 90,
      result: { answer: "partial" },
      error: status === "failed" ? { code: "failed" } : null,
    };
    const client = new sdk.Iskra({
      ...config,
      fetch: async (url, init) => {
        seen.push(String(url));
        assert.equal(new Headers(init.headers).get("x-iskra-run-as"), "profile1");
        return Response.json(
          seen.length === 1 ? { status: "running", next_after: 42, events: [{ seq: 3 }] } : final,
        );
      },
    });
    assert.deepEqual(
      await client.runs.wait("r1", { after: 4, pollIntervalMs: 1, timeoutMs: 500 }),
      final,
    );
    assert.deepEqual(seen, [
      config.baseUrl + "/api/v1/runs/r1?after=4",
      config.baseUrl + "/api/v1/runs/r1?after=42",
    ]);
  });

test("wait has overall deadline, aborts current request and never cancels server run", async () => {
  const methods = [];
  const client = new sdk.Iskra({
    ...config,
    fetch: async (_, init) => {
      methods.push(init.method);
      return new Promise((resolve, reject) =>
        init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }),
      );
    },
  });
  const start = Date.now();
  await assert.rejects(
    client.runs.wait("r1", { timeoutMs: 20, pollIntervalMs: 1 }),
    sdk.TimeoutError,
  );
  assert.ok(Date.now() - start < 500);
  assert.deepEqual(methods, ["GET"]);
});

test("wait keeps its overall budget separate from the individual HTTP timeout", async () => {
  let calls = 0;
  const final = { run_id: "r1", status: "completed", next_after: 2 };
  const client = new sdk.Iskra({
    ...config,
    timeoutMs: 40,
    fetch: async () => Response.json(++calls === 1 ? { status: "running", next_after: 1 } : final),
  });
  assert.deepEqual(await client.runs.wait("r1", { pollIntervalMs: 60 }), final);
  assert.equal(calls, 2);
});

test("OpenAI SSE preserves an in-band error envelope after HTTP 200", async () => {
  const error = {
    error: { code: "upstream_failed", type: "server_error", message: "provider unavailable" },
  };
  const client = new sdk.Iskra({
    ...config,
    fetch: async () => streamResponse("data: " + JSON.stringify(error) + "\n\ndata: [DONE]\n\n"),
  });
  const chunks = [];
  for await (const chunk of client.openai.chatCompletions({
    model: "iskra-agent",
    messages: [],
    stream: true,
  }))
    chunks.push(chunk);
  assert.deepEqual(chunks, [error]);
});

test("wait aborts during polling delay without issuing another request or server DELETE", async () => {
  const controller = new AbortController();
  const methods = [];
  const client = new sdk.Iskra({
    ...config,
    fetch: async (_, init) => {
      methods.push(init.method);
      setTimeout(() => controller.abort(), 5);
      return Response.json({ status: "running", next_after: 2 });
    },
  });
  await assert.rejects(
    client.runs.wait("r1", { signal: controller.signal, timeoutMs: 1000, pollIntervalMs: 500 }),
    sdk.AbortError,
  );
  assert.deepEqual(methods, ["GET"]);
});

test("aborting while the stream consumer is paused releases the HTTP body immediately", async () => {
  let cancelled = false;
  const controller = new AbortController();
  const client = new sdk.Iskra({
    ...config,
    fetch: async () =>
      streamResponse(
        "event: started\ndata: {}\n\n",
        () => {
          cancelled = true;
        },
        true,
      ),
  });
  const iterator = client.runs.events("r1", {}, { signal: controller.signal });
  await iterator.next();
  controller.abort();
  try {
    assert.equal(cancelled, true);
  } finally {
    await iterator.return();
  }
});

for (const kind of ["completed", "failed", "cancelled", "interaction_required"])
  test(`run SSE closes after terminal ${kind} even when the server keeps the connection open`, async () => {
    let cancelled = false;
    const client = new sdk.Iskra({
      ...config,
      timeoutMs: 30,
      fetch: async () =>
        streamResponse(
          `id: 4\nevent: ${kind}\ndata: {}\n\n`,
          () => {
            cancelled = true;
          },
          true,
        ),
    });
    const events = [];
    for await (const event of client.runs.events("r1")) events.push(event);
    assert.deepEqual(events, [{ id: "4", kind, data: {} }]);
    assert.equal(cancelled, true);
  });

for (const surface of ["runs", "openai"])
  test(`${surface} rejects a disconnected stream before completion and preserves emitted progress`, async () => {
    let calls = 0;
    const wire =
      surface === "runs"
        ? 'id: 7\nevent: tool\ndata: {"name":"read_file"}\n\n'
        : 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n';
    const client = new sdk.Iskra({
      ...config,
      fetch: async () => {
        calls++;
        return streamResponse(wire);
      },
    });
    const iterator =
      surface === "runs"
        ? client.runs.events("r1")
        : client.openai.chatCompletions({ model: "iskra-agent", messages: [], stream: true });
    const first = await iterator.next();
    assert.equal(first.done, false);
    if (surface === "runs") assert.equal(first.value.id, "7");
    else assert.equal(first.value.choices[0].delta.content, "partial");
    await assert.rejects(iterator.next(), sdk.ProtocolError);
    assert.equal(calls, 1);
  });
