// DOM builders for result rows, the result list, and entry pages (textContent only).
import { playButton } from "./audio.js";
import { entryActions } from "./entry-actions.js";

export const entryHref = (id) => `?id=${id}`;
export const searchHref = (query) => `?q=${encodeURIComponent(query)}`;

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// res: engine result { id, hanzi, tl, poj, tps, gloss }
export function resultRow(res) {
  const row = el("a", "row");
  row.href = entryHref(res.id);
  row.append(el("span", "row-hanzi", res.hanzi), el("span", "row-roman", res.tl));
  if (res.poj && res.poj !== res.tl) row.append(el("span", "row-roman", res.poj));
  if (res.tps) row.append(el("span", "row-roman", res.tps));
  // source 華語釋義, ellipsized by CSS: tells look-alike rows apart (five 東區 Tang-khu)
  if (res.gloss) row.append(el("span", "row-gloss", res.gloss));
  return row;
}

export function statusView(text, retry) {
  const box = el("p", "status", text);
  if (retry) {
    const button = el("button", "", "閣試一擺");
    button.type = "button";
    button.addEventListener("click", retry);
    box.append(button);
  }
  return box;
}

// engine query() error message
const regexErrorText = (error) =>
  error === "too-long" ? "正規表達式傷長（上濟 64 字）" : "正規表達式無正確";

export function resultsView(query, { results, error }) {
  if (error) return statusView(regexErrorText(error));
  if (!results.length) return statusView(`「${query}」揣無`);
  const frag = document.createDocumentFragment();
  const list = el("ul", "results");
  for (const res of results) {
    const item = el("li");
    item.append(resultRow(res));
    list.append(item);
  }
  frag.append(list);
  return frag;
}

// 【詞】 cross-references inside definitions become search links
const CROSS_REF_RE = /【([^】]+)】/g;

function definitionNode(text) {
  const node = el("p", "def");
  let last = 0;
  for (const match of text.matchAll(CROSS_REF_RE)) {
    node.append(text.slice(last, match.index), "【");
    const link = el("a", "", match[1]);
    link.href = searchHref(match[1]);
    node.append(link, "】");
    last = match.index + match[0].length;
  }
  node.append(text.slice(last));
  return node;
}

function relationLinks(relations) {
  const dd = el("dd");
  for (const [entryId, label] of relations) {
    if (entryId === null) {
      dd.append(el("span", "", label));
      continue;
    }
    const link = el("a", "", label);
    link.href = entryHref(entryId);
    dd.append(link);
  }
  return dd;
}

function relationsList(synonyms = [], antonyms = []) {
  if (!synonyms.length && !antonyms.length) return null;
  const dl = el("dl", "relations");
  if (synonyms.length) dl.append(el("dt", "", "近義"), relationLinks(synonyms));
  if (antonyms.length) dl.append(el("dt", "", "反義"), relationLinks(antonyms));
  return dl;
}

function readingsLine(entry) {
  const line = el("p", "readings");
  const tl = el("span", "reading-tl");
  // source marks shown verbatim, where the dictionary data puts them
  if (entry.readingMark) tl.append(el("span", "mark", `【${entry.readingMark}】`));
  tl.append(entry.tl.join(" / "));
  // official site places the play icon right after the romanization
  if (entry.audio) tl.append(playButton(entry.id));
  line.append(tl);
  // site UI labels, not source text: POJ and 方音符號 are converted from 台羅
  if (entry.poj) line.append(altReading("POJ:", entry.poj));
  if (entry.tps) line.append(altReading("TPS:", entry.tps));
  return line;
}

function altReading(label, readings) {
  const span = el("span", "reading-alt");
  span.append(el("span", "reading-label", label), readings.join(" / "));
  return span;
}

// 語音差異: accent → reading rows, as the official table lists them
function dialectTable(dialectReadings) {
  const dd = el("dd");
  const table = el("table", "dialects");
  const body = el("tbody");
  for (const [accent, readings] of dialectReadings) {
    readings.forEach((tl, i) => {
      const row = el("tr");
      if (i === 0) {
        const th = el("th", "", accent);
        th.rowSpan = readings.length;
        row.append(th);
      }
      row.append(el("td", "", tl));
      body.append(row);
    });
  }
  table.append(body);
  dd.append(table);
  return dd;
}

