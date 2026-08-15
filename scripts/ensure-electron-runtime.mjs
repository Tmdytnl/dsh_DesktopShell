/**
 * dsh-desktop-shell — ensure the Electron runtime is ready.
 *
 * Modes:
 *   --check    (default) verify only; exit 0 ready / exit 1 with a clear reason
 *   --prepare  attempt to materialize the runtime (ELECTRON_MIRROR supported);
 *              never runs during a normal dsh web startup
 *
 * Resolution uses the SAME Node-module-resolution rules as the runtime
 * (lib/electron/resolve.js) — hoisted installs are found correctly.
 */
import { join } from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolveElectronPackage, resolveElectronBinary } from "../lib/electron/resolve.js";

const DEFAULT_MIRROR = "https://npmmirror.com/mirrors/electron/";
const mode = process.argv[2] ?? "--check";

function ready() {
  const bin = resolveElectronBinary();
  console.log(`dsh-desktop-shell: electron runtime ready: ${bin}`);
  process.exit(0);
}

try {
  ready();
} catch (checkError) {
  if (mode !== "--prepare") {
    console.error(`dsh-desktop-shell: ${checkError.message}`);
    process.exit(1);
  }
}

// --prepare: materialize the runtime from the resolved electron package.
let dir;
try {
  dir = resolveElectronPackage();
} catch (error) {
  console.error(`dsh-desktop-shell: ${error.message} — run: pnpm install --dir <dsh-desktop-shell package>`);
  process.exit(1);
}
const installJs = join(dir, "install.js");
if (!existsSync(installJs)) {
  console.error(`dsh-desktop-shell: electron package present but install.js missing at ${installJs}`);
  process.exit(1);
}
console.log(`dsh-desktop-shell: downloading electron via ${process.env.ELECTRON_MIRROR ?? DEFAULT_MIRROR}`);
const result = spawnSync(process.execPath, [installJs], {
  stdio: "inherit",
  env: {
    ...process.env,
    ELECTRON_MIRROR: process.env.ELECTRON_MIRROR ?? DEFAULT_MIRROR
  }
});
if (result.status !== 0) {
  console.error("dsh-desktop-shell: electron download failed");
  process.exit(1);
}
try {
  ready();
} catch (error) {
  console.error(`dsh-desktop-shell: ${error.message}`);
  process.exit(1);
}
