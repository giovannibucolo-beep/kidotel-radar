// Marca le CATENE / non-indipendenti / OTA (is_chain=1) per escluderli da working set e sito.
// Criterio di PRECISIONE (mai marcare un hotel family vero): (1) host del sito = dominio di catena
// o OTA noto, (2) nome che contiene un brand di catena. NIENTE soglia "host condiviso ≥N": i
// portali turistici regionali (es. valgardena.it) la facevano scattare su veri hotel family.
// Idempotente. Stampa anche i portali candidati (host condivisi) solo come REPORT da rivedere.
//   node scripts/flag-chains.mjs
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const DB = process.env.KIDOTEL_DB ||
  join(homedir(), "Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite");

// domini di catena / OTA (match per suffisso host). Curati: solo gruppi globali certi.
const CHAIN_DOMAINS = [
  "marriott.com", "hilton.com", "wyndhamhotels.com", "choicehotels.com", "ihg.com",
  "bestwestern.com", "hyatt.com", "radissonhotels.com", "accor.com", "hotel-bb.com", "hotelf1.com",
  "premierinn.com", "travelodge.co.uk", "melia.com", "melia.es", "barcelo.com", "riu.com",
  "iberostar.com", "nh-hotels.com", "nh-collection.com", "h10hotels.com", "eurostarshotels.com",
  "scandichotels.com", "motel-one.com", "leonardo-hotels.com", "maritim.com", "dorint.com",
  "hrewards.com", "steigenberger.com", "movenpick.com", "toyoko-inn.com", "apahotel.com",
  "superhotel.co.jp", "ibis.com", "mercure.com", "novotel.com", "sofitel.com", "pullmanhotels.com",
  // OTA / aggregatori: il "sito" non è quello dell'hotel → inutile per outreach/prova
  "booking.com", "expedia.com", "expedia.it", "hotels.com", "agoda.com", "tripadvisor.com",
  "tripadvisor.it", "trivago.com", "airbnb.com", "airbnb.it", "hostelworld.com", "hrs.com",
  "kayak.com", "trip.com", "ctrip.com",
  // aggiunti dal report del primo giro
  "sonesta.com", "super8.com.cn", "extendedstayamerica.com", "accorhotels.com", "redroof.com",
  "woodspring.com", "globales.com", "petitpalace.com", "blueseahotels.com", "onahotels.com",
  "omnihotels.com", "fourseasons.com", "facebook.com",
];

function db(sql) {
  const r = spawnSync("sqlite3", ["-json", DB], { input: ".timeout 60000\n" + sql, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("sqlite3: " + (r.stderr || "").slice(0, 300));
  return r.stdout.trim() ? JSON.parse(r.stdout) : [];
}
function exec(sql) {
  const r = spawnSync("sqlite3", [DB], { input: ".timeout 60000\n" + sql, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("sqlite3: " + (r.stderr || "").slice(0, 300));
}
const sqlEsc = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

// brand di catena / aggregatori (sottostringa, lowercase). Solo i principali, globali.
const BRANDS = [
  "holiday inn", "best western", "ibis", "mercure", "novotel", "sofitel", "pullman", "accor",
  "hilton", "hampton", "doubletree", "embassy suites", "homewood", "tru by", "curio",
  "marriott", "courtyard", "residence inn", "fairfield", "springhill", "ac hotel", "moxy", "aloft",
  "four points", "sheraton", "westin", "w hotel", "ritz-carlton", "autograph", "le meridien",
  "hyatt", "comfort inn", "comfort suites", "quality inn", "quality suites", "clarion", "sleep inn",
  "days inn", "super 8", "motel 6", "travelodge", "ramada", "wyndham", "la quinta", "howard johnson",
  "baymont", "microtel", "premier inn", "b&b hotel", "b and b hotel", "campanile", "kyriad",
  "premiere classe", "première classe", "radisson", "park inn", "crowne plaza", "intercontinental",
  "staybridge", "candlewood", "indigo hotel", "nh hotel", "nh collection", "melia", "meliá",
  "barcelo", "barceló", "riu hotel", "iberostar", "h10 hotel", "eurostars", "scandic", "motel one",
  "a&o hostel", "a&o hotel", "leonardo hotel", "maritim", "dorint", "steigenberger", "mövenpick",
  "movenpick", "hampton by hilton", "ロワジール", "toyoko inn", "apa hotel", "super hotel",
];

console.log("Leggo nome+sito…");
const rows = db("SELECT osm_type, osm_id, name, website, family_fit_score FROM hotels WHERE website IS NOT NULL AND website<>'';");
console.log(`Hotel con sito: ${rows.length}`);

const hostCount = new Map();
for (const r of rows) { const h = hostOf(r.website); if (h) hostCount.set(h, (hostCount.get(h) || 0) + 1); }
const isChainHost = (h) => !!h && CHAIN_DOMAINS.some((d) => h === d || h.endsWith("." + d));

// decidi flag per ogni hotel (solo domini catena/OTA curati + brand nel nome)
const toFlag = [];
let byHost = 0, byName = 0;
for (const r of rows) {
  const h = hostOf(r.website);
  const nameL = (r.name || "").toLowerCase();
  const isHost = isChainHost(h);
  // brand nel nome: criterio più debole → NON lo applichiamo agli hotel family verificati (≥60),
  // per non perdere mai un family hotel reale per un'omonimia di brand. Il dominio resta definitivo.
  const isName = BRANDS.some((b) => nameL.includes(b)) && (r.family_fit_score || 0) < 60;
  if (isHost || isName) {
    toFlag.push(r);
    if (isHost) byHost++; else byName++;
  }
}

console.log(`Da marcare: ${toFlag.length} (dominio catena/OTA: ${byHost}, brand nel nome: ${byName}).`);
exec("UPDATE hotels SET is_chain=NULL;"); // reset per idempotenza
for (let i = 0; i < toFlag.length; i += 1000) {
  const blk = toFlag.slice(i, i + 1000);
  let sql = "BEGIN;\n";
  for (const r of blk) sql += `UPDATE hotels SET is_chain=1 WHERE osm_type=${sqlEsc(r.osm_type)} AND osm_id=${r.osm_id};\n`;
  sql += "COMMIT;\n";
  exec(sql);
}

const tot = db("SELECT SUM(is_chain=1) c, SUM(is_chain=1 AND family_fit_score>=60) c60 FROM hotels;")[0];
console.log(`Fatto. Marcati come catena/OTA: ${tot.c}. Di cui family≥60: ${tot.c60} (inventario reale perso ~zero).`);
// REPORT (non flaggato): host molto condivisi NON in lista → forse portali regionali o catene da aggiungere
console.log("\nReport — host molto condivisi NON marcati (rivedere se catena o portale):");
[...hostCount.entries()].filter(([h, n]) => n >= 10 && !isChainHost(h)).sort((a, b) => b[1] - a[1]).slice(0, 15)
  .forEach(([h, n]) => console.log(`  ${n}\t${h}`));
