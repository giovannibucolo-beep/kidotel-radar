// Riempie la classificazione a STELLE (tag OSM `stars`) per gli hotel GIÀ in archivio, interrogando
// Overpass per osm_id a blocchi. Resumibile (lavora su `stars IS NULL`), gentile con Overpass.
// Gli hotel controllati ma senza stelle vengono marcati con stars=0 (così non si ri-controllano).
//   node scripts/backfill-stars.mjs
//   KIDOTEL_DB=/percorso node scripts/backfill-stars.mjs
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const DB = process.env.KIDOTEL_DB ||
  join(homedir(), "Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite");
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const BATCH = Math.max(20, parseInt(process.env.BATCH || "180", 10));
const MAX = parseInt(process.env.MAX || "0", 10); // 0 = tutto; >0 = ferma dopo N blocchi (per test)

function db(sql) {
  const r = spawnSync("sqlite3", [DB], { input: ".timeout 60000\n" + sql, encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr || "sqlite error");
  return r.stdout;
}
const esc = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// stessa logica di parse_stars (Rust): prima cifra 1–5; "S"/superior; lusso = 5 Superior o luxury=yes.
function parseStars(raw, luxTag) {
  if (raw == null) return [0, luxTag ? 1 : 0]; // controllato, nessuna stella → 0
  const m = String(raw).match(/[1-5]/);
  const d = m ? Number(m[0]) : 0;
  const superior = /s/i.test(String(raw));
  const lux = luxTag || (d === 5 && superior);
  return [d, lux ? 1 : 0];
}

async function overpass(q) {
  for (const ep of ENDPOINTS) {
    try {
      const r = await fetch(ep, { method: "POST", body: new URLSearchParams({ data: q }), signal: AbortSignal.timeout(90000) });
      if (r.ok) return (await r.json()).elements || [];
    } catch { /* prova l'endpoint successivo */ }
  }
  return null;
}

// assicura le colonne (se l'app non ha ancora migrato il DB): l'errore "duplicate column" è atteso.
for (const col of ["stars INTEGER", "luxury INTEGER"]) {
  spawnSync("sqlite3", [DB, `ALTER TABLE hotels ADD COLUMN ${col};`], { encoding: "utf8" });
}

let checked = 0, withStars = 0, blocks = 0;
console.log("Backfill stelle da OpenStreetMap…");
while (true) {
  const out = db(`SELECT osm_type, osm_id FROM hotels WHERE stars IS NULL ORDER BY osm_id LIMIT ${BATCH};`).trim();
  if (!out) break;
  const items = out.split("\n").map((l) => l.split("|"));
  const byType = { node: [], way: [], relation: [] };
  for (const [t, id] of items) if (byType[t]) byType[t].push(id);
  const parts = [];
  if (byType.node.length) parts.push(`node(id:${byType.node.join(",")});`);
  if (byType.way.length) parts.push(`way(id:${byType.way.join(",")});`);
  if (byType.relation.length) parts.push(`relation(id:${byType.relation.join(",")});`);
  const els = await overpass(`[out:json][timeout:90];(${parts.join("")});out tags;`);
  if (els == null) { console.log("Overpass non risponde, riprovo tra 10s…"); await new Promise((r) => setTimeout(r, 10000)); continue; }

  const found = new Map();
  for (const e of els) found.set(`${e.type}/${e.id}`, parseStars(e.tags && e.tags.stars, e.tags && e.tags.luxury === "yes"));
  const updates = items.map(([t, id]) => {
    const [s, lux] = found.get(`${t}/${id}`) || [0, 0];
    if (s >= 1) withStars++;
    return `UPDATE hotels SET stars=${s}, luxury=${lux} WHERE osm_type=${esc(t)} AND osm_id=${id};`;
  });
  db("BEGIN;\n" + updates.join("\n") + "\nCOMMIT;");
  checked += items.length;
  blocks++;
  const remaining = db("SELECT COUNT(*) FROM hotels WHERE stars IS NULL;").trim();
  console.log(`controllati ${checked} · con classificazione ${withStars} · restano ${remaining}`);
  if (MAX && blocks >= MAX) { console.log(`(fermato dopo ${MAX} blocchi, MAX impostato)`); break; }
  await new Promise((r) => setTimeout(r, 1200)); // gentile con Overpass
}
console.log(`Fatto. ${withStars} hotel con classificazione su ${checked} controllati.`);
