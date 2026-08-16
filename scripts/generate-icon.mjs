/**
 * dsh-desktop-shell — generate assets/icon-black.ico from the OFFICIAL DSH
 * favicon (assets/favicon-source.svg).
 *
 * v0.1.2: single output — the real black DSH app icon. (v0.1.1 also generated
 * a transparent `icon-window.ico` used to hide the native title-bar icon; that
 * workaround was removed in 0.1.2 because it broke the taskbar/Alt+Tab icon —
 * the title bar is now hidden with Electron's `titleBarStyle: hidden` +
 * `titleBarOverlay`, which needs no icon tricks.)
 *
 * Multi-size, cache-safe: produces a NEW stable resource name
 * (assets/icon-black.ico) so the desktop shortcut's IconLocation changes and
 * Windows does not keep serving the old cached icon. Contains the common
 * Windows sizes:
 *
 *   16, 24, 32, 48, 64, 128, 256
 *
 * Every size keeps the DSH BLACK-STYLE MARK: the raw favicon symbol on a fully
 * TRANSPARENT background — no square, no colored tile, no app-badge card.
 *
 * Self-contained: the SVG path is rasterized IN PROCESS (bezier flattening +
 * nonzero-winding scanline fill with supersampled antialiasing). No browser,
 * no external renderer, no runtime dependencies — the script works in any Node
 * environment. ICO layout: small sizes (<256) are classic uncompressed 32-bit
 * BMP (BGRA) entries for maximum shell compatibility; 256 is a PNG entry
 * (Vista+ PNG-in-ICO).
 *
 * This is a DEV-TIME tool only. The produced ICO is the runtime artifact;
 * nothing at launch time runs this script.
 *
 * Usage: node scripts/generate-icon.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync, inflateSync } from "node:zlib";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SVG = join(ROOT, "assets", "favicon-source.svg");
const OUT = join(ROOT, "assets", "icon-black.ico");
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const VIEWBOX = 50;            // favicon-source.svg viewBox = 0 0 50 50
const SUPERSAMPLE = 3;         // render at size*SS, box-downsample for AA

// ---------------------------------------------------------------------------
// SVG path parsing + bezier flattening
// ---------------------------------------------------------------------------

/** Parse an SVG path `d` string into absolute command tuples. */
export function parsePath(d) {
  const re = /([MmLlCcZz])|(-?\d*\.?\d+(?:[eE][+-]?\d+)?)/g;
  const tokens = [];
  let m;
  while ((m = re.exec(d)) !== null) {
    if (m[1] !== undefined) tokens.push({ cmd: m[1] });
    else tokens.push({ num: parseFloat(m[0]) });
  }
  const out = [];
  let i = 0;
  let cur = { x: 0, y: 0 };
  let lastCmd = null;
  let prevCtrl = null;
  let start = { x: 0, y: 0 };
  while (i < tokens.length) {
    let cmd = tokens[i].cmd;
    if (cmd === undefined) {
      // implicit repeat of the previous command
      if (lastCmd === "M") cmd = "L";
      else cmd = lastCmd;
    } else {
      i++;
    }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    const readNum = () => {
      const t = tokens[i++];
      if (t === undefined || t.num === undefined) throw new Error("unexpected end of path");
      return t.num;
    };
    const pt = (rx, ry) => {
      let x = rx, y = ry;
      if (rel) { x += cur.x; y += cur.y; }
      return { x, y };
    };
    switch (C) {
      case "M": {
        const p = pt(readNum(), readNum());
        out.push({ cmd: "M", x: p.x, y: p.y });
        cur = p; start = p; prevCtrl = null; lastCmd = "M";
        break;
      }
      case "L": {
        const p = pt(readNum(), readNum());
        out.push({ cmd: "L", x: p.x, y: p.y });
        cur = p; prevCtrl = null; lastCmd = "L";
        break;
      }
      case "C": {
        const c1 = pt(readNum(), readNum());
        const c2 = pt(readNum(), readNum());
        const p = pt(readNum(), readNum());
        out.push({ cmd: "C", c1, c2, x: p.x, y: p.y });
        prevCtrl = c2; cur = p; lastCmd = "C";
        break;
      }
      case "Z": {
        out.push({ cmd: "Z" });
        cur = start; prevCtrl = null; lastCmd = "Z";
        break;
      }
      default:
        throw new Error(`unsupported SVG path command: ${C}`);
    }
  }
  return out;
}

/** Cubic bezier point at t. */
function bezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y
  };
}

