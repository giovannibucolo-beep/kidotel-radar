// Backup VERSIONATO del database (kill del rischio "copia unica"). Fa un checkpoint WAL così il
// file copiato è completo, poi salva una copia con timestamp in ~/kidotel-backups, tenendo le
// ultime N. NON invia nulla in rete (i dati contengono email personali): per un vero offsite,
// punta una sincronizzazione cloud su quella cartella.
//   node scripts/backup-db.mjs            # crea un backup, tiene gli ultimi 10
//   KEEP=20 BACKUP_DIR=/percorso node scripts/backup-db.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DB = process.env.KIDOTEL_DB ||
  join(homedir(), "Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite");
const DIR = process.env.BACKUP_DIR || join(homedir(), "kidotel-backups");
const KEEP = Math.max(1, parseInt(process.env.KEEP || "10", 10));

if (!existsSync(DB)) { console.error("DB non trovato:", DB); process.exit(1); }
mkdirSync(DIR, { recursive: true });

// checkpoint WAL: porta le scritture recenti dentro il .sqlite prima della copia.
// Se il checkpoint NON va a buon fine, il .sqlite da solo è incompleto: in quel caso copiamo anche
// i sidecar -wal/-shm così il backup resta integro (niente "backup silenziosamente parziale").
const ck = spawnSync("sqlite3", [DB], { input: ".timeout 60000\nPRAGMA wal_checkpoint(TRUNCATE);\n", encoding: "utf8" });
const checkpointOk = ck.status === 0 && !/error/i.test((ck.stderr || "") + (ck.stdout || ""));
if (!checkpointOk) {
  console.warn("checkpoint WAL non riuscito: copio anche i sidecar -wal/-shm per non perdere dati.");
}

const d = new Date();
const p = (n) => String(n).padStart(2, "0");
const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
const dest = join(DIR, `kidotel-radar-${stamp}.sqlite`);
copyFileSync(DB, dest);
if (!checkpointOk) {
  for (const ext of ["-wal", "-shm"]) {
    if (existsSync(DB + ext)) copyFileSync(DB + ext, dest + ext);
  }
}
const mb = (statSync(dest).size / 1024 / 1024).toFixed(1);
console.log(`Backup creato: ${dest} (${mb} MB)`);

// ruota: tieni gli ultimi KEEP
const files = readdirSync(DIR)
  .filter((f) => f.startsWith("kidotel-radar-") && f.endsWith(".sqlite"))
  .map((f) => ({ f, t: statSync(join(DIR, f)).mtimeMs }))
  .sort((a, b) => b.t - a.t);
for (const { f } of files.slice(KEEP)) { unlinkSync(join(DIR, f)); console.log(`rimosso vecchio: ${f}`); }
console.log(`Backup totali tenuti: ${Math.min(files.length, KEEP)} in ${DIR}`);
console.log("Per un vero offsite: sincronizza questa cartella su un cloud (i file contengono email personali — niente repo pubblici).");
