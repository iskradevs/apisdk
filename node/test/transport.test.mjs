import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { inspect } from "node:util";
import * as sdk from "../dist/esm/index.js";

async function server(t, handler) {
  const http = createServer(handler);
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  t.after(() => {
    http.closeAllConnections();
    http.close();
  });
  return `http://127.0.0.1:${http.address().port}/prefix`;
}

test("real HTTP sends auth, runAs, idempotency and actual multipart boundary", async (t) => {
  const received = [];
  const baseUrl = await server(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    res.setHeader("Content-Type", "application/json");
    res.end("{}");
  });
  const client = new sdk.Iskra({ apiKey: "isk_test", baseUrl, runAs: "profile1" });
  await client.chat.create({ message: "hello" }, { idempotencyKey: "explicit" });
  await client.files.upload({ files: [{ name: "x.txt", data: new Blob(["payload"]) }] });
  assert.equal(received[0].url, "/prefix/api/v1/chat");
  assert.equal(received[0].headers.authorization, "Bearer isk_test");
  assert.equal(received[0].headers["x-iskra-run-as"], "profile1");
  assert.equal(received[0].headers["idempotency-key"], "explicit");
  assert.deepEqual(JSON.parse(received[0].body), { message: "hello" });
  const boundary = received[1].headers["content-type"].split("boundary=")[1];
  assert.ok(boundary);
  assert.ok(received[1].body.includes("--" + boundary));
  assert.ok(received[1].body.includes('name="file"; filename="x.txt"'));
  assert.equal(received[1].headers["x-iskra-run-as"], "profile1");
});

for (const [status, body, code, message] of [
  [
    403,
    {
      type: "about:blank",
      status: 403,
      code: "insufficient_scope",
      detail: "denied",
      request_id: "body-id",
    },
    "insufficient_scope",
    "denied",
  ],
  [
    422,
    {
      error: { code: "structured_output_failed", message: "conversion failed" },
      answer: "partial answer",
      conversation_id: "c1",
    },
    "structured_output_failed",
    "conversion failed",
  ],
  [
    429,
    { error: { type: "rate_limit_error", code: "limited", message: "wait" } },
    "limited",
    "wait",
  ],
])
  test(`normalizes HTTP ${status} and retains raw JSON`, async () => {
    const client = new sdk.Iskra({
      apiKey: "isk_test",
      baseUrl: "https://host.invalid",
      fetch: async () =>
        Response.json(body, { status, headers: { "x-request-id": "req1", "retry-after": "12" } }),
    });
    await assert.rejects(client.chat.create({ message: "go" }), (error) => {
      assert.ok(error instanceof sdk.APIError);
      assert.equal(error.status, status);
      assert.equal(error.code, code);
      assert.equal(error.message, message);
      assert.equal(error.requestID, "req1");
      assert.equal(error.retryAfter, "12");
      assert.deepEqual(error.rawBody, body);
      return true;
    });
  });

test("caps non-JSON response and redacts credentials from error inspection", async () => {
  const client = new sdk.Iskra({
    apiKey: "isk_SECRET",
    baseUrl: "https://host.invalid",
    fetch: async () =>
      new Response("Authorization: Bearer isk_SECRET " + "x".repeat(20000), { status: 502 }),
  });
  await assert.rejects(client.chat.create({ message: "go" }), (error) => {
    assert.ok(error instanceof sdk.APIError);
    assert.ok(error.rawBody.length <= 8192);
    assert.ok(!inspect(error, { depth: 10 }).includes("isk_SECRET"));
    assert.ok(!String(error).includes("isk_SECRET"));
    assert.ok(!JSON.stringify(error).includes("isk_SECRET"));
    return true;
  });
});

test("never replays failed POST even with an idempotency key", async () => {
  let calls = 0;
  const client = new sdk.Iskra({
    apiKey: "key",
    baseUrl: "https://host.invalid",
    fetch: async () => {
      calls++;
      return Response.json({ error: { code: "busy" } }, { status: 503 });
    },
  });
  await assert.rejects(
    client.chat.create({ message: "go" }, { idempotencyKey: "same" }),
    sdk.APIError,
  );
  assert.equal(calls, 1);
});

