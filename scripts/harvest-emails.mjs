// Harvest EMAIL di massa: per ogni hotel con sito ma SENZA email, scarica la home (+ una pagina
// "contatti") ed estrae un'email REALE dal sito (mai inventata). Concorrente e RIPRENDIBILE
// (colonna email_checked: gli hotel già tentati non si rifanno). Pensato per girare INSIEME a
// score-free.mjs (tocca solo la colonna email) — entrambi usano busy_timeout per non scontrarsi.
//   node scripts/harvest-emails.mjs            # finché ce ne sono
//   POOL=24 TIMEOUT_MS=12000 MAX=500 node scripts/harvest-emails.mjs
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const DB = process.env.KIDOTEL_DB ||
  join(homedir(), "Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite");
const POOL = Math.max(1, parseInt(process.env.POOL || "24", 10));
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || "12000", 10);
const MAX = parseInt(process.env.MAX || "0", 10);
const UA = "KidotelRadar/0.5 (+https://kidotel.co; contact info@kidotel.co)";
const CONTACT_HINTS = ["contatt", "contact", "kontakt", "contacto", "contato", "impressum", "prenot", "book", "reserv", "info"];

const sqlEsc = (s) => (s == null ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'");
function db(sql) {
  // .timeout (dot-command) NON stampa output, a differenza di PRAGMA busy_timeout (che emette il
  // valore e inquinava il parsing): imposta l'attesa sul lock così scorer+harvester convivono.
  const r = spawnSync("sqlite3", [DB], { input: ".timeout 60000\n" + sql, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("sqlite3: " + (r.stderr || "").slice(0, 200));
  return r.stdout;
}

// colonna di stato per la ripresa (idempotente)
spawnSync("sqlite3", [DB], { input: "ALTER TABLE hotels ADD COLUMN email_checked INTEGER;", encoding: "utf8" });

function findEmail(html) {
  const isLocal = (c) => /[A-Za-z0-9._%+\-]/.test(c);
  const isDomain = (c) => /[A-Za-z0-9.\-]/.test(c);
  // Allineato a engine.rs find_email: spazzatura su dominio/estensioni (sottostringa) +
  // segnaposto nel local-part (confronto ESATTO, così non scartiamo firstname@/superuser@/…).
  const JUNK_SUB = ["example.", "sentry", "wixpress", "@2x", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg",
    "domain.com", "yourdomain", "googleapis", "gstatic", "schema.org", "w3.org", "@example",
    "@sentry", "@domain", "@yourdomain"];
  const JUNK_LOCAL = ["your-email", "youremail", "name", "user", "test", "email", "example",
    "your", "firstname.lastname", "nome", "tuamail", "tuaemail"];
  const PREF = ["info@", "reception", "reservation", "booking", "hotel@", "contact", "welcome", "office", "mail@"];
  const cands = [];
  for (let i = 0; i < html.length; i++) {
    if (html[i] !== "@") continue;
    let l = i; while (l > 0 && isLocal(html[l - 1])) l--;
    let r = i + 1; while (r < html.length && isDomain(html[r])) r++;
    if (l === i || r === i + 1) continue;
    const local = html.slice(l, i);
    const domain = html.slice(i + 1, r).replace(/\.+$/, "");
    if (!domain.includes(".") || local.length > 64 || domain.length > 100) continue;
    const tld = domain.split(".").pop();
    if (tld.length < 2 || !/^[A-Za-z]+$/.test(tld)) continue;
    const email = (local + "@" + domain).toLowerCase();
    if (JUNK_SUB.some((j) => email.includes(j)) || JUNK_LOCAL.includes(local.toLowerCase())) continue;
    if (!cands.includes(email)) cands.push(email);
  }
  cands.sort((a, b) => (PREF.some((p) => a.includes(p)) ? 0 : 1) - (PREF.some((p) => b.includes(p)) ? 0 : 1));
  return cands[0] || null;
}

async function fetchText(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}
function contactLinks(html, base) {
  const out = []; const re = /href\s*=\s*["']([^"']+)["']/gi; let m;
  while ((m = re.exec(html)) && out.length < 8) {
    const hl = m[1].toLowerCase();
    if (!CONTACT_HINTS.some((h) => hl.includes(h))) continue;
    try { const u = new URL(m[1], base); if (u.host === new URL(base).host && u.href !== base) out.push(u.href); } catch { /* skip */ }
  }
  return [...new Set(out)].slice(0, 1);
}

async function harvest(h) {
  let email = null;
  const home = await fetchText(h.website);
  if (home) {
    email = findEmail(home);
    if (!email) { for (const l of contactLinks(home, h.website)) { const t = await fetchText(l); if (t) { email = findEmail(t); if (email) break; } } }
  }
  return { id: h.id, email };
}

const where = "website IS NOT NULL AND website<>'' AND (email IS NULL OR email='') AND (email_checked IS NULL OR email_checked=0)";
const countLeft = () => Number(db(`SELECT COUNT(*) FROM hotels WHERE ${where};`).trim()) || 0;
const countEmails = () => Number(db("SELECT COUNT(*) FROM hotels WHERE email IS NOT NULL AND email<>'';").trim()) || 0;
function nextChunk(n) {
  const out = db(`SELECT (osm_type||'/'||osm_id)||char(9)||website FROM hotels WHERE ${where} ORDER BY osm_id LIMIT ${n};`).trim();
  return out ? out.split("\n").map((l) => { const [id, website] = l.split("\t"); return { id, website }; }) : [];
}
function write(results) {
  let sql = "BEGIN;\n";
  for (const r of results) {
    const [ot, oid] = r.id.split("/");
    const idc = `osm_type=${sqlEsc(ot)} AND osm_id=${Number(oid) || 0}`;
    if (r.email) sql += `UPDATE hotels SET email=${sqlEsc(r.email)} WHERE ${idc} AND (email IS NULL OR email='');\n`;
    sql += `UPDATE hotels SET email_checked=1 WHERE ${idc};\n`;
  }
  sql += "COMMIT;\n";
  db(sql);
}

if (spawnSync("sqlite3", ["-version"]).status !== 0) { console.error("Manca sqlite3."); process.exit(1); }
const start = countLeft();
console.log(`Email da cercare su ${start} hotel (sito senza email). Concorrenza ${POOL}. Email attuali: ${countEmails()}.\n`);

let done = 0, found = 0;
while (true) {
  if (MAX && done >= MAX) { console.log(`Raggiunto MAX=${MAX}.`); break; }
  const take = MAX ? Math.min(POOL * 4, MAX - done) : POOL * 4;
  const chunk = nextChunk(take);
  if (chunk.length === 0) { console.log("Completato: nessun sito senza email rimasto."); break; }
  const results = [];
  for (let i = 0; i < chunk.length; i += POOL) {
    results.push(...await Promise.all(chunk.slice(i, i + POOL).map(harvest)));
  }
  write(results);
  done += results.length;
  found += results.filter((r) => r.email).length;
  console.log(`+${results.length} controllati (tot ${done}, email trovate ${found}) · rimasti ${countLeft()} · email totali ${countEmails()}`);
}
console.log(`\nFatto. Controllati ${done}, email trovate ${found}. Email totali in archivio: ${countEmails()}.`);
