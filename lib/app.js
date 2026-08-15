/**
 * dsh-desktop-shell — app-mode coordinator (row: desktop-app).
 *
 * Disabled by default; enabled per-launch by
 * `--patch <installed>/launch/desktop-app.patch.yml`.
 *
 * `apply` returns synchronously (so this entry's fiber can reach ACTIVE) and
 * the real work runs in a background task. `ctx.appExit` is read and
 * CONFIRMED in the synchronous apply phase (like the official headless
 * runner): a missing appExit is a launcher-contract violation and throws.
 *
 * Loader failure is FAIL-CLOSED: if the whole Loader cannot settle, the
 * desktop window is never opened and the DSH boot-failure/shutdown flow owns
 * process termination. Only a settled tree may open the window.
 */
const name = "desktop-app";
const inject = ["desktopShell"];

export async function runDesktopApp(ctx, exit) {
  // 1) Loader must settle before any window may open (fail-closed).
  try {
    await ctx.get("loader")?.await();
  } catch (error) {
    ctx.logger.error(
      `desktop-app: Loader failed to settle (${error instanceof Error ? error.message : String(error)}); not opening the desktop window — DSH boot-failure flow owns the exit`
    );
    return;
  }
  // 2) Resolve the shell service (injected, but be defensive).
  const shell = ctx.get("desktopShell");
  if (shell === void 0) {
    ctx.logger.error("desktop-app: desktopShell service missing");
    exit(1);
    return;
  }
  // 3) Open the window. A rejection (e.g. Electron runtime not prepared) is an
  //    explicit failure → appExit(non-zero), never a hidden long download.
  let outcome;
  try {
    outcome = await shell.open();
  } catch (error) {
    ctx.logger.error(`desktop-app: Electron open failed: ${error instanceof Error ? error.message : String(error)}`);
    exit(1);
    return;
  }
  // 4) Decide the exit from the explicit reason — window capabilities do not
  //    automatically shut down DSH.
  if (outcome.reason === "disposed" || outcome.reason === "programmatic-close") return;
  if (outcome.reason === "single-instance-rejected") {
    // Another desktop instance (DSH A + Electron A) owns the single-instance
    // lock and keeps/focuses the UI. THIS DSH runtime has no UI ownership and
    // must not linger as a windowless backend — exit cleanly.
    ctx.logger.info("desktop-app: existing desktop instance owns the UI — exiting this redundant DSH runtime");
    exit(0);
    return;
  }
  if (outcome.reason === "user-close" && (outcome.code ?? 0) === 0) {
    ctx.logger.info("desktop-app: desktop window closed by user — requesting DSH exit (0)");
    exit(0);
    return;
  }
  // spawn-failed / load-failed / invalid-url / crashed / abnormal-exit
  const code = typeof outcome.code === "number" ? outcome.code : 1;
  ctx.logger.error(
    `desktop-app: Electron did not run cleanly (reason=${outcome.reason}, code=${code}, signal=${outcome.signal ?? "null"})`
  );
  exit(code === 0 ? 1 : code);
}

function apply(ctx) {
  const exit = ctx.get("appExit");
  if (exit === void 0) {
    throw new Error("desktop-app: the launcher must provide ctx.appExit before the tree mounts");
  }
  void runDesktopApp(ctx, exit);
}

export { apply, inject, name };
