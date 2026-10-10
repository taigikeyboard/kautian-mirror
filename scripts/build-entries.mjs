// kautian.ods → dist/data/entries/<bucket>.json (entry pages, sharded by id)
// Zero-dependency data build for Node 22+. Reads the ODS shipped in the
// extension's copy so headword search and entry pages share one source.
//
// Entry shape (empty/false fields are omitted from the JSON; the UI defaults them):
//   { id, type, hanzi, isSubstitute (【替】 substitute character),
//     readingMark (文/白/俗 from a 【文】-style reading prefix), tl: [reading],
//     poj: [reading] (only when some reading differs from tl),
//     tps: [reading] (方音符號, syllables space-separated), category,
//     audio (dist/audio/ has its word mp3; run `npm run build:audio` first),
//     altReadings: [[kind, [tl]]], variants: [hanzi],
//     seeAlso: [[entryId, label]] (又見音: other entries with the same hanzi),
//     dialectReadings: [[accent, [tl]]] (語音差異, sheet column order; empty accents dropped),
//     comparisons: [{ mandarin, rows: [[accent, hanzi, tl]] }] (詞彙比較 tables linked to this
//       entry by data/comparison-links.json, see scripts/fetch-comparisons.mjs; rows in accent order),
//     synonyms/antonyms: [[entryId | null, label]] (linked: entryLabel of the target; unlinked: hanzi),
//     senses: [{ pos, definition, examples: [[hanzi, tl, mandarin]], synonyms, antonyms }] }
// Relation targets whose entry is not published (近反義詞不單列詞目者) keep their
// text but get entryId null, so the UI never links to a missing entry.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PUBLISHED_TYPES, readZipEntry, sheetRows } from "../extension/scripts/ods.mjs";
import { convert } from "../vendor/taigi-converter/src/index.js";
import { ENTRIES_DIR, audioPath, bucketOf, shardPath } from "../src/data-paths.js";

const SUBSTITUTE_MARK = "【替】";
const READING_MARK_RE = /^【([^】]+)】/;
const ALT_READING_SHEETS = ["又唸作", "俗唸作", "合音唸作"];
const RELATION_SHEETS = {
  senseToSense: [["義項tuì義項近義", "synonyms"], ["義項tuì義項反義", "antonyms"]],
  senseToEntry: [["義項tuì詞目近義", "synonyms"], ["義項tuì詞目反義", "antonyms"]],
  entryToEntry: [["詞目tuì詞目近義", "synonyms"], ["詞目tuì詞目反義", "antonyms"]],
};

function parseId(cell, sheet) {
  const id = Number(cell);
  if (!Number.isInteger(id) || id <= 0) throw new Error(`${sheet}: bad id ${JSON.stringify(cell)}`);
  return id;
}

const splitReadings = (text) => text.split("/").map((s) => s.trim()).filter(Boolean);

// "" when taigi-converter cannot parse the reading
function convertReading(tl, target) {
  try {
    return convert(tl, "tl", target);
  } catch {
    return "";
  }
}

// converter output pads punctuation and tone-1 syllables: "ㄍㆤ  ， ㄒㄧㄣ" → "ㄍㆤ，ㄒㄧㄣ"
const toTps = (tl) =>
  convertReading(tl, "zhuyin").replace(/\s*([，。；？！、])\s*/g, "$1").replace(/\s+/g, " ").trim();

function addRelation(list, entryId, hanzi) {
  if (!list.some(([id, h]) => id === entryId && h === hanzi)) list.push([entryId, hanzi]);
}

