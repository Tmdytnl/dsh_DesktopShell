# Changelog

## 0.1.2 - 2026-08-16

Taskbar / Alt+Tab icon fix and test hardening.

- Fix running Windows taskbar / Alt+Tab icon regression introduced in 0.1.1:
  the BrowserWindow now uses the real black DSH application icon
  (`assets/icon-black.ico`) — taskbar, Alt+Tab and the running-window icon
  show the DSH mark again.
- Remove the transparent-window-icon workaround: `assets/icon-window.ico` is
  deleted and its generator code is gone.
- Hide the left-side native chrome (icon + title + page/session title) through
  Electron's official Windows title-bar mechanism: `titleBarStyle: "hidden"`
  with `titleBarOverlay` — native min / max / close buttons are preserved.
- Preserve window dragging: the shell injects a thin (4px) transparent
  `-webkit-app-region: drag` strip at the page's top edge (container-level;
  DSH UI is untouched and interactive elements are not blocked).
- Harden isolation tests against port / process / environment flakiness:
  ephemeral ports (web server binds `--port 0`), Electron assertions count
  only processes owned by this package, and the optional quota peer-plugin
  assertion is skipped when dsh-deepseek-quota is not installed.
- Add window-chrome and icon regression suites
  (`test/window.test.mjs`, `test/icon.test.mjs`).
- Clean stale version comments / documentation (no more 0.1.1/0.1.5 mixed
  markers in current code and docs).

## 0.1.1 - 2026-08-16

Usability / isolation update.

- Fix Windows desktop shortcut icon rollout: new cache-safe multi-size icon
  (`assets/icon-black.ico`, 16/24/32/48/64/128/256 px, black DSH mark on
  transparent background). The shortcut's `IconLocation` now points at the new
  stable asset name, so Windows does not keep serving the old cached icon.
- Remove the unwanted icon + session title from the desktop window chrome:
  the native frame is kept (drag / resize / min / max / close stay native),
  the page title is prevented from reaching the title bar, the title is
  empty, and the window icon (`assets/icon-window.ico`) is fully transparent.
- Verify and harden Desktop failure isolation from plain `dsh web`
  (launcher / Electron-runtime / Electron-child / desktop-mode activation
  failures never leave persistent state; plain `dsh web` stays unaffected).
- Add regression coverage for the Desktop isolation boundaries
  (`test/isolation.test.mjs`: I1 / I7 / I8).
- Fix the official DeepSeek Harness repository link
  (`https://github.com/deepseek-ai/deepseek-harness`).
- Icon generation is now self-contained: `scripts/generate-icon.mjs` rasterizes
  the official favicon in-process (no browser / Edge headless dependency).

## 0.1.0 - 2026-08-16

Initial public release.

- Peer-level DSH/Cordis desktop bundle
- Electron desktop window using the real DSH Web UI
- Graceful `ctx.appExit` shutdown
- Random-port web server support
- Single-instance runtime cleanup
- Windows desktop shortcut/setup
- Workspace-aware startup
- Fail-fast launcher/runtime checks
- Hardened Electron renderer/navigation defaults
