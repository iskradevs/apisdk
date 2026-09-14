import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { Iskra, APIError } from "../dist/esm/index.js";

const fixtures = JSON.parse(
  readFileSync(new URL("../../contracts/fixtures.json", import.meta.url), "utf8"),
);
const routes = JSON.parse(
  readFileSync(new URL("../../contracts/routes.json", import.meta.url), "utf8"),
);
const uploadFile = (file) => ({
  name: file.filename,
  data: new Blob([file.content], { type: file.content_type }),
});
function invoke(client, fixture) {
  const { operation, request, query, path } = fixture;
  const parts = path.split("/");
  const options = {
    ...(fixture.request_headers?.["Last-Event-ID"]
      ? { lastEventID: fixture.request_headers["Last-Event-ID"] }
      : {}),
    ...(fixture.request_headers?.["Idempotency-Key"]
      ? { idempotencyKey: fixture.request_headers["Idempotency-Key"] }
      : {}),
  };
  switch (operation) {
    case "chat.create":
      return client.chat.create(request);
    case "chat.delete":
      return client.chat.delete(parts[4]);
    case "files.upload":
      return client.files.upload({
        ...request.multipart.fields,
        files: request.multipart.files.map(uploadFile),
      });
    case "files.download":
      return client.files.download(parts[4], parts.slice(6).map(decodeURIComponent).join("/"));
    case "runs.create":
      return client.runs.create(request, options);
    case "runs.get":
      return client.runs.get(parts[4], query);
    case "runs.cancel":
      return client.runs.cancel(parts[4]);
    case "runs.events":
      return client.runs.events(parts[4], query, options);
    case "skills.list":
      return client.skills.list();
    case "specialists.list":
      return client.specialists.list();
    case "execPlan.defaults":
      return client.execPlan.defaults();
    case "conversations.create":
      return client.conversations.create(request);
    case "conversations.context":
      return client.conversations.context(parts[4]);
    case "conversations.setWorkspace":
      return client.conversations.setWorkspace(parts[4], request);
    case "conversations.clearWorkspace":
      return client.conversations.clearWorkspace(parts[4]);
    case "conversations.addMemoryRef":
      return client.conversations.addMemoryRef(parts[4], request);
    case "conversations.updateMemoryRef":
      return client.conversations.updateMemoryRef(parts[4], parts[6], request);
    case "conversations.deleteMemoryRef":
      return client.conversations.deleteMemoryRef(parts[4], parts[6]);
    case "memory.browse":
      return client.memory.browse(query);
    case "memory.collections":
      return client.memory.collections();
    case "memory.collectionMembers":
      return client.memory.collectionMembers(parts[5]);
    case "memory.createRoot":
      return client.memory.createRoot(request);
    case "memory.createFolder":
      return client.memory.createFolder(request);
    case "memory.upload":
      return client.memory.upload({
        ...request.multipart.fields,
        file: uploadFile(request.multipart.files[0]),
      });
    case "memory.download":
      return client.memory.download(parts[6], query);
    case "apps.create":
      return client.apps.create({
        ...request.multipart.fields,
        ...query,
        bundle: uploadFile(request.multipart.files[0]),
      });
    case "apps.publishVersion":
      return client.apps.publishVersion(parts[4], {
        ...query,
        bundle: uploadFile(request.multipart.files[0]),
      });
    case "apps.get":
      return client.apps.get(parts[4], query);
    case "openai.models":
      return client.openai.models();
    case "openai.chatCompletions":
      return client.openai.chatCompletions(request);
    default:
      throw new Error("Fixture has no public method mapping: " + operation);
  }
}

test("shared fixtures cover every advertised HTTP operation", () => {
  assert.equal(fixtures.schema_version, 1);
  const fixtureOperations = new Set(fixtures.cases.map((c) => c.operation));
  const operations = routes.operations ?? routes.routes;
  assert.ok(operations.length >= 28);
  for (const operation of operations)
    assert.ok(
      fixtureOperations.has(operation.id ?? operation.operation),
      JSON.stringify(operation),
    );
});

test("shared HTTP contract fixtures through public methods", async (t) => {
  let current;
  let received;
  let serverError;
  const server = createServer(async (req, res) => {
    try {
      received = true;
      const url = new URL(req.url, "http://local.invalid");
      assert.equal(req.method, current.method);
      assert.equal(url.pathname, "/prefix" + current.path);
      assert.deepEqual(Object.fromEntries(url.searchParams), current.query ?? {});
      assert.equal(req.headers.authorization, "Bearer isk_fixture");
      for (const [key, value] of Object.entries(current.request_headers ?? {}))
        assert.equal(req.headers[key.toLowerCase()], value);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      if (current.request?.multipart) {
        assert.match(req.headers["content-type"], /^multipart\/form-data; boundary=/);
        const form = await new Response(bytes, {
          headers: { "content-type": req.headers["content-type"] },
        }).formData();
        for (const [key, value] of Object.entries(current.request.multipart.fields))
          assert.equal(form.get(key), value);
        const seenFiles = [];
        for (const [field, value] of form)
          if (value instanceof File)
            seenFiles.push({
              field,
              filename: value.name,
              content_type: value.type,
              content: await value.text(),
            });
        assert.deepEqual(seenFiles, current.request.multipart.files);
      } else if (current.request !== undefined)
        assert.deepEqual(JSON.parse(bytes.toString()), current.request);
      else assert.equal(bytes.length, 0);
      const response = current.response;
      res.writeHead(response.status, response.headers);
      res.end(
        response.status === 204
          ? undefined
          : typeof response.body === "string"
            ? response.body
            : JSON.stringify(response.body),
      );
    } catch (error) {
      serverError = error;
      res.writeHead(500);
      res.end("{}");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const client = new Iskra({
    apiKey: "isk_fixture",
    baseUrl: `http://127.0.0.1:${server.address().port}/prefix`,
  });
  for (const fixture of fixtures.cases)
    await t.test(fixture.id, async () => {
      current = fixture;
      received = false;
      serverError = undefined;
      if (fixture.id === "runs.rejectInline") {
        assert.throws(() => invoke(client, fixture), /file/i);
        assert.equal(received, false);
        return;
      }
      let result;
      let failure;
      try {
        result = invoke(client, fixture);
        if (result?.[Symbol.asyncIterator]) {
          const events = [];
          for await (const event of result) events.push(event);
          result = events;
        } else result = await result;
        if (result instanceof Response) result = await result.text();
      } catch (error) {
        failure = error;
      }
      if (serverError) throw serverError;
      assert.equal(received, true);
      if (fixture.response.status >= 400) {
        assert.ok(failure instanceof APIError);
        assert.equal(failure.status, fixture.response.status);
        assert.deepEqual(failure.rawBody, fixture.response.body);
        if (fixture.response.body?.code) assert.equal(failure.code, fixture.response.body.code);
        if (fixture.response.body?.error?.code)
          assert.equal(failure.code, fixture.response.body.error.code);
        return;
      }
      if (failure) throw failure;
      if (fixture.expect?.event_ids)
        assert.deepEqual(
          result.map((event) => event.id),
          fixture.expect.event_ids,
        );
      else if (fixture.operation === "openai.chatCompletions" && fixture.request?.stream) {
        assert.ok(result.length > 0);
        assert.ok(result.every((chunk) => typeof chunk === "object"));
      } else
        assert.deepEqual(
          result,
          fixture.response.status === 204 ? undefined : fixture.response.body,
        );
    });
});
