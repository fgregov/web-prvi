// The parts of a TrueType font a PDF needs: metrics, glyph widths and the
// Unicode → glyph map. Used to embed Liberation Sans (SIL Open Font License,
// shipped with pdf.js) so every reader shows č, ć, đ, š, ž the same way.
// Reads the font only; the font file is embedded whole.

export interface TrueTypeFont {
  readonly bytes: Uint8Array;
  readonly postScriptName: string;
  readonly unitsPerEm: number;
  /** In 1000-unit text space. */
  readonly ascent: number;
  readonly descent: number;
  readonly capHeight: number;
  readonly bbox: readonly [number, number, number, number];
  readonly italicAngle: number;
  readonly bold: boolean;
  readonly numGlyphs: number;
  /** Glyph id of a Unicode code point, 0 (.notdef) when the font has none. */
  glyph(codePoint: number): number;
  /** Advance width of a glyph in 1000-unit text space. */
  advance(glyphId: number): number;
}

export class FontError extends Error {}

export function parseTrueType(bytes: Uint8Array): TrueTypeFont {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (at: number) => view.getUint16(at);
  const i16 = (at: number) => view.getInt16(at);
  const u32 = (at: number) => view.getUint32(at);

  const version = u32(0);
  if (version !== 0x00010000 && version !== 0x74727565) {
    throw new FontError('Not a TrueType font');
  }
  const tables = new Map<string, { offset: number; length: number }>();
  const count = u16(4);
  for (let i = 0; i < count; i += 1) {
    const at = 12 + i * 16;
    const tag = String.fromCharCode(bytes[at]!, bytes[at + 1]!, bytes[at + 2]!, bytes[at + 3]!);
    tables.set(tag, { offset: u32(at + 8), length: u32(at + 12) });
  }
  const table = (tag: string) => {
    const t = tables.get(tag);
    if (!t) throw new FontError(`Font table ${tag} missing`);
    return t.offset;
  };

  const head = table('head');
  const unitsPerEm = u16(head + 18);
  const scale = (v: number) => Math.round((v * 1000) / unitsPerEm);
  const bbox = [i16(head + 36), i16(head + 38), i16(head + 40), i16(head + 42)].map(scale) as [
    number,
    number,
    number,
    number,
  ];
  const macStyle = u16(head + 44);

  const hhea = table('hhea');
  const numberOfHMetrics = u16(hhea + 34);
  const numGlyphs = u16(table('maxp') + 4);
  const hmtx = table('hmtx');
  const advances = new Uint16Array(numGlyphs);
  let last = 0;
  for (let g = 0; g < numGlyphs; g += 1) {
    if (g < numberOfHMetrics) last = u16(hmtx + g * 4);
    advances[g] = last;
  }

  let ascent = scale(i16(hhea + 4));
  let descent = scale(i16(hhea + 6));
  let capHeight = Math.round(ascent * 0.7);
  let weight = 400;
  if (tables.has('OS/2')) {
    const os2 = table('OS/2');
    const os2Version = u16(os2);
    weight = u16(os2 + 4);
    ascent = scale(i16(os2 + 68));
    descent = scale(i16(os2 + 70));
    if (os2Version >= 2) capHeight = scale(i16(os2 + 88));
  }
  let italicAngle = 0;
  if (tables.has('post')) {
    const post = table('post');
    italicAngle = view.getInt16(post + 4) + u16(post + 6) / 65536;
  }

  // ------------------------------------------------------------- cmap ---
  const cmap = table('cmap');
  const subtables: Array<{ platform: number; encoding: number; offset: number }> = [];
  for (let i = 0; i < u16(cmap + 2); i += 1) {
    const at = cmap + 4 + i * 8;
    subtables.push({ platform: u16(at), encoding: u16(at + 2), offset: cmap + u32(at + 4) });
  }
  const pick = (platform: number, encoding: number, format: number) =>
    subtables.find(
      (s) => s.platform === platform && s.encoding === encoding && u16(s.offset) === format,
    );
  const map = new Map<number, number>();
  const format12 = pick(3, 10, 12) ?? pick(0, 4, 12);
  const format4 = pick(3, 1, 4) ?? pick(0, 3, 4);
  if (format12) {
    const at = format12.offset;
    const groups = u32(at + 12);
    for (let i = 0; i < groups; i += 1) {
      const g = at + 16 + i * 12;
      const start = u32(g);
      const end = u32(g + 4);
      const startGlyph = u32(g + 8);
      for (let c = start; c <= end && c - start < 0x10000; c += 1) {
        map.set(c, startGlyph + (c - start));
      }
    }
  } else if (format4) {
    const at = format4.offset;
    const segCount = u16(at + 6) / 2;
    const ends = at + 14;
    const starts = ends + segCount * 2 + 2;
    const deltas = starts + segCount * 2;
    const rangeOffsets = deltas + segCount * 2;
    for (let s = 0; s < segCount; s += 1) {
      const end = u16(ends + s * 2);
      const start = u16(starts + s * 2);
      const delta = i16(deltas + s * 2);
      const rangeOffsetAt = rangeOffsets + s * 2;
      const rangeOffset = u16(rangeOffsetAt);
      for (let c = start; c <= end && c !== 0xffff; c += 1) {
        let gid: number;
        if (rangeOffset === 0) gid = (c + delta) & 0xffff;
        else {
          const glyphAt = rangeOffsetAt + rangeOffset + (c - start) * 2;
          gid = u16(glyphAt);
          if (gid !== 0) gid = (gid + delta) & 0xffff;
        }
        if (gid !== 0) map.set(c, gid);
      }
    }
  } else {
    throw new FontError('Font has no Unicode cmap');
  }

  let postScriptName = '';
  if (tables.has('name')) {
    const name = table('name');
    const records = u16(name + 2);
    const strings = name + u16(name + 4);
    for (let i = 0; i < records && !postScriptName; i += 1) {
      const at = name + 6 + i * 12;
      if (u16(at + 6) !== 6) continue;
      const platform = u16(at);
      const length = u16(at + 8);
      const offset = strings + u16(at + 10);
      if (platform === 1) {
        postScriptName = String.fromCharCode(...bytes.subarray(offset, offset + length));
      } else if (platform === 3) {
        for (let k = 0; k < length; k += 2) postScriptName += String.fromCharCode(u16(offset + k));
      }
    }
  }
  postScriptName = postScriptName.replace(/[^A-Za-z0-9-]/g, '') || 'EmbeddedFont';

  return {
    bytes,
    postScriptName,
    unitsPerEm,
    ascent,
    descent,
    capHeight,
    bbox,
    italicAngle,
    bold: weight >= 600 || (macStyle & 1) === 1,
    numGlyphs,
    glyph: (codePoint) => map.get(codePoint) ?? 0,
    advance: (glyphId) => scale(advances[glyphId] ?? advances[0] ?? 0),
  };
}
