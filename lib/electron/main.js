/**
 * dsh-desktop-shell — Electron main process (v0.1.3).
 *
 * Pure web container. Hardened defaults (nodeIntegration:false,
 * contextIsolation:true, sandbox:true, webSecurity:true), no preload, no
 * renderer IPC. Loads the LIVE dsh web URL passed on the command line.
 *
 * Window chrome (v0.1.3 — Desktop Caption Safe Area; config in chrome.js):
 *
 *   BrowserWindow viewport
 *   ├── caption safe area (CAPTION_HEIGHT_PX = 32)
 *   │   ├── draggable lane  (the whole caption strip, -webkit-app-region:drag)
 *   │   └── native Windows controls (titleBarOverlay, OS-drawn)
 *   └── DSH web content viewport (starts BELOW the caption)
 *
 *   - The window uses the REAL black DSH app icon (assets/icon-black.ico):
 *     Windows taskbar, Alt+Tab and the running-window icon are correct.
 *     (0.1.1's transparent `icon-window.ico` workaround is removed and must
 *     not return — it broke the taskbar/Alt+Tab icon.)
 *   - The native title bar is hidden with Electron's official mechanism
 *     `titleBarStyle: "hidden"` + `titleBarOverlay`: no left-side icon/title,
 *     while native min / max / close buttons remain (OS-drawn).
 *   - `page-title-updated` is prevented: the DSH page's
 *     "<session title> — DeepSeek Harness" never becomes the window title;
 *     Alt+Tab / taskbar tooltip keep the static "DeepSeek Harness" label.
 *   - The DSH page is inset by the caption height (injected CSS on `body` /
 *     `#root`), so the Windows Controls Overlay and the DSH header never
 *     share the same physical area.
 *   - The caption lane (drag region) is injected container-level, idempotent,
 *     and REAPPLIED on every `did-finish-load` (reload-safe: Ctrl+R / inner
 *     navigation restores both the caption lane and the content inset).
 *   - The overlay symbol color follows the DSH theme (initial + low-frequency
 *     runtime sync; the caption background uses the page's own CSS variables,
 *     so it adapts to theme switches automatically).
 *
 * Flags:
 *   --url=<http://loopback:port>   validated (loopback http/https only)
 *   --parent-pid=<pid>             DSH runtime pid; quit if it disappears
 *
 * Exit codes (the parent desktop-shell maps them to exit reasons):
 *   0   normal window close / app.quit
 *   10  load-failed (dshUrl could not be loaded)
 *   20  invalid --url
 *   30  single-instance-rejected (another desktop window is running)
 */
import { app, BrowserWindow, shell } from "electron";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { classifyNavigation, openExternalSafe } from "./nav.js";
import {
  CAPTION_HEIGHT_PX,
  buildWindowOptions,
  buildCaptionCss,
  buildCaptionLaneJs,
  buildTitleBarOverlay,
  READ_DARK_JS
} from "./chrome.js";

/** The REAL black DSH app icon — taskbar / Alt+Tab / running window.
 *  Missing at runtime must not break launch. */
const ICON_PATH = fileURLToPath(new URL("../../assets/icon-black.ico", import.meta.url));
const WINDOW_ICON = existsSync(ICON_PATH) ? ICON_PATH : undefined;

/** Theme re-sync cadence (P2 — runtime light/dark switching without reload). */
const THEME_SYNC_MS = 2500;

function findArg(name) {
  const prefix = `${name}=`;
  for (const entry of process.argv) {
    if (entry.startsWith(prefix)) return entry.slice(prefix.length);
  }
  return undefined;
}

function validLoopbackUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) return false;
  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  return true;
}

const url = findArg("--url");
const parentPid = Number(findArg("--parent-pid") ?? 0);

let mainWindow = null;
let themeSyncTimer = null;

/** Apply the caption chrome to the CURRENT document (idempotent per document;
 *  re-run on every did-finish-load so reloads restore the chrome). */
