import { build } from "esbuild";
import { cpSync, statSync } from "node:fs";

await build({
  entryPoints: ["src/content/main.js"],
  bundle: true,
  format: "iife",
  outfile: "dist/content.js",
  target: ["chrome100"],
  logLevel: "info",
});
cpSync("src/content/styles.css", "dist/content.css");

// Gate: make sure the vendor 1.5MB dictionary.js did not sneak into the bundle
// Keep the generated content script small.
const size = statSync("dist/content.js").size;
if (size > 200 * 1024) {
  console.error(`FAIL: dist/content.js is ${(size / 1024).toFixed(0)}KB — check whether vendor dictionary.js leaked in`);
  process.exit(1);
}
console.log(`dist/content.js: ${(size / 1024).toFixed(1)} KB`);