/** Flatten a cubic bezier into line segments (adaptive subdivision). */
function flattenCubic(p0, p1, p2, p3, tol, pts) {
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const d2 = Math.hypot(p2.x - p3.x, p2.y - p3.y);
  if (d1 + d2 <= chord + tol * 2) {
    pts.push(p3);
    return;
  }
  const mid01 = bezier(p0, p1, p2, p3, 0.5);
  const a = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const b = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  const c = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 };
  const ab = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const bc = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  const abc = { x: (ab.x + bc.x) / 2, y: (ab.y + bc.y) / 2 };
  flattenCubic(p0, a, ab, abc, tol, pts);
  flattenCubic(abc, bc, c, p3, tol, pts);
}

/** Flatten a parsed path into an array of closed polygons (device coords). */
export function flattenPath(parsed, scale) {
  const polys = [];
  let curPoly = [];
  let cur = null;
  let start = null;
  const emit = (p) => {
    curPoly.push({ x: p.x * scale, y: p.y * scale });
    cur = p;
  };
  for (const seg of parsed) {
    if (seg.cmd === "M") {
      if (curPoly.length > 0) polys.push(curPoly);
      curPoly = [];
      start = { x: seg.x, y: seg.y };
      emit(start);
    } else if (seg.cmd === "L") {
      emit({ x: seg.x, y: seg.y });
    } else if (seg.cmd === "C") {
      const pts = [];
      flattenCubic(cur, seg.c1, seg.c2, { x: seg.x, y: seg.y }, 0.5 / scale, pts);
      for (const p of pts) emit(p);
    } else if (seg.cmd === "Z") {
      cur = start;
    }
  }
  if (curPoly.length > 0) polys.push(curPoly);
  return polys;
}

// ---------------------------------------------------------------------------
// Scanline rasterization (even-odd), supersampled
// ---------------------------------------------------------------------------

/** Rasterize polygons into an {width, height, rgba} black-on-transparent image. */
export function rasterize(polys, size) {
  const renderSize = size * SUPERSAMPLE;
  const scale = renderSize / VIEWBOX;
  const scaled = flattenPath(polys, scale);
  const buf = Buffer.alloc(renderSize * renderSize); // coverage 0..255 per pixel
  const yMax = renderSize - 1;

  // Build ALL directional edges first: winding must accumulate across
  // subpaths (a nested subpath with opposite direction carves a hole).
  const allEdges = [];
  for (const poly of scaled) {
    if (poly.length < 3) continue;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (a.y === b.y) continue; // horizontal edges contribute nothing
      allEdges.push({
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        yLo: Math.min(a.y, b.y),
        yHi: Math.max(a.y, b.y),
        slope: (b.x - a.x) / (b.y - a.y),
        dir: a.y < b.y ? 1 : -1   // +1 crossing upward, -1 downward
      });
    }
  }
  for (let y = 0; y < renderSize; y++) {
    const fy = y + 0.5;
    const hits = [];
    for (const e of allEdges) {
      // standard half-open rule: count crossing at fy
      if (fy >= e.yLo && fy < e.yHi) {
        hits.push({ x: e.x1 + (fy - e.y1) * e.slope, d: e.dir });
      }
    }
    hits.sort((a, b) => a.x - b.x);
    // nonzero winding: fill while the accumulated winding is non-zero
    let w = 0;
    for (let k = 0; k < hits.length; k++) {
      if (w !== 0 && k > 0) {
        const x0 = Math.max(0, Math.ceil(hits[k - 1].x));
        const x1 = Math.min(renderSize, Math.ceil(hits[k].x));
        const rowOff = y * renderSize;
        for (let x = x0; x < x1; x++) {
          const c = buf[rowOff + x];
          buf[rowOff + x] = c >= 255 ? 255 : c + 1; // accumulate coverage
        }
      }
      w += hits[k].d;
    }
  }

  // box-downsample to `size` and build RGBA (straight alpha)
  const rgba = Buffer.alloc(size * size * 4);
  const f = SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sum = 0;
      for (let dy = 0; dy < f; dy++) {
        const rowOff = (y * f + dy) * renderSize;
        for (let dx = 0; dx < f; dx++) {
          sum += buf[rowOff + x * f + dx];
        }
      }
      const alpha = Math.round((sum * 255) / (f * f));
      const off = (y * size + x) * 4;
      rgba[off] = 0; rgba[off + 1] = 0; rgba[off + 2] = 0; rgba[off + 3] = alpha;
    }
  }
  return { width: size, height: size, rgba };
}

