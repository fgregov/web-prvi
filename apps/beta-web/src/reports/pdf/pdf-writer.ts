// A small PDF 1.7 writer for the reports: A4 pages, embedded TrueType text
// (Type0 / Identity-H with a ToUnicode map, so the text can be searched and
// copied), filled and stroked shapes, and one PNG image (the logo). Runs on
// the server and, unchanged, in the in-browser demo: compression comes from
// the caller (node:zlib or the browser's CompressionStream).
//
// Coordinates: points (1/72 in), origin at the TOP-left of the page, y down.
import type { TrueTypeFont } from './truetype.ts';

export const A4 = { width: 595.28, height: 841.89 } as const;

export interface Zlib {
  /** zlib (RFC 1950) compression, as PDF FlateDecode expects. */
  deflate(bytes: Uint8Array): Promise<Uint8Array> | Uint8Array;
  inflate(bytes: Uint8Array): Promise<Uint8Array> | Uint8Array;
}

export type FontName = 'regular' | 'bold';
export type Rgb = readonly [number, number, number];

/** "#e32222" → [0.89, 0.13, 0.13] */
export const rgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const num = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};
const color = (c: Rgb) => c.map((v) => num(Math.round(v * 1000) / 1000)).join(' ');

/** PDF text string (literal), for the document information. */
function pdfString(value: string): string {
  // UTF-16BE with BOM, hex: any character, no escaping problems.
  let hex = 'FEFF';
  for (const ch of value) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      hex += (0xd800 + (v >> 10)).toString(16).padStart(4, '0');
      hex += (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0');
    } else hex += cp.toString(16).padStart(4, '0');
  }
  return `<${hex.toUpperCase()}>`;
}

const encoder = new TextEncoder();

class EmbeddedFont {
  /** glyph id → the text it stands for (ToUnicode). */
  readonly used = new Map<number, string>();
  readonly font: TrueTypeFont;
  readonly resource: string;
  constructor(font: TrueTypeFont, resource: string) {
    this.font = font;
    this.resource = resource;
  }

  /** Glyph ids of a string; a character the font lacks becomes its base letter, else "?". */
  encode(text: string): number[] {
    const out: number[] = [];
    for (const ch of text) {
      let gid = this.font.glyph(ch.codePointAt(0)!);
      let shown = ch;
      if (gid === 0) {
        const base = ch.normalize('NFD').replace(/\p{Diacritic}/gu, '');
        const fallback = base && base !== ch ? this.font.glyph(base.codePointAt(0)!) : 0;
        if (fallback) {
          gid = fallback;
          shown = base;
        } else {
          gid = this.font.glyph(0x3f);
          shown = '?';
        }
      }
      if (!this.used.has(gid)) this.used.set(gid, shown);
      out.push(gid);
    }
    return out;
  }

  width(text: string, size: number): number {
    let w = 0;
    for (const gid of this.encode(text)) w += this.font.advance(gid);
    return (w * size) / 1000;
  }
}

export interface TextOptions {
  readonly font?: FontName;
  readonly size?: number;
  readonly color?: Rgb;
  /** x is the left edge (default), the right edge or the centre. */
  readonly align?: 'left' | 'right' | 'center';
}

export class PdfPage {
  readonly ops: string[] = [];
  private readonly doc: PdfWriter;
  constructor(doc: PdfWriter) {
    this.doc = doc;
  }

  private y(top: number) {
    return A4.height - top;
  }

  /** Text with its baseline at `y`. */
  text(x: number, y: number, value: string, options: TextOptions = {}): void {
    if (!value) return;
    const font = this.doc.font(options.font ?? 'regular');
    const size = options.size ?? 10;
    const width = font.width(value, size);
    const left =
      options.align === 'right' ? x - width : options.align === 'center' ? x - width / 2 : x;
    const glyphs = font
      .encode(value)
      .map((g) => g.toString(16).padStart(4, '0'))
      .join('');
    this.ops.push(
      `BT ${color(options.color ?? [0, 0, 0])} rg /${font.resource} ${num(size)} Tf 1 0 0 1 ${num(left)} ${num(this.y(y))} Tm <${glyphs}> Tj ET`,
    );
  }

  rect(
    x: number,
    y: number,
    w: number,
    h: number,
    style: { fill?: Rgb; stroke?: Rgb; lineWidth?: number },
  ): void {
    const parts: string[] = [];
    if (style.fill) parts.push(`${color(style.fill)} rg`);
    if (style.stroke) parts.push(`${color(style.stroke)} RG ${num(style.lineWidth ?? 0.5)} w`);
    parts.push(`${num(x)} ${num(this.y(y + h))} ${num(w)} ${num(h)} re`);
    parts.push(style.fill && style.stroke ? 'B' : style.fill ? 'f' : 'S');
    this.ops.push(parts.join(' '));
  }

  line(x1: number, y1: number, x2: number, y2: number, stroke: Rgb, width = 0.5): void {
    this.ops.push(
      `${color(stroke)} RG ${num(width)} w ${num(x1)} ${num(this.y(y1))} m ${num(x2)} ${num(this.y(y2))} l S`,
    );
  }

