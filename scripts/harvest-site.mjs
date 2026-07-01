#!/usr/bin/env node
// Harvest dell'INTERO catalogo pubblico di kidotel.co (footer → Destinations).
// BFS su /family-destinations/… : ogni pagina o contiene link più profondi (continente→paese→regione→città)
// o link a schede hotel /family-hotels/<slug>-<id>/. Raccoglie {site_id, name, city, region, country,
// continent} per ogni hotel. Solo pagine PUBBLICHE (niente magic-link/email). Ripartibile: tiene un
// checkpoint delle pagine visitate e appende gli hotel man mano (riprende se interrotto).
//
// Uso:  node scripts/harvest-site.mjs
// Output: scripts/out/site-hotels.jsonl (append)  +  scripts/out/site-catalog.json (finale, deduplicato)

import { mkdirSync, appendFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "scripts", "out");
mkdirSync(OUT, { recursive: true });
const JSONL = join(OUT, "site-hotels.jsonl");
const VISITED = join(OUT, "harvest-visited.json");
const CATALOG = join(OUT, "site-catalog.json");

const BASE = "https://kidotel.co";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const CONC = 10;
const CONTINENTS = ["africa", "asia", "europe", "north-america", "oceania", "south-america"];

async function fetchText(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = AbortSignal.timeout(30000);
      const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" }, signal: ctl });
      if (r.status === 200) return await r.text();
      if (r.status === 404) return "";
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 400 * (i + 1) * (i + 1))); // backoff
  }
  return "";
}

const rxChild = /href="(\/family-destinations\/[a-z0-9-]+(?:\/[a-z0-9-]+)*\/)"/g;
const rxHotel = /href="(\/family-hotels\/([a-z0-9-]+)-(\d+)\/)"/g;
const uniq = (arr) => [...new Set(arr)];

// checkpoint
const visited = new Set(existsSync(VISITED) ? JSON.parse(readFileSync(VISITED, "utf8")) : []);
let pages = 0, hotels = 0, lastSave = Date.now();
function checkpoint() {
  writeFileSync(VISITED, JSON.stringify([...visited]));
}

function parse(url, html) {
  // location dai segmenti dell'URL della pagina: /family-destinations/<cont>/<country>/<region>/<city>/
  const seg = url.replace(/^\/family-destinations\//, "").replace(/\/$/, "").split("/");
  const [continent, country, region, city] = seg;
  const children = uniq([...html.matchAll(rxChild)].map((m) => m[1]))
    .filter((h) => h.split("/").length > url.split("/").length); // solo più profondi
  const found = [];
  for (const m of html.matchAll(rxHotel)) {
    found.push({
      site_id: Number(m[3]),
      slug: m[2],
      name: m[2].replace(/-/g, " "),
      continent: continent || null,
      country: country || null,
      region: region || null,
      city: city || null,
      url: BASE + m[1],
    });
  }
  return { children, found };
}

const queue = [];
const queued = new Set();
function enqueue(url) {
  if (visited.has(url) || queued.has(url)) return;
  queued.add(url); queue.push(url);
}

async function handle(url) {
  const html = await fetchText(BASE + url);
  visited.add(url);
  pages++;
  if (html) {
    const { children, found } = parse(url, html);
    for (const c of children) enqueue(c);
    if (found.length) {
      hotels += found.length;
      appendFileSync(JSONL, found.map((h) => JSON.stringify(h)).join("\n") + "\n");
    }
  }
  if (Date.now() - lastSave > 5000) { checkpoint(); lastSave = Date.now(); console.log(`… ${pages} pagine · ${hotels} hotel · coda ${queue.length}`); }
}

// seed: continenti (o riprendi la coda dai non-visitati impliciti ricamminando dai continenti)
for (const c of CONTINENTS) enqueue(`/family-destinations/${c}/`);

await new Promise((resolve) => {
  let active = 0;
  const pump = () => {
    if (queue.length === 0 && active === 0) return resolve();
    while (active < CONC && queue.length) {
      const url = queue.shift();
      active++;
      handle(url).catch(() => {}).finally(() => { active--; pump(); });
    }
  };
  pump();
});
checkpoint();

// dedup finale per site_id dal JSONL (autorevole anche dopo un riavvio)
const seen = new Map();
for (const line of readFileSync(JSONL, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try { const h = JSON.parse(line); seen.set(h.site_id, h); } catch { /* riga parziale: ignora */ }
}
const catalog = [...seen.values()];
writeFileSync(CATALOG, JSON.stringify(catalog, null, 0));
console.log(`\nFATTO: ${pages} pagine visitate · ${catalog.length} hotel unici → ${CATALOG}`);
