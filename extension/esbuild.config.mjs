import { build } from "esbuild";
import { cpSync, statSync } from "node:fs";
import { join } from "node:path";

// paths relative to extension/, so the root package.json can run this from the repo root
const DIR = import.meta.dirname;

await build({
  entryPoints: [join(DIR, "src/content/main.js")],
  bundle: true,
  format: "iife",
  outfile: join(DIR, "dist/content.js"),
  target: ["chrome100"],
  logLevel: "info",
});
cpSync(join(DIR, "src/content/styles.css"), join(DIR, "dist/content.css"));

// Gate: make sure the vendor 1.5MB dictionary.js did not sneak into the bundle
// Keep the generated content script small.
const size = statSync(join(DIR, "dist/content.js")).size;
if (size > 200 * 1024) {
  console.error(`FAIL: dist/content.js is ${(size / 1024).toFixed(0)}KB — check whether vendor dictionary.js leaked in`);
  process.exit(1);
}
console.log(`dist/content.js: ${(size / 1024).toFixed(1)} KB`);