// sheets: { sheetName: string[][] including the header row } → Map<entryId, entry>
// comparisonLinks: { entryId: [華語詞目id] } (data/comparison-links.json)
export function buildEntries(sheets, comparisonLinks = {}) {
  const rows = (name) => (sheets[name] || []).slice(1);
  const entries = new Map();

  for (const r of rows("詞目")) {
    if (!PUBLISHED_TYPES.has(r[1])) continue;
    const id = parseId(r[0], "詞目");
    if (entries.has(id)) throw new Error(`詞目: duplicate id ${id}`);
    const readingMark = READING_MARK_RE.exec(r[3])?.[1] || "";
    const tl = splitReadings(r[3].replace(READING_MARK_RE, ""));
    const poj = tl.map((reading) => convertReading(reading, "poj"));
    const tps = tl.map(toTps);
    entries.set(id, {
      id,
      type: r[1],
      hanzi: r[2].replace(SUBSTITUTE_MARK, "").trim(),
      isSubstitute: r[2].includes(SUBSTITUTE_MARK),
      readingMark,
      tl,
      poj: poj.some((reading, i) => reading && reading !== tl[i]) ? poj : [],
      tps: tps.some(Boolean) ? tps : [],
      category: r[4] || "",
      altReadings: [],
      seeAlso: [],
      dialectReadings: [],
      comparisons: [],
      variants: [],
      synonyms: [],
      antonyms: [],
      senses: [],
    });
  }
  const linkableId = (id) => (entries.has(id) ? id : null);

  const senses = new Map(); // senseId → { entryId, sense }
  for (const r of rows("義項")) {
    const entry = entries.get(parseId(r[0], "義項"));
    if (!entry) continue;
    const sense = { pos: r[2] || "", definition: r[3] || "", examples: [], synonyms: [], antonyms: [] };
    entry.senses.push(sense);
    senses.set(parseId(r[1], "義項"), { entryId: entry.id, sense });
  }

  const examples = rows("例句")
    .map((r) => ({ senseId: Number(r[1]), order: Number(r[2]), r }))
    .filter(({ senseId }) => senses.has(senseId))
    .sort((a, b) => a.senseId - b.senseId || a.order - b.order);
  for (const { senseId, r } of examples) senses.get(senseId).sense.examples.push([r[3], r[4], r[5]]);

  for (const kind of ALT_READING_SHEETS) {
    for (const r of rows(kind)) {
      const entry = entries.get(parseId(r[0], kind));
      if (!entry) continue;
      let group = entry.altReadings.find(([k]) => k === kind);
      if (!group) entry.altReadings.push((group = [kind, []]));
      group[1].push(...splitReadings(r[2]));
    }
  }
  for (const r of rows("異用字")) {
    const entry = entries.get(parseId(r[0], "異用字"));
    if (entry && !entry.variants.includes(r[2])) entry.variants.push(r[2]);
  }

  for (const [sheet, key] of RELATION_SHEETS.senseToSense) {
    for (const r of rows(sheet)) {
      const from = senses.get(Number(r[0]));
      if (!from) continue;
      const target = senses.get(Number(r[3]));
      addRelation(from.sense[key], target ? target.entryId : null, r[4]);
    }
  }
  for (const [sheet, key] of RELATION_SHEETS.senseToEntry) {
    for (const r of rows(sheet)) {
      const from = senses.get(Number(r[0]));
      if (from) addRelation(from.sense[key], linkableId(Number(r[3])), r[4]);
    }
  }
  for (const [sheet, key] of RELATION_SHEETS.entryToEntry) {
    for (const r of rows(sheet)) {
      const entry = entries.get(Number(r[0]));
      if (entry) addRelation(entry[key], linkableId(Number(r[2])), r[3]);
    }
  }
  // 語音差異: keyed by entry id; the header row names the accent columns
  const [dialectHeader = [], ...dialectRows] = sheets["語音差異"] || [];
  const accents = dialectHeader.slice(2);
  for (const r of dialectRows) {
    const entry = entries.get(Number(r[0]));
    if (!entry) continue;
    // a cell lists several readings as "moo,mn̂g"; the official table gives each its own row
    entry.dialectReadings = accents
      .map((accent, i) => [accent, splitDialectReadings(r[i + 2])])
      .filter(([, readings]) => readings.length);
  }
  // 詞彙比較: keyed by 華語詞目id; which entries show a table comes from comparisonLinks
  const tables = new Map();
  for (const [id, mandarin, accent, hanzi, tl] of rows("詞彙比較")) {
    const key = parseId(id, "詞彙比較");
    if (!tables.has(key)) tables.set(key, { mandarin, rows: [] });
    tables.get(key).rows.push([accent, hanzi, tl]);
  }
  // official tables list accents in 語音差異 column order (stable within an accent)
  const accentOrder = (accent) => {
    const i = accents.indexOf(accent);
    if (i < 0) throw new Error(`詞彙比較: unknown accent ${accent}`);
    return i;
  };
  for (const table of tables.values()) table.rows.sort(([a], [b]) => accentOrder(a) - accentOrder(b));
  for (const [entryId, tableIds] of Object.entries(comparisonLinks)) {
    const entry = entries.get(Number(entryId));
    if (!entry) continue;
    entry.comparisons = tableIds.map((id) => {
      if (!tables.has(id)) throw new Error(`comparison-links: entry ${entryId} → missing 華語詞目id ${id}`);
      return tables.get(id);
    });
  }
  addSeeAlso(entries);
  labelLinkedRelations(entries);
  return entries;
}

const splitDialectReadings = (cell = "") => cell.split(",").map((s) => s.trim()).filter(Boolean);

// How the official site labels a link to an entry, marks included:
// 人【替】 lâng, 頭 【白】thâu, 傷本 siong-pún
function entryLabel(entry) {
  const hanzi = entry.isSubstitute ? `${entry.hanzi}${SUBSTITUTE_MARK}` : entry.hanzi;
  const mark = entry.readingMark ? `【${entry.readingMark}】` : "";
  return `${hanzi} ${mark}${entry.tl.join("/")}`;
}

