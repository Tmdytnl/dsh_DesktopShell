/**
 * dsh-desktop-shell — Desktop-vs-plain-DSH isolation tests (v0.1.1).
 * Run: node --test test/isolation.test.mjs
 *
 * These verify the FAILURE-ISOLATION contract without touching the live
 * profile: every test builds a throwaway DSH_HOME (junctions to the real
 * installation's flat fallback + installed plugins) with a `web` profile,
 * boots `dsh web` on it, and cleans up afterwards.
 *
 * Contract under test:
 *   - I1  plain `dsh web` boots; Desktop rows stay disabled; no Electron child;
 *         the peer quota plugin still activates
 *   - I7  a corrupted DISABLED desktop entry (lib/shell.js) does NOT break
 *         plain `dsh web` (disabled rows are lazy / isolated)
 *   - I8  a malformed bundle patch (cordis.patch.yml) is a DSH/Cordis
 *         loader-level hard boundary: profile boot fails — this is the
 *         documented framework boundary, not something this bundle repairs
 *
 * Unit-level Desktop failure paths (loader fail-closed, appExit decisions,
 * Electron-open rejection) are covered by lifecycle.test.mjs (T1/T4a/T4b).
 *
 * Environment prerequisites (checked; the suite SKIPs cleanly when absent):
 *   - the `dsh` CLI on PATH
 *   - the real DSH home's flat fallback dir ($DSH_HOME/profiles/node_modules)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, existsSync, readFileSync, openSync, closeSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_HOME = join(homedir(), ".dsh");
const REAL_FLAT_FALLBACK = join(DEFAULT_HOME, "profiles", "node_modules");
const REAL_WEB_PROFILE = join(DEFAULT_HOME, "profiles", "web");
const REAL_QUOTA = join(REAL_WEB_PROFILE, "node_modules", "dsh-deepseek-quota");

/** Resolve the real dsh CLI entry (node bin) through PATH via `where`. */
function resolveDshCli() {
  const out = join(tmpdir(), `dsh-iso-where-${process.pid}.txt`);
  const fd = openSync(out, "w");
  try {
    const r = spawnSync("where.exe", ["dsh"], { stdio: ["ignore", fd, "ignore"] });
    if (r.status !== 0) return null;
  } finally {
    closeSync(fd);
  }
  const lines = readFileSync(out, "utf8").split(/\r?\n/).filter(Boolean);
  rmSync(out, { force: true });
  const cmd = lines.find((l) => /\.cmd$/i.test(l)) ?? lines[0];
  if (!cmd) return null;
  // the .cmd shim forwards to node <npm-root>\node_modules\@deepseek-ai\dsh\lib\bin.js
  const bin = join(dirname(cmd), "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  return existsSync(bin) ? bin : null;
}

const dshBin = resolveDshCli();
const dshCli = dshBin !== null ? process.execPath : null;
const dshCliArgs = (args) => dshBin !== null ? [dshBin, ...args] : args;

const preconditions = {
  dshCli: dshCli !== null,
  flatFallback: existsSync(REAL_FLAT_FALLBACK)
};

function junktion(target, link) {
  const r = spawnSync("cmd", ["/c", "mklink", "/J", link, target], { stdio: "ignore" });
  if (r.status !== 0) throw new Error(`could not junction ${link} -> ${target}`);
}

/** Stop a booted dsh web child and WAIT for its exit (junctions must be
 *  releasable before the temp home can be removed). */
function stopChild(child, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    if (child === null || child.exitCode !== null) return finish();
    child.once("exit", finish);
    try { child.kill(); } catch { /* already gone */ }
    setTimeout(finish, timeoutMs).unref();
  });
}

