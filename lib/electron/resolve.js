/**
 * dsh-desktop-shell — Electron runtime location (shared by runtime and setup).
 *
 * Single source of truth for resolving the Electron package/binary via REAL
 * Node module resolution (createRequire + require.resolve), never by
 * hard-coding a package-local node_modules path. This works for both the
 * development layout (plugin-local node_modules) and a hoisted install
 * (e.g. electron hoisted into the web profile's node_modules).
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Resolve the electron package directory through Node module resolution.
 * @param requireFrom - require to resolve with (tests inject a custom base).
 * @returns the electron package directory.
 * @throws when the electron package is not installed.
 */
export function resolveElectronPackage(requireFrom = createRequire(import.meta.url)) {
  let packageJsonPath;
  try {
    packageJsonPath = requireFrom.resolve("electron/package.json");
  } catch {
    throw new Error(
      "dsh-desktop-shell: electron package is not installed (resolve failed for electron/package.json)"
    );
  }
  return dirname(packageJsonPath);
}

/**
 * Resolve the electron binary (path.txt + dist/<bin>) and verify it exists.
 * @param requireFrom - require to resolve with (tests inject a custom base).
 * @returns the absolute path to the electron executable.
 * @throws "electron package is not installed" or "Electron runtime is not prepared".
 */
export function resolveElectronBinary(requireFrom = createRequire(import.meta.url)) {
  const dir = resolveElectronPackage(requireFrom);
  let pathTxt;
  try {
    pathTxt = readFileSync(join(dir, "path.txt"), "utf8").trim();
  } catch {
    throw new Error(
      `dsh-desktop-shell: Electron runtime is not prepared (${join(dir, "path.txt")} unreadable) — run scripts/ensure-electron-runtime.cmd --prepare`
    );
  }
  const bin = join(dir, "dist", pathTxt);
  if (!existsSync(bin)) {
    throw new Error(
      `dsh-desktop-shell: Electron runtime is not prepared: ${bin} missing — run scripts/ensure-electron-runtime.cmd --prepare`
    );
  }
  return bin;
}
