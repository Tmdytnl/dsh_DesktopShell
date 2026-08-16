# dsh-desktop-shell

A **peer-level DSH/Cordis bundle** that opens the live [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) web UI in a **native Windows Electron window** and bridges the desktop lifecycle (open / close) to the DSH runtime.

The bundle ships **installed but disabled**: a plain `dsh web` launch is completely unaffected (no Electron window, no runtime behavior). Desktop App Mode is enabled per-launch via the official `--patch` mechanism.

## Features

- Electron desktop window pointing at the **real live dsh web UI** (never a hard-coded port)
- **Graceful shutdown**: closing the window requests DSH exit through the official `ctx.appExit` contract
- **Single-instance semantics**: a redundant desktop runtime exits cleanly instead of lingering windowless
- **Random-port support**: `--port 0` lets the web server pick a free port
- **Windows desktop setup**: idempotent shortcut creation (`DeepSeek Harness.lnk`), hidden bootstrap, workspace-aware startup
- **Fail-fast launcher/runtime checks**: missing Electron runtime, missing `dsh` CLI, or missing patch → one log line + one popup, then terminate
- **Hardened Electron defaults**: no Node integration, context isolation, sandbox, strict navigation boundary
- **Clean native window chrome**: the native title bar is hidden with Electron's official `titleBarStyle: "hidden"` + `titleBarOverlay` (Window Controls Overlay) — no icon / title / session title in the top-left, native min / max / close buttons preserved, native resize kept
- Ships with the DSH black-style mark as the single app icon (`assets/icon-black.ico`, multi-size, transparent background) used by the desktop shortcut, the BrowserWindow, the Windows taskbar and Alt+Tab

## Architecture

`dsh-desktop-shell` is a **peer-level bundle** like any other DSH plugin. It installs two Cordis rows, both disabled by default:

| Row | Entry | Responsibility |
|---|---|---|
| `desktop-shell` | `lib/shell.js` | Pure host: injects the real web server, manages the Electron child process, exposes the `desktopShell` service (open / close / focus) with explicit exit reasons |
| `desktop-app` | `lib/app.js` | App-mode coordinator: awaits the loader, opens the window, maps the Electron exit reason to a DSH exit decision (`ctx.appExit`) |

```
Desktop shortcut
  → wscript.exe <pkg>\launch\launch-hidden.vbs   (hidden bootstrap)
    → desktop-launch.cmd                          (hidden; fail-fast preflight)
      → dsh web --patch <pkg>\launch\desktop-app.patch.yml --port 0
        → Electron window over the live dsh web URL
```

### Scope boundaries

This bundle is responsible for:

- Electron desktop window
- DSH web host integration
- Windows launcher / desktop setup
- Desktop lifecycle bridge (open / close → DSH exit)

It is **not** responsible for (these belong to a separate DSH client/UI plugin):

- DSH Web UI theming / DOM / CSS injection
- Quota widget UI or other plugin UI
- Custom window title bar or in-page top icons

### Electron exit reason → DSH decision

| Electron exit | Reason | DSH decision |
|---|---|---|
| `0` (window closed) | `user-close` | exit — `ctx.appExit(0)` |
| — (`desktopShell.close()`) | `programmatic-close` | do **not** exit DSH |
| — (Cordis dispose) | `disposed` | no double exit (shutdown owns the lifecycle) |
| `30` (single-instance rejected) | `single-instance-rejected` | exit the redundant runtime — `ctx.appExit(0)` |
| `10` (load failed) | `load-failed` | exit — `ctx.appExit(10)` |
| `20` (invalid `--url`) | `invalid-url` | exit — `ctx.appExit(20)` |
| spawn/setup failure | `spawn-failed` | exit — `ctx.appExit(1)` |
| other non-zero / signal | `crashed` / `abnormal-exit` | exit — `ctx.appExit(non-zero)` |

## Requirements

