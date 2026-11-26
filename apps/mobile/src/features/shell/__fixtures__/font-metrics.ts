/// <reference types="node" />
// Test helper: measures text with the real glyph advances from a bundled TTF,
// so "does this label fit?" is computed, not guessed. Reads only the tables it
// needs (head, hhea, hmtx, cmap format 4). No kerning: Roboto's kerning only
// ever tightens these pairs, so the result is a safe upper bound.

import { readFileSync } from "fs";
import { join } from "path";

type Font = { unitsPerEm: number; advance: (codePoint: number) => number };

function parse(buf: Buffer): Font {
  const numTables = buf.readUInt16BE(4);
  const tables: Record<string, number> = {};
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    tables[buf.toString("ascii", rec, rec + 4)] = buf.readUInt32BE(rec + 8);
  }
  const unitsPerEm = buf.readUInt16BE(tables.head + 18);
  const numHMetrics = buf.readUInt16BE(tables.hhea + 34);
  const advanceOf = (glyph: number) => buf.readUInt16BE(tables.hmtx + 4 * Math.min(glyph, numHMetrics - 1));

  // cmap: find the Windows Unicode BMP subtable (3,1), format 4.
  const cmap = tables.cmap;
  const n = buf.readUInt16BE(cmap + 2);
  let sub = -1;
  for (let i = 0; i < n; i++) {
    const rec = cmap + 4 + i * 8;
    if (buf.readUInt16BE(rec) === 3 && buf.readUInt16BE(rec + 2) === 1) sub = cmap + buf.readUInt32BE(rec + 4);
  }
  if (sub < 0 || buf.readUInt16BE(sub) !== 4) throw new Error("no cmap format 4 subtable");
  const segX2 = buf.readUInt16BE(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const ranges = deltas + segX2;
  const glyphFor = (cp: number) => {
    for (let s = 0; s < segX2; s += 2) {
      const end = buf.readUInt16BE(ends + s);
      if (cp > end) continue;
      const start = buf.readUInt16BE(starts + s);
      if (cp < start) return 0;
      const delta = buf.readInt16BE(deltas + s);
      const rangeOffset = buf.readUInt16BE(ranges + s);
      if (rangeOffset === 0) return (cp + delta) & 0xffff;
      const g = buf.readUInt16BE(ranges + s + rangeOffset + 2 * (cp - start));
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  };
  return { unitsPerEm, advance: (cp) => advanceOf(glyphFor(cp)) };
}

const cache = new Map<string, Font>();

/** Width in points of `text` set in a bundled @expo-google-fonts face at `size`. */
export function textWidth(text: string, size: number, face: { pkg: string; file: string }): number {
  const key = `${face.pkg}/${face.file}`;
  let font = cache.get(key);
  if (!font) {
    const dir = join(__dirname, "../../../../node_modules/@expo-google-fonts", face.pkg, face.file.replace(/^[^_]+_/, "").replace(/\.ttf$/, ""));
    font = parse(readFileSync(join(dir, face.file)));
    cache.set(key, font);
  }
  let units = 0;
  for (const ch of text) units += font.advance(ch.codePointAt(0)!);
  return (units / font.unitsPerEm) * size;
}

export const ROBOTO_EXTRABOLD = { pkg: "roboto", file: "Roboto_800ExtraBold.ttf" };
export const ROBOTO_MEDIUM = { pkg: "roboto", file: "Roboto_500Medium.ttf" };
