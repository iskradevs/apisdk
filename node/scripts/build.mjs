import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const tsc = fileURLToPath(new URL("../node_modules/typescript/bin/tsc", import.meta.url));
rmSync(new URL("../dist/", import.meta.url), { recursive: true, force: true });
execFileSync(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: root, stdio: "inherit" });
execFileSync(
  process.execPath,
  [
    tsc,
    "-p",
    "tsconfig.json",
    "--module",
    "commonjs",
    "--moduleResolution",
    "node",
    "--outDir",
    "dist/cjs",
  ],
  { cwd: root, stdio: "inherit" },
);
mkdirSync(new URL("../dist/cjs/", import.meta.url), { recursive: true });
writeFileSync(new URL("../dist/cjs/package.json", import.meta.url), '{"type":"commonjs"}\n');
