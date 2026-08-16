/**
 * dsh-desktop-shell — Electron main process (v0.1.2).
 *
 * Pure web container. Hardened defaults (nodeIntegration:false,
 * contextIsolation:true, sandbox:true, webSecurity:true), no preload, no
 * renderer IPC. Loads the LIVE dsh web URL passed on the command line.
 *
 * Window chrome (v0.1.2):
 *   - The window uses the REAL black DSH app icon (assets/icon-black.ico):
 *     the Windows taskbar, Alt+Tab and the running-window icon are correct.
 *     (0.1.1's transparent `icon-window.ico` workaround is removed — it broke
 *     the taskbar/Alt+Tab icon.)
 *   - The native title bar is hidden with Electron's official Windows
 *     mechanism `titleBarStyle: "hidden"` + `titleBarOverlay` (Window
 *     Controls Overlay): no left-side icon, no title text, no page/session
 *     title — while the native min / max / close buttons remain (OS-drawn).
 *   - `page-title-updated` is prevented: the DSH page's
 *     "<session title> — DeepSeek Harness" never becomes the window title, so
 *     Alt+Tab / taskbar tooltip keep the static "DeepSeek Harness" label.
 *   - Drag: a hidden title bar has no native drag area, so the shell injects
 *     a thin (4px), transparent `-webkit-app-region: drag` strip at the very
 *     top edge of the page. Container-level runtime injection — no DSH source
 *     file is touched and interactive elements (buttons/inputs/links) sit
 *     below the strip, so nothing loses interaction.
 *   - The overlay's symbol color is matched to the page's actual color scheme
 *     after load, so the native buttons stay visible in dark/light themes.
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

/** v0.1.2: the REAL black DSH app icon — taskbar / Alt+Tab / running window.
 *  Missing at runtime must not break launch. */
const ICON_PATH = fileURLToPath(new URL("../../assets/icon-black.ico", import.meta.url));
const WINDOW_ICON = existsSync(ICON_PATH) ? ICON_PATH : undefined;

/** Height of the container drag strip in px. 4px is below the DSH sidebar's
 *  own 6px top padding and every interactive element (buttons are 24px+). */
const DRAG_STRIP_HEIGHT_PX = 4;

/** Inject a thin transparent drag strip at the page's top edge. The hidden
 *  title bar removes the native drag area, so the shell supplies a minimal
 *  container-level drag region (DSH files are never modified). */
const DRAG_STRIP_JS = `(() => {
  if (document.getElementById("dsh-desktop-drag-strip")) return;
  const strip = document.createElement("div");
  strip.id = "dsh-desktop-drag-strip";
  strip.style.cssText = [
    "position:fixed", "top:0", "left:0", "right:0",
    "height:${DRAG_STRIP_HEIGHT_PX}px",
    "z-index:2147483647",
    "-webkit-app-region:drag"
  ].join(";");
  (document.body ?? document.documentElement).appendChild(strip);
})();`;

/** Read the page's effective color scheme so the native overlay symbols can
 *  be matched (dark → white symbols, light → black symbols). */
const READ_COLOR_SCHEME_JS = `(() => {
  const scheme = getComputedStyle(document.documentElement).colorScheme;
  return { dark: scheme === "dark" };
})()`;

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
      mainWindow = new BrowserWindow({
        // v0.1.2 chrome: real black DSH icon (taskbar/Alt+Tab), hidden native
        // title bar + Window Controls Overlay (native min/max/close), static
        // window title used only for Alt+Tab / taskbar tooltip.
        width: 1280,
        height: 820,
        minWidth: 720,
        minHeight: 540,
        title: "DeepSeek Harness",
        icon: WINDOW_ICON,
        titleBarStyle: "hidden",
        titleBarOverlay: {
          color: "#00000000",        // transparent strip — the page shows through
          symbolColor: "#000000"     // tuned to the page theme after load
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
      });

      // Never let the DSH page title ("<session> — DeepSeek Harness") replace
      // the window title — Alt+Tab / taskbar tooltip keep "DeepSeek Harness".
      mainWindow.on("page-title-updated", (event) => event.preventDefault());

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
        mainWindow = null;
        app.quit();
      });

      // Fail-closed load: window stays hidden until the real DSH page is
      // actually loaded. Load failure → non-zero exit → desktop-app appExit(10).
      try {
        await mainWindow.loadURL(url);

        // v0.1.2 container wiring — best-effort, never blocks the show():
        //   1. thin drag strip (hidden title bar has no native drag area)
        //   2. overlay symbol color matched to the page's color scheme
        try {
          await mainWindow.webContents.executeJavaScript(DRAG_STRIP_JS, true);
        } catch {
          /* renderer already gone — fail-closed load still proceeds */
        }
        try {
          const scheme = await mainWindow.webContents.executeJavaScript(READ_COLOR_SCHEME_JS, true);
          if (mainWindow !== null && !mainWindow.isDestroyed()) {
            mainWindow.setTitleBarOverlay({
              color: "#00000000",
              symbolColor: scheme?.dark === true ? "#FFFFFF" : "#000000"
            });
          }
        } catch {
          /* keep the initial overlay colors */
        }

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