test("never sends auth to a redirect destination", async (t) => {
  let targetCalls = 0;
  const target = await server(t, (_, res) => {
    targetCalls++;
    res.end("{}");
  });
  const baseUrl = await server(t, (_, res) => {
    res.writeHead(307, { location: target });
    res.end();
  });
  const client = new sdk.Iskra({ apiKey: "key", baseUrl });
  await assert.rejects(
    client.chat.create({ message: "go" }),
    (error) => error instanceof sdk.APIError && error.status === 307,
  );
  assert.equal(targetCalls, 0);
});

test("distinguishes network failure, timeout and caller cancellation", async (t) => {
  const client = new sdk.Iskra({
    apiKey: "key",
    baseUrl: "https://host.invalid",
    fetch: async () => {
      throw new TypeError("fetch failed");
    },
  });
  await assert.rejects(client.skills.list(), sdk.NetworkError);
  const baseUrl = await server(t, () => {});
  const timed = new sdk.Iskra({ apiKey: "key", baseUrl, timeoutMs: 20 });
  await assert.rejects(timed.skills.list(), sdk.TimeoutError);
  const controller = new AbortController();
  const promise = timed.skills.list({ signal: controller.signal, timeoutMs: 1000 });
  controller.abort();
  await assert.rejects(promise, sdk.AbortError);
});

test("Apps rejects delegation without silently dropping runAs", async () => {
  let calls = 0;
  const client = new sdk.Iskra({
    apiKey: "key",
    baseUrl: "https://host.invalid",
    runAs: "p1",
    fetch: async () => {
      calls++;
      return Response.json({});
    },
  });
  await assert.rejects(async () => client.apps.get("a1", { version: "1" }), /runAs/);
  assert.equal(calls, 0);
});

test("validates async attachment IDs and does not transmit inline content", async () => {
  let calls = 0;
  const client = new sdk.Iskra({
    apiKey: "key",
    baseUrl: "https://host.invalid",
    fetch: async () => {
      calls++;
      return Response.json({});
    },
  });
  await assert.rejects(
    async () =>
      client.runs.create({ message: "go", files: [{ name: "x", content_base64: "eA==" }] }),
    /file/i,
  );
  assert.equal(calls, 0);
});

test("timeout cancels JSON bodies after headers, including JSON error responses", async () => {
  for (const status of [200, 503]) {
    let cancelled = false;
    const client = new sdk.Iskra({
      apiKey: "key",
      baseUrl: "https://host.invalid",
      timeoutMs: 15,
      fetch: async () =>
        new Response(
          new ReadableStream({
            cancel() {
              cancelled = true;
            },
          }),
          { status, headers: { "content-type": "application/json" } },
        ),
    });
    await assert.rejects(client.skills.list(), sdk.TimeoutError);
    assert.equal(cancelled, true);
  }
});

test("error inspection redacts reflected credentials in all visible metadata", async () => {
  const client = new sdk.Iskra({
    apiKey: "isk_SECRET",
    baseUrl: "https://host.invalid",
    fetch: async () =>
      Response.json(
        { error: { code: "isk_SECRET", message: "Bearer isk_SECRET" } },
        { status: 500, headers: { "x-request-id": "isk_SECRET", "retry-after": "isk_SECRET" } },
      ),
  });
  await assert.rejects(client.skills.list(), (error) => {
    assert.ok(!inspect(error).includes("isk_SECRET"));
    assert.ok(!JSON.stringify(error).includes("isk_SECRET"));
    return true;
  });
});

test("operation delegation overrides the client and remains on every poll", async () => {
  const targets = [];
  let polls = 0;
  const client = new sdk.Iskra({
    apiKey: "key",
    baseUrl: "https://host.invalid",
    runAs: "default",
    fetch: async (_, init) => {
      targets.push(new Headers(init.headers).get("x-iskra-run-as"));
      return Response.json({ status: ++polls < 3 ? "running" : "completed", next_after: polls });
    },
  });
  await client.chat.create({ message: "go" }, { runAs: "delegate" });
  await client.runs.wait("r1", { runAs: "delegate", timeoutMs: 100, pollIntervalMs: 1 });
  assert.deepEqual(targets, ["delegate", "delegate", "delegate"]);
  await assert.rejects(
    async () => client.apps.get("a1", { version: "1" }, { runAs: "delegate" }),
    /runAs/,
  );
});
