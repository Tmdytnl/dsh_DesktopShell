/**
 * dsh-desktop-shell — Electron main process (v0.1).
 *
 * Pure web container. Hardened defaults (nodeIntegration:false,
 * contextIsolation:true, sandbox:true, webSecurity:true), no preload, no
 * renderer IPC. Loads the LIVE dsh web URL passed on the command line.
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

/** Productization v1: window icon — the official DSH favicon repackaged as
 *  assets/icon.ico. Optional at runtime (missing icon must not break launch). */
const ICON_PATH = fileURLToPath(new URL("../../assets/icon.ico", import.meta.url));
const WINDOW_ICON = existsSync(ICON_PATH) ? ICON_PATH : undefined;

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
        // Productization v1 (frozen lifecycle untouched): native frame, sane
        // defaults, real DSH title, official icon, responsive min size.
        width: 1280,
        height: 820,
        minWidth: 720,
        minHeight: 540,
        title: "DeepSeek Harness",
        icon: WINDOW_ICON,
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
