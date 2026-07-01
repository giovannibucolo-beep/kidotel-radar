#!/usr/bin/env node
// Match GLOBALE Radar ↔ kidotel.co: collega l'intero catalogo del sito (scripts/out/site-catalog.json,
// prodotto da harvest-site.mjs) ai record Radar (osm_id) e salva la mappatura site_id ↔ osm_id.
// Chiave: paese + città normalizzati + somiglianza nome (token Jaccard ∪ Dice sui bigrammi), con
// ripiego «stesso paese» a soglia severa per i casi di città scritta diversamente (localizzazione).
//
// Uso:  node scripts/match-all.mjs
// Output: scripts/out/site-radar-map.json (+ .csv) — pairs (site_id, osm_id, confidence, review, match).

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "scripts", "out");
const DB = `${process.env.HOME}/Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite`;

// ---------- normalizzazione (condivisa lato sito e lato Radar) ----------
const deaccent = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const NAME_STOP = new Set(["hotel", "residence", "resort", "aparthotel", "apartments", "apartment", "suites", "suite", "spa", "wellness", "boutique", "camping", "village", "villaggio", "the", "bb", "bed", "breakfast", "guesthouse", "inn", "relais", "albergo", "hostel", "haus", "casa", "hotel",
  // rumore di marketing/OTA (chain-qualifier e diciture prenotazione) che diluisce il match nome
  "by", "all", "inclusive", "incl", "trademark", "collection", "autograph", "curio", "tapestry", "vignette", "grand", "vacations", "a", "an", "and"]);
function normName(s) {
  return deaccent(s).toLowerCase().replace(/&/g, " ").replace(/[^a-z0-9]+/g, " ")
    .split(" ").filter((w) => w && !NAME_STOP.has(w)).join(" ").trim();
}
const normCity = (s) => deaccent(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const normCountry = (s) => deaccent(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/^the /, "").trim();
const tokens = (s) => new Set(normName(s).split(" ").filter(Boolean));
function jaccard(a, b) { const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return i / (A.size + B.size - i); }
function bigrams(s) { const t = normName(s).replace(/ /g, ""); const g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; }
function dice(a, b) { const A = bigrams(a), B = bigrams(b); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return (2 * i) / (A.size + B.size); }
const sim = (a, b) => (normName(a) && normName(a) === normName(b) ? 1 : Math.max(jaccard(a, b), dice(a, b)));
// dice generico su bigrammi di una stringa arbitraria (per fuzzy-map dei paesi)
function diceStr(a, b) { const g = (s) => { const set = new Set(); const t = normCountry(s).replace(/ /g, ""); for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2)); return set; }; const A = g(a), B = g(b); if (!A.size || !B.size) return 0; let i = 0; for (const x of A) if (B.has(x)) i++; return (2 * i) / (A.size + B.size); }

// ---------- carica sito ----------
const site = JSON.parse(readFileSync(join(OUT, "site-catalog.json"), "utf8"));
console.log(`sito: ${site.length} hotel nel catalogo`);

// ---------- carica Radar (tutto) ----------
const sql = "SELECT osm_id AS osm_id, name AS name, COALESCE(city,'') AS city, COALESCE(country,'') AS country FROM hotels;";
const radar = JSON.parse(execFileSync("sqlite3", ["-json", DB, sql], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }) || "[]");
console.log(`radar: ${radar.length} hotel nel DB`);

