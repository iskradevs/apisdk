import assert from "node:assert/strict";
import { test } from "node:test";
import * as sdk from "../dist/esm/index.js";

const callCases = [
  [
    "chat.create",
    [{ message: "Привет", iskra_exec: { skills: [] } }],
    "POST",
    "/api/v1/chat",
    { message: "Привет", iskra_exec: { skills: [] } },
  ],
  ["chat.delete", ["c/ ?"], "DELETE", "/api/v1/chat/c%2F%20%3F"],
  [
    "runs.create",
    [{ message: "go", files: [{ id: "v1" }] }],
    "POST",
    "/api/v1/runs",
    { message: "go", files: [{ id: "v1" }] },
  ],
  ["runs.get", ["r/1", { after: 9 }], "GET", "/api/v1/runs/r%2F1?after=9"],
  ["runs.cancel", ["r1"], "DELETE", "/api/v1/runs/r1"],
  ["skills.list", [], "GET", "/api/v1/skills"],
  ["specialists.list", [], "GET", "/api/v1/specialists"],
  ["execPlan.defaults", [], "GET", "/api/v1/exec-plan/defaults"],
  ["conversations.create", [{}], "POST", "/api/v1/conversations", {}],
  ["conversations.context", ["c1"], "GET", "/api/v1/chat/c1/context"],
  [
    "conversations.setWorkspace",
    ["c1", { directory_id: "d1" }],
    "PUT",
    "/api/v1/chat/c1/workspace",
    { directory_id: "d1" },
  ],
  ["conversations.clearWorkspace", ["c1"], "DELETE", "/api/v1/chat/c1/workspace"],
  [
    "conversations.addMemoryRef",
    ["c1", { collection_id: "col1", access_mode: "write" }],
    "POST",
    "/api/v1/chat/c1/memory-refs",
    { collection_id: "col1", access_mode: "write" },
  ],
  [
    "conversations.updateMemoryRef",
    ["c1", "ref/1", { access_mode: "read" }],
    "PATCH",
    "/api/v1/chat/c1/memory-refs/ref%2F1",
    { access_mode: "read" },
  ],
  [
    "conversations.deleteMemoryRef",
    ["c1", "ref/1"],
    "DELETE",
    "/api/v1/chat/c1/memory-refs/ref%2F1",
  ],
  [
    "memory.browse",
    [{ directory_id: "d 1", folder_id: "f/1", q: "a&b", candidates: false, limit: 10 }],
    "GET",
    "/api/v1/memory/browse?directory_id=d+1&folder_id=f%2F1&q=a%26b&candidates=false&limit=10",
  ],
  ["memory.collections", [], "GET", "/api/v1/memory/collections"],
  ["memory.collectionMembers", ["col/1"], "GET", "/api/v1/memory/collections/col%2F1/members"],
  [
    "memory.createRoot",
    [{ name: "Docs" }],
    "POST",
    "/api/v1/memory/resources/roots",
    { name: "Docs" },
  ],
  [
    "memory.createFolder",
    [{ directory_id: "d1", path: "a/b" }],
    "POST",
    "/api/v1/memory/resources/folders",
    { directory_id: "d1", path: "a/b" },
  ],
  [
    "apps.get",
    ["app/1", { version: "1.0+test" }],
    "GET",
    "/api/v1/apps/app%2F1?version=1.0%2Btest",
  ],
  ["openai.models", [], "GET", "/api/openai/v1/models"],
  [
    "openai.chatCompletions",
    [{ model: "iskra", messages: [{ role: "user", content: "hello" }] }],
    "POST",
    "/api/openai/v1/chat/completions",
    { model: "iskra", messages: [{ role: "user", content: "hello" }] },
  ],
];

test("exports a usable client", () => assert.equal(typeof sdk.Iskra, "function"));
for (const [operation, args, method, path, body] of callCases) {
  test(operation + " maps the public request and preserves response JSON", async () => {
    const payload = { marker: operation, unknown_output: [null, { future: true }] };
    const client = new sdk.Iskra({
      apiKey: "isk_test",
      baseUrl: "https://example.invalid/prefix/",
      fetch: async (url, init) => {
        assert.equal(String(url), "https://example.invalid/prefix" + path);
        assert.equal(init.method, method);
        assert.equal(init.redirect, "manual");
        assert.equal(new Headers(init.headers).get("authorization"), "Bearer isk_test");
        if (body) assert.deepEqual(JSON.parse(init.body), body);
        else assert.equal(init.body, undefined);
        return Response.json(payload);
      },
    });
    const [namespace, name] = operation.split(".");
    assert.deepEqual(await client[namespace][name](...args), payload);
  });
}

test("preserves absent, null, empty skill selection and false antonym", async () => {
  const bodies = [];
  const client = new sdk.Iskra({
    apiKey: "isk_test",
    baseUrl: "https://example.invalid",
    fetch: async (_, init) => {
      bodies.push(JSON.parse(init.body));
      return Response.json({});
    },
  });
  for (const iskra_exec of [{}, { skills: null }, { skills: [], antonym: false }])
    await client.chat.create({ message: "go", iskra_exec });
  assert.deepEqual(
    bodies.map((x) => x.iskra_exec),
    [{}, { skills: null }, { skills: [], antonym: false }],
  );
});

