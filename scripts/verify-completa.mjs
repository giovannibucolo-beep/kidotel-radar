// VERIFICA end-to-end di "Completa 100%": replica esattamente ciò che fa il comando discover_area
// (stessa query Overpass per area + inserimento dei NUOVI hotel con nome, paese timbrato) e mostra
// il conteggio del DB PRIMA → DOPO. Uso: node scripts/verify-completa.mjs "Germany" 3
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const DB = process.env.KIDOTEL_DB || join(homedir(), "Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite");
const COUNTRY = process.argv[2] || "Germany";
const MAX_REGIONS = parseInt(process.argv[3] || "3", 10);
const UA = "KidotelRadar/0.7 (+https://kidotel.co)";
const EPS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
];
const sqlEsc = (s) => (s == null || s === "" ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'");
function dbq(sql) { const r = spawnSync("sqlite3", [DB], { input: ".timeout 60000\n" + sql, encoding: "utf8", maxBuffer: 256e6 }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); }
const countDe = () => Number(dbq(`SELECT COUNT(*) FROM hotels WHERE country='${COUNTRY}';`)) || 0;

async function op(data) {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const EP of EPS) {
      try {
        const res = await fetch(EP, { method: "POST", headers: { "User-Agent": UA }, body: new URLSearchParams({ data }), signal: AbortSignal.timeout(150000) });
        if (!res.ok) { last = EP + " " + res.status; continue; }
        const txt = await res.text();
        return JSON.parse(txt).elements || [];
      } catch (e) { last = EP + " " + String(e).slice(0, 60); }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("overpass non disponibile: " + last);
}
async function nomId(q) {
  const a = await (await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`, { headers: { "User-Agent": UA } })).json();
  return a && a[0] && a[0].osm_type === "relation" ? 3600000000 + a[0].osm_id : 0;
}

console.log(`Verifica "Completa" su ${COUNTRY} (prime ${MAX_REGIONS} regioni)…`);
const cid = await nomId(COUNTRY);
const regs = (await op(`[out:json][timeout:120];area(${cid})->.a;rel(area.a)["admin_level"="4"]["boundary"="administrative"];out tags;`))
  .filter((e) => (e.tags?.["ISO3166-2"] || "").startsWith((COUNTRY === "Germany" ? "DE" : "") + "-") || COUNTRY !== "Germany")
  .filter((e) => e.tags?.name).slice(0, MAX_REGIONS);
console.log(`Regioni: ${regs.map((r) => r.tags.name).join(", ")}`);

const before = countDe();
console.log(`DB ${COUNTRY} PRIMA: ${before}`);
let attempted = 0;
for (const r of regs) {
  const aid = 3600000000 + r.id;
  const els = await op(`[out:json][timeout:120];(node["tourism"="hotel"](area:${aid});way["tourism"="hotel"](area:${aid}););out center tags;`);
  let sql = "BEGIN;\n", n = 0;
  for (const el of els) {
    const t = el.tags || {}; const name = (t.name || "").trim(); if (!name) continue; // come parse_elements: niente nome → scarta
    const lat = el.lat ?? el.center?.lat ?? 0, lon = el.lon ?? el.center?.lon ?? 0;
    const site = t.website || t["contact:website"] || t.url || null;
    const phone = t.phone || t["contact:phone"] || null;
    const email = t.email || t["contact:email"] || null;
    // INSERT OR IGNORE: aggiunge SOLO i nuovi (UNIQUE osm_type+osm_id), paese timbrato — come discover_area.
    sql += `INSERT OR IGNORE INTO hotels (osm_type,osm_id,name,country,website,phone,email,lat,lon,source,updated_at) VALUES ('${el.type}',${el.id},${sqlEsc(name)},${sqlEsc(COUNTRY)},${sqlEsc(site)},${sqlEsc(phone)},${sqlEsc(email)},${lat},${lon},'OpenStreetMap',datetime('now'));\n`;
    n++;
  }
  sql += "COMMIT;\n"; dbq(sql); attempted += n;
  console.log(`  ${r.tags.name}: ${els.length} elementi, ${n} con nome · DB ${COUNTRY} ora ${countDe()}`);
  await new Promise((x) => setTimeout(x, 1500));
}
const after = countDe();
console.log(`\nDB ${COUNTRY} DOPO: ${after}  →  NUOVI aggiunti: ${after - before}  (su ${attempted} con nome trovati nelle regioni)`);
console.log(after > before ? "✓ VERIFICATO: Completa aggiunge nuovi hotel e il conteggio cresce." : "Nessun nuovo (area già coperta).");
