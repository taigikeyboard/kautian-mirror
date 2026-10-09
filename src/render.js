// DOM builders for result rows, the result list, and entry pages (textContent only).

export const entryHref = (id) => `?id=${id}`;
export const searchHref = (query) => `?q=${encodeURIComponent(query)}`;

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// res: engine result { id, hanzi, tl, poj }
export function resultRow(res) {
  const row = el("a", "row");
  row.href = entryHref(res.id);
  row.append(el("span", "row-hanzi", res.hanzi), el("span", "row-roman", res.tl));
  if (res.poj && res.poj !== res.tl) row.append(el("span", "row-roman", res.poj));
  return row;
}

export function statusView(text, retry) {
  const box = el("p", "status", text);
  if (retry) {
    const button = el("button", "", "再試一擺");
    button.type = "button";
    button.addEventListener("click", retry);
    box.append(button);
  }
  return box;
}

export function resultsView(query, { results, error, truncated }) {
  if (error) return statusView(error === "too-long" ? "正規表達式傷長（上濟 64 字）。" : "正規表達式無正確。");
  if (!results.length) return statusView(`揣無「${query}」。`);
  const frag = document.createDocumentFragment();
  // truncated: the engine's regex scan hit its cap, so matches may be missing
  if (truncated) frag.append(el("p", "results-meta", "結果可能無齊全"));
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
  for (const [entryId, hanzi] of relations) {
    if (entryId === null) {
      dd.append(el("span", "", hanzi));
      continue;
    }
    const link = el("a", "", hanzi);
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
  line.append(tl);
  if (entry.poj) line.append(el("span", "reading-poj", entry.poj.join(" / ")));
  return line;
}

// facts: [term, text | <dd>] rows, in the official site's order
function factsList(entry) {
  const facts = (entry.altReadings || []).map(([kind, readings]) => [kind, readings.join("、")]);
  if (entry.variants?.length) facts.push(["異用字", entry.variants.join("、")]);
  if (entry.seeAlso?.length) facts.push(["又見音", relationLinks(entry.seeAlso)]);
  if (entry.category) facts.push(["分類", entry.category.replaceAll(",", "、")]);
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
  head.append(hanzi, readingsLine(entry), el("p", "entry-meta", entry.type));
  article.append(head);

  if (entry.senses?.length) {
    const list = el("ol", "senses");
    const isNumbered = entry.senses.length > 1;
    entry.senses.forEach((sense, i) => list.append(senseItem(sense, isNumbered ? i + 1 : null)));
    article.append(list);
  }
  for (const block of [factsList(entry), relationsList(entry.synonyms, entry.antonyms)]) {
    if (block) article.append(block);
  }
  return article;
}