test("DELETE handles 204 without JSON parsing", async () => {
  const client = new sdk.Iskra({
    apiKey: "isk_test",
    baseUrl: "https://example.invalid",
    fetch: async () => new Response(null, { status: 204 }),
  });
  assert.equal(await client.chat.delete("c1"), undefined);
  assert.equal(await client.conversations.deleteMemoryRef("c1", "ref1"), undefined);
});

test("validates authority options and keeps credentials out of inspection", async () => {
  for (const config of [
    {},
    { apiKey: "", baseUrl: "https://host.invalid" },
    { apiKey: "key", baseUrl: "" },
    { apiKey: "key", baseUrl: "https://user:password@host.invalid" },
    { apiKey: "key", baseUrl: "file:///tmp/foo" },
    { apiKey: "key", baseUrl: "https://host.invalid?x=1" },
  ])
    assert.throws(() => new sdk.Iskra(config));
  const { inspect } = await import("node:util");
  const client = new sdk.Iskra({ apiKey: "isk_SECRET", baseUrl: "https://host.invalid" });
  assert.ok(!inspect(client, { showHidden: true, depth: 10 }).includes("isk_SECRET"));
  assert.ok(!JSON.stringify(client).includes("isk_SECRET"));
});

test("encodes artifact path segments and rejects dot segments and arbitrary URLs", async () => {
  let calls = 0;
  const client = new sdk.Iskra({
    apiKey: "key",
    baseUrl: "https://host.invalid/prefix",
    fetch: async (url) => {
      calls++;
      assert.equal(
        String(url),
        "https://host.invalid/prefix/api/v1/chat/c%2F1/files/reports/%D1%82%D0%B5%D1%81%D1%82%20%23%3F.txt",
      );
      return new Response("bytes");
    },
  });
  const response = await client.files.download("c/1", "reports/тест #?.txt");
  assert.equal(await response.text(), "bytes");
  for (const path of [
    "../secret",
    "a/../secret",
    ".",
    "https://evil.invalid/a",
    "//evil.invalid/a",
  ])
    await assert.rejects(async () => client.files.download("c1", path));
  assert.equal(calls, 1);
});

test("uploads chat files as repeated file parts and memory as one file", async () => {
  const upload = { name: "report.txt", data: new Blob(["Привет"], { type: "text/plain" }) };
  const requests = [];
  const client = new sdk.Iskra({
    apiKey: "key",
    baseUrl: "https://host.invalid",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ files: [] });
    },
  });
  await client.files.upload({
    files: [upload, { ...upload, name: "second.txt" }],
    conversation_id: "c1",
    ttl_seconds: 60,
  });
  await client.memory.upload({
    file: upload,
    directory_id: "d1",
    path: "docs/report.txt",
    conflict_policy: "rename",
  });
  await client.apps.create({ bundle: upload, title: "Demo", activate: false });
  await client.apps.publishVersion("a1", { bundle: upload, activate: true });
  assert.equal(requests[0].url, "https://host.invalid/api/v1/chat/files");
  assert.deepEqual(
    requests[0].init.body.getAll("file").map((x) => x.name),
    ["report.txt", "second.txt"],
  );
  assert.equal(await requests[0].init.body.get("file").text(), "Привет");
  assert.equal(requests[0].init.body.get("conversation_id"), "c1");
  assert.equal(requests[0].init.body.get("ttl_seconds"), "60");
  assert.equal(requests[1].url, "https://host.invalid/api/v1/memory/resources/files");
  assert.equal(requests[1].init.body.getAll("file").length, 1);
  assert.equal(requests[1].init.body.get("path"), "docs/report.txt");
  assert.equal(requests[1].init.body.get("directory_id"), "d1");
  assert.equal(requests[1].init.body.get("conflict_policy"), "rename");
  assert.equal(requests[2].url, "https://host.invalid/api/v1/apps?activate=false");
  assert.equal(requests[2].init.body.get("title"), "Demo");
  assert.equal(requests[2].init.body.get("bundle").name, "report.txt");
  assert.equal(requests[3].url, "https://host.invalid/api/v1/apps/a1/versions?activate=true");
  for (const { init } of requests)
    assert.equal(new Headers(init.headers).has("content-type"), false);
});

test("memory downloads encode directory query and leave body streaming", async () => {
  const client = new sdk.Iskra({
    apiKey: "key",
    baseUrl: "https://host.invalid",
    fetch: async (url) => {
      assert.equal(
        String(url),
        "https://host.invalid/api/v1/memory/resources/files/f%2F1/content?directory_id=d+1",
      );
      return new Response("file");
    },
  });
  const response = await client.memory.download("f/1", { directory_id: "d 1" });
  assert.equal(response.bodyUsed, false);
  assert.equal(await response.text(), "file");
});

test("rejects base URLs with empty query or fragment markers instead of swallowing the route", () => {
  for (const baseUrl of ["https://host.invalid/prefix?", "https://host.invalid/prefix#"]) {
    assert.throws(() => new sdk.Iskra({ apiKey: "key", baseUrl }), /baseUrl/);
  }
});
