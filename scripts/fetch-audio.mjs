// MOE sutiau-mp3.zip → dist/audio/<id/1000>/<id>.mp3 (word audio, bytes unchanged: CC BY-ND)
// Not part of `npm run build` (300 MB download); run before build:entries so entries get `audio`.
// Needs curl + unzip on PATH. The zip is cached in .cache/ and checked against a pinned SHA-256.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIO_DIR, audioBucketOf } from "../src/data-paths.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ZIP_URL = "https://sutian.moe.edu.tw/media/senn/sutiau-mp3.zip";
// Own file so CI can key its download cache on it. A mismatch means MOE republished the zip
// (or the download was tampered with): verify the new file before re-pinning.
const ZIP_SHA256 = readFileSync(join(ROOT, "scripts/sutiau-mp3.sha256"), "utf8").trim();
const ZIP_NAME_RE = /^(\d+)\(1\)\.mp3$/;

const CACHE_PATH = join(ROOT, ".cache/sutiau-mp3.zip");
const OUT_DIR = join(ROOT, "dist", AUDIO_DIR);
// written last, so a present stamp means dist/audio holds the complete pinned zip
const STAMP_PATH = join(OUT_DIR, ".source-sha256");

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function fetchZip() {
  if (existsSync(CACHE_PATH) && (await sha256(CACHE_PATH)) === ZIP_SHA256) return;
  const partPath = `${CACHE_PATH}.part`;
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  console.log(`downloading ${ZIP_URL}`);
  // -k: the MOE certificate expired 2026-10-08; integrity comes from the pinned hash below
  execFileSync("curl", ["-sSfLk", "-o", partPath, ZIP_URL], { stdio: "inherit" });
  const actual = await sha256(partPath);
  if (actual !== ZIP_SHA256) {
    throw new Error(`sutiau-mp3.zip SHA-256 ${actual} != pinned ${ZIP_SHA256}; ` +
      `check the new file at ${partPath} before updating scripts/sutiau-mp3.sha256`);
  }
  renameSync(partPath, CACHE_PATH);
}

// Unzip beside the cache (same filesystem as dist/, so renames work). The zip already uses
// the {id/1000}/ buckets, so only `<id>(1).mp3` → `<id>.mp3` changes before the swap.
function extract() {
  const work = mkdtempSync(join(dirname(CACHE_PATH), "audio-"));
  try {
    const staged = join(work, AUDIO_DIR);
    execFileSync("unzip", ["-q", CACHE_PATH, "-d", staged]);
    let count = 0;
    for (const bucket of readdirSync(staged)) {
      for (const file of readdirSync(join(staged, bucket))) {
        const id = Number(ZIP_NAME_RE.exec(file)?.[1]);
        if (!id || String(audioBucketOf(id)) !== bucket) throw new Error(`unexpected file in zip: ${bucket}/${file}`);
        renameSync(join(staged, bucket, file), join(staged, bucket, `${id}.mp3`));
        count++;
      }
    }
    writeFileSync(join(staged, ".source-sha256"), ZIP_SHA256);

    // keep the old dist/audio until the new one is in place, so a failed swap loses nothing
    const previous = join(work, "previous");
    mkdirSync(dirname(OUT_DIR), { recursive: true });
    if (existsSync(OUT_DIR)) renameSync(OUT_DIR, previous);
    try {
      renameSync(staged, OUT_DIR);
    } catch (err) {
      if (existsSync(previous)) renameSync(previous, OUT_DIR);
      throw err;
    }
    console.log(`audio: ${count} files → ${OUT_DIR}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (existsSync(STAMP_PATH) && readFileSync(STAMP_PATH, "utf8") === ZIP_SHA256) {
  console.log(`audio: ${OUT_DIR} already matches the pinned zip`);
} else {
  await fetchZip();
  extract();
}
