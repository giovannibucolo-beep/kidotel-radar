// Gate di DELIVERABILITY delle email: verifica via DNS (record MX) che il dominio possa ricevere
// posta, e classifica ogni indirizzo. NIENTE API, NIENTE invii. Idempotente (colonna email_status).
// Stati: ok (MX + indirizzo personale) · role (MX ma indirizzo generico info@/booking@…) ·
//        risky (niente MX ma c'è un A record) · no_mx (dominio non riceve posta) · bad (sintassi).
//   node scripts/verify-emails.mjs            # verifica le non ancora controllate
//   POOL=30 node scripts/verify-emails.mjs
import { spawnSync } from "node:child_process";
import dns from "node:dns/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DB = process.env.KIDOTEL_DB ||
  join(homedir(), "Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite");
const POOL = Math.max(1, parseInt(process.env.POOL || "30", 10));

function db(sql) {
  const r = spawnSync("sqlite3", ["-json", DB], { input: ".timeout 60000\n" + sql, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("sqlite3: " + (r.stderr || "").slice(0, 300));
  return r.stdout.trim() ? JSON.parse(r.stdout) : [];
}
function exec(sql) {
  const r = spawnSync("sqlite3", [DB], { input: ".timeout 60000\n" + sql, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("sqlite3: " + (r.stderr || "").slice(0, 300));
}
const sqlEsc = (s) => (s == null ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'");

// colonna di stato (idempotente)
spawnSync("sqlite3", [DB], { input: "ALTER TABLE hotels ADD COLUMN email_status TEXT;", encoding: "utf8" });

const ROLE = ["info", "booking", "bookings", "reservation", "reservations", "reservierung", "prenotazioni",
  "reception", "reception", "empfang", "office", "mail", "email", "hello", "contact", "kontakt", "contatto",
  "sales", "admin", "hotel", "welcome", "stay", "rooms", "frontdesk", "front.office", "rezeption", "recepcion"];
const EMAIL_RE = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i;

const mxCache = new Map(); // domain -> "mx" | "a" | "none"
async function domainStatus(domain) {
  if (mxCache.has(domain)) return mxCache.get(domain);
  let st = "none";
  try {
    const mx = await dns.resolveMx(domain);
    if (mx && mx.length) st = "mx";
  } catch { /* nessun MX */ }
  if (st === "none") {
    try { const a = await dns.resolve(domain); if (a && a.length) st = "a"; } catch { /* nessun A */ }
  }
  mxCache.set(domain, st);
  return st;
}

async function classify(email) {
  const e = (email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return "bad";
  const [local, domain] = e.split("@");
  const dom = await domainStatus(domain);
  if (dom === "none") return "no_mx";
  const isRole = ROLE.some((r) => local === r || local.startsWith(r + ".") || local.startsWith(r + "-"));
  if (dom === "a") return "risky";
  return isRole ? "role" : "ok";
}

const where = "email IS NOT NULL AND email<>'' AND (email_status IS NULL OR email_status='')";
const countLeft = () => Number(db(`SELECT COUNT(*) c FROM hotels WHERE ${where};`)[0]?.c || 0);
function nextChunk(n) {
  return db(`SELECT (osm_type||'/'||osm_id) id, email FROM hotels WHERE ${where} ORDER BY osm_id LIMIT ${n};`);
}
function write(results) {
  let sql = "BEGIN;\n";
  for (const r of results) {
    const [ot, oid] = r.id.split("/");
    sql += `UPDATE hotels SET email_status=${sqlEsc(r.status)} WHERE osm_type=${sqlEsc(ot)} AND osm_id=${Number(oid) || 0};\n`;
  }
  sql += "COMMIT;\n";
  exec(sql);
}

if (spawnSync("sqlite3", ["-version"]).status !== 0) { console.error("Manca sqlite3."); process.exit(1); }
const start = countLeft();
console.log(`Email da verificare (MX/DNS): ${start}. Concorrenza ${POOL}. Nessun invio.\n`);

let done = 0;
while (true) {
  const chunk = nextChunk(POOL * 6);
  if (chunk.length === 0) { console.log("Completato."); break; }
  const results = [];
  for (let i = 0; i < chunk.length; i += POOL) {
    const batch = chunk.slice(i, i + POOL);
    const sts = await Promise.all(batch.map((h) => classify(h.email)));
    batch.forEach((h, j) => results.push({ id: h.id, status: sts[j] }));
  }
  write(results);
  done += results.length;
  if (done % 1200 === 0 || chunk.length < POOL * 6) console.log(`verificate ${done} · rimaste ${countLeft()} · domini in cache ${mxCache.size}`);
}

const breakdown = db("SELECT email_status, COUNT(*) c FROM hotels WHERE email IS NOT NULL AND email<>'' GROUP BY email_status ORDER BY c DESC;");
console.log("\n=== Deliverability ===");
for (const b of breakdown) console.log(`  ${(b.email_status || "?").padEnd(8)} ${b.c}`);
const usable = db("SELECT COUNT(*) c FROM hotels WHERE email_status IN ('ok','role');")[0]?.c || 0;
console.log(`\nEmail CONTATTABILI (ok+role): ${usable}. (Evitare no_mx/bad nell'outreach.)`);
