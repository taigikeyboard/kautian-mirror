// Search performance measurements.
// exact/prefix < 5ms, substring+fuzzy < 30ms, regex worst < 80ms (budget abort)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createEngine } from "../src/search/engine.js";

const DATA = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "kautian.min.json");

let t = performance.now();
const raw = readFileSync(DATA, "utf8");
console.log(`read: ${(performance.now() - t).toFixed(1)} ms`);
t = performance.now();
const data = JSON.parse(raw);
console.log(`parse: ${(performance.now() - t).toFixed(1)} ms`);
t = performance.now();
const engine = createEngine(data);
console.log(`createEngine (derivation; indexes are lazy): ${(performance.now() - t).toFixed(1)} ms`);

const CASES = [
  ["exact toned", "si7"],
  ["exact notone", "sutiann"],
  ["prefix short", "tsh"],
  ["prefix 1char", "a"],
  ["hanzi exact", "同居"],
  ["hanzi substr", "語"],
  ["tps", "ㆠㄨㄣˊ"],
  ["zhuyin fold", "ㄙㄨㄉㄧㄚ"],
  ["fuzzy hit", "sualakku"],
  ["fuzzy miss", "zzzzzzz"],
  ["regex simple", "^tshiau"],
  ["regex greedy", "(t+s+h+)+x"],
  ["regex wide", "a"],
];

for (const [label, q] of CASES) {
  // warmup (also pays each mode's one-time lazy index build)
  engine.query(q);
  const N = 20;
  const t0 = performance.now();
  let out;
  for (let i = 0; i < N; i++) out = engine.query(q);
  const ms = (performance.now() - t0) / N;
  console.log(
    `${label.padEnd(14)} ${JSON.stringify(q).padEnd(18)} ${ms.toFixed(2).padStart(7)} ms  ` +
    `results=${out.results.length}${out.truncated ? " (truncated)" : ""}${out.error ? " error=" + out.error : ""}`
  );
}
