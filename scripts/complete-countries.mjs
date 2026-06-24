// COMPLETA PIÙ PAESI verso il 100% — pensato per girare di NOTTE, da un solo comando.
// Per ogni paese enumera le regioni (admin_level=4, filtrate al paese via ISO3166-2) e le scansiona
// PER AREA (osm_id) — stessa logica verificata di "Completa", SENZA Nominatim per regione. Inserisce
// solo i NUOVI hotel con nome, paese timbrato. CONCORRENTE (più regioni insieme), RIPRENDIBILE
// (stato su file: le regioni già fatte si saltano), con garbo verso Overpass. A fine giro fa il
// geo-backfill dei nuovi.
//
//   node scripts/complete-countries.mjs "Germany,Spain,United States,France"
//   POOL=3 node scripts/complete-countries.mjs            # usa la lista di default
//   node scripts/complete-countries.mjs --reset "Germany" # ignora lo stato e rifà
//
// Suggerimento per la notte (niente standby del Mac):
//   caffeinate -i node scripts/complete-countries.mjs "Germany,Spain,United States"
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const DB = process.env.KIDOTEL_DB || join(homedir(), "Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite");
const POOL = Math.max(1, parseInt(process.env.POOL || "3", 10)); // regioni in parallelo (garbo verso Overpass)
const UA = "KidotelRadar/0.7 (+https://kidotel.co; contact info@kidotel.co)";
const STATE = resolve(import.meta.dirname, ".complete-done.json");
const EPS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
];
const DEFAULT_COUNTRIES = [
  "Germany", "Spain", "France", "United States", "United Kingdom", "Portugal", "Greece",
  "Croatia", "Netherlands", "Switzerland", "Poland", "Czechia", "Turkey", "Japan",
];

const args = process.argv.slice(2);
const reset = args.includes("--reset");
const listArg = args.find((a) => !a.startsWith("--"));
const COUNTRIES = (listArg ? listArg.split(",") : DEFAULT_COUNTRIES).map((s) => s.trim()).filter(Boolean);

