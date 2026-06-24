// Valutazione GRATIS (a regole) di tutto l'archivio: nessuna AI, nessuna chiave, nessun limite.
// Per ogni hotel non valutato (con sito): scarica home + pagine "famiglia", cerca i segnali family
// dal dizionario condiviso signals.json, e scrive voto + prova nel DB. Concorrente e riprendibile.
//   node scripts/score-free.mjs            # finche' ce ne sono
//   MAX=200 node scripts/score-free.mjs    # prova un blocco
// Opzioni: POOL=12  TIMEOUT_MS=15000

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DB = process.env.KIDOTEL_DB ||
  join(homedir(), "Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite");
const POOL = Math.max(1, parseInt(process.env.POOL || "12", 10));
const TIMEOUT_MS = parseInt(process.env.TIMEOUT_MS || "15000", 10);
const MAX = parseInt(process.env.MAX || "0", 10);
const UA = "KidotelRadar/0.3 (+https://kidotel.co; contact info@kidotel.co)";
const HINTS = ["famigli", "famiglia", "bambini", "bimbi", "kids", "kinder", "family", "familie", "enfant", "infantil", "child", "miniclub"];

const SIGNALS = JSON.parse(readFileSync(join(import.meta.dirname, "../src-tauri/src/signals.json"), "utf8")).signals;

const sqlEsc = (s) => (s == null ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'");
function db(sql) {
  // busy_timeout via dot-command (.timeout NON stampa output, a differenza di PRAGMA): lo scorer
  // e l'harvester scrivono insieme → si aspettano invece di fallire sul lock di SQLite.
  const r = spawnSync("sqlite3", [DB], { input: ".timeout 60000\n" + sql, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("sqlite3: " + (r.stderr || "").slice(0, 200));
  return r.stdout;
}

// Estrae un'email reale dall'HTML grezzo (mailto:/JSON-LD/testo), scarta i falsi positivi.
function findEmail(html) {
  const isLocal = (c) => /[A-Za-z0-9._%+\-]/.test(c);
  const isDomain = (c) => /[A-Za-z0-9.\-]/.test(c);
  // Allineato a engine.rs find_email (vedi harvest-emails.mjs).
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
const countUnscored = () => Number(db("SELECT COUNT(*) FROM hotels WHERE family_fit_score IS NULL AND website IS NOT NULL AND website<>'';").trim()) || 0;
function nextChunk(n) {
  const out = db(`SELECT (osm_type||'/'||osm_id)||char(9)||website FROM hotels
     WHERE family_fit_score IS NULL AND website IS NOT NULL AND website<>'' ORDER BY osm_id LIMIT ${n};`).trim();
  return out ? out.split("\n").map((l) => { const [id, website] = l.split("\t"); return { id, website }; }) : [];
}

function htmlToText(html) {
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<[^>]+>/g, "\n");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
       .replace(/&agrave;/g, "à").replace(/&egrave;/g, "è").replace(/&igrave;/g, "ì").replace(/&ograve;/g, "ò").replace(/&ugrave;/g, "ù");
  return s;
}
function sentences(text) {
  return text.split(/[\n.!?;•|]+/).map((x) => x.replace(/\s+/g, " ").trim()).filter((x) => x.length >= 4 && x.length <= 400);
}
async function fetchText(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}
function familyLinks(html, base) {
  const out = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi; let m;
  while ((m = re.exec(html)) && out.length < 6) {
    const href = m[1]; if (!HINTS.some((h) => href.toLowerCase().includes(h))) continue;
    try { const u = new URL(href, base); if (u.host === new URL(base).host && u.href !== base) out.push(u.href); } catch { /* skip */ }
  }
  return [...new Set(out)].slice(0, 2);
}

async function scoreHotel(h) {
  const home = await fetchText(h.website);
  const pages = [];
  let email = null;
  if (home) {
    email = findEmail(home);
    pages.push([h.website, htmlToText(home)]);
    for (const l of familyLinks(home, h.website)) { const t = await fetchText(l); if (t) { if (!email) email = findEmail(t); pages.push([l, htmlToText(t)]); } }
  }
  const websiteOk = pages.length > 0;
  const tagged = [];
  for (const [url, text] of pages) for (const s of sentences(text)) tagged.push([s, url]);
  let score = 0; const breakdown = [];
  for (const def of SIGNALS) {
    let found = null;
    if (def.patterns && def.patterns.length) {
      for (const [sent, url] of tagged) { const sl = sent.toLowerCase(); if (def.patterns.some((p) => sl.includes(p))) { found = [sent.slice(0, 220), url]; break; } }
    }
    if (found) { score += def.weight; breakdown.push({ key: def.key, weight: def.weight, present: true, quote: found[0], url: found[1] }); }
    else breakdown.push({ key: def.key, weight: def.weight, present: false, quote: null, url: null });
  }
  return { id: h.id, score, breakdown, websiteOk, email };
}

function write(results) {
  let sql = "BEGIN;\n";
  for (const r of results) {
    const [otype, oid] = r.id.split("/");
    const emailSet = r.email ? `email=COALESCE(NULLIF(email,''), ${sqlEsc(r.email)}), ` : "";
    sql += `UPDATE hotels SET family_fit_score=${r.score}, score_breakdown=${sqlEsc(JSON.stringify(r.breakdown))}, ` +
      `enrichment='{"website_ok":${r.websiteOk},"source":"rules"}', ${emailSet}updated_at=datetime('now') ` +
      `WHERE osm_type=${sqlEsc(otype)} AND osm_id=${Number(oid) || 0};\n`;
  }
  sql += "COMMIT;\n";
  db(sql);
}

if (spawnSync("sqlite3", ["-version"]).status !== 0) { console.error("Manca sqlite3."); process.exit(1); }
const start = countUnscored();
console.log(`Da valutare (gratis): ${start} hotel. Concorrenza ${POOL}. Ctrl-C per fermare; rilancia per continuare.\n`);

let done = 0;
while (true) {
  if (MAX && done >= MAX) { console.log(`Raggiunto MAX=${MAX}.`); break; }
  const take = MAX ? Math.min(POOL * 4, MAX - done) : POOL * 4;
  const chunk = nextChunk(take);
  if (chunk.length === 0) { console.log("Completato: nessun hotel rimasto."); break; }
  const results = [];
  for (let i = 0; i < chunk.length; i += POOL) {
    const batch = chunk.slice(i, i + POOL);
    results.push(...await Promise.all(batch.map(scoreHotel)));
  }
  write(results);
  done += results.length;
  console.log(`+${results.length} valutati (tot ${done}) · rimasti ${countUnscored()}`);
}
console.log(`\nFatto. Valutati ora: ${done}. Rimasti: ${countUnscored()}. App: "Mostra archivio salvato".`);