// 詞彙比較: one table per 華語詞目, accent cells spanning their word rows, as the official site
function comparisonTables(comparisons) {
  const dd = el("dd");
  for (const { mandarin, rows } of comparisons) {
    const table = el("table", "comparison");
    table.append(el("caption", "", `華語詞目：${mandarin}`));
    const head = el("thead");
    const headRow = el("tr");
    for (const label of ["腔", "詞彙", "音讀"]) headRow.append(el("th", "", label));
    head.append(headRow);
    table.append(head);
    const body = el("tbody");
    rows.forEach(([accent, hanzi, tl], i) => {
      const row = el("tr");
      if (accent !== rows[i - 1]?.[0]) {
        const th = el("th", "", accent);
        th.scope = "rowgroup";
        let span = 1;
        while (rows[i + span]?.[0] === accent) span++;
        th.rowSpan = span;
        row.append(th);
      }
      row.append(el("td", "", hanzi), el("td", "", tl));
      body.append(row);
    });
    table.append(body);
    dd.append(table);
  }
  return dd;
}

// facts: [term, text | <dd>] rows, in the official site's order
function factsList(entry) {
  const facts = (entry.altReadings || []).map(([kind, readings]) => [kind, readings.join("、")]);
  if (entry.variants?.length) facts.push(["異用字", entry.variants.join("、")]);
  if (entry.seeAlso?.length) facts.push(["又見音", relationLinks(entry.seeAlso)]);
  // 附錄 entries carry their appendix listing in the category column; the official site labels it 附錄
  if (entry.category) facts.push([entry.type === "附錄" ? "附錄" : "分類", entry.category.replaceAll(",", "、")]);
  if (entry.synonyms?.length) facts.push(["近義", relationLinks(entry.synonyms)]);
  if (entry.antonyms?.length) facts.push(["反義", relationLinks(entry.antonyms)]);
  if (entry.dialectReadings?.length) facts.push(["語音差異", dialectTable(entry.dialectReadings)]);
  if (entry.comparisons?.length) facts.push(["詞彙比較", comparisonTables(entry.comparisons)]);
  if (!facts.length) return null;
  const dl = el("dl", "facts");
  for (const [term, value] of facts) {
    dl.append(el("dt", "", term), typeof value === "string" ? el("dd", "", value) : value);
  }
  return dl;
}

// number: 1-based sense number, or null when the entry has a single sense
function senseItem(sense, number) {
  const item = el("li", "sense");
  const head = el("div", "sense-head");
  const label = [number, sense.pos].filter(Boolean).join("  ");
  if (label) head.append(el("span", "pos", label));
  head.append(definitionNode(sense.definition || ""));
  item.append(head);
  if (sense.examples?.length) {
    const list = el("ul", "examples");
    for (const [hanzi, tl, mandarin] of sense.examples) {
      const example = el("li", "example");
      example.append(el("div", "ex-hanzi", hanzi), el("div", "ex-roman", tl));
      if (mandarin) example.append(el("div", "ex-zh", mandarin));
      list.append(example);
    }
    item.append(list);
  }
  const relations = relationsList(sense.synonyms, sense.antonyms);
  if (relations) item.append(relations);
  return item;
}

export function entryView(entry) {
  const article = el("article", "entry");
  const head = el("header", "entry-head");
  const hanzi = el("h1", "entry-hanzi", entry.hanzi);
  if (entry.isSubstitute) hanzi.append(el("span", "mark", "【替】"));
  head.append(entryActions(entry), hanzi, readingsLine(entry), el("p", "entry-meta", entry.type));
  article.append(head);

  if (entry.senses?.length) {
    const list = el("ol", "senses");
    const isNumbered = entry.senses.length > 1;
    entry.senses.forEach((sense, i) => list.append(senseItem(sense, isNumbered ? i + 1 : null)));
    article.append(list);
  }
  const facts = factsList(entry);
  if (facts) article.append(facts);
  return article;
}