// pre-calcolo per record Radar: nome normalizzato, token, bigrammi (per un match veloce e ripetuto)
const bgOf = (norm) => { const t = norm.replace(/ /g, ""); const g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
for (const r of radar) { r._n = normName(r.name); r._t = new Set(r._n.split(" ").filter(Boolean)); r._b = bgOf(r._n); }
function simFast(sn, st, sb, r) {
  if (sn && sn === r._n) return 1;
  let ji = 0; for (const x of st) if (r._t.has(x)) ji++;
  const j = st.size && r._t.size ? ji / (st.size + r._t.size - ji) : 0;
  let di = 0; for (const x of sb) if (r._b.has(x)) di++;
  const d = sb.size && r._b.size ? (2 * di) / (sb.size + r._b.size) : 0;
  return Math.max(j, d);
}

// indici Radar: per paese, per (paese|città), e per (paese → token nome → record) per il blocking
const radarByCountry = new Map();          // normCountry -> [rec]
const radarByCC = new Map();               // normCountry|normCity -> [rec]
const radarByCR = new Map();               // normCountry|normRegion -> [rec]
const radarTok = new Map();                // normCountry -> Map(token -> [rec])
for (const r of radar) {
  const nc = normCountry(r.country);
  (radarByCountry.get(nc) || radarByCountry.set(nc, []).get(nc)).push(r);
  const cck = nc + "|" + normCity(r.city);
  (radarByCC.get(cck) || radarByCC.set(cck, []).get(cck)).push(r);
  const crk = nc + "|" + normCity(r.region || "");
  if (r.region) (radarByCR.get(crk) || radarByCR.set(crk, []).get(crk)).push(r);
  let tm = radarTok.get(nc); if (!tm) { tm = new Map(); radarTok.set(nc, tm); }
  for (const tok of r._t) (tm.get(tok) || tm.set(tok, []).get(tok)).push(r);
}

// mappa paese-sito -> paese-Radar: alias ISO noti, poi esatto normalizzato, poi fuzzy dice>=0.75.
// (Radar usa i nomi ISO lunghi: «Korea, Republic of», «Tanzania, United Republic of», «Viet Nam»…)
const ALIAS = {
  "south korea": "korea republic of", "north korea": "korea democratic peoples republic of",
  "tanzania": "tanzania united republic of", "brunei": "brunei darussalam", "vietnam": "viet nam",
  "russia": "russian federation", "bolivia": "bolivia plurinational state of", "iran": "iran islamic republic of",
  "venezuela": "venezuela bolivarian republic of", "laos": "lao peoples democratic republic",
  "syria": "syrian arab republic", "moldova": "moldova republic of", "cape verde": "cabo verde",
  "ivory coast": "cote divoire", "democratic republic of the congo": "congo democratic republic of the",
  "united states virgin islands": "virgin islands us", "us virgin islands": "virgin islands us",
};
const radarCountries = [...radarByCountry.keys()].filter(Boolean);
const radarCountrySet = new Set(radarCountries);
const countryMap = new Map();
function mapCountry(siteCountry) {
  const nc = normCountry(siteCountry);
  if (countryMap.has(nc)) return countryMap.get(nc);
  let target = null;
  if (radarByCountry.has(nc)) target = nc;
  else if (ALIAS[nc] && radarCountrySet.has(ALIAS[nc])) target = ALIAS[nc];
  else { let best = null, sc = 0; for (const rc of radarCountries) { const v = diceStr(nc, rc); if (v > sc) { sc = v; best = rc; } } target = sc >= 0.75 ? best : null; }
  countryMap.set(nc, target);
  return target;
}

// ---------- match ----------
const bestFast = (cands, sn, st, sb) => { let best = null, sc = 0; if (cands) for (const r of cands) { const v = simFast(sn, st, sb, r); if (v > sc) { sc = v; best = r; } } return { best, sc }; };
const pairs = [], unmatched = [];
let n = 0;
for (const s of site) {
  if (++n % 5000 === 0) console.log(`… ${n}/${site.length}`);
  const rc = mapCountry(s.country);
  if (!rc) { unmatched.push({ site_id: s.site_id, name: s.name, city: s.city, country: s.country, reason: "country" }); continue; }
  const sn = normName(s.name), st = new Set(sn.split(" ").filter(Boolean)), sb = bgOf(sn);
  // 1) stesso paese+città (soglia 0.5)
  let { best, sc } = bestFast(radarByCC.get(rc + "|" + normCity(s.city)), sn, st, sb);
  let how = best && sc >= 0.5 ? "citta" : null;
  // 2) stessa REGIONE (città diversa ma stessa regione: soglia 0.62)
  if (!how && s.region) {
    const r = bestFast(radarByCR.get(rc + "|" + normCity(s.region)), sn, st, sb);
    if (r.best && r.sc >= 0.62) { best = r.best; sc = r.sc; how = "regione"; } else if (r.sc > sc) { best = r.best; sc = r.sc; }
  }
  // 3) ripiego «stesso paese» via blocking sui token del nome (soglia severa 0.75)
  if (!how) {
    const tm = radarTok.get(rc); const seen = new Set(); const cands = [];
    if (tm) for (const tok of st) for (const r of (tm.get(tok) || [])) if (!seen.has(r.osm_id)) { seen.add(r.osm_id); cands.push(r); }
    const r = bestFast(cands, sn, st, sb);
    if (r.best && r.sc >= 0.75) { best = r.best; sc = r.sc; how = "paese"; } else if (r.sc > sc) { best = r.best; sc = r.sc; }
  }
  if (how) {
    // soglie CALIBRATE su un audit avversariale (40 giudici, web): la tier affidabile (~100% precisione) è
    // «stessa città conf ≥ 0.9» oppure «stesso paese conf ≥ 0.85»; tutto il resto → review (confusioni
    // ramo-di-catena / stessa-città-hotel-diverso). Vedi scripts/out/audit-result.json.
    const auto = (how === "citta" && sc >= 0.9) || (how !== "citta" && sc >= 0.85);
    pairs.push({ site_id: s.site_id, osm_id: best.osm_id, confidence: Number(sc.toFixed(2)), review: !auto, match: how, site_name: s.name, radar_name: best.name, city: s.city, country: s.country });
  } else unmatched.push({ site_id: s.site_id, name: s.name, city: s.city, country: s.country, best: best ? best.name : null, score: Number(sc.toFixed(2)), reason: "name" });
}

// integrità 1:1 nel tier AUTO: se più hotel del sito puntano allo STESSO osm_id, tieni solo il match a
// confidenza più alta come automatico e retrocedi gli altri a review (collisione = o doppione lato sito,
// o falso positivo: in entrambi i casi va confermato a mano, non collegato in automatico).
{
  const byOsm = new Map();
  for (const p of pairs) if (!p.review) (byOsm.get(p.osm_id) || byOsm.set(p.osm_id, []).get(p.osm_id)).push(p);
  let demoted = 0;
  for (const [, ps] of byOsm) {
    if (ps.length < 2) continue;
    ps.sort((a, b) => b.confidence - a.confidence);
    for (const p of ps.slice(1)) { p.review = true; p.collision = true; demoted++; }
  }
  if (demoted) console.log(`integrità 1:1: retrocessi ${demoted} match auto in collisione su osm_id → review`);
}

const auto = pairs.filter((p) => !p.review);
const rate = site.length ? Math.round((pairs.length / site.length) * 100) : 0;
console.log(`\nMATCH GLOBALE: ${pairs.length}/${site.length} collegate (${rate}%) — ${auto.length} automatiche (tier affidabile ~100% dall'audit) + ${pairs.length - auto.length} da rivedere`);
const byReason = unmatched.reduce((a, u) => ((a[u.reason] = (a[u.reason] || 0) + 1), a), {});
console.log(`non collegate: ${unmatched.length}  (per motivo: ${JSON.stringify(byReason)})`);
console.log(`match per tipo: citta=${pairs.filter((p) => p.match === "citta").length}, paese=${pairs.filter((p) => p.match === "paese").length}`);

writeFileSync(join(OUT, "site-radar-map.json"), JSON.stringify({ generated_from: "site-catalog.json", site_count: site.length, radar_count: radar.length, matched: pairs.length, auto: auto.length, review: pairs.length - auto.length, match_rate_pct: rate, pairs }, null, 0));
const csv = "site_id,osm_id,confidence,review,match\n" + pairs.map((p) => `${p.site_id},${p.osm_id},${p.confidence},${p.review ? 1 : 0},${p.match}`).join("\n");
writeFileSync(join(OUT, "site-radar-map.csv"), csv);
writeFileSync(join(OUT, "site-unmatched.json"), JSON.stringify(unmatched, null, 0));
console.log(`\nScritto: scripts/out/site-radar-map.json (+ .csv) e site-unmatched.json`);

// Persistenza opzionale nel DB di Radar (tabella site_map): SOLO con --write-db (di default non tocca
// il DB vivo). Così il feed/app può unire per osm_id la scheda del sito ai dati Radar (description/facilities).
if (process.argv.includes("--write-db")) {
  // chiave = site_id (ogni scheda del sito → un osm_id di Radar; più schede-doppione possono puntare allo
  // stesso osm). L'integrità 1:1 nel tier AUTO (un osm non collegato automaticamente a 2 schede) è già
  // garantita dalla retrocessione delle collisioni fatta sopra.
  const ddl = `CREATE TABLE IF NOT EXISTS site_map (site_id INTEGER PRIMARY KEY, osm_id INTEGER, confidence REAL, review INTEGER, match TEXT, mapped_at TEXT DEFAULT (datetime('now')));\nDROP TABLE IF EXISTS site_map;\nCREATE TABLE site_map (site_id INTEGER PRIMARY KEY, osm_id INTEGER, confidence REAL, review INTEGER, match TEXT, mapped_at TEXT DEFAULT (datetime('now')));\nCREATE INDEX IF NOT EXISTS idx_site_map_osm ON site_map(osm_id);\nBEGIN;\n`
    + pairs.map((p) => `INSERT OR REPLACE INTO site_map(site_id,osm_id,confidence,review,match) VALUES(${p.site_id},${p.osm_id},${p.confidence},${p.review ? 1 : 0},'${p.match}');`).join("\n")
    + `\nCOMMIT;\n`;
  const tmp = join(OUT, "_site_map.sql");
  writeFileSync(tmp, ddl);
  execFileSync("sqlite3", [DB], { input: `.timeout 8000\n.read ${tmp}\n`, encoding: "utf8" });
  const cnt = execFileSync("sqlite3", [DB, "SELECT COUNT(*) FROM site_map;"], { encoding: "utf8" }).trim();
  console.log(`DB: tabella site_map scritta (${cnt} righe) in ${DB}`);
}
