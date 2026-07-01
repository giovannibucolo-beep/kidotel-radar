#!/usr/bin/env node
// Chiave di join Radar ↔ kidotel.co.
// Collega le schede pubbliche del sito (family-destinations → family-hotels/<slug>-<id>/) con i record
// della banca dati Radar (osm_id) tramite una chiave NORMALIZZATA nome+città (+ prossimità geo quando
// disponibile). Nessun dato inventato: il sito si legge dalle pagine pubbliche, Radar dal suo SQLite.
//
// Uso:  node scripts/match-site.mjs [regionSlug] [radarRegion] [radarCountryLike]
//   es. node scripts/match-site.mjs europe/italy/sardinia Sardinia %Ital%
//
// Produce un report a schermo e scrive scripts/out/match-<region>.json con le coppie (site_id ↔ osm_id).

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB = `${process.env.HOME}/Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite`;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const BASE = "https://kidotel.co";

const regionSlug = process.argv[2] || "europe/italy/sardinia";
const radarRegion = process.argv[3] || "Sardinia";
const radarCountryLike = process.argv[4] || "%Ital%";

// ---------- fetch (curl con UA: il sito risponde 403 a fetch "nudo") ----------
function get(url) {
  try {
    return execFileSync("curl", ["-sS", "-A", UA, "-m", "30", "-L", url], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch { return ""; }
}
const linksTo = (html, re) => [...new Set((html.match(re) || []).map((s) => s.replace(/^href="/, "").replace(/"$/, "")))];

// ---------- normalizzazione chiave (identica sui due lati) ----------
const NAME_STOP = new Set(["hotel", "residence", "resort", "aparthotel", "apartments", "apartment", "suites", "suite", "spa", "wellness", "boutique", "camping", "village", "villaggio", "the", "b&b", "bed", "breakfast", "guesthouse", "inn", "relais", "albergo", "hostel"]);
const deaccent = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function normName(s) {
  return deaccent(String(s || "").toLowerCase())
    .replace(/&/g, " ").replace(/[^a-z0-9]+/g, " ")
    .split(" ").filter((w) => w && !NAME_STOP.has(w)).join(" ").trim();
}
const normCity = (s) => deaccent(String(s || "").toLowerCase()).replace(/[^a-z0-9]+/g, " ").trim();
const tokens = (s) => new Set(normName(s).split(" ").filter(Boolean));
function jaccard(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
// Somiglianza a bigrammi (Dice) sul nome senza spazi: cattura gli artefatti da slug (apostrofi persi,
// «jannae sole» ↔ «janna 'e sole») dove il match a token fallirebbe.
function bigrams(s) {
  const t = normName(s).replace(/ /g, "");
  const g = new Set();
  for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
  return g;
}
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let i = 0; for (const x of A) if (B.has(x)) i++;
  return (2 * i) / (A.size + B.size);
}
// Somiglianza nome complessiva: uguaglianza normalizzata = 1, altrimenti max(token, bigrammi).
const sim = (a, b) => (normName(a) && normName(a) === normName(b) ? 1 : Math.max(jaccard(a, b), dice(a, b)));

// ---------- lato SITO: harvest della regione ----------
function harvestSite(slug) {
  const region = get(`${BASE}/family-destinations/${slug}/`);
  const cities = linksTo(region, new RegExp(`href="/family-destinations/${slug}/[^"/]+/"`, "g"));
  const hotels = [];
  for (const cityUrl of cities) {
    const citySlug = cityUrl.replace(/\/$/, "").split("/").pop();
    const cityHtml = get(`${BASE}${cityUrl}`);
    const hrefs = linksTo(cityHtml, /href="\/family-hotels\/[^"]+"/g);
    for (const href of hrefs) {
      const m = href.match(/\/family-hotels\/(.+)-(\d+)\/$/);
      if (!m) continue;
      const [, nameSlug, id] = m;
      hotels.push({
        site_id: Number(id),
        url: `${BASE}${href}`,
        name: nameSlug.replace(/-/g, " "),
        city: citySlug.replace(/-/g, " "),
      });
    }
  }
  // dedup per site_id
  return [...new Map(hotels.map((h) => [h.site_id, h])).values()];
}

// ---------- lato RADAR: dal DB SQLite ----------
function loadRadar() {
  const sql = `SELECT osm_id AS osm_id, name AS name, COALESCE(city,'') AS city,
                      COALESCE(lat,0) AS lat, COALESCE(lon,0) AS lon
               FROM hotels WHERE region='${radarRegion}' OR (region IS NULL AND country LIKE '${radarCountryLike}' AND city IN
               (SELECT DISTINCT city FROM hotels WHERE region='${radarRegion}'));`;
  const out = execFileSync("sqlite3", ["-json", DB, sql], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  const rows = JSON.parse(out || "[]");
  return rows.map((r) => ({ osm_id: r.osm_id, name: r.name, city: r.city, lat: r.lat, lon: r.lon }));
}

// ---------- match ----------
function matchAll(site, radar) {
  const byCity = new Map();
  for (const r of radar) {
    const k = normCity(r.city);
    if (!byCity.has(k)) byCity.set(k, []);
    byCity.get(k).push(r);
  }
  const bestOf = (cands, name) => {
    let best = null, sc = 0;
    for (const r of cands) { const v = sim(name, r.name); if (v > sc) { sc = v; best = r; } }
    return { best, sc };
  };
  const pairs = [], unmatched = [];
  for (const s of site) {
    // 1) stessa città (soglia 0.5). 2) fallback su TUTTA la regione (soglia più severa 0.72, per non
    // creare falsi positivi tra città diverse — la città sul sito è talvolta la frazione, non il comune).
    let { best, sc } = bestOf(byCity.get(normCity(s.city)) || [], s.name);
    let how = "città";
    if (!(best && sc >= 0.5)) {
      const r = bestOf(radar, s.name);
      if (r.best && r.sc >= 0.72) { best = r.best; sc = r.sc; how = "regione"; }
      else { best = r.best; sc = r.sc; how = null; }
    }
    if (how) {
      // conf ≥ 0.7 → collegamento automatico affidabile; 0.5–0.7 → da rivedere a mano (rischio omonimia).
      pairs.push({ site_id: s.site_id, osm_id: best.osm_id, confidence: Number(sc.toFixed(2)), review: sc < 0.7, match: how, site_name: s.name, radar_name: best.name, city: s.city });
    } else {
      unmatched.push({ site_id: s.site_id, name: s.name, city: s.city, best: best ? best.name : null, score: Number(sc.toFixed(2)) });
    }
  }
  return { pairs, unmatched };
}

// ---------- run ----------
console.log(`\n=== Chiave di join Radar ↔ kidotel.co — regione: ${regionSlug} ===`);
const site = harvestSite(regionSlug);
console.log(`sito: ${site.length} hotel raccolti dalle pagine pubbliche`);
const radar = loadRadar();
console.log(`radar: ${radar.length} hotel nella banca dati (regione ${radarRegion})`);
const { pairs, unmatched } = matchAll(site, radar);
const auto = pairs.filter((p) => !p.review), review = pairs.filter((p) => p.review);
const rate = site.length ? Math.round((pairs.length / site.length) * 100) : 0;
console.log(`\nMATCH: ${pairs.length}/${site.length} collegate (${rate}%) — di cui ${auto.length} automatiche (conf ≥ 0.7) + ${review.length} da rivedere`);
console.log("\nCollegamenti automatici (site_id → osm_id, confidenza):");
for (const p of auto.slice(0, 14)) console.log(`  ${p.site_id} → ${p.osm_id}  [${p.confidence}]  «${p.site_name}» ↔ «${p.radar_name}» (${p.city})`);
if (review.length) {
  console.log("\nDa rivedere (0.5–0.7, possibile omonimia):");
  for (const p of review) console.log(`  ${p.site_id} → ${p.osm_id}  [${p.confidence}]  «${p.site_name}» ↔ «${p.radar_name}» (${p.city})`);
}
if (unmatched.length) {
  console.log(`\nNon collegati (${unmatched.length}) — esempi:`);
  for (const u of unmatched.slice(0, 8)) console.log(`  site_id ${u.site_id}  «${u.name}» (${u.city})  best=${u.best ? `«${u.best}» ${u.score}` : "—"}`);
}
const outDir = join(ROOT, "scripts", "out");
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `match-${regionSlug.replace(/\//g, "-")}.json`);
writeFileSync(outFile, JSON.stringify({ region: regionSlug, radarRegion, site_count: site.length, radar_count: radar.length, matched: pairs.length, match_rate_pct: rate, pairs, unmatched }, null, 2));
console.log(`\nScritto: ${outFile}`);
