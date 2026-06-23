// Scansione mondiale "a tappe", incrementale e riprendibile.
// Per ogni zona: Nominatim (bbox) -> Overpass (tourism=hotel) -> inserisce nel DB SQLite dell'app.
// Dedup automatico (UNIQUE osm_type+osm_id). Rilanciandolo salta le zone già fatte.
//   node scripts/world-scan.mjs            # continua dalle zone non ancora fatte
//   node scripts/world-scan.mjs --reset    # riparte da capo (ignora lo stato)
// Per AGGIUNGERE zone: scrivile in PLACES qui sotto e rilancia.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join } from "node:path";

const DB = process.env.KIDOTEL_DB ||
  join(homedir(), "Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite");
const STATE = resolve(join(import.meta.dirname || ".", ".world-scan-done.json"));
const UA = "KidotelRadar/0.3 (https://kidotel.co; contact: info@kidotel.co)";
const OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

// Zone family-rilevanti, sparse su tutti i continenti. Allungare liberamente.
const PLACES = [
  // Europa — Alpi e mare
  "Alto Adige", "Trentino", "Tirolo Austria", "Salisburghese", "Baviera",
  "Toscana", "Emilia-Romagna riviera", "Sardegna", "Sicilia", "Costa Brava",
  "Andalusia", "Mallorca", "Tenerife", "Algarve", "Costa Azzurra", "Corsica",
  "Istria Croazia", "Creta", "Rodi", "Cornovaglia", "Algarve",
  // Africa
  "Marrakech", "Agadir", "Sharm el Sheikh", "Hurghada", "Djerba", "Mauritius",
  "Seychelles", "Zanzibar", "Città del Capo", "Mombasa",
  // Asia / Medio Oriente
  "Bali", "Phuket", "Krabi", "Koh Samui", "Maldive", "Dubai", "Goa",
  "Sri Lanka sud", "Chiang Mai", "Tokyo", "Okinawa", "Cebu",
  // Americhe
  "Cancún", "Riviera Maya", "Punta Cana", "Orlando Florida", "Miami",
  "San Diego", "Maui Hawaii", "Costa Rica Guanacaste", "Bariloche", "Rio de Janeiro",
  // Oceania
  "Gold Coast", "Cairns", "Queenstown Nuova Zelanda", "Fiji", "Sydney",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sqlEsc = (s) => (s == null || s === "" ? "NULL" : "'" + String(s).replace(/'/g, "''") + "'");

function dbExec(sql) {
  const r = spawnSync("sqlite3", [DB], { input: sql, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("sqlite3: " + (r.stderr || "").slice(0, 200));
  return r.stdout.trim();
}
const dbCount = () => Number(dbExec("SELECT COUNT(*) FROM hotels;")) || 0;

async function nominatimBbox(q) {
  const u = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
  const res = await fetch(u, { headers: { "User-Agent": UA } });
  const arr = await res.json();
  if (!arr || !arr[0] || !arr[0].boundingbox) return null;
  const [s, n, w, e] = arr[0].boundingbox.map(Number);
  return { s, n, w, e };
}

async function overpass(b) {
  const q = `[out:json][timeout:90];(node["tourism"="hotel"](${b.s},${b.w},${b.n},${b.e});way["tourism"="hotel"](${b.s},${b.w},${b.n},${b.e}););out center tags;`;
  for (const ep of OVERPASS) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(q),
      });
      if (!res.ok) continue;
      const text = await res.text();
      const v = JSON.parse(text);
      return v.elements || [];
    } catch { /* prova endpoint successivo */ }
  }
  return null; // tutti gli endpoint falliti
}

function rowsToSql(elements) {
  const vals = [];
  for (const el of elements) {
    const t = el.tags || {};
    const name = t.name;
    if (!name || !name.trim()) continue;
    const website = t.website || t["contact:website"] || t.url || null;
    const phone = t.phone || t["contact:phone"] || null;
    const lat = el.lat ?? el.center?.lat ?? 0;
    const lon = el.lon ?? el.center?.lon ?? 0;
    vals.push(
      `(${sqlEsc(el.type || "node")},${el.id || 0},${sqlEsc(name)},${sqlEsc(t["addr:city"])},` +
      `${sqlEsc(t["addr:country"])},${sqlEsc(website)},${sqlEsc(phone)},${lat},${lon},'OpenStreetMap')`,
    );
  }
  return vals;
}

function insert(vals) {
  if (vals.length === 0) return;
  let sql = "BEGIN;\n";
  for (let i = 0; i < vals.length; i += 400) {
    sql += "INSERT OR IGNORE INTO hotels (osm_type,osm_id,name,city,country,website,phone,lat,lon,source) VALUES\n" +
      vals.slice(i, i + 400).join(",\n") + ";\n";
  }
  sql += "COMMIT;\n";
  dbExec(sql);
}

const reset = process.argv.includes("--reset");
let done = new Set();
if (!reset && existsSync(STATE)) {
  try { done = new Set(JSON.parse(readFileSync(STATE, "utf8"))); } catch { /* ignora */ }
}
if (!existsSync(DB)) {
  console.error("Database non trovato:", DB, "\nApri Kidotel Radar almeno una volta (fa una scansione) e riprova.");
  process.exit(1);
}

const todo = PLACES.filter((p) => !done.has(p));
console.log(`Zone totali: ${PLACES.length} · già fatte: ${done.size} · da fare: ${todo.length} · DB: ${dbCount()} hotel\n`);

for (let i = 0; i < todo.length; i++) {
  const place = todo[i];
  try {
    const b = await nominatimBbox(place);
    if (!b) { console.log(`[${i + 1}/${todo.length}] ${place} — luogo non trovato, salto`); }
    else if ((b.n - b.s) * (b.e - b.w) > 2000) { console.log(`[${i + 1}/${todo.length}] ${place} — area troppo grande, salto`); }
    else {
      const els = await overpass(b);
      if (els == null) { console.log(`[${i + 1}/${todo.length}] ${place} — Overpass non disponibile, riprovo al prossimo giro`); continue; }
      insert(rowsToSql(els));
      console.log(`[${i + 1}/${todo.length}] ${place} — ${els.length} elementi → DB ora ${dbCount()} hotel`);
    }
    done.add(place);
    writeFileSync(STATE, JSON.stringify([...done], null, 0));
  } catch (e) {
    console.log(`[${i + 1}/${todo.length}] ${place} — errore: ${String(e).slice(0, 120)} (riprovo al prossimo giro)`);
  }
  await sleep(1300); // gentile con Nominatim/Overpass
}

console.log(`\nFatto questo giro. DB: ${dbCount()} hotel. Rilancia per incrementare o aggiungi zone in PLACES.`);