// Linked synonyms/antonyms carry the target's label; unlinked targets have no entry,
// so they stay hanzi-only there too.
function labelLinkedRelations(entries) {
  for (const entry of entries.values()) {
    for (const list of [entry.synonyms, entry.antonyms, ...entry.senses.flatMap((s) => [s.synonyms, s.antonyms])]) {
      for (const relation of list) {
        if (relation[0] !== null) relation[1] = entryLabel(entries.get(relation[0]));
      }
    }
  }
}

// 又見音: every other published entry sharing this hanzi
function addSeeAlso(entries) {
  const byHanzi = new Map();
  for (const entry of entries.values()) {
    byHanzi.set(entry.hanzi, [...(byHanzi.get(entry.hanzi) || []), entry]);
  }
  for (const group of byHanzi.values()) {
    if (group.length < 2) continue;
    for (const entry of group) {
      for (const other of group) {
        if (other !== entry) entry.seeAlso.push([other.id, entryLabel(other)]);
      }
    }
  }
}

// Drop empty object fields; array items stay positional.
function omitEmpty(key, value) {
  if (Array.isArray(this)) return value;
  if (value === false || value === "" || (Array.isArray(value) && !value.length)) return undefined;
  return value;
}

export function shardEntries(entries) {
  const buckets = new Map();
  for (const entry of entries.values()) {
    const bucket = bucketOf(entry.id);
    if (!buckets.has(bucket)) buckets.set(bucket, {});
    buckets.get(bucket)[entry.id] = entry;
  }
  return buckets;
}

export const serializeShard = (shard) => JSON.stringify(shard, omitEmpty);

// published site root, same as og:url in src/index.html
export const SITE_URL = "https://taigikeyboard.tw/kautian-mirror/";

// home + one ?id= URL per entry; entry pages are client-rendered, so crawlers can't find them by links
export function sitemapXml(entryIds) {
  const urls = [SITE_URL, ...entryIds.map((id) => `${SITE_URL}?id=${id}`)];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `<url><loc>${url}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");
}

const SHEETS = [
  "詞目", "義項", "例句", ...ALT_READING_SHEETS, "異用字", "語音差異", "詞彙比較",
  ...Object.values(RELATION_SHEETS).flat().map(([sheet]) => sheet),
];

export function readSheets(odsPath) {
  const xml = readZipEntry(odsPath, "content.xml").toString("utf8");
  return Object.fromEntries(SHEETS.map((name) => [name, sheetRows(xml, name)]));
}

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ODS_PATH = join(ROOT, "extension/kautian.ods");
export const COMPARISON_LINKS_PATH = join(ROOT, "data/comparison-links.json");
export const readComparisonLinks = () => JSON.parse(readFileSync(COMPARISON_LINKS_PATH, "utf8"));
// search index produced by extension/scripts/build-data.mjs (copied into dist/ by esbuild.config.mjs)
export const SEARCH_INDEX_PATH = join(ROOT, "extension/data/kautian.min.json");

function main() {
  const distDir = join(ROOT, "dist");
  const outDir = join(distDir, ENTRIES_DIR);
  const t0 = performance.now();
  const entries = buildEntries(readSheets(ODS_PATH), readComparisonLinks());
  for (const entry of entries.values()) entry.audio = existsSync(join(distDir, audioPath(entry.id)));
  const buckets = shardEntries(entries);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  let rawBytes = 0;
  let gzipBytes = 0;
  let largestGzip = 0;
  for (const [bucket, shard] of buckets) {
    const json = serializeShard(shard);
    writeFileSync(join(distDir, shardPath(bucket)), json);
    const size = gzipSync(json).length;
    rawBytes += Buffer.byteLength(json);
    gzipBytes += size;
    largestGzip = Math.max(largestGzip, size);
  }
  writeFileSync(join(distDir, "sitemap.xml"), sitemapXml([...entries.keys()].sort((a, b) => a - b)));
  const withoutSenses = [...entries.values()].filter((e) => !e.senses.length).length;
  const withAudio = [...entries.values()].filter((e) => e.audio).length;
  console.log([
    `entries: ${entries.size} (without senses: ${withoutSenses}, with audio: ${withAudio}) in ${buckets.size} shards`,
    `raw ${(rawBytes / 1048576).toFixed(2)} MB, gzip ${(gzipBytes / 1048576).toFixed(2)} MB, ` +
      `largest shard gzip ${(largestGzip / 1024).toFixed(0)} KB`,
    `build time: ${(performance.now() - t0).toFixed(0)} ms`,
  ].join("\n"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