const sqlEsc = (s) => (s == null || s === "" ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'");
function dbq(sql) {
  const r = spawnSync("sqlite3", [DB], { input: ".timeout 120000\n" + sql, encoding: "utf8", maxBuffer: 256e6 });
  if (r.status !== 0) throw new Error("sqlite3: " + (r.stderr || "").slice(0, 200));
  return r.stdout.trim();
}
const countCountry = (c) => Number(dbq(`SELECT COUNT(*) FROM hotels WHERE country=${sqlEsc(c)};`)) || 0;

const done = !reset && existsSync(STATE) ? new Set(JSON.parse(readFileSync(STATE, "utf8"))) : new Set();
const saveState = () => writeFileSync(STATE, JSON.stringify([...done]));

async function op(data, timeoutMs = 150000) {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const EP of EPS) {
      try {
        const res = await fetch(EP, { method: "POST", headers: { "User-Agent": UA }, body: new URLSearchParams({ data }), signal: AbortSignal.timeout(timeoutMs) });
        if (!res.ok) { last = `${EP} ${res.status}`; continue; }
        return JSON.parse(await res.text()).elements || [];
      } catch (e) { last = `${EP} ${String(e).slice(0, 50)}`; }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("overpass non disponibile: " + last);
}
async function nominatim(q) {
  const a = await (await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&addressdetails=1`, { headers: { "User-Agent": UA } })).json();
  if (!a || !a[0] || a[0].osm_type !== "relation") return null;
  return { areaId: 3600000000 + a[0].osm_id, cc: (a[0].address?.country_code || "").toUpperCase() };
}

// inserisce i NUOVI hotel con nome di una regione (area), paese timbrato. Ritorna # nuovi.
async function scanRegion(country, areaId) {
  const els = await op(`[out:json][timeout:120];(node["tourism"="hotel"](area:${areaId});way["tourism"="hotel"](area:${areaId}););out center tags;`);
  let sql = "BEGIN;\n", named = 0;
  for (const el of els) {
    const t = el.tags || {}; const name = (t.name || "").trim(); if (!name) continue;
    const lat = el.lat ?? el.center?.lat ?? 0, lon = el.lon ?? el.center?.lon ?? 0;
    sql += `INSERT OR IGNORE INTO hotels (osm_type,osm_id,name,country,website,phone,email,lat,lon,source,updated_at) VALUES ('${el.type}',${el.id},${sqlEsc(name)},${sqlEsc(country)},${sqlEsc(t.website || t["contact:website"] || t.url || null)},${sqlEsc(t.phone || t["contact:phone"] || null)},${sqlEsc(t.email || t["contact:email"] || null)},${lat},${lon},'OpenStreetMap',datetime('now'));\n`;
    named++;
  }
  sql += "COMMIT;\n"; dbq(sql);
  return named;
}

// --- costruisci la worklist (paese → regioni) ---
console.log(`Completa paesi: ${COUNTRIES.join(", ")}\nConcorrenza ${POOL} regioni. Stato: ${done.size} regioni già fatte.\n`);
const work = [];
for (const country of COUNTRIES) {
  try {
    const info = await nominatim(country);
    if (!info) { console.log(`! ${country}: non geocodificato, salto`); continue; }
    await new Promise((r) => setTimeout(r, 1100)); // garbo verso Nominatim
    const regs = await op(`[out:json][timeout:120];area(${info.areaId})->.a;rel(area.a)["admin_level"="4"]["boundary"="administrative"];out tags;`);
    let added = 0;
    for (const e of regs) {
      const iso = (e.tags?.["ISO3166-2"] || "").toUpperCase();
      if (info.cc && !iso.startsWith(info.cc + "-")) continue; // solo regioni DEL paese
      if (!e.tags?.name || !e.id) continue;
      const key = `${country}|${e.id}`;
      if (done.has(key)) continue;
      work.push({ country, name: e.tags.name, areaId: 3600000000 + e.id, key });
      added++;
    }
    console.log(`• ${country}: ${added} regioni da fare`);
  } catch (e) { console.log(`! ${country}: ${String(e).slice(0, 80)}`); }
}
console.log(`\nTotale regioni da scansionare: ${work.length}\n`);

// --- esegui con concorrenza POOL ---
let idx = 0, processed = 0, totalNew = 0;
const startCounts = Object.fromEntries(COUNTRIES.map((c) => [c, countCountry(c)]));
async function worker() {
  while (idx < work.length) {
    const item = work[idx++];
    try {
      const n = await scanRegion(item.country, item.areaId);
      totalNew += n;
      done.add(item.key); saveState();
      processed++;
      console.log(`[${processed}/${work.length}] ${item.country} · ${item.name}: ${n} con nome · DB ${item.country}=${countCountry(item.country)}`);
    } catch (e) {
      console.log(`[skip] ${item.country} · ${item.name}: ${String(e).slice(0, 80)} (riprovabile al prossimo giro)`);
    }
    await new Promise((r) => setTimeout(r, 800)); // garbo verso Overpass
  }
}
await Promise.all(Array.from({ length: POOL }, worker));

console.log("\n=== Riepilogo ===");
for (const c of COUNTRIES) console.log(`  ${c}: ${startCounts[c]} → ${countCountry(c)}  (+${countCountry(c) - startCounts[c]})`);

// geo-backfill dei nuovi (regione/città/paese dalle coordinate, offline)
console.log("\nGeolocalizzo i nuovi hotel…");
const bf = spawnSync("python3", [resolve(import.meta.dirname, "backfill-geo.py"), "--new"], { stdio: "inherit" });
if (bf.status !== 0) console.log("⚠ backfill non riuscito: lancia a mano python3 scripts/backfill-geo.py --new");
console.log("\nFatto. Rilancia per riprendere/continuare (le regioni fatte si saltano). Poi: score-free + harvest-emails per valutare/contattare i nuovi.");