/** Remove the temp home; junction handles can lag the child exit — retry. */
async function removeHome(home) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      return;
    } catch (error) {
      if (error.code !== "EPERM" && error.code !== "EBUSY") throw error;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

/** Build one throwaway DSH_HOME with a `web` profile. `desktopShellDir` is
 *  junctioned into the profile's node_modules as dsh-desktop-shell (a
 *  worktree/copy for the fault-injection cases). */
function makeHome({ desktopShellDir = PKG_ROOT, withQuota = true } = {}) {
  const home = mkdtempSync(join(tmpdir(), "dsh-iso-"));
  const profileDir = join(home, "profiles", "web");
  mkdirSync(join(profileDir, "node_modules"), { recursive: true });
  if (preconditions.flatFallback) {
    junktion(REAL_FLAT_FALLBACK, join(home, "profiles", "node_modules"));
  }
  junktion(desktopShellDir, join(profileDir, "node_modules", "dsh-desktop-shell"));
  if (withQuota && existsSync(REAL_QUOTA)) {
    junktion(REAL_QUOTA, join(profileDir, "node_modules", "dsh-deepseek-quota"));
  }
  const manifest = {
    name: "dsh-profile-isotest-web",
    private: true,
    dependencies: {
      ...(withQuota && existsSync(REAL_QUOTA) ? { "dsh-deepseek-quota": "^0.4.0" } : {}),
      "dsh-desktop-shell": "link:__desktop_shell__"
    },
    dsh: {
      profile: {
        bundles: [
          "@deepseek-ai/dsh-base",
          "@deepseek-ai/dsh-web-app",
          ...(withQuota && existsSync(REAL_QUOTA) ? ["dsh-deepseek-quota"] : []),
          "dsh-desktop-shell"
        ]
      }
    }
  };
  writeFileSync(join(profileDir, "package.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(profileDir, "cordis.yml"), "[]\n");
  writeFileSync(join(profileDir, "cordis.patch.yml"), "[]\n");
  writeFileSync(join(profileDir, "pnpm-workspace.yaml"), "packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\n");
  return {
    home,
    profileDir,
    async cleanup() { await removeHome(home); }
  };
}

/** Copy the current package into a fresh dir (for fault injection). */
function copyPackage() {
  const dest = mkdtempSync(join(tmpdir(), "dsh-pkg-"));
  cpSync(PKG_ROOT, dest, {
    recursive: true,
    filter: (src) => !src.includes(`${sep}node_modules`) && !src.includes(`${sep}.git`)
  });
  return dest;
}

function runDsh(args, home, { timeoutMs = 60000 } = {}) {
  // stdio pipes are blocked in confined environments — capture via files
  const outFd = openSync(join(home, "run.out"), "w");
  const errFd = openSync(join(home, "run.err"), "w");
  try {
    const r = spawnSync(dshCli, dshCliArgs(args), {
      cwd: home,
      env: { ...process.env, DSH_HOME: home },
      timeout: timeoutMs,
      stdio: ["ignore", outFd, errFd]
    });
    const out = readFileSync(join(home, "run.out"), "utf8");
    const err = readFileSync(join(home, "run.err"), "utf8");
    return { status: r.status, stdout: out, stderr: err };
  } finally {
    closeSync(outFd);
    closeSync(errFd);
  }
}

/** Boot `dsh web` on the temp home; resolves with the child on HTTP 200. */
function bootWeb(home, port, { timeoutMs = 150000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(dshCli, dshCliArgs(["web", "--host", "127.0.0.1", `--port=${port}`]), {
      cwd: home,
      env: { ...process.env, DSH_HOME: home },
      stdio: "ignore",
      windowsHide: true
    });
    const started = Date.now();
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      if (err) {
        try { child.kill(); } catch { /* gone */ }
        reject(err);
      } else {
        resolve(value);
      }
    };
    const timer = setInterval(() => {
      http.get(`http://127.0.0.1:${port}/`, (res) => {
        if (res.statusCode === 200) finish(null, child);
        else res.resume();
      }).on("error", () => { /* not up yet */ });
      if (Date.now() - started > timeoutMs) {
        finish(new Error(`dsh web did not answer on :${port} within ${timeoutMs}ms`));
      }
    }, 1500);
    child.on("exit", (code) => {
      finish(new Error(`dsh web exited early (code=${code}) before answering on :${port}`));
    });
  });
}

/** Count running electron.exe processes (via tasklist -> file, no pipes). */
function countElectron() {
  const out = join(tmpdir(), `dsh-iso-tasklist-${process.pid}.txt`);
  const fd = openSync(out, "w");
  try {
    spawnSync("tasklist", ["/FI", "IMAGENAME eq electron.exe", "/FO", "CSV", "/NH"], { stdio: ["ignore", fd, "ignore"] });
  } finally {
    closeSync(fd);
  }
  const text = readFileSync(out, "utf8");
  rmSync(out, { force: true });
  return text.split(/\r?\n/).filter((l) => l.includes("electron.exe")).length;
}

/** Compose the tree and assert the Desktop rows are present AND disabled. */
function assertDesktopDisabled(home) {
  const r = runDsh(["web", "--dump-config"], home);
  const out = `${r.stdout}\n${r.stderr}`;
  assert.match(out, /id: desktop-shell[\s\S]*?disabled: true/, "desktop-shell must be disabled in the composed tree");
  assert.match(out, /id: desktop-app[\s\S]*?disabled: true/, "desktop-app must be disabled in the composed tree");
}

const T = (name, fn, opts = {}) => test(name, {
  ...opts,
  skip: !preconditions.dshCli || !preconditions.flatFallback
    ? "dsh CLI or flat fallback missing — isolation boot tests skipped"
    : false
}, fn);

// ---------------------------------------------------------------------------
// I1: plain `dsh web` — Desktop rows disabled, no Electron, web UI + quota
// ---------------------------------------------------------------------------
T("I1 plain dsh web: Desktop rows disabled, no Electron child, web + quota serve", async () => {
  const env = makeHome();
  try {
    assertDesktopDisabled(env.home);
    const before = countElectron();
    const child = await bootWeb(env.home, 39171, { timeoutMs: 180000 });
    try {
      assert.equal(countElectron(), before, "plain dsh web must not spawn any Electron child");
      // quota route registered by the peer plugin: 200 or 503 (no credentials
      // in the throwaway home) — anything but 404 proves the plugin activated
      const quota = await new Promise((resolve, reject) => {
        http.get({ host: "127.0.0.1", port: 39171, path: "/api/deepseek-balance" }, (res) => {
          res.resume();
          resolve(res.statusCode);
        }).on("error", reject);
      });
      assert.ok(quota !== 404, `quota endpoint must be registered (got ${quota})`);
    } finally {
      await stopChild(child);
    }
  } finally {
    await env.cleanup();
  }
});

// ---------------------------------------------------------------------------
// I7: corrupted DISABLED desktop entry must not break plain `dsh web`
// ---------------------------------------------------------------------------
T("I7 corrupted disabled lib/shell.js: plain dsh web still boots", async () => {
  const pkg = copyPackage();
  try {
    // destroy the disabled host entry — a plain dsh web must never load it
    writeFileSync(join(pkg, "lib", "shell.js"), "export const broken = ( => { syntax error !!!");
    const env = makeHome({ desktopShellDir: pkg });
    try {
      const before = countElectron();
      const child = await bootWeb(env.home, 39172, { timeoutMs: 180000 });
      try {
        assert.equal(countElectron(), before, "no Electron child after boot");
      } finally {
        await stopChild(child);
      }
    } finally {
      await env.cleanup();
    }
  } finally {
    rmSync(pkg, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// I8: malformed bundle patch — DSH/Cordis loader hard boundary (documented)
// ---------------------------------------------------------------------------
T("I8 malformed bundle patch: profile boot fails (documented loader boundary)", async () => {
  const pkg = copyPackage();
  try {
    writeFileSync(join(pkg, "cordis.patch.yml"), "- insert: [unclosed yaml [ !!!");
    const env = makeHome({ desktopShellDir: pkg });
    try {
      const r = runDsh(["web", "--dump-config"], env.home);
      assert.notEqual(r.status, 0, "malformed bundle patch must fail profile boot (loader hard boundary)");
    } finally {
      await env.cleanup();
    }
  } finally {
    rmSync(pkg, { recursive: true, force: true });
  }
});
