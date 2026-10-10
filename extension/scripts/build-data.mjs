// kautian.csv + kautian.ods → data/kautian.min.json (format v5) + data/build-report.txt
// Zero-dependency data build for Node 22+.
//
// Format v5 = v2 (string-pool, runtime-derived notone/zhu) + entry ids + gloss,
// no frequency column (ranking does not use word frequency):
// - Every shipped row is joined to a dictionary entry id from kautian.ods
//   (詞目 sheet + variant-reading sheets 又唸作/俗唸作/合音唸作 + variant-spelling
//   sheet 異用字), so the UI can link straight to /su/<id>/.
// - CSV rows that join to no entry (given names, surnames, dialect-table forms)
//   are dropped — the dropdown must only show dictionary headword forms.
// - Entry-type 近反義詞不單列詞目者 is excluded (its ids 404 on the site).
// - ODS forms missing from the CSV are synthesized with taigi-converter so
//   every linkable entry form is searchable.
// - 語音差異 readings and linked 詞彙比較 words are appended as alias rows
//   (FLAG.ALIAS; FLAG.COMPARISON): searchable, displayed as their entry headword.
// - gloss: the entry's first 華語釋義, cut to GLOSS_LENGTH, so look-alike rows
//   (five 附錄 東區 Tang-khu) can be told apart in the dropdown.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dataFold } from "../src/search/zhuyin-fold.js";
import { deriveTlNotone, derivePojNotone, deriveTpsNotone } from "../src/search/derive.js";
import { PUBLISHED_TYPES, readZipEntry, sheetRows } from "./ods.mjs";
import { buildEntries, readComparisonLinks, readSheets } from "../../scripts/build-entries.mjs";
import { FLAG } from "../src/search/engine.js";
import { convert, toToneNumber } from "../../vendor/taigi-converter/src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_CSV = join(ROOT, "kautian.csv");
const SRC_ODS = join(ROOT, "kautian.ods");
const OUT_DIR = join(ROOT, "data");
const OUT_JSON = join(OUT_DIR, "kautian.min.json");
const OUT_REPORT = join(OUT_DIR, "build-report.txt");

// --- minimal RFC4180 parser ---
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// --- ODS: build the (roman, hanzi) → { id, variant } join map ---
const MARK_RE = /【[^】]*】/g;
const normHanzi = (s) => s.normalize("NFC").replace(MARK_RE, "").trim();
// display form: hyphens instead of spaces, original case kept
const displayRoman = (s) =>
  s.normalize("NFC").replace(MARK_RE, "").trim().replace(/\s+/g, "-");
// join key: additionally lowercased, neutral-tone -- folded to -
const keyRoman = (s) =>
  displayRoman(s).toLowerCase().replace(/^--/, "").replaceAll("--", "-");
const formKey = (roman, hanzi) => `${roman}${hanzi}`;

