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

// bundle_dmg.sh fallisce se restano immagini DMG montate orfane (/Volumes/dmg.*) da build
// precedenti interrotte. Le stacchiamo PRIMA di buildare. (Vedi memo "Tauri: dmg e mount orfani".)
function detachOrphanDmgMounts() {
  let out = "";
  try { out = execFileSync("bash", ["-lc", "ls -d /Volumes/dmg.* 2>/dev/null || true"], { encoding: "utf8" }); }
  catch { /* nessun mount */ }
  for (const vol of out.split("\n").map((s) => s.trim()).filter(Boolean)) {
    try { execFileSync("hdiutil", ["detach", vol, "-force"], { stdio: "inherit" }); console.log(`smontata immagine orfana: ${vol}`); }
    catch { /* già smontata */ }
  }
}

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

// bundle_dmg.sh (hdiutil) ogni tanto fallisce e LASCIA un'immagine montata orfana, facendo fallire
// anche il tentativo successivo finché non la si stacca. Quindi: stacca → build; se fallisce, stacca
// di nuovo (anche l'orfana appena creata) e riprova UNA volta.
detachOrphanDmgMounts();
try {
  run("pnpm", ["tauri", "build"]);
} catch {
  console.log("\nbuild fallita (probabile immagine DMG orfana): stacco e riprovo una volta…\n");
  detachOrphanDmgMounts();
  run("pnpm", ["tauri", "build"]);
}

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

// cancella i .dmg di versioni precedenti, tieni solo quello corrente.
// L'architettura nel nome del dmg dipende dalla macchina (aarch64 su Apple Silicon, x86_64 su
// Intel): NON la inchiodiamo, teniamo qualunque dmg che contenga la versione corrente.
if (existsSync(dmgDir)) {
  for (const f of readdirSync(dmgDir)) {
    if (f.endsWith(".dmg") && !f.includes(`_${version}_`)) {
      unlinkSync(join(dmgDir, f));
      console.log(`rimosso vecchio dmg: ${f}`);
    }
  }
}

console.log("\n=== apro l'app ===");
run("open", [dest]);
console.log(`\nFatto. ${PRODUCT} v${version} installata e aperta.`);
console.log("Ricorda: aggiorna docs/STATO.md e CHANGELOG.md.");
