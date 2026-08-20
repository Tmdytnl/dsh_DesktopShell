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
                      parent-PID watchdog, fail-closed loadURL, caption chrome
                      application (reload-safe)
    chrome.js         window-chrome configuration (pure/testable): caption safe-area
                      geometry, BrowserWindow options, caption CSS, drag lane JS,
                      overlay theme helpers
    nav.js            navigation boundary: allow / open-external / deny
    resolve.js        Electron package/binary resolution via Node module resolution
launch/
  desktop-app.patch.yml   per-launch overlay enabling Desktop App Mode (--patch)
  desktop-launch.cmd      fail-fast launcher (patch / runtime / dsh CLI preflight)
  launch-hidden.vbs       hidden bootstrap (runs desktop-launch.cmd, exits immediately)
scripts/
  install-desktop.mjs/.cmd   desktop setup: workspace validation, runtime prepare,
                             idempotent shortcut creation (IconLocation =
                             assets/icon-black.ico — cache-safe stable name)
  ensure-electron-runtime.mjs/.cmd  runtime check (--check, default) / prepare (--prepare)
  setup-args.mjs          shared option parser & validation (no deps)
  create-shortcut.vbs     COM shortcut helper
  generate-icon.mjs       dev-time icon generation (self-contained SVG rasterizer;
                          writes icon-black.ico)
assets/
  favicon-source.svg      official DSH favicon copy (icon source)
  icon-black.ico          the single DSH app icon (multi-size black DSH mark);
                          desktop shortcut + BrowserWindow + taskbar + Alt+Tab
test/
  lifecycle.test.mjs      lifecycle unit tests (20/20)
  setup.test.mjs          setup/parser unit tests (19/19)
  isolation.test.mjs      Desktop-vs-plain-DSH isolation tests (3/3)
  window.test.mjs         window-chrome / caption-geometry regression tests (9/9)
  icon.test.mjs           icon-asset regression tests (3/3)
```

## Bundle rows

Both rows are installed **disabled**; `--patch launch/desktop-app.patch.yml` enables Desktop App Mode for one launch.

- `desktop-shell` (`dsh-desktop-shell`, lib/shell.js) — pure host plugin: no DSH
  business-UI awareness, no quota awareness. Injects the real `webServer`,
  provides the `desktopShell` service. (Renderer-side DOM/CSS injection, if any,
  lives in the Electron main's chrome wiring — see "Renderer injection
  boundary" below — never in the host row.)
- `desktop-app` (`dsh-desktop-shell/app`, lib/app.js) — disabled by default; reads `ctx.appExit` synchronously in `apply`, runs the open/exit decision in a background task.

## Renderer injection boundary

The ONLY renderer-side DOM/CSS injection performed by this bundle is the
minimal **container chrome** wiring in `lib/electron/main.js` +
`lib/electron/chrome.js`, executed inside the Desktop Electron window:

```text
DesktopShell
├── Native Electron window lifecycle
├── Desktop caption geometry (caption safe area, drag lane, content inset)
├── minimal chrome-only renderer injection (caption CSS + drag-lane element)
└── Windows launcher

