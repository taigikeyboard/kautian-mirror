// Minimal ODS reader for kautian.ods (build-time only, zero dependencies).
// An ODS file is a zip archive; we parse the central directory manually and
// inflate content.xml, then extract sheet rows with regexes. Good enough for
// the fixed structure of this one file — not a general ODS library.
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

export function readZipEntry(path, entryName) {
  const buf = readFileSync(path);
  // locate End Of Central Directory (scan backwards, comment can pad the tail)
  let eocd = -1;
  const stop = Math.max(0, buf.length - 22 - 65536);
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("EOCD not found — not a zip file?");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // central directory offset
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory entry");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === entryName) {
      const lnameLen = buf.readUInt16LE(lho + 26);
      const lextraLen = buf.readUInt16LE(lho + 28);
      const dataStart = lho + 30 + lnameLen + lextraLen;
      const comp = buf.subarray(dataStart, dataStart + csize);
      return method === 0 ? Buffer.from(comp) : inflateRawSync(comp);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`${entryName} not found in ${path}`);
}

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const unescapeXml = (s) => s.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m]);

// Extract one sheet's rows as string[][] (numeric cells via office:value)
export function sheetRows(contentXml, sheetName) {
  const start = contentXml.indexOf(`table:table table:name="${sheetName}"`);
  if (start < 0) throw new Error(`sheet not found: ${sheetName}`);
  let end = contentXml.indexOf("<table:table ", start + 10);
  if (end < 0) end = contentXml.length;
  const section = contentXml.slice(start, end);

  const rows = [];
  for (const rowMatch of section.matchAll(/<table:table-row[\s\S]*?<\/table:table-row>/g)) {
    const cells = [];
    for (const cellMatch of rowMatch[0].matchAll(
      /<table:table-cell[^>]*\/>|<table:table-cell[^>]*>[\s\S]*?<\/table:table-cell>/g
    )) {
      const xml = cellMatch[0];
      const rep = /number-columns-repeated="(\d+)"/.exec(xml);
      const n = rep ? Number(rep[1]) : 1;
      if (n > 50) break; // trailing filler cells
      const valAttr = /office:value="([^"]+)"/.exec(xml);
      let val;
      if (valAttr) {
        val = valAttr[1];
      } else {
        const ps = [...xml.matchAll(/<text:p[^>]*>([\s\S]*?)<\/text:p>/g)].map((m) => m[1]);
        val = unescapeXml(ps.join(" ").replace(/<[^>]+>/g, ""));
      }
      for (let i = 0; i < n; i++) cells.push(val);
    }
    rows.push(cells);
  }
  return rows;
}
