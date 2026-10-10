// Word card: draws an entry's headword, readings and definitions to a PNG, then shares or saves it.
const CARD_WIDTH = 1080;
const PADDING = 96;
const CONTENT_WIDTH = CARD_WIDTH - PADDING * 2;
// light palette from styles.css, so a shared card looks the same whatever the viewer's theme
const COLORS = { background: "#ffffff", text: "#1d1d1f", secondary: "#86868b", hairline: "#e8e8ed" };
const STYLES = {
  hanzi: { size: 120, weight: 700, color: COLORS.text, lineHeight: 1.25 },
  mark: { size: 48, weight: 400, color: COLORS.secondary, lineHeight: 1.25 },
  reading: { size: 48, weight: 400, color: COLORS.text, lineHeight: 1.4 },
  poj: { size: 44, weight: 400, color: COLORS.secondary, lineHeight: 1.4 },
  label: { size: 34, weight: 400, color: COLORS.secondary, lineHeight: 1.5 },
  definition: { size: 44, weight: 400, color: COLORS.text, lineHeight: 1.6 },
  credit: { size: 28, weight: 400, color: COLORS.secondary, lineHeight: 1.5 },
};
// CC BY-ND attribution, worded like the site footer
const CREDIT = "資料來源：教育部《臺灣台語常用詞辭典》，CC BY-ND 3.0 TW";
// space the credit line takes at the bottom, below the content's own padding
const CREDIT_HEIGHT = 48;

// a romanized word stays whole and opening brackets cling to what follows; other characters may end a line
const TOKEN_RE = /[（「『【(]*(?:[\p{Script=Latin}\p{M}0-9'-]+|\s+|.)/gu;
// closing punctuation never starts a line
const NO_LINE_START_RE = /^[、，。；：！？）」』】),.;:!?]/u;

let fontStack = "";
const fontOf = (style) => `${style.weight} ${style.size}px ${fontStack}`;

function wrapLines(ctx, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const token of text.match(TOKEN_RE) ?? []) {
    const candidate = line + token;
    if (line && ctx.measureText(candidate).width > maxWidth && !NO_LINE_START_RE.test(token)) {
      lines.push(line.trimEnd());
      line = token.trimStart();
    } else {
      line = candidate;
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

// ops: { text, style, x, y } (y = line top, relative to the content block) or { rule: true, y }
function layoutCard(ctx, entry) {
  const ops = [];
  let y = 0;
  const addText = (text, style, gapBefore) => {
    ctx.font = fontOf(style);
    y += gapBefore;
    for (const line of wrapLines(ctx, text, CONTENT_WIDTH)) {
      ops.push({ text: line, style, x: 0, y });
      y += style.size * style.lineHeight;
    }
  };

  addText(entry.hanzi, STYLES.hanzi, 0);
  if (entry.isSubstitute) {
    // source mark sits right after the headword, as on the entry page
    const last = ops.at(-1);
    ctx.font = fontOf(STYLES.hanzi);
    const x = ctx.measureText(last.text).width;
    const centerOffset = (STYLES.hanzi.size - STYLES.mark.size) * STYLES.hanzi.lineHeight / 2;
    ops.push({ text: "【替】", style: STYLES.mark, x, y: last.y + centerOffset });
  }
  const mark = entry.readingMark ? `【${entry.readingMark}】` : "";
  addText(mark + entry.tl.join(" / "), STYLES.reading, 16);
  if (entry.poj) addText(entry.poj.join(" / "), STYLES.poj, 0);

  const senses = (entry.senses ?? []).filter((sense) => sense.definition);
  if (!senses.length) return { ops, height: y };
  y += 48;
  ops.push({ rule: true, y });
  const isNumbered = senses.length > 1;
  senses.forEach((sense, i) => {
    // same "1  動詞" label as the entry page
    const label = [isNumbered ? i + 1 : null, sense.pos].filter(Boolean).join("  ");
    if (label) addText(label, STYLES.label, 40);
    addText(sense.definition, STYLES.definition, label ? 4 : 40);
  });
  return { ops, height: y };
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("canvas.toBlob returned null"))), "image/png");
  });
}

// entry: { hanzi, tl, poj?, readingMark?, isSubstitute?, senses? }
export async function renderWordCard(entry) {
  fontStack = getComputedStyle(document.documentElement).getPropertyValue("--font").trim();
  // canvas draws with whatever is loaded; make sure the CJK face is in before measuring
  await document.fonts.load(fontOf(STYLES.hanzi), entry.hanzi);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const { ops, height } = layoutCard(ctx, entry);
  // at least square; short entries sit centered above the credit, long ones grow the card downward
  canvas.width = CARD_WIDTH;
  canvas.height = Math.max(CARD_WIDTH, height + PADDING * 2 + CREDIT_HEIGHT);
  const top = Math.max(PADDING, (canvas.height - CREDIT_HEIGHT - height) / 2);

  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textBaseline = "middle";
  for (const op of ops) {
    if (op.rule) {
      ctx.fillStyle = COLORS.hairline;
      ctx.fillRect(PADDING, top + op.y, CONTENT_WIDTH, 2);
      continue;
    }
    ctx.font = fontOf(op.style);
    ctx.fillStyle = op.style.color;
    ctx.fillText(op.text, PADDING + op.x, top + op.y + (op.style.size * op.style.lineHeight) / 2);
  }
  ctx.font = fontOf(STYLES.credit);
  ctx.fillStyle = STYLES.credit.color;
  ctx.fillText(CREDIT, PADDING, canvas.height - PADDING / 2 - CREDIT_HEIGHT / 2, CONTENT_WIDTH);
  return canvasToBlob(canvas);
}

function saveFile(file) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

// share sheet where the browser can share image files (mobile, macOS); otherwise download the PNG
export async function shareWordCard(entry) {
  const file = new File([await renderWordCard(entry)], `${entry.hanzi}.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      // AbortError: the user closed the share sheet
      if (err.name === "AbortError") return;
      // NotAllowedError: rendering outlived the click's user activation, so save the file instead
      if (err.name !== "NotAllowedError") throw err;
    }
  }
  saveFile(file);
}