async function applyCaptionChrome(win) {
  const wc = win.webContents;
  try {
    await wc.insertCSS(buildCaptionCss({ height: CAPTION_HEIGHT_PX }));
  } catch {
    /* renderer gone — best effort */
  }
  try {
    await wc.executeJavaScript(buildCaptionLaneJs({ height: CAPTION_HEIGHT_PX }), true);
  } catch {
    /* renderer gone — best effort */
  }
  await syncOverlayTheme(win);
}

/** Match the native overlay symbols to the page's current theme. */
async function syncOverlayTheme(win) {
  try {
    const dark = await win.webContents.executeJavaScript(READ_DARK_JS, true);
    if (win !== null && !win.isDestroyed()) {
      win.setTitleBarOverlay(buildTitleBarOverlay({ dark: dark === true }));
    }
  } catch {
    /* keep the previous overlay colors */
  }
}

if (url === undefined || !validLoopbackUrl(url)) {
  console.error(`desktop-shell: invalid --url (loopback http/https required): ${String(url)}`);
  app.exit(20);
} else {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.exit(30);
  } else {
    const allowedOrigin = new URL(url).origin;

    app.on("second-instance", () => {
      if (mainWindow !== null) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });

    app.whenReady().then(async () => {
      mainWindow = new BrowserWindow(buildWindowOptions({ icon: WINDOW_ICON }));

      // Never let the DSH page title ("<session> — DeepSeek Harness") replace
      // the window title — Alt+Tab / taskbar tooltip keep "DeepSeek Harness".
      mainWindow.on("page-title-updated", (event) => event.preventDefault());

      // v0.1.3: caption safe area + drag lane are re-applied on EVERY finished
      // load (initial load, Ctrl+R, renderer reload, inner navigation).
      mainWindow.webContents.on("did-finish-load", () => {
        void applyCaptionChrome(mainWindow);
      });

      // Navigation boundary: same-origin stays in the window; external
      // http/https goes to the system browser; everything else is denied.
      mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
        const decision = classifyNavigation(target, allowedOrigin);
        if (decision.action === "open-external") {
          openExternalSafe(decision.href, (href) => void shell.openExternal(href));
        }
        return { action: "deny" };
      });
      mainWindow.webContents.on("will-navigate", (event, target) => {
        const decision = classifyNavigation(target, allowedOrigin);
        if (decision.action === "allow") return;
        event.preventDefault();
        if (decision.action === "open-external") {
          openExternalSafe(decision.href, (href) => void shell.openExternal(href));
        }
      });

      mainWindow.on("closed", () => {
        if (themeSyncTimer !== null) {
          clearInterval(themeSyncTimer);
          themeSyncTimer = null;
        }
        mainWindow = null;
        app.quit();
      });

      // Low-frequency runtime theme sync (P2): keep the native button symbols
      // in sync when DSH switches light/dark without a reload.
      themeSyncTimer = setInterval(() => {
        if (mainWindow !== null && !mainWindow.isDestroyed()) {
          void syncOverlayTheme(mainWindow);
        }
      }, THEME_SYNC_MS);

      // Fail-closed load: window stays hidden until the real DSH page is
      // actually loaded. Load failure → non-zero exit → desktop-app appExit(10).
      try {
        await mainWindow.loadURL(url);
        mainWindow.show();
      } catch (error) {
        console.error(`desktop-shell: failed to load ${url}: ${error instanceof Error ? error.message : String(error)}`);
        app.exit(10);
      }
    });

    // Parent watchdog: if the DSH runtime that spawned us disappears
    // unexpectedly, close the window instead of leaving a stray desktop shell.
    if (parentPid > 0) {
      const watchdog = setInterval(() => {
        try {
          process.kill(parentPid, 0);
        } catch {
          app.quit();
        }
      }, 2000);
      app.on("will-quit", () => clearInterval(watchdog));
    }
  }
}
