import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "iskra-apisdk-package-"));
try {
  const packed = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--pack-destination", temporary], {
      cwd: root,
      encoding: "utf8",
    }),
  );
  const artifact = join(temporary, packed[0].filename);
  assert.ok(packed[0].files.some((file) => file.path === "LICENSE"));
  assert.ok(
    packed[0].files.every(
      (file) =>
        !file.path.includes("node_modules") &&
        !file.path.startsWith("src/") &&
        !file.path.startsWith("test/"),
    ),
  );
  writeFileSync(join(temporary, "package.json"), '{"private":true,"type":"module"}\n');
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", artifact], {
    cwd: temporary,
    stdio: "inherit",
  });
  const smoke = `
const assert = require('node:assert/strict');
const { Iskra, APIError } = require('@iskradevs/apisdk');
assert.equal(typeof APIError, 'function');
const client = new Iskra({ apiKey: 'test', baseUrl: 'https://host.invalid', fetch: async () => Response.json({ skills: [] }) });
client.skills.list().then(result => assert.deepEqual(result, { skills: [] }));
`;
  writeFileSync(join(temporary, "smoke.cjs"), smoke);
  writeFileSync(
    join(temporary, "smoke.mjs"),
    smoke
      .replace(
        "const assert = require('node:assert/strict');",
        "import assert from 'node:assert/strict';",
      )
      .replace(
        "const { Iskra, APIError } = require('@iskradevs/apisdk');",
        "import { Iskra, APIError } from '@iskradevs/apisdk';",
      ),
  );
  for (const file of ["smoke.cjs", "smoke.mjs"])
    execFileSync(process.execPath, [file], { cwd: temporary, stdio: "inherit" });
  const typeSmoke = `
import { Iskra, type RunRequest, type ConversationContext, type ExecPlanDefaults } from '@iskradevs/apisdk';
const client = new Iskra({ apiKey: 'test', baseUrl: 'https://host.invalid' });
const request: RunRequest = { message: 'hello', files: [{ id: 'version' }], iskra_exec: { skills: null } };
const run = client.runs.create(request);
const plan: Promise<ExecPlanDefaults> = client.execPlan.defaults();
const context: Promise<ConversationContext> = client.conversations.context('id');
const chat = client.chat.create<{ total: number }>({ message: 'go', iskra_exec: { skills: [] } });
chat.then(result => { const value: number | undefined = result.output?.total; });
client.memory.download('file', { directory_id: 'dir', format: 'spreadsheet-asset', asset: 'sheet/1', download: '1' });
client.openai.chatCompletions({ model: 'iskra-llm', messages: [{ role: 'assistant', content: null, tool_calls: [{ id: 'call', type: 'function', function: { name: 'lookup', arguments: '{}' } }] }, { role: 'tool', content: 'result', tool_call_id: 'call' }], tools: [{ type: 'function', function: { name: 'lookup', parameters: {} } }], tool_choice: 'auto', temperature: 0.5 });
const stream = client.openai.chatCompletions({ model: 'iskra', messages: [], stream: true });
stream.next().then(event => { const data: unknown = event.value; });

`;
  for (const extension of ["mts", "cts"])
    writeFileSync(join(temporary, "types." + extension), typeSmoke);
  const tsc = join(root, "node_modules/typescript/bin/tsc");
  execFileSync(
    process.execPath,
    [
      tsc,
      "--noEmit",
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "types.mts",
      "types.cts",
    ],
    { cwd: temporary, stdio: "inherit" },
  );
  writeFileSync(
    join(temporary, "invalid.mts"),
    `
import { Iskra } from '@iskradevs/apisdk';
const client = new Iskra({ apiKey: 'test', baseUrl: 'https://host.invalid' });
client.runs.create({ message: 'go', files: [{ name: 'x', mime: 'text/plain', content_base64: 'eA==' }] });
new Iskra({ apiKey: 'test' });
`,
  );
  const rejected = spawnSync(
    process.execPath,
    [
      tsc,
      "--noEmit",
      "--strict",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "invalid.mts",
    ],
    { cwd: temporary, encoding: "utf8" },
  );
  assert.equal(rejected.status, 2);
  assert.match(rejected.stdout, /TS2322/);
  assert.match(rejected.stdout, /TS2345/);
  const manifest = JSON.parse(
    readFileSync(join(temporary, "node_modules/@iskradevs/apisdk/package.json"), "utf8"),
  );
  assert.equal(manifest.version, "0.1.0");
  console.log("Packed SDK installs and runs with ESM, CommonJS, and both declaration entrypoints.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
