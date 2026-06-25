// Release di Kidotel Radar (macOS).
// Workflow (requisito committente): [bump versione] -> build -> firma ad-hoc ->
// installa la NUOVA in /Applications -> cancella la PRECEDENTE (app + .dmg vecchi) -> apri.
//
// Uso:
//   node scripts/release.mjs            # build+installa la versione corrente
//   node scripts/release.mjs 0.3.0      # aggiorna la versione ovunque, poi build+installa
//
// Nota: il .dmg viene creato in src-tauri/target/release/bundle/dmg/.
// L'.exe Windows NON si genera da macOS: a fine rilascio lo script committa e spinge il tag vX.Y.Z, che
// innesca GitHub Actions (build.yml) a costruire la .exe e allegarla a una release in bozza, ripulendo
// le bozze vecchie. Tutto best-effort (serve un remote GitHub e la CI attiva: repo pubblico o billing).

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

// --- Git + Windows .exe (via CI) — TUTTO best-effort: non deve MAI far fallire il rilascio macOS ---
// La .exe non si costruisce su macOS: la produce GitHub Actions (.github/workflows/build.yml) quando si
// spinge il tag vX.Y.Z. Qui automatizziamo le stesse operazioni della dmg: committa il rilascio, spingi
// branch+tag (→ build .exe + .dmg allegate a una release in bozza) e ripulisci le bozze vecchie.
function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}
function ghAvailable() {
  try { execFileSync("gh", ["--version"], { stdio: "ignore" }); return true; } catch { return false; }
}
// Messaggio di commit dalla sezione di testa del CHANGELOG (cronologia descrittiva, senza scriverlo a mano).
function changelogMessage(version) {
  try {
    const cl = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
    const start = cl.indexOf(`## [${version}]`);
    if (start >= 0) {
      const rest = cl.slice(start + 3);
      const next = rest.indexOf("\n## [");
      const section = (next >= 0 ? rest.slice(0, next) : rest).trim();
      return `Kidotel Radar v${version}\n\n${section}`;
    }
  } catch { /* nessun changelog */ }
  return `Kidotel Radar v${version}`;
}
function releaseGitAndWindows(version) {
  const tag = `v${version}`;
  let remote = "";
  try { remote = git(["remote", "get-url", "origin"]); } catch { /* nessun remote */ }

  // 1) committa il rilascio se l'albero è "sporco" → il tag punta al codice corretto della versione.
  try {
    if (git(["status", "--porcelain"])) {
      git(["add", "-A"]);
      const msgPath = join(ROOT, ".release-commit-msg.tmp");
      writeFileSync(msgPath, changelogMessage(version) + "\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>\n");
      git(["commit", "-F", msgPath]);
      try { unlinkSync(msgPath); } catch { /* */ }
      console.log(`commit del rilascio v${version} creato`);
    } else {
      console.log("albero git pulito: nessun commit da creare");
    }
  } catch (e) { console.log(`commit saltato: ${String(e.message).split("\n")[0]}`); }

  if (!remote) {
    console.log("nessun remote 'origin' → niente build Windows (.exe). Configura un remote GitHub per attivarla.");
    return;
  }

  // 2) push branch + tag → innesca la CI (build .exe Windows + .dmg macOS).
  try { git(["push", "origin", "HEAD"]); } catch (e) { console.log(`push branch: ${String(e.message).split("\n")[0]}`); }
  try {
    try { git(["rev-parse", tag]); } catch { git(["tag", tag]); }
    git(["push", "origin", tag]);
    console.log(`tag ${tag} spinto → CI in avvio (costruisce la .exe Windows)`);
  } catch (e) {
    console.log(`push del tag fallito: ${String(e.message).split("\n")[0]}`);
    return;
  }

  // 3) "cancella i file vecchi" lato Windows: rimuovi le RELEASE in bozza vecchie (tieni solo la corrente).
  if (ghAvailable()) {
    try {
      const rels = JSON.parse(execFileSync("gh", ["release", "list", "--limit", "50", "--json", "tagName,isDraft"], { cwd: ROOT, encoding: "utf8" }));
      for (const r of rels) {
        if (r.isDraft && r.tagName !== tag) {
          try { execFileSync("gh", ["release", "delete", r.tagName, "--yes", "--cleanup-tag"], { cwd: ROOT, stdio: "ignore" }); console.log(`rimossa bozza vecchia: ${r.tagName}`); }
          catch { /* ignora */ }
        }
      }
    } catch { /* nessuna release ancora / gh non autorizzato: ok */ }
  }
  const slug = remote.replace(/^.*github\.com[:/]/, "").replace(/\.git$/, "");
  console.log(`Windows .exe in costruzione → scaricala dalla release (bozza): https://github.com/${slug}/releases`);
  console.log("(Se la CI non parte: il repo dev'essere PUBBLICO o il billing GitHub Actions attivo.)");
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

// Stesse operazioni della dmg, ma per la .exe Windows: commit + tag → CI costruisce e pubblica la .exe,
// e ripuliamo le bozze vecchie. Best-effort: se qualcosa va storto, il rilascio macOS resta completo.
try {
  releaseGitAndWindows(version);
} catch (e) {
  console.log(`\nWindows/CI: passo saltato (${String(e.message).split("\n")[0]}). Il rilascio macOS è completo.`);
}

console.log("\n=== apro l'app ===");
run("open", [dest]);
console.log(`\nFatto. ${PRODUCT} v${version} installata e aperta.`);
console.log("Ricorda: aggiorna docs/STATO.md e CHANGELOG.md.");
