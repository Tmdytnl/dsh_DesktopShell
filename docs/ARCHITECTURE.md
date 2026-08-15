# dsh-desktop-shell — Architecture

Short reference for maintainers. See [README.md](./README.md) for usage and scope.

## File map

```
lib/
  shell.js            host service: webServer injection, Electron child lifecycle,
                      explicit exit reasons (mapExit), Cordis disposer
  app.js              app-mode coordinator: loader.await → shell.open → ctx.appExit decision
  electron/
    main.js           Electron main: window, hardened webPreferences, single-instance,
                      parent-PID watchdog, fail-closed loadURL
    nav.js            navigation boundary: allow / open-external / deny
    resolve.js        Electron package/binary resolution via Node module resolution
launch/
  desktop-app.patch.yml   per-launch overlay enabling Desktop App Mode (--patch)
  desktop-launch.cmd      fail-fast launcher (patch / runtime / dsh CLI preflight)
  launch-hidden.vbs       hidden bootstrap (runs desktop-launch.cmd, exits immediately)
scripts/
  install-desktop.mjs/.cmd   desktop setup: workspace validation, runtime prepare,
                             idempotent shortcut creation
  ensure-electron-runtime.mjs/.cmd  runtime check (--check, default) / prepare (--prepare)
  setup-args.mjs          shared option parser & validation (no deps)
  create-shortcut.vbs     COM shortcut helper
  generate-icon.mjs       dev-time icon generation (Edge headless)
assets/
  icon.ico                window + shortcut icon (DSH black-style mark, transparent bg)
test/
  lifecycle.test.mjs      lifecycle unit tests (20/20)
  setup.test.mjs          setup/parser unit tests (19/19)
```

## Bundle rows

Both rows are installed **disabled**; `--patch launch/desktop-app.patch.yml` enables Desktop App Mode for one launch.

- `desktop-shell` (`dsh-desktop-shell`, lib/shell.js) — pure host plugin: no client injection, no DOM/CSS/JS, no quota awareness. Injects the real `webServer`, provides the `desktopShell` service.
- `desktop-app` (`dsh-desktop-shell/app`, lib/app.js) — disabled by default; reads `ctx.appExit` synchronously in `apply`, runs the open/exit decision in a background task.

## Lifecycle

```
user closes window → Electron exit 0 → user-close → ctx.appExit(0) → DSH runtime exits
desktopShell.close()            → programmatic-close → DSH stays up
Cordis dispose                  → disposed → DSH shutdown owns the exit
second instance                 → single-instance-rejected → redundant runtime exits (0)
loadURL failure                 → load-failed (10) → ctx.appExit(10)
invalid --url                   → invalid-url (20) → ctx.appExit(20)
spawn/setup failure             → spawn-failed → ctx.appExit(1)
crash / signal                  → crashed / abnormal-exit → ctx.appExit(non-zero)
```

Close intent is **per-child**: `_closing` resets when the child's lifecycle ends, so `programmatic-close` never leaks into the next child (tests F1/F2). After dispose, `open()` refuses to relaunch.

## Runtime chain (Windows)

```
Desktop shortcut "DeepSeek Harness.lnk"
  → wscript.exe <pkg>\launch\launch-hidden.vbs   (hidden, exits immediately)
    → desktop-launch.cmd                          (hidden; preflight: patch exists,
       electron runtime ready, dsh on PATH — any failure logs + popup + exit 1)
      → dsh web --patch <pkg>\launch\desktop-app.patch.yml --port 0
```

The package is installed into a DSH profile as a local link (space-free junction on Windows).
All preflight checks are relative to the installed package root; the launcher never changes
the current directory — the shortcut's Working Directory owns the workspace.

## Security model

- Electron is a pure web container: `nodeIntegration:false`, `contextIsolation:true`,
  `sandbox:true`, `webSecurity:true`; no preload, no renderer IPC.
- Navigation boundary: same-origin stays in-window; external http/https opens in the
  system browser (protocol-validated); `file:`/`javascript:`/`data:`/`shell:`/custom
  schemes are denied.
- `--url` accepts loopback http/https only (127.0.0.1 / localhost / ::1 + valid port).
- Fail-closed load: window stays hidden until the real page loads.
- The runtime never contacts GitHub; no auto-update, no release checks.

## Dependencies

- `electron` **43.4.0** (exact pin; no `^`) — the only runtime dependency.
- `pnpm-lock.yaml` is the lockfile; `pnpm-workspace.yaml` scopes `onlyBuiltDependencies: electron`.
