// 詞彙比較 links: which entry page shows which 華語詞目 table.
// The ODS 詞彙比較 sheet has the table rows but not the entry ↔ table links (curated
// by MOE; hanzi/reading matching picks wrong tables), so read them off the official
// entry pages once and commit data/comparison-links.json. Rerun after an ODS update.
// Every published entry is scanned: links can join unrelated hanzi (棄世 → 去世).
// Page results are cached in .cache/ so an interrupted run resumes; delete it to refetch.
// The official cert has expired before; if fetch fails on TLS, rerun with
// NODE_TLS_REJECT_UNAUTHORIZED=0 (read-only public pages).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readSheets, buildEntries, ODS_PATH, COMPARISON_LINKS_PATH, ROOT } from "./build-entries.mjs";

const ENTRY_URL = (id) => `https://sutian.moe.edu.tw/zh-hant/su/${id}/`;
const CONCURRENCY = 4;
const CACHE_PATH = join(ROOT, ".cache/comparison-pages.json");

// &amp; goes last: decoding it first would turn a literal "&amp;lt;" into "<"
const decode = (s) => s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(n))
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
  .replace(/&amp;/g, "&");
const text = (s) => decode(s.replace(/<[^>]+>/g, "")).trim();

// entry page HTML → [{ mandarin, rows: [[accent, hanzi, tl]] }] in page order
export function parseComparisons(html) {
  const start = html.indexOf('id="詞彙比較"');
  if (start < 0) return [];
  const section = html.slice(start, html.indexOf("</section>", start));
  return [...section.matchAll(/<table[\s\S]*?<\/table>/g)].map(([table]) => {
    const mandarin = text(/華語詞目：([\s\S]*?)<\/caption>/.exec(table)[1]);
    const rows = [];
    let accent = "";
    for (const [, tr] of table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const th = /<th rowspan[^>]*>([\s\S]*?)<\/th>/.exec(tr);
      if (th) accent = text(th[1]);
      const cells = [...tr.matchAll(/<td>([\s\S]*?)<\/td>/g)].map(([, td]) => text(td));
      if (cells.length) rows.push([accent, ...cells]);
    }
    return { mandarin, rows };
  });
}

async function fetchPage(id) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(ENTRY_URL(id));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (attempt === 3) throw new Error(`${ENTRY_URL(id)}: ${err.cause?.code || err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function main() {
  const sheets = readSheets(ODS_PATH);
  const ids = [...buildEntries(sheets).keys()];
  const mandarinIds = new Map(sheets["詞彙比較"].slice(1).map(([id, mandarin]) => [mandarin, Number(id)]));

  // id → 華語詞目 captions on that page; resumable, a full run is ~26k pages
  const cache = existsSync(CACHE_PATH) ? JSON.parse(readFileSync(CACHE_PATH, "utf8")) : {};
  const saveCache = () => writeFileSync(CACHE_PATH, JSON.stringify(cache));
  const todo = ids.filter((id) => !(id in cache));
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      const id = todo[next++];
      cache[id] = parseComparisons(await fetchPage(id)).map(({ mandarin }) => mandarin);
      const done = ids.length - todo.length + next;
      if (done % 200 === 0) {
        saveCache();
        console.log(`${done}/${ids.length}`);
      }
    }
  };
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  } finally {
    saveCache();
  }

  const links = {};
  for (const id of ids) {
    if (!cache[id].length) continue;
    links[id] = cache[id].map((mandarin) => {
      if (!mandarinIds.has(mandarin)) throw new Error(`entry ${id}: 華語詞目 ${mandarin} not in ODS`);
      return mandarinIds.get(mandarin);
    });
  }
  writeFileSync(COMPARISON_LINKS_PATH, JSON.stringify(links).replace(/\],/g, "],\n") + "\n");
  const linked = new Set(Object.values(links).flat());
  console.log(`entries ${ids.length}, with tables ${Object.keys(links).length}, ` +
    `tables linked ${linked.size}/${mandarinIds.size}`);
}

if (process.argv[1] === import.meta.filename) await main();
