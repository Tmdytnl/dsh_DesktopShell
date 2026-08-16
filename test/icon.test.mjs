/**
 * dsh-desktop-shell — icon asset regression tests (v0.1.3).
 * Run: node test/icon.test.mjs
 *
 * Guards the 0.1.2 icon architecture:
 *   - assets/icon-black.ico is the single real DSH app icon: multi-size
 *     (16/24/32/48/64/128/256), black DSH mark on transparent background,
 *     no blue / no white / no square badge — used by the desktop shortcut,
 *     the BrowserWindow, the Windows taskbar and Alt+Tab
 *   - assets/icon-window.ico (the 0.1.1 transparent workaround) must NOT
 *     exist and must NOT be generated anymore
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decodePngRgba } from "../scripts/generate-icon.mjs";

const ASSETS = new URL("../assets/", import.meta.url); // directory URL base
const GENERATOR = readFileSync(fileURLToPath(new URL("../scripts/generate-icon.mjs", import.meta.url)), "utf8");

/** Decode every ICO entry into { size, rgba, isPng }. */
function decodeIco(buf) {
  const count = buf.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const e = 6 + i * 16;
    const w = buf[e];
    const size = w === 0 ? 256 : w;
    const bytes = buf.readUInt32LE(e + 8);
    const off = buf.readUInt32LE(e + 12);
    const block = buf.subarray(off, off + bytes);
    let rgba;
    if (block.readUInt32BE(0) === 0x89504e47) {
      rgba = decodePngRgba(block).rgba;
    } else {
      // classic 32-bit BMP DIB: 40-byte header + bottom-up BGRA XOR + AND mask
      const xor = block.subarray(40, 40 + size * size * 4);
      rgba = Buffer.alloc(size * size * 4);
      for (let y = 0; y < size; y++) {
        const srcRow = (size - 1 - y) * size * 4;
        for (let x = 0; x < size; x++) {
          rgba[(y * size + x) * 4 + 0] = xor[srcRow + x * 4 + 2];
          rgba[(y * size + x) * 4 + 1] = xor[srcRow + x * 4 + 1];
          rgba[(y * size + x) * 4 + 2] = xor[srcRow + x * 4 + 0];
          rgba[(y * size + x) * 4 + 3] = xor[srcRow + x * 4 + 3];
        }
      }
    }
    entries.push({ size, rgba });
  }
  return entries;
}

function stats(rgba) {
  let solid = 0, blue = 0, white = 0, maxAlpha = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3];
    if (a > maxAlpha) maxAlpha = a;
    if (a > 128) {
      solid++;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      if (b > 140 && b > r + 50 && b > g + 50) blue++;
      if (r > 200 && g > 200 && b > 200) white++;
    }
  }
  return { solid, blue, white, maxAlpha };
}

test("icon-black.ico exists and is the single multi-size DSH app icon", () => {
  const path = new URL("./icon-black.ico", ASSETS);
  assert.ok(existsSync(path), "assets/icon-black.ico must exist");
  const entries = decodeIco(readFileSync(path));
  const sizes = entries.map((e) => e.size).sort((a, b) => a - b);
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256], "must carry the common Windows sizes");
  for (const { size, rgba } of entries) {
    const s = stats(rgba);
    assert.ok(s.solid > 0, `${size}px entry must contain the black glyph`);
    assert.equal(s.blue, 0, `${size}px entry must have no blue (no old blue tile)`);
    assert.equal(s.white, 0, `${size}px entry must have no white (no badge)`);
    assert.equal(s.maxAlpha, 255, `${size}px entry must be opaque where drawn`);
  }
});

test("icon-window.ico (0.1.1 transparent workaround) must not exist", () => {
  assert.ok(!existsSync(new URL("./icon-window.ico", ASSETS)), "icon-window.ico must be deleted");
});

test("generate-icon.mjs produces only the black app icon", () => {
  assert.match(GENERATOR, /icon-black\.ico/, "the generator must still produce icon-black.ico");
  // code-path markers of the removed transparent-window-icon generation
  assert.doesNotMatch(GENERATOR, /WINDOW_SIZES|OUT_WINDOW|maskOnes/,
    "no transparent-window-icon generation may remain");
  assert.match(GENERATOR, /writeFileSync\(OUT, packIco\(SIZES, images\)\)/,
    "the generator must write exactly one ICO (icon-black.ico)");
});
