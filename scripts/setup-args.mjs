/**
 * dsh-desktop-shell — setup argument parsing & validation (v0.1.2).
 *
 * Shared by scripts/install-desktop.mjs (runtime) and test/setup.test.mjs
 * (unit tests). No side effects, no dependencies — deliberately no
 * Commander/Yargs.
 *
 * Supported forms for every option:
 *   --workspace "<workspace-dir>"          (space-separated value)
 *   --workspace="<workspace-dir>"          (equals form)
 *   --profile web / --profile=web
 *
 * Precedence (workspace):
 *   CLI --workspace  >  DSH_DESKTOP_WORKSPACE env  >  DEFAULT_WORKSPACE
 * Precedence (profile): CLI --profile > default "web".
 * Desktop mode currently supports ONLY the "web" profile; any other profile
 * must fail BEFORE any side effect (see assertSupportedProfile).
 * Unknown options and missing values fail loudly.
 */
import { statSync } from "node:fs";

export const KNOWN_OPTIONS = new Set(["--workspace", "--profile", "--help"]);

export const HELP_TEXT = `DeepSeek Harness — desktop setup (dsh-desktop-shell)

Usage:
  install-desktop.cmd [options]

Options:
  --workspace <dir>     Working directory for the desktop launch (must be an
                        existing directory; both forms are accepted):
                          --workspace "D:\\AI\\Harness\\Daily"
                          --workspace="D:\\AI\\Harness\\Daily"
  --profile <name>      DSH profile to target (only "web" is supported):
                          --profile web
                          --profile=web
  --help                Print this help and exit (no side effects).

Precedence:
  CLI --workspace  >  DSH_DESKTOP_WORKSPACE env  >  default (D:\\AI\\Harness\\Daily)

Notes:
  - Desktop mode currently supports ONLY the "web" profile.
  - The workspace MUST be an existing directory; validation happens before
    any shortcut creation/update.
  - Re-running is idempotent: the same "DeepSeek Harness.lnk" is updated,
    never duplicated.`;

/** Desktop mode is currently web-only: any other profile must fail loudly. */
export function assertSupportedProfile(profile) {
  if (profile !== "web") {
    throw new Error(
      `unsupported profile: ${profile}; desktop mode currently supports only "web"`
    );
  }
}

/** Read `--name value` or `--name=value`; throws when the value is missing. */
export function readOption(argv, name) {
  const exact = `--${name}`;
  const prefix = `${exact}=`;

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];

    if (value.startsWith(prefix)) {
      return value.slice(prefix.length);
    }

    if (value === exact) {
      const next = argv[i + 1];

      if (next === undefined || next.startsWith("--")) {
        throw new Error(`${exact} requires a value`);
      }

      return next;
    }
  }

  return undefined;
}

/** Fail loudly on typos like `--workspcae` instead of silently ignoring them. */
export function checkUnknown(argv, known = KNOWN_OPTIONS) {
  for (const entry of argv) {
    if (!entry.startsWith("--")) continue;
    const name = entry.split("=")[0];
    if (!known.has(name)) {
      throw new Error(`unknown option: ${name}`);
    }
  }
}

/**
 * Resolve { workspace, profile, cliWorkspace, cliProfile } with the documented
 * precedence. `env` is injectable for tests (defaults to process.env).
 */
export function parseArgs(argv, env = process.env, defaults = {}) {
  checkUnknown(argv);
  const cliWorkspace = readOption(argv, "workspace");
  const cliProfile = readOption(argv, "profile");
  const workspace = cliWorkspace ?? env.DSH_DESKTOP_WORKSPACE ?? defaults.workspace;
  const profile = cliProfile ?? defaults.profile;
  if (workspace === undefined) throw new Error("workspace could not be resolved");
  if (profile === undefined) throw new Error("profile could not be resolved");
  return { workspace, profile, cliWorkspace, cliProfile };
}

/** Fail unless `path` exists AND is a directory. */
export function requireDirectory(path, label = "workspace") {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    throw new Error(`${label} does not exist: ${path}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`${label} is not a directory: ${path}`);
  }
}