function loadOdsForms(entries) {
  const xml = readZipEntry(SRC_ODS, "content.xml").toString("utf8");
  // key → Map(id → { id, variant, tl, hanzi }) (tl/hanzi = display forms); one key can belong to
  // several entries: 恩 【白】in/un + 【文】un, 陳 tân + surname Tân, five 東區 Tang-khu
  const forms = new Map();
  const put = (id, roman, hanzi, variant) => {
    for (const r of roman.split("/")) {
      if (!r.trim()) continue;
      const k = formKey(keyRoman(r), normHanzi(hanzi));
      if (!forms.has(k)) forms.set(k, new Map());
      const byId = forms.get(k);
      const existing = byId.get(id);
      if (!existing || (existing.variant && !variant)) {
        byId.set(id, { id, variant, tl: displayRoman(r), hanzi: normHanzi(hanzi) });
      }
    }
  };

  const main = sheetRows(xml, "詞目").slice(1);
  const idRomans = new Map(); // id → roman[] (for the 異用字 join)
  const okIds = new Set();
  for (const r of main) {
    if (r.length < 4 || !PUBLISHED_TYPES.has(r[1])) continue;
    const id = Math.trunc(Number(r[0]));
    if (!Number.isFinite(id) || id <= 0) continue;
    okIds.add(id);
    put(id, r[3], r[2], 0);
    const list = idRomans.get(id) || [];
    for (const roman of r[3].split("/")) if (roman.trim()) list.push(roman);
    idRomans.set(id, list);
  }
  for (const sheet of ["又唸作", "俗唸作", "合音唸作"]) {
    for (const r of sheetRows(xml, sheet).slice(1)) {
      if (r.length < 3) continue;
      const id = Math.trunc(Number(r[0]));
      if (okIds.has(id)) put(id, r[2], r[1], 1);
    }
  }
  // 異用字: variant hanzi spellings; readings come from the parent entry
  for (const r of sheetRows(xml, "異用字").slice(1)) {
    if (r.length < 3) continue;
    const id = Math.trunc(Number(r[0]));
    if (!okIds.has(id)) continue;
    for (const roman of idRomans.get(id) || []) put(id, roman, r[2], 1);
  }
  return { forms, aliases: loadAliases(forms, entries) };
}

// Search aliases, like the official search: 語音差異 accent readings (khìr → 去) and the words of
// the 詞彙比較 tables linked to an entry (人仔書 → 尪仔冊), taken from the entry pages' own build so
// both agree. One form may point at several entries, so aliases live outside the one-id-per-key
// `forms` map; the result row shows the entry headword.
const NOTE_RE = /\([^)]*\)|（[^）]*）/g; // annotations inside comparison cells: (書), （透）
function loadAliases(forms, entries) {
  const aliases = new Map(); // `${id}\t${formKey}` → { id, tl, hanzi, comparison }
  const add = (id, roman, hanzi, comparison) => {
    const tl = displayRoman(roman.replace(NOTE_RE, ""));
    const hz = normHanzi(hanzi.replace(NOTE_RE, ""));
    if (!tl || !hz) return;
    const k = formKey(keyRoman(tl), hz);
    if (forms.get(k)?.has(id)) return; // already a real form of this entry
    const ak = `${id}\t${k}`;
    if (!aliases.has(ak)) aliases.set(ak, { id, tl, hanzi: hz, comparison });
  };
  for (const entry of entries.values()) {
    for (const [, readings] of entry.dialectReadings) {
      for (const roman of readings) add(entry.id, roman, entry.hanzi, false);
    }
    for (const { rows } of entry.comparisons) {
      for (const [, hanzi, roman] of rows) add(entry.id, roman, hanzi, true);
    }
  }
  return [...aliases.values()];
}

// --- main ---
const t0 = performance.now();
const entries = buildEntries(readSheets(SRC_ODS), readComparisonLinks());
const { forms: odsForms, aliases } = loadOdsForms(entries);

const rows = parseCsv(readFileSync(SRC_CSV, "utf8"));
const header = rows.shift();
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const need = (name) => {
  if (!(name in col)) throw new Error(`kautian.csv is missing column: ${name}`);
  return col[name];
};

// Shipped columns (string-pool)
const SHIP = {
  tl: need("tl"), hanzi: need("hanzi"), poj: need("poj"),
  tps: need("tps_num"), tlNum: need("tl_num"), tpsNotoneVar: need("tps_notone_var"),
  abTl: need("tl_abbrev"), abPoj: need("poj_abbrev"), abTps: need("tps_abbrev"),
};
// QA-only columns (not shipped; compared against runtime derivation)
const QA_COLS = {
  tlNotone: need("tl_notone"), pojNotone: need("poj_notone"), tpsNotone: need("tps_notone"),
};
const iMain = need("kautian_main");

// Match the target site's regex representation: numeric tones with every
// syllable separator normalized to one space.
const toSiteTlNum = (tl) =>
  toToneNumber(tl).toLowerCase().replace(/--|[-\s]+/g, " ").trim();