DSH / other plugins
└── actual business UI (themes, components, Session log, quota, …)
```

The injected CSS reserves the native caption safe area (DSH content starts
below it) and the injected element is the drag region. DesktopShell never
touches DSH layout semantics, theme design, components or plugin UI — a future
DSH header/plugin UI is safe by construction because the whole page is inset
below the caption.

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

## Failure isolation boundary

`dsh-desktop-shell` is an **optional** Desktop enhancement layer, never a base
runtime dependency of DSH:

- Both rows are `disabled: true` in the bundle layer; plain `dsh web` never
  activates them and never resolves the Electron path.
- Desktop App Mode is enabled for ONE launch only, via
  `--patch launch/desktop-app.patch.yml` (overrides the bundle's disabled
  rows). No profile file is permanently changed by a Desktop launch.
- Launcher / Electron-runtime / Electron-child / desktop-mode entry failures
  stay inside the Desktop launch path; the Desktop runtime exits per its
  lifecycle (no hidden backend is left behind) and the next plain `dsh web`
  is unaffected.
- Other DSH plugins (e.g. `dsh-deepseek-quota`) have **no hard dependency**
  on DesktopShell: nothing injects a `desktopShell` service reference except
  the `desktop-app` coordinator itself, and DesktopShell has no quota /
  other-plugin awareness.
- Framework-level boundary: DSH/Cordis parses every installed bundle's
  metadata at profile boot. A malformed `package.json` / bundle patch breaks
  the whole profile boot — that is the plugin-loader layer's boundary, not
  something this bundle can or should repair.

## Window chrome (0.1.3 — Desktop Caption Safe Area)

The window hides the native title bar with Electron's **official Windows
mechanism**, keeps the **real DSH app icon**, and gives the DSH web content a
**dedicated safe area** below the caption:

```
BrowserWindow viewport
├── caption safe area (CAPTION_HEIGHT_PX = 32)
│   ├── draggable lane   — the whole caption strip (`-webkit-app-region: drag`)
│   └── native Windows controls (titleBarOverlay, OS-drawn: min/max/close)
└── DSH web content viewport — starts BELOW the caption (content inset)
```

- **Icon**: `icon: assets/icon-black.ico` → Windows taskbar, Alt+Tab and the
  running-window icon show the DSH mark. (0.1.1's transparent
  `icon-window.ico` workaround is removed and must not return — it broke the
  taskbar/Alt+Tab icon.)
- **Official mechanism**: `titleBarStyle: "hidden"` + `titleBarOverlay`
  (Window Controls Overlay): the native title bar (icon + title text) is not
  drawn at all, while native min / max / close buttons remain (OS-drawn,
  top-right). `titleBarOverlay.height` == `CAPTION_HEIGHT_PX` so the native
  strip and the caption lane always agree. No custom HTML title bar / buttons.
- **DSH content inset** (fixes the 0.1.2 overlap): injected CSS sets
  `body { padding-top: var(--dsh-desktop-caption-height) }` and
  `#root { height: calc(100vh - var(--dsh-desktop-caption-height)) }`, so the
  Windows controls and the DSH header (Session log, breadcrumb, future plugin
  utilities) never share the same physical area. The page's own background
  fills the caption strip, so it blends with light/dark themes. (The DSH
  frontend only uses `100vh` inside `max-height` rules and mounts into
  `#root` with `height:100%` chains — the reduced root height cannot overflow.)
- **Drag** (fixes the unusable 4px strip): the whole caption lane is the drag
  region (idempotent container-level element, `CAPTION_LANE_ID`). Native
  double-click maximize/restore comes from the platform drag behavior.
- **page title**: `page-title-updated` is prevented → the DSH page title
  (`"<session> — DeepSeek Harness"`) never becomes the window title; the
  static `title: "DeepSeek Harness"` is used for the Alt+Tab / taskbar label.
- **Reload-safe**: the caption CSS + lane are re-applied on every
  `did-finish-load` (initial load, Ctrl+R, renderer reload, inner navigation);
  the lane is idempotent and never duplicated.
- **Theme**: the caption background uses the page's CSS variables (auto light/
  dark); the native button symbols are matched via `setTitleBarOverlay` on
  load and by a low-frequency (2.5s) runtime sync when DSH switches themes
  without reloading.
- **Geometry single source of truth**: `lib/electron/chrome.js` exports
  `CAPTION_HEIGHT_PX` (32), which drives the overlay height, the drag lane
  height AND the content inset — they can never drift apart.
- Icon architecture (single source):
  `desktop shortcut IconLocation` = `icon-black.ico`,
  `BrowserWindow icon` = `icon-black.ico`,
  `Windows taskbar` = window icon (icon-black.ico),
  `Alt+Tab` = window icon (icon-black.ico).

## Runtime chain (Windows)

```
Desktop shortcut "DeepSeek Harness.lnk"
  → wscript.exe <pkg>\launch\launch-hidden.vbs   (hidden, exits immediately)
    → desktop-launch.cmd                          (hidden; preflight: patch exists,
       electron runtime ready, dsh on PATH — any failure logs + popup + exit 1)
      → dsh web --patch <pkg>\launch\desktop-app.patch.yml --port 0 --no-open
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