// ---------------------------------------------------------------------------
// PNG encode / decode (8-bit RGBA)
// ---------------------------------------------------------------------------

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

/** Encode 8-bit RGBA into a PNG buffer. */
export function encodePngRgba(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

/** Decode an 8-bit RGBA PNG buffer into { width, height, rgba } (top-down). */
export function decodePngRgba(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`expected 8-bit RGBA PNG, got depth=${bitDepth} colorType=${colorType}`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rgba = Buffer.alloc(width * height * 4);
  let src = 0;
  let prev = null;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = Buffer.from(raw.subarray(src, src + stride));
    src += stride;
    // unfilter (filters 0..4)
    for (let i = 0; i < row.length; i++) {
      const a = i >= 4 ? row[i - 4] : 0;
      const b = prev !== null ? prev[i] : 0;
      const c = i >= 4 && prev !== null ? prev[i - 4] : 0;
      switch (filter) {
        case 0: break;
        case 1: row[i] = (row[i] + a) & 0xff; break;
        case 2: row[i] = (row[i] + b) & 0xff; break;
        case 3: row[i] = (row[i] + ((a + b) >> 1)) & 0xff; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          row[i] = (row[i] + pr) & 0xff;
          break;
        }
      }
    }
    row.copy(rgba, y * stride);
    prev = row;
  }
  return { width, height, rgba };
}

// ---------------------------------------------------------------------------
// ICO packing (classic BMP entries for <256, PNG entry for 256)
// ---------------------------------------------------------------------------

/** Build a classic 32-bit BMP DIB (BITMAPINFOHEADER + bottom-up BGRA + AND mask). */
function bmpDib(size, rgbaTopDown) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);          // biSize
  header.writeInt32LE(size, 4);         // biWidth
  header.writeInt32LE(size * 2, 8);     // biHeight (XOR + AND)
  header.writeUInt16LE(1, 12);          // biPlanes
  header.writeUInt16LE(32, 14);         // biBitCount
  header.writeUInt32LE(0, 16);          // biCompression = BI_RGB
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const srcRow = y * size * 4;
    const dstRow = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x++) {
      // RGBA -> BGRA (bottom-up)
      xor[dstRow + x * 4 + 0] = rgbaTopDown[srcRow + x * 4 + 2];
      xor[dstRow + x * 4 + 1] = rgbaTopDown[srcRow + x * 4 + 1];
      xor[dstRow + x * 4 + 2] = rgbaTopDown[srcRow + x * 4 + 0];
      xor[dstRow + x * 4 + 3] = rgbaTopDown[srcRow + x * 4 + 3];
    }
  }
  const andStride = ((size + 31) >> 5) * 4;
  const andMask = Buffer.alloc(andStride * size, 0);
  return Buffer.concat([header, xor, andMask]);
}

/** Pack rendered RGBA images into a multi-size ICO. */
function packIco(sizes, images) {
  const count = sizes.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const entries = [];
  const blocks = [];
  let offset = 6 + 16 * count;
  for (let i = 0; i < count; i++) {
    const size = sizes[i];
    const entry = Buffer.alloc(16);
    entry[0] = size === 256 ? 0 : size;
    entry[1] = size === 256 ? 0 : size;
    entry[2] = 0;
    entry[3] = 0;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    const block = size === 256
      ? encodePngRgba(size, images[i].rgba)
      : bmpDib(size, images[i].rgba);
    entry.writeUInt32LE(block.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    blocks.push(block);
    offset += block.length;
  }
  return Buffer.concat([header, ...entries, ...blocks]);
}

// ---------------------------------------------------------------------------
// CLI entry (guarded: importing this module for tests must not regenerate)
// ---------------------------------------------------------------------------

import { pathToFileURL } from "node:url";

const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;

export function main() {
  const svg = readFileSync(SVG, "utf8");
  const dMatch = svg.match(/\sd="([^"]+)"/);
  if (!dMatch) throw new Error("favicon-source.svg: no path d attribute found");
  const parsed = parsePath(dMatch[1]);

  const images = [];
  for (const size of SIZES) {
    const img = rasterize(parsed, size);
    images.push(img);
    console.log(`  rasterized ${size}x${size} (black glyph, transparent bg)`);
  }

  writeFileSync(OUT, packIco(SIZES, images));
  console.log(`dsh-desktop-shell: wrote ${OUT} (${SIZES.length} sizes: ${SIZES.join(",")}), DSH black-style mark, transparent background`);
}

if (isMain) main();
