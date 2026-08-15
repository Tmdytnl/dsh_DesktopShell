/**
 * dsh-desktop-shell — host half (row: desktop-shell).
 *
 * Pure host plugin. No dsh.client, no DOM/CSS/JS injection, no quota or
 * other-plugin awareness. Injects the real webServer, exposes a
 * `desktopShell` service that spawns an Electron window pointed at the LIVE
 * dsh web URL, and tracks the child's lifecycle with explicit exit reasons.
 *
 * Child lifecycle single source of truth: on `exit`/`error` the child handle
 * is CLEARED (`this.child = null`, `state = "closed"`). The Cordis disposer
 * therefore returns immediately when the child is already gone — it never
 * waits the 3s timeout for an event that already fired (signal-exit,
 * spawn-failure, user-close, crash).
 *
 * Close intent is PER-CHILD, not service-wide: `_closing` belongs to the
 * currently running Electron child only. The exit handler therefore computes
 * the outcome FIRST (reading `_closing` for that child), THEN clears the
 * lifecycle state, and `#clearChild()` / `#launch()` reset `_closing` so a
 * later child always starts from a clean close intent (programmatic-close
 * never leaks into the next child — see tests F1/F2). `_disposed` is never
 * reset: once the plugin is disposed, open() refuses to relaunch.
 *
 * Exit reasons (mapExit, aligned with Electron main exit codes):
 *   user-close, programmatic-close, disposed, spawn-failed, load-failed,
 *   invalid-url, single-instance-rejected, crashed / abnormal-exit.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveElectronBinary } from "./electron/resolve.js";

const name = "desktop-shell";
const inject = ["webServer"];

const ELECTRON_MAIN = fileURLToPath(new URL("./electron/main.js", import.meta.url));
/** Child shutdown grace. Kept well under the DSH root shutdown budget (5s). */
const DEFAULT_DISPOSE_TIMEOUT_MS = 3000;

/** Map a child (code, signal) plus our own intent into an explicit exit reason. */
export function mapExit(code, signal, disposed, closing) {
  if (disposed) return { code: code ?? 1, signal, reason: "disposed" };
  if (closing) return { code: code ?? 1, signal, reason: "programmatic-close" };
  if (signal !== null) return { code: code ?? 1, signal, reason: "abnormal-exit" };
  if (code === 0) return { code: 0, signal: null, reason: "user-close" };
  if (code === 30) return { code: 30, signal: null, reason: "single-instance-rejected" };
  if (code === 10) return { code: 10, signal: null, reason: "load-failed" };
  if (code === 20) return { code: 20, signal: null, reason: "invalid-url" };
  return { code: code ?? 1, signal: null, reason: "crashed" };
}

class DesktopShellService {
  constructor(ctx, deps) {
    this.ctx = ctx;
    this.deps = deps;
    this.state = "idle"; // idle | opening | open | closing | closed
    this.child = null; // single source of truth; null once exited/errored/never spawned
    this._pending = null;
    this._disposed = false;
    this._closing = false;
    ctx.effect(() => () => this.#disposeChild(), "desktop-shell");
  }

  /** The live DSH web URL (real webServer host/port; never hard-codes 3080). */
  url() {
    const server = this.ctx.webServer;
    return `http://${server.host}:${server.port}`;
  }

  /** Open the desktop window; resolves on child exit with { code, signal, reason }. */
  open() {
    if (this._disposed) return Promise.resolve({ code: 0, signal: null, reason: "disposed" });
    if (this._pending !== null) return this._pending;
    const promise = this.#launch().finally(() => {
      this._pending = null;
    });
    this._pending = promise;
    return promise;
  }

  async #launch() {
    if (this.state === "open") return { code: 0, signal: null, reason: "already-open" };
    this._closing = false; // every new child starts with a clean close intent (F2)
    this.state = "opening";
    const electronBinary = this.deps.resolveElectronBinary(); // throws a clear setup error if missing
    const url = this.url();
    const child = this.deps.spawn(electronBinary, [
      this.deps.electronMain,
      `--url=${url}`,
      `--parent-pid=${process.pid}`
    ], { stdio: "ignore" });
    this.child = child;
    this.state = "open";
    return await new Promise((resolve) => {
      child.once("error", (error) => {
        this.#clearChild();
        resolve({ code: 1, signal: null, reason: "spawn-failed", error });
      });
      child.once("exit", (code, signal) => {
        // Compute the outcome from THIS child's state FIRST, then clear —
        // clearing first would drop `_closing` and misclassify the exit.
        const outcome = mapExit(code, signal, this._disposed, this._closing);
        this.#clearChild();
        resolve(outcome);
      });
    });
  }

  /** Single source of truth: the child resource is finished. Close intent is
   *  per-child, so `_closing` resets with the child it belonged to (F1). */
  #clearChild() {
    this.child = null;
    this.state = "closed";
    this._closing = false;
  }

  /** Programmatic close of the window — does NOT imply shutting down DSH. */
  close() {
    this._closing = true;
    this.state = "closing";
    if (this.child !== null) {
      try { this.child.kill(); } catch { /* already gone */ }
    }
  }

  /** Cordis dispose: mark, request child exit, AWAIT it (bounded, fast when gone). */
  async #disposeChild() {
    this._disposed = true;
    const child = this.child;
    if (child === null) return; // already exited / spawn-failed / never spawned → nothing to wait for
    this.state = "closing";
    const exited = new Promise((resolve) => child.once("exit", resolve));
    try { child.kill(); } catch { /* already gone */ }
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, this.deps.disposeTimeoutMs))
    ]);
  }

  /** v0.1.1: no-op — second-instance focus is handled inside Electron main. */
  focus() { /* nothing */ }
}

/** Testable factory; the real apply() uses the production defaults. */
export function createDesktopShellService(ctx, deps = {}) {
  return new DesktopShellService(ctx, {
    spawn: deps.spawn ?? spawn,
    electronMain: deps.electronMain ?? ELECTRON_MAIN,
    resolveElectronBinary: deps.resolveElectronBinary ?? resolveElectronBinary,
    disposeTimeoutMs: deps.disposeTimeoutMs ?? DEFAULT_DISPOSE_TIMEOUT_MS
  });
}

function apply(ctx) {
  ctx.provide("desktopShell", createDesktopShellService(ctx));
}

export { apply, inject, name };
