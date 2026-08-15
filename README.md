# dsh-desktop-shell

A **peer-level DSH/Cordis bundle** that opens the live [DeepSeek Harness](https://github.com/bpc-oss) (DSH) web UI in a **native Windows Electron window** and bridges the desktop lifecycle (open / close) to the DSH runtime.

The bundle ships **installed but disabled**: a plain `dsh web` launch is completely unaffected (no Electron window, no runtime behavior). Desktop App Mode is enabled per-launch via the official `--patch` mechanism.

## Features

- Electron desktop window pointing at the **real live dsh web UI** (never a hard-coded port)
- **Graceful shutdown**: closing the window requests DSH exit through the official `ctx.appExit` contract
- **Single-instance semantics**: a redundant desktop runtime exits cleanly instead of lingering windowless
- **Random-port support**: `--port 0` lets the web server pick a free port
- **Windows desktop setup**: idempotent shortcut creation (`DeepSeek Harness.lnk`), hidden bootstrap, workspace-aware startup
- **Fail-fast launcher/runtime checks**: missing Electron runtime, missing `dsh` CLI, or missing patch → one log line + one popup, then terminate
- **Hardened Electron defaults**: no Node integration, context isolation, sandbox, strict navigation boundary
- Ships with the DSH black-style mark as window/shortcut icon (transparent background)

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
- [DSH](https://github.com/bpc-oss) installed globally (`dsh` CLI on `PATH`)
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
  icon.ico                window + shortcut icon (DSH black-style mark)
test/
  lifecycle.test.mjs      lifecycle unit tests
  setup.test.mjs          setup / argument-parser unit tests
```

## Testing

```cmd
node test\lifecycle.test.mjs
node test\setup.test.mjs
```

Current baseline: **lifecycle 20/20 PASS**, **setup 19/19 PASS** (Node built-in `node:test`, no framework).

## Scope / Non-goals

- No installer (no MSI / NSIS / Squirrel) — this is source + setup scripts only
- No auto-update, no GitHub runtime dependency: the desktop launch never contacts GitHub
- No tray, no custom title bar, no window-state persistence
- No Web UI theming — UI customization belongs to a separate client/UI plugin

## License

[MIT](./LICENSE)
