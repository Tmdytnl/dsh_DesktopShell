/**
 * dsh-desktop-shell — BrowserWindow chrome-configuration regression tests
 * (v0.1.3). Run: node test/window.test.mjs
 *
 * Guards the Desktop Caption Safe Area contract:
 *   - a practical caption/drag height (>= MIN_USABLE_CAPTION_HEIGHT_PX, and
 *     definitely NOT the unusable 4px strip from 0.1.2)
 *   - the SAME caption height drives the drag lane AND the DSH content inset
 *     (the page can never again start at top:0 under the Windows controls)
 *   - the real black DSH icon (assets/icon-black.ico) stays the window icon;
 *     the 0.1.1 transparent `icon-window.ico` workaround is forbidden again
 *   - the official `titleBarStyle: "hidden"` + `titleBarOverlay` mechanism is
 *     used and native window controls are NOT re-implemented
 *   - the caption injection is reload-safe (re-applied on did-finish-load)
 *   - the hardened webPreferences stay unchanged
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CAPTION_HEIGHT_PX,
  MIN_USABLE_CAPTION_HEIGHT_PX,
  CAPTION_LANE_ID,
  buildWindowOptions,
  buildCaptionCss,
  buildCaptionLaneJs,
  buildTitleBarOverlay,
  READ_DARK_JS
} from "../lib/electron/chrome.js";

const MAIN = readFileSync(fileURLToPath(new URL("../lib/electron/main.js", import.meta.url)), "utf8");
const GENERATOR = readFileSync(fileURLToPath(new URL("../scripts/generate-icon.mjs", import.meta.url)), "utf8");

test("caption geometry: practical height, never the 4px strip", () => {
  assert.ok(
    CAPTION_HEIGHT_PX >= MIN_USABLE_CAPTION_HEIGHT_PX,
    `caption height (${CAPTION_HEIGHT_PX}px) must be a usable drag lane (>= ${MIN_USABLE_CAPTION_HEIGHT_PX}px)`
  );
  assert.ok(CAPTION_HEIGHT_PX > 4, "the unusable 4px drag strip must not return");
  // the old 4px strip is fully removed from the source
  assert.doesNotMatch(MAIN, /DRAG_STRIP|dsh-desktop-drag-strip|4px strip/i, "no leftover 4px drag-strip implementation");
});

test("caption geometry: drag lane height == content inset height (one source of truth)", () => {
  const css = buildCaptionCss();
  const laneJs = buildCaptionLaneJs();
  assert.match(css, new RegExp(`--dsh-desktop-caption-height:${CAPTION_HEIGHT_PX}px`), "CSS must define the caption height");
  assert.match(css, /body[^{]*\{[^}]*padding-top:var\(--dsh-desktop-caption-height\)/, "DSH content must be inset below the caption");
  assert.match(css, /#root[^{]*\{[^}]*height:calc\(100vh - var\(--dsh-desktop-caption-height\)\)/, "#root viewport must shrink by the caption height");
  assert.match(laneJs, new RegExp(`height:${CAPTION_HEIGHT_PX}px`), "the drag lane must be exactly the caption height");
  assert.match(laneJs, /-webkit-app-region:drag/, "the caption lane must be the drag region");
  assert.match(laneJs, new RegExp(JSON.stringify(CAPTION_LANE_ID)), "the lane must be idempotent by its id");
});

test("window icon: real black DSH app icon, never the transparent workaround", () => {
  const opts = buildWindowOptions({ icon: "assets/icon-black.ico" });
  assert.equal(opts.icon, "assets/icon-black.ico", "BrowserWindow must use icon-black.ico");
  assert.match(MAIN, /icon-black\.ico/, "main.js must resolve assets/icon-black.ico");
  assert.doesNotMatch(MAIN, /assets\/icon-window\.ico/, "main.js must not resolve the removed icon-window.ico");
  assert.doesNotMatch(MAIN, /transparent window icon|fully transparent ICO/i, "no transparent-icon workaround remains");
});

test("chrome: official hidden title bar + native window controls", () => {
  const opts = buildWindowOptions({});
  assert.equal(opts.titleBarStyle, "hidden", "titleBarStyle must be 'hidden'");
  assert.ok(opts.titleBarOverlay, "titleBarOverlay must be enabled (native controls)");
  assert.equal(opts.titleBarOverlay.height, CAPTION_HEIGHT_PX, "the native strip must match the caption height");
  // native controls stay native — no hand-rolled HTML buttons anywhere
  const all = `${MAIN}\n${readFileSync(fileURLToPath(new URL("../lib/electron/chrome.js", import.meta.url)), "utf8")}`;
  assert.doesNotMatch(all, /minimizeButton|maximizeButton|closeButton|window-control/i,
    "no custom window-control buttons may be introduced");
});

test("chrome: page title never propagates; static Alt+Tab label kept", () => {
  const opts = buildWindowOptions({});
  assert.equal(opts.title, "DeepSeek Harness", "the static window title (Alt+Tab label) must be kept");
  assert.match(MAIN, /page-title-updated/, "page-title-updated must be handled");
  assert.match(MAIN, /preventDefault\(\)/, "the page title must be prevented from replacing the window title");
});

test("chrome: reload-safe caption injection", () => {
  assert.match(MAIN, /did-finish-load/, "the caption chrome must be re-applied on every finished load");
  assert.match(MAIN, /applyCaptionChrome/, "the caption application must be a named re-runnable step");
});

test("chrome: hardened webPreferences unchanged", () => {
  const opts = buildWindowOptions({});
  assert.deepEqual(opts.webPreferences, {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true
  }, "security configuration must stay hardened");
});

test("theme helpers: overlay colors follow the page scheme", () => {
  assert.deepEqual(buildTitleBarOverlay({ dark: false }), { color: "#00000000", symbolColor: "#000000", height: CAPTION_HEIGHT_PX });
  assert.deepEqual(buildTitleBarOverlay({ dark: true }), { color: "#00000000", symbolColor: "#FFFFFF", height: CAPTION_HEIGHT_PX });
  assert.match(READ_DARK_JS, /data-ds-dark-theme/, "dark detection must read the DSH theme attribute");
});

test("generator: no leftover transparent-window-icon code", () => {
  assert.doesNotMatch(GENERATOR, /WINDOW_SIZES|OUT_WINDOW|maskOnes/, "no window-icon constants may remain");
});
