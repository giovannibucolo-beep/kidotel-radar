// Valutazione AI "totale" e non presidiata di tutto l'archivio.
// Per ogni blocco di hotel NON valutati (con sito): chiede al `claude` di Claude Code di aprire i
// siti (WebFetch), valutare family-fit 0-100 con citazioni, e scrive i voti nel DB. Riprendibile.
// NIENTE chiave API: usa la tua sottoscrizione (serve `claude login` una volta).
//
//   node scripts/score-all-ai.mjs            # valuta finche' ce ne sono
//   MAX=50 node scripts/score-all-ai.mjs     # prova: solo i primi 50
// Opzioni env: CLAUDE_MODEL=sonnet|opus  CHUNK=5  SLEEP_MS=2500  RL_SLEEP_MS=300000
//
// Si ferma da solo se Claude resta non disponibile (limiti/auth); rilancialo per continuare.

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const DB = process.env.KIDOTEL_DB ||
  join(homedir(), "Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite");
const CLAUDE_BIN = process.env.CLAUDE_BIN || "claude";
const MODEL = process.env.CLAUDE_MODEL || "sonnet";
const CHUNK = Math.max(1, parseInt(process.env.CHUNK || "5", 10));
const SLEEP_MS = parseInt(process.env.SLEEP_MS || "2500", 10);
const RL_SLEEP_MS = parseInt(process.env.RL_SLEEP_MS || "300000", 10); // attesa sui limiti (5 min)
const MAX = parseInt(process.env.MAX || "0", 10); // 0 = nessun limite
const KEYS = ["kids_club", "kids_facilities", "family_rooms", "childcare", "kids_dining", "activities_age", "safety"];

const sleep = (ms) => spawnSync(process.execPath, ["-e", `setTimeout(()=>{}, ${ms})`]); // sleep bloccante semplice
const sqlEsc = (s) => (s == null ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'");
function db(sql) {
  const r = spawnSync("sqlite3", [DB], { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("sqlite3: " + (r.stderr || "").slice(0, 200));
  return r.stdout;
}
const countUnscored = () => Number(db("SELECT COUNT(*) FROM hotels WHERE family_fit_score IS NULL AND website IS NOT NULL AND website<>'';").trim()) || 0;

function nextChunk() {
  const out = db(
    `SELECT (osm_type||'/'||osm_id)||char(9)||name||char(9)||website FROM hotels
     WHERE family_fit_score IS NULL AND website IS NOT NULL AND website<>''
     ORDER BY osm_id LIMIT ${CHUNK};`,
  ).trim();
  if (!out) return [];
  return out.split("\n").map((l) => {
    const [id, name, website] = l.split("\t");
    return { id, name, website };
  });
}

function extractJson(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const c = fence ? fence[1] : text;
  try { return JSON.parse(c); } catch { /* continua */ }
  const s = c.indexOf("["), e = c.lastIndexOf("]");
  if (s >= 0 && e > s) { try { return JSON.parse(c.slice(s, e + 1)); } catch { /* niente */ } }
  return null;
}

// ritorna {arr} oppure {rateLimited:true} oppure {fatal:'...'}
function scoreChunk(chunk) {
  const prompt =
    `Sei un valutatore family-fit di hotel. Per OGNI hotel apri il sito ("website") con WebFetch, ` +
    `leggi le pagine rilevanti in QUALSIASI lingua e valuta quanto e' adatto alle famiglie con bambini.\n` +
    `Assegna "family_fit_score" 0-100. Per ogni servizio family trovato aggiungi a "breakdown" un elemento con ` +
    `"key" (${KEYS.join("|")}), "present":true, "quote" (frase BREVE citata dal sito) e "url".\n` +
    `Non inventare: se non c'e' prova, niente punto. Se il sito non e' raggiungibile: family_fit_score 0, breakdown [].\n` +
    `Rispondi SOLO con un array JSON, un elemento per hotel, con lo stesso "id".\n\nHOTEL:\n${JSON.stringify(chunk)}`;
  const res = spawnSync(
    CLAUDE_BIN,
    ["-p", prompt, "--model", MODEL, "--allowedTools", "WebFetch", "--permission-mode", "dontAsk", "--output-format", "json"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  let outer;
  try { outer = JSON.parse(res.stdout); } catch { return { fatal: (res.stderr || res.stdout || "no output").slice(0, 200) }; }
  if (outer.is_error) {
    const msg = String(outer.result || "");
    if (/401|authenticate|credentials/i.test(msg)) return { fatal: "401 — esegui prima: claude login" };
    if (/limit|rate|usage|overloaded|429/i.test(msg)) return { rateLimited: true, msg };
    return { fatal: msg.slice(0, 200) };
  }
  const arr = extractJson(outer.result);
  return Array.isArray(arr) ? { arr } : { fatal: "risposta senza array JSON" };
}

function writeScores(arr) {
  let n = 0, sql = "BEGIN;\n";
  for (const r of arr) {
    if (!r || !r.id || !r.id.includes("/")) continue;
    const [otype, oid] = r.id.split("/");
    const score = Math.max(0, Math.min(100, Number(r.family_fit_score) || 0));
    const bd = Array.isArray(r.breakdown) ? r.breakdown.filter((b) => b && KEYS.includes(b.key) && b.present) : [];
    sql += `UPDATE hotels SET family_fit_score=${score}, score_breakdown=${sqlEsc(JSON.stringify(bd))}, ` +
      `enrichment='{"website_ok":true,"source":"ai"}', updated_at=datetime('now') ` +
      `WHERE osm_type=${sqlEsc(otype)} AND osm_id=${Number(oid) || 0};\n`;
    n++;
  }
  sql += "COMMIT;\n";
  if (n) db(sql);
  return n;
}

if (spawnSync("sqlite3", ["-version"]).status !== 0) { console.error("Manca sqlite3."); process.exit(1); }

let done = 0;
const start = countUnscored();
console.log(`Da valutare: ${start} hotel (con sito, senza voto). Modello: ${MODEL}. Ctrl-C per fermare; rilancia per continuare.\n`);

while (true) {
  if (MAX && done >= MAX) { console.log(`Raggiunto MAX=${MAX}.`); break; }
  const chunk = nextChunk();
  if (chunk.length === 0) { console.log("Nessun hotel rimasto da valutare. Completato."); break; }
  const r = scoreChunk(chunk);
  if (r.fatal) { console.error(`Stop: ${r.fatal}\nProgresso salvato. Rilancia per continuare.`); break; }
  if (r.rateLimited) {
    console.log(`Limite Claude raggiunto — attendo ${Math.round(RL_SLEEP_MS / 60000)} min e riprovo lo stesso blocco…`);
    sleep(RL_SLEEP_MS);
    continue; // riprova lo stesso blocco (non ancora scritto)
  }
  const wrote = writeScores(r.arr);
  done += wrote;
  const left = countUnscored();
  console.log(`+${wrote} valutati (tot sessione ${done}) · rimasti ${left}`);
  sleep(SLEEP_MS);
}

console.log(`\nSessione finita. Valutati ora: ${done}. Rimasti: ${countUnscored()}. Nell'app: "Mostra archivio salvato".`);
