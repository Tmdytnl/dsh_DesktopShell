/**
 * dsh-desktop-shell — Desktop setup (Productization v1, v0.1.5).
 *
 * Development-stage setup only (NO installer: no MSI/NSIS/Squirrel).
 * Strict order — a failure at any step terminates BEFORE a shortcut is
 * created or modified:
 *   0. --help  → print usage, exit 0, ZERO side effects
 *   1. parse args (--workspace value | --workspace=value, --profile ...)
 *   2. resolve workspace with precedence
 *      CLI --workspace  >  DSH_DESKTOP_WORKSPACE  >  default
 *   3. REJECT any non-web profile (desktop mode is currently web-only)
 *   4. VALIDATE the workspace is an existing directory
 *   5. verify the dsh CLI resolves through PATH
 *   6. verify the bundle is installed in the active profile
 *   7. prepare (idempotent) the Electron runtime
 *   8. verify the icon asset
 *   9. create/UPDATE the user-desktop shortcut "DeepSeek Harness.lnk"
 *
 * The shortcut is the ONLY owner of the working directory (workspace):
 *   Target        = wscript.exe "<pkgRoot>\launch\launch-hidden.vbs"
 *   WorkingDir    = resolved workspace
 *   IconLocation  = <pkgRoot>\assets\icon.ico
 *   Description   = "DeepSeek Harness Desktop"
 *
 * Idempotent: re-running updates the same shortcut; nothing duplicates.
 *
 * Usage:
 *   node scripts/install-desktop.mjs
 *   node scripts/install-desktop.mjs --workspace "<workspace-dir>"
 *   node scripts/install-desktop.mjs --workspace="<workspace-dir>"
 *   node scripts/install-desktop.mjs --profile web / --profile=web
 *   node scripts/install-desktop.mjs --help
 */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs, requireDirectory, assertSupportedProfile, HELP_TEXT } from "./setup-args.mjs";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(THIS_DIR, "..");
const DEFAULT_WORKSPACE = "D:\\AI\\Harness\\Daily"; // current daily DSH workspace

function fail(message) {
  console.error(`dsh-desktop-shell: install-desktop FAIL: ${message}`);
  process.exit(1);
}
function ok(message) {
  console.log(`dsh-desktop-shell: ${message}`);
}

// ---- 0. --help: print usage and exit 0 BEFORE any other processing ----
if (process.argv.slice(2).includes("--help")) {
  console.log(HELP_TEXT);
  process.exit(0);
}

// ---- 1+2. parse & resolve (CLI > env > default); unknown/missing -> throw ----
let resolved;
try {
  resolved = parseArgs(process.argv.slice(2), process.env, {
    workspace: DEFAULT_WORKSPACE,
    profile: "web"
  });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const { workspace, profile } = resolved;

// ---- 3. web-only profile guard (BEFORE any side effect) ----
try {
  assertSupportedProfile(profile);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

// ---- 4. workspace must exist and be a directory (BEFORE any shortcut work) ----
try {
  requireDirectory(workspace);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
ok(`workspace validated: ${workspace}`);

const userProfile = homedir();
const installedRoot = join(userProfile, ".dsh", "profiles", profile, "node_modules", "dsh-desktop-shell");
const desktop = join(userProfile, "Desktop");
const lnkPath = join(desktop, "DeepSeek Harness.lnk");
const wscript = join(process.env.WINDIR ?? "C:\\Windows", "System32", "wscript.exe");

// ---- 5. dsh CLI through PATH ----
const which = spawnSync("where.exe", ["dsh"], { stdio: "ignore" });
if (which.status !== 0) fail("dsh CLI not found in PATH (where dsh) — install the global @deepseek-ai/dsh first");

// ---- 6. bundle installed in the active profile ----
const patchPath = join(installedRoot, "launch", "desktop-app.patch.yml");
if (!existsSync(patchPath)) {
  fail(
    `bundle not installed in profile "${profile}" (missing ${patchPath}). ` +
    `Install once via the official CLI, e.g.: dsh plugin --profile ${profile} add link:<space-free junction path>`
  );
}
ok(`bundle installed at ${installedRoot}`);

// ---- 7. Electron runtime (idempotent: --prepare returns immediately when ready) ----
const ensure = join(PKG_ROOT, "scripts", "ensure-electron-runtime.mjs");
const prepared = spawnSync(process.execPath, [ensure, "--prepare"], { stdio: "inherit" });
if (prepared.status !== 0) fail("Electron runtime could not be prepared — see output above");

// ---- 8. icon asset ----
const iconPath = join(installedRoot, "assets", "icon.ico");
if (!existsSync(iconPath)) fail(`icon missing at ${iconPath} (run scripts/generate-icon.mjs once)`);
ok(`icon ready: ${iconPath}`);

// ---- 9. shortcut (idempotent overwrite of the same .lnk; only reached on success) ----
const vbsPath = join(installedRoot, "launch", "launch-hidden.vbs");
if (!existsSync(vbsPath)) fail(`hidden launcher missing at ${vbsPath}`);
if (!existsSync(desktop)) fail(`user Desktop folder missing: ${desktop}`);
const shortcutArgs = [
  join(THIS_DIR, "create-shortcut.vbs"),
  lnkPath,
  wscript,
  vbsPath, // RAW path: create-shortcut.vbs adds the surrounding quotes itself
  workspace,
  iconPath,
  "DeepSeek Harness Desktop"
];
const made = spawnSync(wscript, shortcutArgs, { stdio: "inherit" });
if (made.status !== 0) fail(`shortcut creation failed (wscript exit ${made.status})`);

ok(`desktop shortcut ready: ${lnkPath}`);
ok(`  Target       = ${wscript} "${vbsPath}"`);
ok(`  WorkingDir   = ${workspace}`);
ok(`  IconLocation = ${iconPath}`);
ok(`done — double-click "DeepSeek Harness" on the desktop to launch (hidden bootstrap, no console)`);
