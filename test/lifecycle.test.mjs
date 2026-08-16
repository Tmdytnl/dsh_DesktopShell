/**
 * dsh-desktop-shell — lifecycle tests (node:test, no framework).
 * Run: node test/lifecycle.test.mjs
 * Includes F1 (programmatic-close must not leak into the next child) and
 * F2 (new child starts with a clean close intent).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createDesktopShellService, mapExit } from "../lib/shell.js";
import { runDesktopApp } from "../lib/app.js";
import { classifyNavigation, openExternalSafe } from "../lib/electron/nav.js";

function mockCtx(overrides = {}) {
  const services = new Map();
  const disposers = [];
  const ctx = {
    webServer: { host: "127.0.0.1", port: 51966 },
    get(name) { return services.get(name); },
    set(name, value) { services.set(name, value); },
    effect(fn) { disposers.push(fn()); return () => {}; },
    disposers,
    logger: { info() {}, warn() {}, error() {} },
    ...overrides
  };
  return ctx;
}

function fakeChild() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

function exitSpy() {
  const spy = { calls: 0, codes: [] };
  spy.fn = (code) => { spy.calls++; spy.codes.push(code); };
  return spy;
}

const READY_LOADER = { await: async () => {} };

// ---------- T1: Loader failure is fail-closed ----------
test("T1 loader failure: desktopShell.open is never called, no appExit", async () => {
  let opened = 0;
  const shell = { open: async () => { opened++; return { code: 0, signal: null, reason: "user-close" }; } };
  const ctx = mockCtx();
  ctx.set("loader", { await: async () => { throw new Error("loader boom"); } });
  ctx.set("desktopShell", shell);
  const spy = exitSpy();
  await runDesktopApp(ctx, spy.fn);
  assert.equal(opened, 0, "open must not be called after loader failure");
  assert.equal(spy.calls, 0, "exit must not be called by desktop-app on loader failure");
});

// ---------- T2: user close → appExit(0) exactly once ----------
test("T2 user-close: ctx.appExit(0) exactly once", async () => {
  const shell = { open: async () => ({ code: 0, signal: null, reason: "user-close" }) };
  const ctx = mockCtx();
  ctx.set("loader", READY_LOADER);
  ctx.set("desktopShell", shell);
  const spy = exitSpy();
  await runDesktopApp(ctx, spy.fn);
  assert.equal(spy.calls, 1);
  assert.deepEqual(spy.codes, [0]);
});

// ---------- S4: programmatic close ≠ user-close, no appExit ----------
test("S4 programmatic-close: no appExit", async () => {
  const shell = { open: async () => ({ code: 0, signal: null, reason: "programmatic-close" }) };
  const ctx = mockCtx();
  ctx.set("loader", READY_LOADER);
  ctx.set("desktopShell", shell);
  const spy = exitSpy();
  await runDesktopApp(ctx, spy.fn);
  assert.equal(spy.calls, 0);
});

// ---------- N1: single-instance-rejected → appExit(0) exactly once ----------
test("N1 single-instance-rejected: redundant DSH runtime exits with appExit(0) once", async () => {
  const shell = { open: async () => ({ code: 30, signal: null, reason: "single-instance-rejected" }) };
  const ctx = mockCtx();
  ctx.set("loader", READY_LOADER);
  ctx.set("desktopShell", shell);
  const spy = exitSpy();
  await runDesktopApp(ctx, spy.fn);
  assert.equal(spy.calls, 1);
  assert.deepEqual(spy.codes, [0]);
});

// ---------- T4: launch / load failure → appExit(non-zero) ----------
test("T4a shell.open rejection (spawn/setup failure) → appExit(1)", async () => {
  const shell = { open: async () => { throw new Error("Electron runtime not prepared"); } };
  const ctx = mockCtx();
  ctx.set("loader", READY_LOADER);
  ctx.set("desktopShell", shell);
  const spy = exitSpy();
  await runDesktopApp(ctx, spy.fn);
  assert.equal(spy.calls, 1);
  assert.equal(spy.codes[0], 1);
});

test("T4b load-failed → appExit(10) (non-zero)", async () => {
  const shell = { open: async () => ({ code: 10, signal: null, reason: "load-failed" }) };
  const ctx = mockCtx();
  ctx.set("loader", READY_LOADER);
  ctx.set("desktopShell", shell);
  const spy = exitSpy();
  await runDesktopApp(ctx, spy.fn);
  assert.equal(spy.calls, 1);
  assert.equal(spy.codes[0], 10);
});

test("abnormal child exit (signal) → appExit(non-zero)", async () => {
  const shell = { open: async () => ({ code: 1, signal: "SIGTERM", reason: "abnormal-exit" }) };
  const ctx = mockCtx();
  ctx.set("loader", READY_LOADER);
  ctx.set("desktopShell", shell);
  const spy = exitSpy();
  await runDesktopApp(ctx, spy.fn);
  assert.equal(spy.calls, 1);
  assert.equal(spy.codes[0], 1);
});

// ---------- T3 / S3: dispose marks, kills and AWAITS child exit; no double appExit ----------
test("T3 dispose: awaits child exit, resolves open() as disposed, no appExit", async () => {
  const child = fakeChild();
  const ctx = mockCtx();
  const shell = createDesktopShellService(ctx, {
    spawn: () => child,
    electronMain: "main.js",
    resolveElectronBinary: () => "C:\\fake\\electron.exe",
    disposeTimeoutMs: 1000
  });
  ctx.set("desktopShell", shell);

  const opened = shell.open();
  let openedReason = null;
  void opened.then((outcome) => { openedReason = outcome.reason; });

  const disposer = ctx.disposers[0];
  let disposeSettled = false;
  const disposePromise = disposer();
  void disposePromise.then(() => { disposeSettled = true; });

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(disposeSettled, false, "disposer must NOT settle before the child exits");
  assert.equal(child.killed, true, "dispose must request child exit");

  child.emit("exit", 0, null);
  await disposePromise;
  assert.equal(disposeSettled, true, "disposer settles after child exit");
  await opened;
  assert.equal(openedReason, "disposed");

  // desktop-app with this (disposed) shell → no appExit
  const spy = exitSpy();
  const ctx2 = mockCtx();
  ctx2.set("loader", READY_LOADER);
  ctx2.set("desktopShell", shell);
  await runDesktopApp(ctx2, spy.fn);
  assert.equal(spy.calls, 0);
});

test("dispose timeout bounds the wait when the child never exits", async () => {
  const child = fakeChild();
  const ctx = mockCtx();
  const shell = createDesktopShellService(ctx, {
    spawn: () => child,
    electronMain: "main.js",
    resolveElectronBinary: () => "C:\\fake\\electron.exe",
    disposeTimeoutMs: 150
  });
  void shell.open();
  const disposer = ctx.disposers[0];
  const started = Date.now();
  await disposer(); // child never emits exit → bounded by timeout
  assert.ok(Date.now() - started < 2000, "dispose must be bounded");
});

// ---------- N2/N3/N4: dispose is fast once the child is already gone ----------
function fastDisposeProbe(childEvents) {
  const child = fakeChild();
  const ctx = mockCtx();
  const shell = createDesktopShellService(ctx, {
    spawn: () => child,
    electronMain: "main.js",
    resolveElectronBinary: () => "C:\\fake\\electron.exe",
    disposeTimeoutMs: 3000
  });
  const opened = shell.open();
  for (const ev of childEvents) child.emit(...ev);
  return opened.then(async () => {
    const disposer = ctx.disposers[0];
    const started = Date.now();
    await disposer();
    return Date.now() - started;
  });
}

test("N2 child already exited (user-close) → dispose completes fast (<500ms)", async () => {
  const elapsed = await fastDisposeProbe([["exit", 0, null]]);
  assert.ok(elapsed < 500, `dispose took ${elapsed}ms; must not wait the 3s timeout`);
});

test("N3 child already signal-exited → dispose completes fast (<500ms)", async () => {
  const elapsed = await fastDisposeProbe([["exit", null, "SIGTERM"]]);
  assert.ok(elapsed < 500, `dispose took ${elapsed}ms; must not wait the 3s timeout`);
});

test("N4 spawn-failure already happened → dispose completes fast (<500ms)", async () => {
  const elapsed = await fastDisposeProbe([["error", new Error("ENOENT")]]);
  assert.ok(elapsed < 500, `dispose took ${elapsed}ms; must not wait the 3s timeout`);
});

// ---------- F1/F2: programmatic-close is PER-CHILD, never leaks forward ----------
function childFactory(count) {
  const children = Array.from({ length: count }, () => fakeChild());
  let next = 0;
  return { children, spawn: () => children[next++] };
}

test("F1 programmatic close does not leak into next child", async () => {
  const { children, spawn } = childFactory(2);
  const ctx = mockCtx();
  const shell = createDesktopShellService(ctx, {
    spawn,
    electronMain: "main.js",
    resolveElectronBinary: () => "C:\\fake\\electron.exe",
    disposeTimeoutMs: 3000
  });
  // child A: desktopShell.close() → programmatic-close
  const a = shell.open();
  shell.close();
  children[0].emit("exit", 0, null);
  const outcomeA = await a;
  assert.equal(outcomeA.reason, "programmatic-close");

  // child B: plain user close → MUST be user-close, never programmatic-close
  const b = shell.open();
  children[1].emit("exit", 0, null);
  const outcomeB = await b;
  assert.equal(outcomeB.reason, "user-close", "programmatic-close must not leak into child B");
});

test("F2 new child starts with clean close intent (_closing reset)", async () => {
  const { children, spawn } = childFactory(2);
  const ctx = mockCtx();
  const shell = createDesktopShellService(ctx, {
    spawn,
    electronMain: "main.js",
    resolveElectronBinary: () => "C:\\fake\\electron.exe",
    disposeTimeoutMs: 3000
  });
  const a = shell.open();
  shell.close();
  children[0].emit("exit", 0, null);
  await a;
  assert.equal(shell._closing, false, "close intent must be reset when child A's lifecycle ends");

  const b = shell.open();
  assert.equal(shell._closing, false, "child B must not inherit A's close intent");
  children[1].emit("exit", 0, null);
  const outcomeB = await b;
  assert.equal(outcomeB.reason, "user-close");
});

// ---------- N5: runtime resolution uses Node module resolution (hoisted-style) ----------
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { resolveElectronPackage, resolveElectronBinary } from "../lib/electron/resolve.js";

function makeFakeElectronTree() {
  const base = mkdtempSync(join(tmpdir(), "dsh-eh-test-"));
  const pkg = join(base, "node_modules", "electron");
  mkdirSync(join(pkg, "dist"), { recursive: true });
  writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "electron", version: "43.4.0" }));
  writeFileSync(join(pkg, "path.txt"), "electron.exe");
  writeFileSync(join(pkg, "dist", "electron.exe"), ""); // existence check only
  return { base, pkg };
}

test("N5 resolveElectronBinary finds a hoisted-style electron via Node resolution", () => {
  const { base, pkg } = makeFakeElectronTree();
  const requireFrom = createRequire(join(base, "probe.js"));
  assert.equal(resolveElectronPackage(requireFrom), pkg);
  assert.equal(resolveElectronBinary(requireFrom), join(pkg, "dist", "electron.exe"));
});

test("N5 missing electron package → clear error", () => {
  const base = mkdtempSync(join(tmpdir(), "dsh-eh-missing-"));
  const requireFrom = createRequire(join(base, "probe.js"));
  assert.throws(() => resolveElectronPackage(requireFrom), /electron package is not installed/);
});

// ---------- reason mapping (shell) ----------
test("mapExit reason granularity", () => {
  assert.equal(mapExit(0, null, false, false).reason, "user-close");
  assert.equal(mapExit(10, null, false, false).reason, "load-failed");
  assert.equal(mapExit(20, null, false, false).reason, "invalid-url");
  assert.equal(mapExit(30, null, false, false).reason, "single-instance-rejected");
  assert.equal(mapExit(1, "SIGTERM", false, false).reason, "abnormal-exit");
  assert.equal(mapExit(1, null, false, false).reason, "crashed");
  assert.equal(mapExit(0, null, false, true).reason, "programmatic-close");
  assert.equal(mapExit(0, null, true, false).reason, "disposed");
  assert.equal(mapExit(null, null, false, false).reason, "crashed", "null code must not be treated as success");
});

test("spawn error event → spawn-failed", async () => {
  const child = fakeChild();
  const ctx = mockCtx();
  const shell = createDesktopShellService(ctx, {
    spawn: () => child,
    electronMain: "main.js",
    resolveElectronBinary: () => "C:\\fake\\electron.exe"
  });
  const opened = shell.open();
  child.emit("error", new Error("ENOENT"));
  const outcome = await opened;
  assert.equal(outcome.reason, "spawn-failed");
  assert.equal(outcome.code, 1);
});

test("binary resolution failure rejects with a clear setup error", async () => {
  const ctx = mockCtx();
  const shell = createDesktopShellService(ctx, {
    spawn: () => { throw new Error("must not spawn"); },
    electronMain: "main.js",
    resolveElectronBinary: () => { throw new Error("Electron runtime not prepared: ... run scripts/ensure-electron-runtime.cmd"); }
  });
  await assert.rejects(shell.open(), /ensure-electron-runtime/);
});

// ---------- S5: navigation boundary (decision logic) ----------
test("S5 navigation boundary", () => {
  const origin = "http://127.0.0.1:51966";
  assert.equal(classifyNavigation("http://127.0.0.1:51966/settings", origin).action, "allow");
  assert.equal(classifyNavigation("http://127.0.0.1:51966", origin).action, "allow");
  assert.equal(classifyNavigation("https://example.com", origin).action, "open-external");
  assert.equal(classifyNavigation("http://example.com/x", origin).action, "open-external");
  assert.equal(classifyNavigation("javascript:alert(1)", origin).action, "deny");
  assert.equal(classifyNavigation("file:///C:/x", origin).action, "deny");
  assert.equal(classifyNavigation("data:text/html,x", origin).action, "deny");
  assert.equal(classifyNavigation("shell:open", origin).action, "deny");
  assert.equal(classifyNavigation("not a url", origin).action, "deny");

  let opened = null;
  assert.equal(openExternalSafe("https://example.com", (h) => { opened = h; }), true);
  assert.equal(opened, "https://example.com/"); // URL normalization adds the trailing slash
  assert.equal(openExternalSafe("http://example.com", (h) => { opened = h; }), true);
  assert.equal(openExternalSafe("javascript:alert(1)", () => { throw new Error("must not open"); }), false);
  assert.equal(openExternalSafe("file:///C:/x", () => { throw new Error("must not open"); }), false);
  assert.equal(openExternalSafe("data:text/html,x", () => { throw new Error("must not open"); }), false);
});