  /** The document's image `name`, drawn with its top-left corner at (x, y). */
  image(name: string, x: number, y: number, w: number, h: number): void {
    this.doc.useImage(name);
    this.ops.push(`q ${num(w)} 0 0 ${num(h)} ${num(x)} ${num(this.y(y + h))} cm /${name} Do Q`);
  }
}

interface ImageData {
  readonly width: number;
  readonly height: number;
  /** RGB samples, 8 bits each. */
  readonly rgb: Uint8Array;
  /** Alpha samples (soft mask), or null when opaque. */
  readonly alpha: Uint8Array | null;
}

export interface DocumentInfo {
  readonly title: string;
  readonly subject?: string;
  readonly author?: string;
  readonly creator?: string;
  readonly createdAt: Date;
}

export class PdfWriter {
  readonly pages: PdfPage[] = [];
  private readonly fonts: Record<FontName, EmbeddedFont>;
  private readonly images = new Map<string, ImageData>();
  private readonly usedImages = new Set<string>();
  private readonly zlib: Zlib;
  private readonly info: DocumentInfo;

  constructor(fonts: Record<FontName, TrueTypeFont>, zlib: Zlib, info: DocumentInfo) {
    this.zlib = zlib;
    this.info = info;
    this.fonts = {
      regular: new EmbeddedFont(fonts.regular, 'F1'),
      bold: new EmbeddedFont(fonts.bold, 'F2'),
    };
  }

  font(name: FontName): EmbeddedFont {
    return this.fonts[name];
  }

  widthOf(text: string, size: number, font: FontName = 'regular'): number {
    return this.fonts[font].width(text, size);
  }

  addPage(): PdfPage {
    const page = new PdfPage(this);
    this.pages.push(page);
    return page;
  }

  addImage(name: string, image: ImageData): void {
    this.images.set(name, image);
  }

  useImage(name: string): void {
    if (!this.images.has(name)) throw new Error(`Unknown image ${name}`);
    this.usedImages.add(name);
  }

