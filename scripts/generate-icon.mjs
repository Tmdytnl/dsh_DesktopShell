/**
 * dsh-desktop-shell — generate assets/icon.ico from the OFFICIAL DSH favicon
 * (dsh-web-frontend/dist/favicon.svg).
 *
 * v0.1.5 style: DSH BLACK-STYLE MARK — the raw favicon symbol on a fully
 * TRANSPARENT background. No square, no colored tile, no app-badge card:
 * just the pure DSH glyph, matching the favicon the web UI itself uses.
 *
 * This is a DEV-TIME tool only. The produced assets/icon.ico is the runtime
 * artifact; nothing at launch time runs this script or a browser.
 *
 * Steps:
 *   1. read assets/favicon-source.svg (official DSH favicon copy)
 *   2. render it at 256x256 via the system Edge/Chromium headless
 *      (transparent canvas, forced light color-scheme → black glyph)
 *   3. wrap the PNG into a single-image PNG-in-ICO (Vista+ compatible)
 *
 * Usage: node scripts/generate-icon.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SVG = join(ROOT, "assets", "favicon-source.svg");
const OUT = join(ROOT, "assets", "icon.ico");
const SIZE = 256;

const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
];

function findChromium() {
  for (const candidate of EDGE_CANDIDATES) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch { /* keep looking */ }
  }
  throw new Error("no Edge/Chrome found to render the icon");
}

/** Wrap a PNG byte buffer into a single-entry ICO (Vista+ PNG-in-ICO). */
function pngToIco(png) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  // entry: width=0 (256), height=0 (256), colors=0, reserved=0
  header.writeUInt16LE(1, 10); // planes
  header.writeUInt16LE(32, 12); // bit count
  header.writeUInt32LE(png.length, 14); // bytes in resource
  header.writeUInt32LE(22, 18); // image offset
  return Buffer.concat([header, png]);
}

const svg = readFileSync(SVG);
const tmp = mkdtempSync(join(tmpdir(), "dsh-icon-"));
try {
  const html = join(tmp, "icon.html");
  const pngOut = join(tmp, "icon.png");
  // Transparent canvas + forced light color-scheme → the favicon renders as a
  // pure black glyph on transparency (no tile, no border, no badge).
  writeFileSync(html, `<!doctype html>
<html style="color-scheme: light"><head><meta charset="utf-8"></head>
<body style="margin:0;width:${SIZE}px;height:${SIZE}px;background:transparent">
<img src="favicon.svg" width="${SIZE}" height="${SIZE}" style="display:block">
</body></html>`);
  writeFileSync(join(tmp, "favicon.svg"), svg);

  const edge = findChromium();
  const result = spawnSync(edge, [
    "--headless", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
    "--default-background-color=00000000", // keep the canvas transparent
    `--screenshot=${pngOut}`, `--window-size=${SIZE},${SIZE}`,
    `file:///${html.replace(/\\/g, "/")}`
  ], { stdio: "ignore", timeout: 60000 });

  const png = readFileSync(pngOut);
  if (png.length === 0) throw new Error("headless render produced an empty image");
  writeFileSync(OUT, pngToIco(png));
  console.log(`dsh-desktop-shell: wrote ${OUT} (${png.length} bytes PNG in ICO, 256x256, DSH black-style mark, transparent background)`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