const cols = Object.fromEntries(Object.keys(SHIP).map((k) => [k, []]));
const ids = [];
const flags = []; // FLAG bits (engine.js)
const errors = [];
const qa = { emptyFields: {}, unknownTps: new Map(), mismatch: { tlNotone: [], pojNotone: [], tpsNotone: [] } };
let droppedCsv = 0;
const covered = new Set();

for (const r of rows) {
  const get = (i) => (r[i] ?? "").normalize("NFC");
  const k = formKey(keyRoman(get(SHIP.tl)), normHanzi(get(SHIP.hanzi)));
  const hits = odsForms.get(k);
  if (!hits) {
    droppedCsv++;
    continue; // not a dictionary headword form (name/surname/dialect table)
  }
  covered.add(k);

  const values = Object.fromEntries(Object.entries(SHIP).map(([name, i]) => [name, get(i)]));
  values.tlNum = toSiteTlNum(values.tl);
  for (const [name, v] of Object.entries(values)) {
    if (v.includes("\n")) errors.push(`column ${name} contains a newline (string-pool separator): ${v}`);
    if (!v && ["tl", "hanzi", "poj"].includes(name)) {
      qa.emptyFields[name] = (qa.emptyFields[name] || 0) + 1;
    }
  }
  // one row per entry sharing this form
  for (const hit of hits.values()) {
    for (const name of Object.keys(SHIP)) cols[name].push(values[name]);
    ids.push(hit.id);
    flags.push((get(iMain) === "True" ? FLAG.MAIN : 0) | (hit.variant ? FLAG.VARIANT : 0));
  }

  // QA: runtime derivation vs CSV (hard gate)
  const checks = [
    ["tlNotone", deriveTlNotone(values.tl), get(QA_COLS.tlNotone).toLowerCase()],
    ["pojNotone", derivePojNotone(values.poj), get(QA_COLS.pojNotone).toLowerCase()],
    ["tpsNotone", deriveTpsNotone(values.tps), get(QA_COLS.tpsNotone)],
  ];
  for (const [name, derived, csv] of checks) {
    if (derived !== csv && qa.mismatch[name].length < 20) {
      qa.mismatch[name].push(`${values.tl}: derived=${JSON.stringify(derived)} csv=${JSON.stringify(csv)}`);
    } else if (derived !== csv) {
      qa.mismatch[name].push(null); // count only
    }
  }
  // QA: FOLD table coverage (soft, report only)
  const { unknown } = dataFold(get(QA_COLS.tpsNotone));
  for (const ch of unknown) qa.unknownTps.set(ch, (qa.unknownTps.get(ch) || 0) + 1);
}

// --- synthesize ODS forms that the CSV does not cover ---
const abbrevOf = (roman, deriveFn) => {
  const syls = roman.split(/[-\s]+/).filter(Boolean);
  if (syls.length < 2) return "";
  return syls.map((s) => deriveFn(s)[0] || "").join("");
};
let synthFailures = 0;
function pushSynthesized(tl, hanzi, id, flag) {
  let poj = "";
  let tps = "";
  let tlNum = "";
  try {
    poj = convert(tl, "tl", "poj");
    tps = convert(tl, "tl", "zhuyin").replace(/\s+/g, "");
    tlNum = toSiteTlNum(tl);
  } catch {
    synthFailures++; // keep the row anyway — tl/hanzi search still works
  }
  cols.tl.push(tl);
  cols.hanzi.push(hanzi);
  cols.poj.push(poj);
  cols.tps.push(tps);
  cols.tlNum.push(tlNum);
  cols.tpsNotoneVar.push("");
  cols.abTl.push(abbrevOf(tl, deriveTlNotone));
  cols.abPoj.push(poj ? abbrevOf(poj, derivePojNotone) : "");
  cols.abTps.push("");
  ids.push(id);
  flags.push(flag);
}
let synthesized = 0;
for (const [k, byId] of odsForms) {
  if (covered.has(k)) continue;
  for (const form of byId.values()) {
    pushSynthesized(form.tl, form.hanzi, form.id, form.variant ? FLAG.VARIANT : FLAG.MAIN);
    synthesized++;
  }
}
// aliases also carry VARIANT so ranking puts them after real forms and random picks (MAIN only)
// skip them
const ALIAS_FLAGS = FLAG.VARIANT | FLAG.ALIAS;
for (const alias of aliases) {
  pushSynthesized(alias.tl, alias.hanzi, alias.id, alias.comparison ? ALIAS_FLAGS | FLAG.COMPARISON : ALIAS_FLAGS);
}
const comparisonAliases = aliases.filter((a) => a.comparison).length;

