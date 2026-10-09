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

export function resultsView(query, { results, error, truncated }, limit) {
  if (error) return statusView(error === "too-long" ? "正規表達式傷長（上濟 64 字）。" : "正規表達式無正確。");
  if (!results.length) return statusView(`揣無「${query}」。`);
  const frag = document.createDocumentFragment();
  const count = results.length >= limit ? `頭前 ${limit} 筆` : `${results.length} 筆`;
  // truncated: the engine's regex scan hit its cap, so matches may be missing
  frag.append(el("p", "results-meta", truncated ? `${count}，結果可能無齊全` : count));
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

function readingSpan(className, label, readings) {
  const span = el("span", className);
  span.append(el("span", "reading-label", label), readings.join(" / "));
  return span;
}

function readingsLine(entry) {
  const line = el("div", "readings");
  line.append(readingSpan("reading-tl", "台羅", entry.tl));
  if (entry.poj) line.append(readingSpan("reading-poj", "白話字", entry.poj));
  return line;
}

function factsList(entry) {
  const facts = (entry.altReadings || []).map(([kind, readings]) => [kind, readings.join("、")]);
  if (entry.variants?.length) facts.push(["異用字", entry.variants.join("、")]);
  if (entry.category) facts.push(["分類", entry.category.replaceAll(",", "、")]);
  if (!facts.length) return null;
  const dl = el("dl", "facts");
  for (const [term, value] of facts) dl.append(el("dt", "", term), el("dd", "", value));
  return dl;
}

function senseItem(sense) {
  const item = el("li", "sense");
  const head = el("div", "sense-head");
  if (sense.pos) head.append(el("span", "pos", sense.pos));
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
  head.append(el("h1", "entry-hanzi", entry.hanzi), readingsLine(entry));
  const tags = el("div", "tags");
  tags.append(el("span", "tag", entry.type));
  if (entry.readingMark) tags.append(el("span", "tag", `${entry.readingMark}讀`));
  if (entry.isSubstitute) tags.append(el("span", "tag", "替代字"));
  head.append(tags);
  const facts = factsList(entry);
  if (facts) head.append(facts);
  const relations = relationsList(entry.synonyms, entry.antonyms);
  if (relations) head.append(relations);
  article.append(head);

  if (entry.senses?.length) {
    const list = el("ol", entry.senses.length > 1 ? "senses numbered" : "senses");
    for (const sense of entry.senses) list.append(senseItem(sense));
    article.append(list);
  } else if (entry.type === "臺華共同詞") {
    article.append(el("p", "empty-note", "臺華共同詞：意思佮華語相仝。"));
  }
  return article;
}
