import { inspect } from "node:util";
import { appendFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import { APIError, Iskra } from "@iskradevs/apisdk";

const started = Date.now();
const totalDeadline = started + 300_000;
const cleanupReserveMs = 25_000;
const conversations = new Set();
const runs = new Map();
const terminalStates = new Set(["completed", "failed", "cancelled", "interaction_required"]);
const scenarioIDs = [
  "catalogs_and_defaults",
  "memory_read",
  "openai_models",
  "restricted_scopes",
  "conversation_context",
  "native_chat",
  "openai_stream",
  "multipart_upload",
  "async_run_and_replay",
  "run_events_and_wait",
  "download_bytes",
  "run_cancellation",
];
const report = {
  schema_version: 1,
  sdk: "node",
  ok: false,
  scenarios: scenarioIDs.map((id) => ({ id, status: "not_run" })),
  cleanup: [],
  cleanup_runs: [],
};
let client;
let restricted;
let config;
let signal;
let secrets = [];

function check(condition, code) {
  if (!condition) throw new Error(code);
}
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function remember(value) {
  if (isRecord(value) && typeof value.conversation_id === "string" && value.conversation_id) {
    const id = value.conversation_id;
    check(
      secrets.every((secret) => !id.includes(secret)),
      "credential_in_conversation_id",
    );
    if (!conversations.has(id)) {
      conversations.add(id);
      if (config?.journalPath)
        appendFileSync(config.journalPath, JSON.stringify({ kind: "conversation", id }) + "\n", {
          mode: 0o600,
        });
    }
  }
  return value;
}
function rememberRun(value) {
  remember(value);
  if (isRecord(value) && typeof value.run_id === "string") {
    const id = value.run_id;
    check(
      secrets.every((secret) => !id.includes(secret)),
      "credential_in_run_id",
    );
    if (!runs.has(id) && config?.journalPath)
      appendFileSync(
        config.journalPath,
        JSON.stringify({ kind: "run", id, conversation_id: value.conversation_id }) + "\n",
        { mode: 0o600 },
      );
    runs.set(id, { conversation_id: value.conversation_id, status: value.status });
  }
  return value;
}
function redact(value) {
  let text = String(value);
  for (const secret of secrets) text = text.replaceAll(secret, "[REDACTED]");
  return text.replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [REDACTED]");
}
function errorSummary(error) {
  remember(error?.rawBody);
  if (error instanceof APIError)
    return {
      name: "APIError",
      status: error.status,
      code: typeof error.code === "string" ? redact(error.code).slice(0, 200) : null,
      request_id: error.requestID ? redact(error.requestID).slice(0, 200) : null,
    };
  return {
    name: typeof error?.name === "string" ? redact(error.name) : "Error",
    code: signal?.aborted
      ? "overall_deadline_exceeded"
      : redact(error instanceof Error ? error.message : "unexpected_failure").slice(0, 300),
  };
}
function options(maxMs = 120_000) {
  const remaining = totalDeadline - cleanupReserveMs - Date.now();
  check(remaining > 0, "overall_deadline_exceeded");
  return { signal, timeoutMs: Math.max(1, Math.min(maxMs, remaining)) };
}
async function scenario(id, action) {
  const entry = report.scenarios.find((item) => item.id === id);
  const began = Date.now();
  try {
    const details = await action();
    entry.status = "passed";
    entry.details = details;
    return details;
  } catch (error) {
    entry.status = "failed";
    entry.error = errorSummary(error);
    throw error;
  } finally {
    entry.duration_ms = Date.now() - began;
  }
}
async function requireForbidden(action) {
  let refusal;
  try {
    remember(await action());
  } catch (error) {
    refusal = error;
  }
  remember(refusal?.rawBody);
  check(refusal instanceof APIError, "restricted_request_did_not_return_sdk_api_error");
  check(refusal.status === 403, "restricted_request_did_not_return_403");
  const rendered = [
    inspect(refusal, { showHidden: true, depth: 8 }),
    String(refusal),
    JSON.stringify(refusal),
  ].join("\n");
  check(
    secrets.every((secret) => !rendered.includes(secret)),
    "credential_leaked_in_error_repr",
  );
  return { status: refusal.status, code: refusal.code ?? null, credential_repr_redacted: true };
}
async function readConfiguration() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    check(size <= 16_384, "stdin_configuration_too_large");
    chunks.push(chunk);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid_stdin_json");
  }
  check(isRecord(parsed), "stdin_configuration_must_be_an_object");
  secrets = [parsed.apiKey, parsed.restrictedApiKey].filter(
    (value) => typeof value === "string" && value.length > 0,
  );
  for (const key of ["baseUrl", "apiKey", "restrictedApiKey", "marker"])
    check(typeof parsed[key] === "string" && parsed[key].trim(), `missing_configuration_${key}`);
  if (parsed.journalPath !== undefined)
    check(
      typeof parsed.journalPath === "string" && parsed.journalPath.length > 0,
      "invalid_journal_path",
    );
  check(parsed.marker.length <= 120, "marker_too_long");
  check(parsed.apiKey !== parsed.restrictedApiKey, "restricted_key_must_be_distinct");
  return parsed;
}
async function main() {
  config = await readConfiguration();
  const remaining = totalDeadline - cleanupReserveMs - Date.now();
  check(remaining > 0, "overall_deadline_exceeded");
  signal = AbortSignal.timeout(remaining);
  client = new Iskra({ apiKey: config.apiKey, baseUrl: config.baseUrl });
  restricted = new Iskra({ apiKey: config.restrictedApiKey, baseUrl: config.baseUrl });
  let mandatoryBundles;

  await scenario("catalogs_and_defaults", async () => {
    const defaults = await client.execPlan.defaults(options());
    check(isRecord(defaults.plan), "defaults_plan_missing");
    check(isRecord(defaults.pins), "defaults_pins_missing");
    check(typeof defaults.version === "number", "defaults_version_is_not_number");
    check(isRecord(defaults.options), "defaults_options_missing");
    check(Array.isArray(defaults.options.mandatory_bundles), "defaults_mandatory_bundles_missing");
    check(
      defaults.options.mandatory_bundles.every(
        (bundle) => typeof bundle === "string" && bundle.length > 0,
      ),
      "defaults_mandatory_bundle_invalid",
    );
    mandatoryBundles = [...defaults.options.mandatory_bundles];
    const skills = await client.skills.list(options());
    check(Array.isArray(skills.skills), "skills_array_missing");
    check(
      skills.skills.every(
        (skill) =>
          typeof skill.bundle === "string" &&
          typeof skill.available === "boolean" &&
          typeof skill.mandatory === "boolean" &&
          typeof skill.setup_state === "string",
      ),
      "skill_catalog_fields_invalid",
    );
    const specialists = await client.specialists.list(options());
    check(Array.isArray(specialists.specialists), "specialists_array_missing");
    check(
      specialists.specialists.every(
        (item) => typeof item.id === "string" && typeof item.title === "string",
      ),
      "specialist_catalog_fields_invalid",
    );
    return {
      defaults_version: defaults.version,
      skills_count: skills.skills.length,
      specialists_count: specialists.specialists.length,
      mandatory_count: defaults.options.mandatory_bundles.length,
    };
  });

  await scenario("memory_read", async () => {
    const page = await client.memory.browse({ limit: 1 }, options());
    check(Array.isArray(page.entries), "memory_entries_missing");
    check(typeof page.complete === "boolean", "memory_complete_missing");
    const collections = await client.memory.collections(options());
    check(Array.isArray(collections.collections), "memory_collections_missing");
    return {
      entries_count: page.entries.length,
      collections_count: collections.collections.length,
    };
  });

  await scenario("openai_models", async () => {
    const models = await client.openai.models(options());
    check(Array.isArray(models.data), "openai_models_data_missing");
    check(
      models.data.every((model) => typeof model.id === "string"),
      "openai_model_id_invalid",
    );
    return { models_count: models.data.length };
  });

  await scenario("restricted_scopes", async () => ({
    memory: await requireForbidden(() => restricted.memory.browse({ limit: 1 }, options())),
    files: await requireForbidden(() =>
      restricted.files.upload(
        { files: [{ name: "forbidden.txt", data: new Blob(["scope-check"]) }] },
        options(),
      ),
    ),
  }));

  let conversationID;
  await scenario("conversation_context", async () => {
    const created = remember(await client.conversations.create({ ttl_seconds: 1800 }, options()));
    check(typeof created.conversation_id === "string", "conversation_id_missing");
    conversationID = created.conversation_id;
    const context = await client.conversations.context(conversationID, options());
    check(isRecord(context.workspace), "conversation_workspace_missing");
    check(Array.isArray(context.references), "conversation_references_missing");
    return { conversation_id: conversationID, references_count: context.references.length };
  });

  await scenario("native_chat", async () => {
    const marker = `${config.marker}-native`;
    const answer = remember(
      await client.chat.create(
        {
          conversation_id: conversationID,
          ttl_seconds: 1800,
          message: `Ответь одной строкой: ${marker}`,
          iskra_exec: { complexity: "simple", skills: mandatoryBundles },
        },
        options(),
      ),
    );
    check(answer.conversation_id === conversationID, "native_conversation_changed");
    check(answer.status === "completed", "native_chat_not_completed");
    check(
      typeof answer.answer === "string" && answer.answer.includes(marker),
      "native_marker_missing",
    );
    return { status: answer.status, marker_present: true };
  });

  await scenario("openai_stream", async () => {
    const marker = `${config.marker}-openai`;
    let text = "";
    let chunks = 0;
    for await (const chunk of client.openai.chatCompletions(
      {
        model: "iskra-agent",
        conversation_id: conversationID,
        messages: [{ role: "user", content: `Ответь одной строкой: ${marker}` }],
        iskra_exec: { complexity: "simple", skills: mandatoryBundles },
        stream: true,
      },
      options(),
    )) {
      remember(chunk);
      check(!chunk.error, "openai_stream_error_envelope");
      chunks++;
      for (const choice of chunk.choices ?? []) {
        if (typeof choice.delta?.content === "string") text += choice.delta.content;
      }
      check(text.length <= 65_536, "openai_stream_output_too_large");
    }
    check(text.includes(marker), "openai_stream_marker_missing");
    return { chunks, marker_present: true };
  });

  const uploadMarker = `${config.marker}-upload`;
  const expectedBytes = Buffer.from(`SDK integration marker: ${uploadMarker}\n`, "utf8");
  let uploaded;
  await scenario("multipart_upload", async () => {
    uploaded = remember(
      await client.files.upload(
        {
          conversation_id: conversationID,
          ttl_seconds: 1800,
          files: [
            { name: "sdk marker.txt", data: new Blob([expectedBytes], { type: "text/plain" }) },
          ],
        },
        options(),
      ),
    );
    check(uploaded.conversation_id === conversationID, "upload_conversation_changed");
    check(Array.isArray(uploaded.files) && uploaded.files.length === 1, "upload_file_missing");
    check(typeof uploaded.files[0].id === "string", "uploaded_version_id_missing");
    check(typeof uploaded.files[0].name === "string", "uploaded_name_missing");
    return { files_count: uploaded.files.length, bytes: expectedBytes.length };
  });

  let runID;
  await scenario("async_run_and_replay", async () => {
    const request = {
      conversation_id: conversationID,
      ttl_seconds: 1800,
      message: "Прочитай приложенный текстовый файл и ответь контрольной строкой из него целиком.",
      files: uploaded.files.map((file) => ({ id: file.id })),
      iskra_exec: { complexity: "simple", skills: mandatoryBundles },
    };
    const idempotencyKey = `${config.marker}:node:async`;
    const run = rememberRun(await client.runs.create(request, { ...options(), idempotencyKey }));
    check(typeof run.run_id === "string", "async_run_id_missing");
    check(run.conversation_id === conversationID, "async_conversation_changed");
    runID = run.run_id;
    const replay = rememberRun(await client.runs.create(request, { ...options(), idempotencyKey }));
    check(replay.run_id === runID, "async_replay_created_another_run");
    check(replay.conversation_id === conversationID, "async_replay_conversation_changed");
    return { run_id: runID, same_run_replayed: true };
  });

  await scenario("run_events_and_wait", async () => {
    const stop = new AbortController();
    const requestOptions = { ...options(180_000), signal: AbortSignal.any([signal, stop.signal]) };
    const progress = { count: 0, kinds: new Set(), terminal: null, last_id: null };
    const events = (async () => {
      for await (const event of client.runs.events(runID, { after: 0 }, requestOptions)) {
        check(typeof event.kind === "string", "run_event_kind_missing");
        progress.count++;
        progress.kinds.add(event.kind);
        if (event.id !== undefined) progress.last_id = event.id;
        if (terminalStates.has(event.kind)) progress.terminal = event.kind;
      }
    })();
    let snapshot;
    try {
      [snapshot] = await Promise.all([
        client.runs.wait(runID, { ...requestOptions, pollIntervalMs: 250 }),
        events,
      ]);
    } finally {
      stop.abort();
      await events.catch(() => {});
    }
    rememberRun(snapshot);
    check(snapshot.status === "completed", "async_run_not_completed");
    check(progress.terminal === "completed", "run_terminal_event_missing");
    check(
      isRecord(snapshot.result) &&
        typeof snapshot.result.answer === "string" &&
        snapshot.result.answer.includes(uploadMarker),
      "async_marker_missing",
    );
    return {
      status: snapshot.status,
      marker_present: true,
      event_count: progress.count,
      event_kinds: [...progress.kinds],
      terminal_event: progress.terminal,
      last_event_id: progress.last_id,
    };
  });

  await scenario("download_bytes", async () => {
    const response = await client.files.download(conversationID, uploaded.files[0].name, options());
    const actual = Buffer.from(await response.arrayBuffer());
    check(actual.equals(expectedBytes), "downloaded_bytes_differ_from_upload");
    return { bytes: actual.length, exact_match: true };
  });

  await scenario("run_cancellation", async () => {
    const created = remember(await client.conversations.create({ ttl_seconds: 1800 }, options()));
    const run = rememberRun(
      await client.runs.create(
        {
          conversation_id: created.conversation_id,
          ttl_seconds: 1800,
          message: `Ответь одной строкой: ${config.marker}-cancel`,
          iskra_exec: { complexity: "simple", skills: mandatoryBundles },
        },
        options(),
      ),
    );
    let cancelStatus;
    let completedBeforeCancel = false;
    try {
      const cancelled = rememberRun(await client.runs.cancel(run.run_id, options()));
      check(cancelled.status === "cancelled", "accepted_cancel_did_not_return_cancelled");
      cancelStatus = cancelled.status;
    } catch (error) {
      if (!(error instanceof APIError) || error.status !== 409 || error.code !== "already_finished")
        throw error;
      cancelStatus = "already_finished_http_409";
      completedBeforeCancel = true;
    }
    const result = rememberRun(
      await client.runs.wait(run.run_id, { ...options(180_000), pollIntervalMs: 250 }),
    );
    check(
      completedBeforeCancel ? result.status === "completed" : result.status === "cancelled",
      "cancellation_unexpected_terminal_state",
    );
    return {
      run_id: run.run_id,
      cancel_response: cancelStatus,
      terminal_status: result.status,
      outcome: result.status === "cancelled" ? "cancelled" : "completed_race",
    };
  });
}