- Windows 10/11
- Node.js (for setup scripts and tests)
- [DSH](https://github.com/deepseek-ai/deepseek-harness) installed globally (`dsh` CLI on `PATH`)
- pnpm (for install / pack workflows)

## Installation

The bundle is installed as a **DSH plugin** into a profile. On Windows, use a space-free junction path for the local package:

```cmd
:: 1) put the package in a space-free location, e.g. %USERPROFILE%\dsh-desktop-shell-pkg
::    (a junction to the real package location works, e.g. mklink /J)
:: 2) install into the web profile
dsh plugin --profile web add link:%USERPROFILE%\dsh-desktop-shell-pkg
:: 3) uninstall
dsh plugin --profile web remove dsh-desktop-shell
```

The CLI maintains `dependencies` and `dsh.profile.bundles` — do not edit the profile `package.json` by hand.

## Desktop Setup

First-time setup (prepares the Electron runtime and creates/updates the desktop shortcut; idempotent, safe to re-run):

```cmd
scripts\install-desktop.cmd
:: optional: override the workspace (working directory of the launch)
scripts\install-desktop.cmd --workspace "<your-workspace-dir>"
:: optional: target profile (only "web" is currently supported)
scripts\install-desktop.cmd --profile web
scripts\install-desktop.cmd --help
```

- **Workspace precedence**: `CLI --workspace` > env `DSH_DESKTOP_WORKSPACE` > default
- The workspace must be an existing directory; validation happens **before** any shortcut change
- Only the `web` profile is supported; any other profile fails before any side effect
- Re-running updates the same `DeepSeek Harness.lnk` — never a duplicate

## Failure isolation

`dsh-desktop-shell` is an **optional desktop enhancement layer**, not a runtime
dependency of DSH:

- A plain `dsh web` launch never activates the Desktop rows (`desktop-shell` /
  `desktop-app` are installed `disabled: true`), so it never loads the Electron
  path and never starts a window.
- Desktop App Mode is enabled only for a single launch via
  `--patch launch/desktop-app.patch.yml`.
- Failures in the desktop launcher / Electron runtime / desktop-mode entries
  are confined to the Desktop launch path. Verified boundaries:

  | Failure | Plain `dsh web` after it |
  |---|---|
  | Desktop launcher (`desktop-launch.cmd` / `launch-hidden.vbs`) broken | still works |
  | Electron runtime missing | still works |
  | Electron child crash / abnormal exit | still works (Desktop runtime exits per lifecycle) |
  | `desktop-shell` / `desktop-app` activation failure (Desktop mode only) | still works |
  | Corrupted disabled entry module (`lib/shell.js` / `lib/app.js`) | still works (disabled rows are lazy / isolated) |

  A desktop failure therefore never leaves persistent state that prevents a
  later plain `dsh web` session. **Framework-level boundary:** DSH/Cordis
  itself still parses the profile's bundle metadata; a malformed
  `package.json` / bundle patch can break the whole profile boot, exactly as
  with any other installed plugin. This bundle does not (and cannot) repair
  the plugin loader.

## Usage

Double-click **DeepSeek Harness** on the desktop. A hidden bootstrap launches `dsh web` with the desktop-app patch on a random port, the Electron window opens over the real DSH UI, and closing the window shuts the whole runtime down cleanly.

Launcher logs (failures only): `%LOCALAPPDATA%\dsh-desktop-shell\logs\launcher.log`

For one-off debug launches:

```cmd
dsh web --patch "%USERPROFILE%\.dsh\profiles\web\node_modules\dsh-desktop-shell\launch\desktop-app.patch.yml" --port 0
```

## Development

```text
lib/
  shell.js            host service (Electron child lifecycle)
  app.js              app-mode coordinator (exit decisions)
  electron/
    main.js           Electron main process (window, security defaults)
    nav.js            navigation boundary (allow / open-external / deny)
    resolve.js        Electron binary resolution (Node module resolution)
launch/
  desktop-app.patch.yml   per-launch enable patch
  desktop-launch.cmd      fail-fast launcher
  launch-hidden.vbs       hidden bootstrap
scripts/
  install-desktop.*       desktop shortcut / runtime setup
  ensure-electron-runtime.*  runtime check / prepare
  setup-args.mjs          argument parsing & validation (shared with tests)
  generate-icon.mjs       icon generation (dev-time tool)
  create-shortcut.vbs     shortcut COM helper
assets/
  favicon-source.svg       official DSH favicon copy (icon source)
  icon-black.ico           the single DSH app icon (multi-size black DSH mark);
                           desktop shortcut + BrowserWindow + taskbar + Alt+Tab
test/
  lifecycle.test.mjs      lifecycle unit tests
  setup.test.mjs          setup / argument-parser unit tests
```

## Testing

```cmd
node test\lifecycle.test.mjs
node test\setup.test.mjs
node test\isolation.test.mjs
node test\window.test.mjs
node test\icon.test.mjs
```

Current baseline: **lifecycle 20/20 PASS**, **setup 19/19 PASS**, **isolation 3/3 PASS**, **window 5/5 PASS**, **icon 3/3 PASS** (Node built-in `node:test`, no framework). `isolation.test.mjs` builds throwaway profiles under a temp `DSH_HOME` and verifies the Desktop-vs-plain-DSH failure boundary (I1: plain `dsh web` keeps Desktop rows disabled and spawns no owned Electron; I7: a corrupted disabled desktop entry does not break plain `dsh web`; I8: a malformed bundle patch is a documented loader-level boundary). `window.test.mjs` and `icon.test.mjs` guard the 0.1.2 taskbar-icon fix (BrowserWindow must use `icon-black.ico`; the transparent-icon workaround must stay gone).

## Scope / Non-goals

- No installer (no MSI / NSIS / Squirrel) — this is source + setup scripts only
- No auto-update, no GitHub runtime dependency: the desktop launch never contacts GitHub
- No tray, no custom title bar, no window-state persistence
- No Web UI theming — UI customization belongs to a separate client/UI plugin

## License

[MIT](./LICENSE)
