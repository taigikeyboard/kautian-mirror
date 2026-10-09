// kautian.ods → dist/data/entries/<bucket>.json (entry pages, sharded by id)
// Zero-dependency data build for Node 22+. Reads the ODS shipped in the
// kautian-extension submodule so headword search and entry pages share one source.
//
// Entry shape (empty/false fields are omitted from the JSON; the UI defaults them):
//   { id, type, hanzi, isSubstitute (【替】 substitute character),
//     readingMark (文/白/俗 from a 【文】-style reading prefix), tl: [reading],
//     poj: [reading] (only when some reading differs from tl), category,
//     audio (dist/audio/ has its word mp3; run `npm run build:audio` first),
//     altReadings: [[kind, [tl]]], variants: [hanzi],
//     seeAlso: [[entryId, label]] (又見音: other entries with the same hanzi, label from source fields),
//     synonyms/antonyms: [[entryId | null, hanzi, tl?]] (tl of the linked entry, as the official site shows),
//     senses: [{ pos, definition, examples: [[hanzi, tl, mandarin]], synonyms, antonyms }] }
// Relation targets whose entry is not published (近反義詞不單列詞目者) keep their
// text but get entryId null, so the UI never links to a missing entry.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readZipEntry, sheetRows } from "../vendor/kautian-extension/scripts/ods.mjs";
import { convert } from "../vendor/kautian-extension/vendor/taigi-converter/src/index.js";
import { ENTRIES_DIR, audioPath, bucketOf, shardPath } from "../src/data-paths.js";

// Same published entry types as the extension's search index (build-data.mjs)
export const PUBLISHED_TYPES = new Set(["主詞目", "單字不成詞者", "臺華共同詞", "附錄"]);

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

function toPoj(tl) {
  try {
    return convert(tl, "tl", "poj");
  } catch {
    return "";
  }
}

function addRelation(list, entryId, hanzi) {
  if (!list.some(([id, h]) => id === entryId && h === hanzi)) list.push([entryId, hanzi]);
}

// sheets: { sheetName: string[][] including the header row } → Map<entryId, entry>
export function buildEntries(sheets) {
  const rows = (name) => (sheets[name] || []).slice(1);
  const entries = new Map();

  for (const r of rows("詞目")) {
    if (!PUBLISHED_TYPES.has(r[1])) continue;
    const id = parseId(r[0], "詞目");
    if (entries.has(id)) throw new Error(`詞目: duplicate id ${id}`);
    const readingMark = READING_MARK_RE.exec(r[3])?.[1] || "";
    const tl = splitReadings(r[3].replace(READING_MARK_RE, ""));
    const poj = tl.map(toPoj);
    entries.set(id, {
      id,
      type: r[1],
      hanzi: r[2].replace(SUBSTITUTE_MARK, "").trim(),
      isSubstitute: r[2].includes(SUBSTITUTE_MARK),
      readingMark,
      tl,
      poj: poj.some((reading, i) => reading && reading !== tl[i]) ? poj : [],
      category: r[4] || "",
      altReadings: [],
      seeAlso: [],
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
  addSeeAlso(entries);
  addRelationReadings(entries);
  return entries;
}

// The official site lists linked synonyms/antonyms with their reading (傷本 siong-pún);
// unlinked targets have no entry, so they stay hanzi-only there too.
function addRelationReadings(entries) {
  for (const entry of entries.values()) {
    for (const list of [entry.synonyms, entry.antonyms, ...entry.senses.flatMap((s) => [s.synonyms, s.antonyms])]) {
      for (const relation of list) {
        if (relation[0] !== null) relation.push(entries.get(relation[0]).tl.join("/"));
      }
    }
  }
}

// 又見音: every other published entry sharing this hanzi, labelled like the source
// data writes it (人【替】 lâng, 九 【文】kiú)
function addSeeAlso(entries) {
  const byHanzi = new Map();
  for (const entry of entries.values()) {
    byHanzi.set(entry.hanzi, [...(byHanzi.get(entry.hanzi) || []), entry]);
  }
  for (const group of byHanzi.values()) {
    if (group.length < 2) continue;
    for (const entry of group) {
      for (const other of group) {
        if (other === entry) continue;
        const hanzi = other.isSubstitute ? `${other.hanzi}${SUBSTITUTE_MARK}` : other.hanzi;
        const mark = other.readingMark ? `【${other.readingMark}】` : "";
        entry.seeAlso.push([other.id, `${hanzi} ${mark}${other.tl.join("/")}`]);
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

const SHEETS = [
  "詞目", "義項", "例句", ...ALT_READING_SHEETS, "異用字",
  ...Object.values(RELATION_SHEETS).flat().map(([sheet]) => sheet),
];

export function readSheets(odsPath) {
  const xml = readZipEntry(odsPath, "content.xml").toString("utf8");
  return Object.fromEntries(SHEETS.map((name) => [name, sheetRows(xml, name)]));
}

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ODS_PATH = join(ROOT, "vendor/kautian-extension/kautian.ods");
// search index produced by the submodule's build-data.mjs (copied into dist/ by esbuild.config.mjs)
export const VENDOR_INDEX_PATH = join(ROOT, "vendor/kautian-extension/data/kautian.min.json");

function main() {
  const distDir = join(ROOT, "dist");
  const outDir = join(distDir, ENTRIES_DIR);
  const t0 = performance.now();
  const entries = buildEntries(readSheets(ODS_PATH));
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