async function cleanup() {
  if (!client) return;
  for (const [runID, state] of runs) {
    if (terminalStates.has(state.status)) continue;
    const entry = { run_id: runID, status: "failed" };
    report.cleanup_runs.push(entry);
    try {
      const remaining = totalDeadline - Date.now();
      check(remaining > 0, "cleanup_deadline_exceeded");
      const result = await client.runs.cancel(runID, { timeoutMs: Math.min(5000, remaining) });
      rememberRun(result);
      entry.status = "cancel_requested";
      entry.terminal_status = result.status;
    } catch (error) {
      if (
        error instanceof APIError &&
        (error.status === 404 || (error.status === 409 && error.code === "already_finished"))
      )
        entry.status = "already_terminal_or_absent";
      else entry.error = errorSummary(error);
    }
  }
  for (const conversationID of conversations) {
    const entry = { conversation_id: conversationID, status: "failed", attempts: 0 };
    report.cleanup.push(entry);
    const deletionDeadline = Math.min(totalDeadline, Date.now() + 10_000);
    for (;;) {
      entry.attempts++;
      try {
        const remaining = deletionDeadline - Date.now();
        check(remaining > 0, "cleanup_deadline_exceeded");
        await client.chat.delete(conversationID, { timeoutMs: Math.min(5000, remaining) });
        entry.status = "deleted";
        break;
      } catch (error) {
        if (error instanceof APIError && error.status === 404) {
          entry.status = "already_absent";
          break;
        }
        if (
          error instanceof APIError &&
          error.status === 409 &&
          error.code === "generation_in_progress" &&
          Date.now() < deletionDeadline
        ) {
          await delay(Math.min(250, Math.max(0, deletionDeadline - Date.now())));
          continue;
        }
        entry.error = errorSummary(error);
        break;
      }
    }
  }
}

try {
  await main();
} catch (error) {
  report.error = errorSummary(error);
} finally {
  try {
    await cleanup();
  } catch (error) {
    report.cleanup_error = errorSummary(error);
  }
  report.duration_ms = Date.now() - started;
  report.ok =
    !report.error &&
    !report.cleanup_error &&
    report.scenarios.every((entry) => entry.status === "passed") &&
    report.cleanup.every((entry) => entry.status !== "failed") &&
    report.cleanup_runs.every((entry) => entry.status !== "failed");
  process.stdout.write(
    JSON.stringify(report, (_key, value) => (typeof value === "string" ? redact(value) : value)) +
      "\n",
  );
  process.exitCode = report.ok ? 0 : 1;
}
