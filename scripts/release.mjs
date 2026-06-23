// Release di Kidotel Radar (macOS).
// Workflow (requisito committente): [bump versione] -> build -> firma ad-hoc ->
// installa la NUOVA in /Applications -> cancella la PRECEDENTE (app + .dmg vecchi) -> apri.
//
// Uso:
//   node scripts/release.mjs            # build+installa la versione corrente
//   node scripts/release.mjs 0.3.0      # aggiorna la versione ovunque, poi build+installa
//
// Nota: il .dmg viene creato in src-tauri/target/release/bundle/dmg/.
// L'.exe Windows NON si genera da macOS (serve CI/Windows) — vedi docs/ROADMAP.md.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync, cpSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCT = "Kidotel Radar";
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", cwd: ROOT, ...opts });

function setVersion(v) {
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`Versione non valida: ${v}`);
  const edits = [
    ["package.json", /("version":\s*)"\d+\.\d+\.\d+"/],
    ["src-tauri/tauri.conf.json", /("version":\s*)"\d+\.\d+\.\d+"/],
    ["src-tauri/Cargo.toml", /(^version\s*=\s*)"\d+\.\d+\.\d+"/m],
    ["src/version.ts", /(APP_VERSION\s*=\s*)"\d+\.\d+\.\d+"/],
  ];
  for (const [rel, re] of edits) {
    const p = join(ROOT, rel);
    const txt = readFileSync(p, "utf8");
    if (!re.test(txt)) throw new Error(`Pattern versione non trovato in ${rel}`);
    writeFileSync(p, txt.replace(re, `$1"${v}"`));
    console.log(`versione -> ${v} in ${rel}`);
  }
}

function currentVersion() {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
}

const arg = process.argv[2];
if (arg) setVersion(arg);
const version = currentVersion();
console.log(`\n=== Release ${PRODUCT} v${version} ===\n`);

run("pnpm", ["tauri", "build"]);

const appPath = join(ROOT, "src-tauri/target/release/bundle/macos", `${PRODUCT}.app`);
const dmgDir = join(ROOT, "src-tauri/target/release/bundle/dmg");
if (!existsSync(appPath)) throw new Error(`App non trovata: ${appPath}`);

console.log("\n=== firma ad-hoc ===");
run("codesign", ["--force", "--deep", "-s", "-", appPath]);
run("codesign", ["--verify", "--deep", "--strict", appPath]);

// installa in /Applications (fallback ~/Applications)
let dest = join("/Applications", `${PRODUCT}.app`);
try {
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(appPath, dest, { recursive: true });
} catch {
  const home = process.env.HOME;
  dest = join(home, "Applications", `${PRODUCT}.app`);
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(appPath, dest, { recursive: true });
}
try { run("xattr", ["-dr", "com.apple.quarantine", dest]); } catch { /* ignore */ }
console.log(`installata: ${dest}`);

// cancella i .dmg di versioni precedenti, tieni solo quello corrente
if (existsSync(dmgDir)) {
  const keep = `${PRODUCT}_${version}_aarch64.dmg`;
  for (const f of readdirSync(dmgDir)) {
    if (f.endsWith(".dmg") && f !== keep) {
      unlinkSync(join(dmgDir, f));
      console.log(`rimosso vecchio dmg: ${f}`);
    }
  }
}

console.log("\n=== apro l'app ===");
run("open", [dest]);
console.log(`\nFatto. ${PRODUCT} v${version} installata e aperta.`);
console.log("Ricorda: aggiorna docs/STATO.md e CHANGELOG.md.");
