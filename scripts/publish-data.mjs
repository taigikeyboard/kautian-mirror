import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { validateDataset } from "../extension/src/background/dataset.js";

// Publishes a compatible descriptor and immutable dictionary JSON with the static site.
const root = new URL("../", import.meta.url);
const bytes = readFileSync(new URL("extension/data/kautian.min.json", root));
validateDataset(JSON.parse(bytes));
const hash = createHash("sha256").update(bytes).digest("hex");
const directory = new URL("dist/data/v6/", root);
mkdirSync(directory, { recursive: true });
writeFileSync(new URL(`${hash}.json`, directory), bytes);
let source = null;
// CI supplies provenance only when it has just fetched the inputs.
if (process.env.UPSTREAM_FETCHED === "true") {
  source = JSON.parse(readFileSync(new URL(".cache/upstream-source.json", root), "utf8"));
}
writeFileSync(new URL("latest.json", directory), JSON.stringify({
  format: 6, sha256: hash, file: `${hash}.json`, bytes: bytes.length, source,
}));
console.log(`Published dictionary v6: ${hash}`);