  async bytes(): Promise<Uint8Array> {
    const objects: Array<Uint8Array | string> = [];
    const reserve = () => {
      objects.push('');
      return objects.length; // object number
    };
    const set = (n: number, body: Uint8Array | string) => {
      objects[n - 1] = body;
    };
    const stream = async (dict: string, data: Uint8Array, compress = true) => {
      const body = compress ? await this.zlib.deflate(data) : data;
      const head = encoder.encode(
        `<< ${dict}${compress ? ' /Filter /FlateDecode' : ''} /Length ${body.length} >>\nstream\n`,
      );
      return concat([head, body, encoder.encode('\nendstream')]);
    };

    const catalog = reserve();
    const pagesRoot = reserve();
    const infoRef = reserve();

    // Fonts (only what the pages used).
    const fontRefs: Record<string, number> = {};
    for (const embedded of Object.values(this.fonts)) {
      if (embedded.used.size === 0) continue;
      const f = embedded.font;
      const file = reserve();
      set(file, await stream(`/Length1 ${f.bytes.length}`, f.bytes));
      const descriptor = reserve();
      set(
        descriptor,
        `<< /Type /FontDescriptor /FontName /${f.postScriptName} /Flags ${f.italicAngle ? 96 : 32} /FontBBox [${f.bbox.join(' ')}] /ItalicAngle ${num(f.italicAngle)} /Ascent ${f.ascent} /Descent ${f.descent} /CapHeight ${f.capHeight} /StemV ${f.bold ? 140 : 80} /FontFile2 ${file} 0 R >>`,
      );
      const gids = [...embedded.used.keys()].sort((a, b) => a - b);
      const widths = gids.map((g) => `${g} [${f.advance(g)}]`).join(' ');
      const cid = reserve();
      set(
        cid,
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${f.postScriptName} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW ${f.advance(0)} /W [${widths}] /CIDToGIDMap /Identity >>`,
      );
      const toUnicode = reserve();
      set(toUnicode, await stream('', encoder.encode(toUnicodeCMap(embedded.used))));
      const type0 = reserve();
      set(
        type0,
        `<< /Type /Font /Subtype /Type0 /BaseFont /${f.postScriptName} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUnicode} 0 R >>`,
      );
      fontRefs[embedded.resource] = type0;
    }

    // Images
    const imageRefs: Record<string, number> = {};
    for (const name of this.usedImages) {
      const img = this.images.get(name)!;
      let mask = '';
      if (img.alpha) {
        const smask = reserve();
        set(
          smask,
          await stream(
            `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceGray /BitsPerComponent 8`,
            img.alpha,
          ),
        );
        mask = ` /SMask ${smask} 0 R`;
      }
      const ref = reserve();
      set(
        ref,
        await stream(
          `/Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8${mask}`,
          img.rgb,
        ),
      );
      imageRefs[name] = ref;
    }

    const fontDict = Object.entries(fontRefs)
      .map(([name, ref]) => `/${name} ${ref} 0 R`)
      .join(' ');
    const xobjects = Object.entries(imageRefs)
      .map(([name, ref]) => `/${name} ${ref} 0 R`)
      .join(' ');
    const resources = `<< /ProcSet [/PDF /Text /ImageC] /Font << ${fontDict} >>${xobjects ? ` /XObject << ${xobjects} >>` : ''} >>`;

    const pageRefs: number[] = [];
    for (const page of this.pages) {
      const content = reserve();
      set(content, await stream('', encoder.encode(page.ops.join('\n'))));
      const ref = reserve();
      set(
        ref,
        `<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources ${resources} /Contents ${content} 0 R >>`,
      );
      pageRefs.push(ref);
    }
    set(
      pagesRoot,
      `<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(' ')}] /Count ${pageRefs.length} >>`,
    );
    set(
      catalog,
      `<< /Type /Catalog /Pages ${pagesRoot} 0 R /Lang (hr-HR) /ViewerPreferences << /DisplayDocTitle true >> >>`,
    );
    const d = this.info.createdAt;
    const p2 = (n: number) => String(n).padStart(2, '0');
    const date = `D:${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}${p2(d.getUTCSeconds())}Z`;
    set(
      infoRef,
      `<< /Title ${pdfString(this.info.title)}${this.info.subject ? ` /Subject ${pdfString(this.info.subject)}` : ''}${this.info.author ? ` /Author ${pdfString(this.info.author)}` : ''} /Creator ${pdfString(this.info.creator ?? 'RENVARA CRM')} /Producer ${pdfString('RENVARA CRM')} /CreationDate (${date}) /ModDate (${date}) >>`,
    );

    // Assemble with the cross-reference table.
    // Header with a binary comment (real bytes ≥ 128: the file is binary).
    const header = concat([
      encoder.encode('%PDF-1.7\n%'),
      new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]),
      encoder.encode('\n'),
    ]);
    const parts: Uint8Array[] = [header];
    let offset = header.length;
    const offsets: number[] = [];
    for (let i = 0; i < objects.length; i += 1) {
      const body = objects[i]!;
      const chunk = concat([
        encoder.encode(`${i + 1} 0 obj\n`),
        typeof body === 'string' ? encoder.encode(body) : body,
        encoder.encode('\nendobj\n'),
      ]);
      offsets.push(offset);
      offset += chunk.length;
      parts.push(chunk);
    }
    const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`];
    for (const o of offsets) xref.push(`${String(o).padStart(10, '0')} 00000 n \n`);
    xref.push(
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${infoRef} 0 R >>\nstartxref\n${offset}\n%%EOF\n`,
    );
    parts.push(encoder.encode(xref.join('')));
    return concat(parts);
  }
}

function toUnicodeCMap(used: ReadonlyMap<number, string>): string {
  const entries = [...used.entries()].sort((a, b) => a[0] - b[0]);
  const blocks: string[] = [];
  for (let i = 0; i < entries.length; i += 100) {
    const chunk = entries.slice(i, i + 100);
    blocks.push(`${chunk.length} beginbfchar`);
    for (const [gid, text] of chunk) {
      let hex = '';
      for (let k = 0; k < text.length; k += 1) {
        hex += text.charCodeAt(k).toString(16).padStart(4, '0');
      }
      blocks.push(`<${gid.toString(16).padStart(4, '0')}> <${hex}>`);
    }
    blocks.push('endbfchar');
  }
  return [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    ...blocks,
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n');
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const p of parts) length += p.length;
  const out = new Uint8Array(length);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Decodes an 8-bit, non-interlaced PNG (RGB or RGBA) into RGB samples and an
 * alpha mask — enough for the Renvara logo.
 */
export async function decodePng(bytes: Uint8Array, zlib: Zlib): Promise<ImageData> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((b, i) => bytes[i] === b)) throw new Error('Not a PNG');
  let at = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  while (at < bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      const depth = data[8];
      colorType = data[9]!;
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || data[12] !== 0) {
        throw new Error('Unsupported PNG');
      }
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  const raw = await zlib.inflate(concat(idat));
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? out[x - channels]! : 0;
      const b = prev ? prev[x]! : 0;
      const c = prev && x >= channels ? prev[x - channels]! : 0;
      let v = line[x]!;
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = v & 255;
    }
  }
  const rgbSamples = new Uint8Array(width * height * 3);
  const alpha = channels === 4 ? new Uint8Array(width * height) : null;
  for (let i = 0; i < width * height; i += 1) {
    rgbSamples[i * 3] = pixels[i * channels]!;
    rgbSamples[i * 3 + 1] = pixels[i * channels + 1]!;
    rgbSamples[i * 3 + 2] = pixels[i * channels + 2]!;
    if (alpha) alpha[i] = pixels[i * channels + 3]!;
  }
  return { width, height, rgb: rgbSamples, alpha };
}