const count = cols.tl.length;
// the UI ellipsizes by width; the cut only bounds the index size
const GLOSS_LENGTH = 30;
const glossOf = (id) => (entries.get(id).senses[0]?.definition || "").trim().slice(0, GLOSS_LENGTH);
const out = { meta: { source: "kautian.csv+ods", count, format: 5 }, id: ids, flags };
for (const k of Object.keys(SHIP)) out[k] = cols[k].join("\n");
// alias rows display their head row, so their own gloss would never show
out.gloss = ids.map((id, i) => (flags[i] & FLAG.ALIAS ? "" : glossOf(id))).join("\n");

mkdirSync(OUT_DIR, { recursive: true });
const json = JSON.stringify(out);
writeFileSync(OUT_JSON, json);
const jsonBytes = Buffer.byteLength(json);
const gzBytes = gzipSync(json).length;
const elapsed = (performance.now() - t0).toFixed(0);

const mismatchLines = Object.entries(qa.mismatch).flatMap(([name, list]) => [
  `derive ${name} mismatches: ${list.length} / ${count}`,
  ...list.filter(Boolean).map((s) => `  sample: ${s}`),
]);
const report = [
  `build-data report — ${new Date().toISOString()}`,
  `format: 5 (string-pool + entry ids + gloss, runtime-derived notone/zhu, no frequency)`,
  `entries (rows): ${count} — distinct entry ids: ${new Set(ids).size}`,
  `ODS headword form keys: ${odsForms.size} (csv-covered: ${covered.size}, synthesized: ${synthesized})`,
  `alias rows: ${aliases.length} (語音差異: ${aliases.length - comparisonAliases}, 詞彙比較: ${comparisonAliases})`,
  `synth failures (headwords + aliases): ${synthFailures}`,
  `CSV rows dropped (no entry id — names/dialect forms): ${droppedCsv}`,
  `json bytes: ${jsonBytes} (${(jsonBytes / 1048576).toFixed(2)} MB)`,
  `gzip bytes: ${gzBytes} (${(gzBytes / 1048576).toFixed(2)} MB)`,
  `build time: ${elapsed} ms`,
  ``,
  `-- QA --`,
  `empty required fields: ${JSON.stringify(qa.emptyFields)}`,
  `unknown TPS chars: ${[...qa.unknownTps].map(([c, x]) => `${c}(U+${c.codePointAt(0).toString(16).toUpperCase()})×${x}`).join(" ") || "none"}`,
  ...mismatchLines,
  ``,
].join("\n");
writeFileSync(OUT_REPORT, report);
console.log(report);

// hard gates
const totalMismatch = Object.values(qa.mismatch).reduce((s, l) => s + l.length, 0);
if (totalMismatch > 0) {
  console.error(`FAIL: runtime derivation differs from CSV (${totalMismatch} rows) — fix derive.js or inspect the data`);
  process.exit(1);
}
if (errors.length > 0) {
  console.error(`FAIL: ${errors.length} column errors`, errors.slice(0, 5));
  process.exit(1);
}
if (jsonBytes > 8 * 1048576) {
  console.error("FAIL: JSON exceeds the 8MB package limit");
  process.exit(1);
}
