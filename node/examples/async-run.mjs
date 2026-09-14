import { openAsBlob } from "node:fs";
import { basename } from "node:path";
import { iskra } from "./config.mjs";
const path = process.argv[2];
if (!path) throw new Error("Usage: node examples/async-run.mjs ./document.pdf");
const uploaded = await iskra.files.upload({
  files: [{ name: basename(path), data: await openAsBlob(path) }],
});
const run = await iskra.runs.create(
  {
    message: "Подготовь краткий обзор документа.",
    conversation_id: uploaded.conversation_id,
    files: uploaded.files.map((file) => ({ id: file.id })),
  },
  { idempotencyKey: crypto.randomUUID() },
);
console.log("run_id:", run.run_id);
const result = await iskra.runs.wait(run.run_id);
console.log(result.status, result.result, result.error);
// Timeout leaves the run intact; keep run_id to inspect or cancel it explicitly.
await iskra.chat.delete(uploaded.conversation_id);
