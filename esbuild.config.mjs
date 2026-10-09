import { build, context } from "esbuild";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { VENDOR_INDEX_PATH } from "./scripts/build-entries.mjs";
import { INDEX_PATH } from "./src/data-paths.js";

const options = {
  entryPoints: ["src/main.js"],
  bundle: true,
  format: "esm",
  minify: true,
  outfile: "dist/app.js",
  banner: { js: "/*! Includes kautian-extension (MIT) — see licenses/ */" },
  target: ["es2022"],
  logLevel: "info",
};

if (!existsSync(VENDOR_INDEX_PATH)) {
  console.error(`FAIL: ${VENDOR_INDEX_PATH} missing — run \`npm run build:index\` first`);
  process.exit(1);
}
mkdirSync(dirname(join("dist", INDEX_PATH)), { recursive: true });
cpSync(VENDOR_INDEX_PATH, join("dist", INDEX_PATH));
cpSync("src/index.html", "dist/index.html");
cpSync("src/styles.css", "dist/styles.css");
cpSync("src/favicon.svg", "dist/favicon.svg");
// same typeface as taigikeyboard.tw/taigi-converter (jf open 粉圓, SIL OFL 1.1)
mkdirSync("dist/fonts", { recursive: true });
cpSync("vendor/kautian-extension/vendor/taigi-converter/jf-openhuninn-2.1.ttf", "dist/fonts/jf-openhuninn-2.1.ttf");
// app.js bundles the MIT-licensed extension engine; ship both license texts with it
mkdirSync("dist/licenses", { recursive: true });
cpSync("LICENSE", "dist/licenses/kautian-website.txt");
cpSync("vendor/kautian-extension/LICENSE", "dist/licenses/kautian-extension.txt");

if (process.argv.includes("--serve")) {
  const ctx = await context(options);
  await ctx.watch();
  await ctx.serve({ servedir: "dist", port: 8000 });
} else {
  await build(options);
}
