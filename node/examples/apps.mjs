import { openAsBlob } from "node:fs";
import { iskra } from "./config.mjs";
const archive = process.argv[2];
if (!archive) throw new Error("Usage: node examples/apps.mjs ./bundle.zip");
const app = await iskra.apps.create({
  bundle: { name: "bundle.zip", data: await openAsBlob(archive) },
  activate: true,
});
console.log(app);
console.log(await iskra.apps.get(app.id, { version: app.version }));
