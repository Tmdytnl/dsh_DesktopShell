/**
 * dsh-desktop-shell — setup/launcher layer unit tests (v0.1.4).
 * Run: node test/setup.test.mjs        (in-process, no Windows behavior)
 *
 * Kept SEPARATE from lifecycle.test.mjs on purpose: these test the pure
 * argument parser + workspace validation, not the frozen lifecycle.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  parseArgs, readOption, checkUnknown, requireDirectory,
  assertSupportedProfile, HELP_TEXT
} from "../scripts/setup-args.mjs";

const DEFAULTS = { workspace: "D:\\AI\\Harness\\Daily", profile: "web" };
const INSTALL_DESKTOP = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "install-desktop.mjs");
const NODE = process.execPath;

/** Run the real install-desktop entry with no captured output (status only). */
function runInstall(argv) {
  return spawnSync(NODE, [INSTALL_DESKTOP, ...argv], { stdio: "ignore" });
}

// ---------- L1/L2: workspace forms ----------
test("L1 --workspace=value (equals form)", () => {
  const r = parseArgs(["--workspace=D:\\AI\\Harness\\Daily"], {}, DEFAULTS);
  assert.equal(r.workspace, "D:\\AI\\Harness\\Daily");
  assert.equal(r.cliWorkspace, "D:\\AI\\Harness\\Daily");
});

test("L2 --workspace value (space-separated form)", () => {
  const r = parseArgs(["--workspace", "D:\\AI\\Harness\\Daily"], {}, DEFAULTS);
  assert.equal(r.workspace, "D:\\AI\\Harness\\Daily");
});

// ---------- L3/L4: profile forms ----------
test("L3 --profile=value (equals form)", () => {
  const r = parseArgs(["--profile=web"], {}, DEFAULTS);
  assert.equal(r.profile, "web");
});

test("L4 --profile value (space-separated form)", () => {
  const r = parseArgs(["--profile", "web"], {}, DEFAULTS);
  assert.equal(r.profile, "web");
});

// ---------- L5: missing value fails ----------
test("L5 --workspace without value fails loudly", () => {
  assert.throws(() => parseArgs(["--workspace"], {}, DEFAULTS), /--workspace requires a value/);
  assert.throws(() => parseArgs(["--profile"], {}, DEFAULTS), /--profile requires a value/);
  assert.throws(() => parseArgs(["--workspace", "--profile", "web"], {}, DEFAULTS), /--workspace requires a value/);
});

// ---------- L6: invalid (nonexistent) workspace fails ----------
test("L6 workspace that does not exist fails", () => {
  const missing = join(tmpdir(), "dsh-setup-missing-" + Date.now());
  assert.throws(() => requireDirectory(missing), new RegExp(`does not exist: ${missing.replace(/\\/g, "\\\\")}`));
});

// ---------- L7: workspace is a file fails ----------
test("L7 workspace that is a file fails", () => {
  const base = mkdtempSync(join(tmpdir(), "dsh-setup-file-"));
  try {
    const file = join(base, "temp-workspace.txt");
    writeFileSync(file, "not a directory");
    assert.throws(() => requireDirectory(file), /is not a directory/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ---------- L8: CLI overrides env ----------
test("L8 CLI --workspace overrides DSH_DESKTOP_WORKSPACE", () => {
  const r = parseArgs(["--workspace", "D:\\CLI\\Wins"], { DSH_DESKTOP_WORKSPACE: "D:\\ENV\\Loses" }, DEFAULTS);
  assert.equal(r.workspace, "D:\\CLI\\Wins");
  assert.equal(r.cliWorkspace, "D:\\CLI\\Wins");
});

test("L8b env applies when no CLI workspace is given", () => {
  const r = parseArgs([], { DSH_DESKTOP_WORKSPACE: "D:\\ENV\\Used" }, DEFAULTS);
  assert.equal(r.workspace, "D:\\ENV\\Used");
  assert.equal(r.cliWorkspace, undefined);
});

test("L8c default applies when neither CLI nor env is present", () => {
  const r = parseArgs([], {}, DEFAULTS);
  assert.equal(r.workspace, "D:\\AI\\Harness\\Daily");
});

// ---------- L9: path with spaces survives intact ----------
test("L9 workspace path with spaces is not split", () => {
  const r = parseArgs(["--workspace", "D:\\AI\\Harness\\Workspace Test"], {}, DEFAULTS);
  assert.equal(r.workspace, "D:\\AI\\Harness\\Workspace Test");
  const r2 = parseArgs(["--workspace=D:\\AI\\Harness\\Workspace Test"], {}, DEFAULTS);
  assert.equal(r2.workspace, "D:\\AI\\Harness\\Workspace Test");
});

// ---------- extras: unknown option + profile precedence ----------
test("unknown option fails loudly (typo protection)", () => {
  assert.throws(() => parseArgs(["--workspcae", "D:\\AI"], {}, DEFAULTS), /unknown option: --workspcae/);
});

test("profile defaults to web when not provided", () => {
  const r = parseArgs([], {}, DEFAULTS);
  assert.equal(r.profile, "web");
});

test("readOption returns undefined when absent", () => {
  assert.equal(readOption(["--profile", "web"], "workspace"), undefined);
});

// ---------- T1: non-web profile must fail BEFORE any side effect ----------
test("T1 assertSupportedProfile rejects non-web profiles", () => {
  assert.throws(
    () => assertSupportedProfile("foo"),
    /unsupported profile: foo; desktop mode currently supports only "web"/
  );
  assert.throws(() => assertSupportedProfile("dev"), /supports only "web"/);
  assert.doesNotThrow(() => assertSupportedProfile("web"));
});

test("T1b real install-desktop --profile foo exits non-zero (guard runs first)", () => {
  const r = runInstall(["--profile", "foo"]);
  assert.notEqual(r.status, 0, "non-web profile must exit non-zero");
});

test("T1c real install-desktop --profile=foo (equals form) also exits non-zero", () => {
  const r = runInstall(["--profile=foo"]);
  assert.notEqual(r.status, 0);
});

// ---------- T2: --help prints usage and exits 0 with zero side effects ----------
test("T2 HELP_TEXT covers usage, precedence, web-only and workspace notes", () => {
  assert.match(HELP_TEXT, /Usage:/);
  assert.match(HELP_TEXT, /--workspace <dir>/);
  assert.match(HELP_TEXT, /--workspace="D:\\AI\\Harness\\Daily"/);
  assert.match(HELP_TEXT, /--workspace "D:\\AI\\Harness\\Daily"/);
  assert.match(HELP_TEXT, /--profile web/);
  assert.match(HELP_TEXT, /--profile=web/);
  assert.match(HELP_TEXT, /--help/);
  assert.match(HELP_TEXT, /CLI --workspace\s+>\s+DSH_DESKTOP_WORKSPACE env\s+>\s+default/);
  assert.match(HELP_TEXT, /supports ONLY the "web" profile/);
  assert.match(HELP_TEXT, /MUST be an existing directory/);
});

test("T2b real install-desktop --help exits 0 (no side effects)", () => {
  const r = runInstall(["--help"]);
  assert.equal(r.status, 0, "--help must exit 0");
});
