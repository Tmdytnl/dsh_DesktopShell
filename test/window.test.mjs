/**
 * dsh-desktop-shell — BrowserWindow chrome-configuration regression tests
 * (v0.1.2). Run: node test/window.test.mjs
 *
 * Guards the 0.1.2 taskbar-icon fix:
 *   - the window MUST use the real black DSH icon (assets/icon-black.ico) —
 *     the 0.1.1 transparent `icon-window.ico` workaround is forbidden again
 *   - the left-side native chrome (icon + title + page/session title) must be
 *     hidden through Electron's official `titleBarStyle: "hidden"` +
 *     `titleBarOverlay` mechanism, NOT through icon tricks
 *   - native window controls must stay native (no re-implemented buttons)
 *   - the page title must never replace the window title
 *   - a thin container drag region must be provided (hidden title bar has no
 *     native drag area)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MAIN = readFileSync(fileURLToPath(new URL("../lib/electron/main.js", import.meta.url)), "utf8");
const GENERATOR = readFileSync(fileURLToPath(new URL("../scripts/generate-icon.mjs", import.meta.url)), "utf8");

test("window icon: real black DSH app icon, never the transparent workaround", () => {
  // BrowserWindow must resolve its icon from assets/icon-black.ico
  assert.match(MAIN, /icon-black\.ico/, "main.js must reference assets/icon-black.ico");
  assert.match(MAIN, /icon:\s*WINDOW_ICON/, "the BrowserWindow icon option must use WINDOW_ICON");
  assert.match(MAIN, /const WINDOW_ICON\s*=/, "main.js must keep a WINDOW_ICON resolution");
  // the transparent-window-icon workaround must be gone from the CODE paths
  assert.doesNotMatch(MAIN, /assets\/icon-window\.ico/, "main.js must not resolve the removed icon-window.ico");
  assert.doesNotMatch(MAIN, /transparent window icon|fully transparent ICO/i, "no transparent-icon workaround remains");
});

test("chrome: hidden title bar via Electron titleBarStyle + titleBarOverlay", () => {
  assert.match(MAIN, /titleBarStyle:\s*["']hidden["']/, "titleBarStyle must be 'hidden' (official mechanism)");
  assert.match(MAIN, /titleBarOverlay:/, "titleBarOverlay must be set (native window controls)");
  // native controls stay native — no hand-rolled HTML buttons anywhere
  assert.doesNotMatch(MAIN, /minimizeButton|maximizeButton|closeButton|window-control/i,
    "no custom window-control buttons may be introduced");
});

test("chrome: empty left content — no title text, page title never propagates", () => {
  // the hidden bar renders no icon/title; the window title must stay static
  assert.match(MAIN, /page-title-updated/, "page-title-updated must be handled");
  assert.match(MAIN, /event\)\s*=>\s*event\.preventDefault\(\)|event\.preventDefault\(\)/, "page title must be prevented from replacing the window title");
  assert.doesNotMatch(MAIN, /title:\s*""/, "the static window title (Alt+Tab label) must not be emptied");
});

test("drag: a thin container drag region is provided (hidden bar has no native drag)", () => {
  assert.match(MAIN, /-webkit-app-region:\s*drag/, "a -webkit-app-region: drag strip must be injected");
  assert.match(MAIN, /DRAG_STRIP_HEIGHT_PX/, "the drag strip must have an explicit thin height");
  assert.match(MAIN, /executeJavaScript\(DRAG_STRIP_JS/, "the drag strip must be injected at runtime (container level)");
});

test("generator: no leftover transparent-window-icon code", () => {
  assert.doesNotMatch(GENERATOR, /WINDOW_SIZES|OUT_WINDOW|maskOnes/, "no window-icon constants may remain");
});
