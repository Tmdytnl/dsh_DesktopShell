/**
 * dsh-desktop-shell — window chrome configuration (v0.1.3).
 *
 * Pure, dependency-free module: every geometry/configuration decision for the
 * DesktopShell window chrome lives here so it can be unit-tested without
 * launching Electron.
 *
 * Design (v0.1.3 — Desktop Caption Safe Area):
 *
 *   BrowserWindow viewport
 *   ├── caption safe area (CAPTION_HEIGHT_PX, ~32px)
 *   │   ├── draggable lane  (the whole caption strip, -webkit-app-region:drag)
 *   │   └── native Windows controls (titleBarOverlay, OS-drawn)
 *   └── DSH web content viewport (starts BELOW the caption)
 *
 * The DSH page is inset by the caption height through injected CSS so the
 * Windows Controls Overlay and the DSH header NEVER share the same physical
 * area: `body { padding-top }` + `#root { height: calc(100vh - H) }`. The
 * caption lane itself is a container-level fixed element (idempotent,
 * reload-safe) — no DSH source file is touched and the whole caption strip is
 * the drag region (replaces the unusable 4px strip from 0.1.2).
 *
 * `titleBarOverlay.height` is set to the SAME value as the caption height so
 * the native button strip and the caption lane always agree.
 */

/** Height of the Desktop caption safe area in CSS px. 32px is a comfortable
 *  drag lane on Windows 10/11 at 100–150% DPI while staying visually thin.
 *  This single constant drives: the overlay strip height, the drag lane
 *  height, and the DSH content top inset — they can never drift apart. */
export const CAPTION_HEIGHT_PX = 32;

/** A drag lane smaller than this is not practically usable (0.1.2 used 4px
 *  and real users could not drag the window). Guards against regressions. */
export const MIN_USABLE_CAPTION_HEIGHT_PX = 24;

/** ID of the injected caption lane element (idempotency key). */
export const CAPTION_LANE_ID = "dsh-desktop-caption";

/**
 * BrowserWindow options for the Desktop shell.
 * @param icon - resolved icon path (assets/icon-black.ico) or undefined.
 */
export function buildWindowOptions({ icon } = {}) {
  return {
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 540,
    // Static label for Alt+Tab / taskbar tooltip; the hidden title bar never
    // renders it and `page-title-updated` keeps the page title out.
    title: "DeepSeek Harness",
    // REAL black DSH app icon — taskbar / Alt+Tab / running-window icon.
    // (0.1.1's transparent-icon workaround is gone and must not return.)
    icon,
    // Official Windows title-bar mechanism: hide the native bar (no left
    // icon/title) while the Window Controls Overlay keeps native
    // min/max/close buttons.
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#00000000",                 // transparent strip — page shows through
      symbolColor: "#000000",             // tuned to the page theme after load
      height: CAPTION_HEIGHT_PX           // native strip == caption lane height
    },
    center: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  };
}

/**
 * CSS that creates the caption safe area: the whole DSH web content is
 * pushed below the caption lane. Uses the DSH theme's own body background
 * (the caption strip therefore blends with the page in light and dark).
 *
 * Rationale (verified against the DSH web frontend):
 *   - DSH mounts into `#root` and its app frame uses `height:100%` chains;
 *     giving `#root` a definite `calc(100vh - H)` makes the app viewport
 *     exactly the area below the caption regardless of the html/body chain.
 *   - `body { padding-top }` shifts the content down; body height stays
 *     `H + (100vh - H) = 100vh`, so no extra page scrollbar appears.
 *   - The frontend only ever uses `100vh` inside `max-height` rules, so the
 *     reduced root height cannot cause overflow.
 * @param height - caption height in px (default CAPTION_HEIGHT_PX).
 */
export function buildCaptionCss({ height = CAPTION_HEIGHT_PX } = {}) {
  return `:root{--dsh-desktop-caption-height:${height}px}
html{box-sizing:border-box}
body{box-sizing:border-box;padding-top:var(--dsh-desktop-caption-height)}
#root{box-sizing:border-box;height:calc(100vh - var(--dsh-desktop-caption-height));min-height:calc(100vh - var(--dsh-desktop-caption-height))}`;
}

/**
 * JS that injects the caption lane element — the DRAG region. Idempotent
 * (checks CAPTION_LANE_ID) and container-level (DSH files untouched). The
 * native WCO buttons are OS-drawn above the web content, so the full-width
 * lane never intercepts them. On Windows, `-webkit-app-region: drag` also
 * provides the native double-click maximize/restore behavior.
 * @param height - caption height in px (default CAPTION_HEIGHT_PX).
 */
export function buildCaptionLaneJs({ height = CAPTION_HEIGHT_PX } = {}) {
  return `(() => {
  if (document.getElementById(${JSON.stringify(CAPTION_LANE_ID)})) return;
  const lane = document.createElement("div");
  lane.id = ${JSON.stringify(CAPTION_LANE_ID)};
  lane.style.cssText = [
    "position:fixed", "top:0", "left:0", "right:0",
    "height:${height}px",
    "z-index:2147483647",
    "-webkit-app-region:drag"
  ].join(";");
  (document.body ?? document.documentElement).appendChild(lane);
})();`;
}

/** JS returning whether the DSH page is currently in dark theme. */
export const READ_DARK_JS = `(() => Boolean(document.body && document.body.hasAttribute("data-ds-dark-theme")))()`;

/** Overlay config for a given dark/light scheme (native button symbols). */
export function buildTitleBarOverlay({ dark = false, height = CAPTION_HEIGHT_PX } = {}) {
  return {
    color: "#00000000",
    symbolColor: dark ? "#FFFFFF" : "#000000",
    height
  };
}
