// Cattura gli SCREENSHOT del manuale in-app (Guida), aggiornati ad ogni release così riflettono sempre
// l'interfaccia corrente. Avvia il dev server Vite, carica l'app in un browser headless (Playwright) con
// DATI FINTI (mock dell'invoke Tauri: niente backend, niente dati reali/email → manuale pulito e
// riproducibile), naviga ogni vista e salva i PNG in public/manual/<vista>.<lingua>.png (IT/EN/RU).
// Uso: node scripts/capture-manual.mjs   (lo chiama anche release.mjs prima del build).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "manual");
const PORT = 1420;
const URL = `http://localhost:${PORT}`;
mkdirSync(OUT, { recursive: true });

// ---- DATI FINTI (uguali per tutte le lingue; le etichette arrivano dall'i18n) ----
const HOTELS = [
  { osm_type: "node", osm_id: 1, name: "Grand Hotel Alpina", city: "Zermatt", country: "Switzerland", region: null, province: null, website: "https://alpina.example", phone: null, email: "info@alpina.example", email_status: "ok", source: "OpenStreetMap", lat: 46, lon: 7.7, family_fit_score: 91, score_breakdown: "[]", enrichment: '{"website_ok":true}', contact_status: "trattativa", contact_note: "", contact_updated: null, stars: 5, luxury: 1, price_tier: null, price_eur: null, price_src: null },
  { osm_type: "relation", osm_id: 2, name: "Hotel Schwarzenstein", city: "Lutago", country: "Italy", region: "Trentino-Alto Adige", province: null, website: "https://schwarzenstein.example", phone: null, email: "hotel@schwarzenstein.example", email_status: "ok", source: "OpenStreetMap", lat: 46.9, lon: 11.9, family_fit_score: 84, score_breakdown: "[]", enrichment: '{"website_ok":true}', contact_status: "contattato", contact_note: "", contact_updated: null, stars: 4, luxury: 0, price_tier: 4, price_eur: null, price_src: "€€€€" },
  { osm_type: "node", osm_id: 3, name: "Familotel Sonnwies", city: "Lüsen", country: "Italy", region: "Trentino-Alto Adige", province: null, website: "https://sonnwies.example", phone: null, email: "info@sonnwies.example", email_status: "ok", source: "OpenStreetMap", lat: 46.7, lon: 11.7, family_fit_score: 78, score_breakdown: "[]", enrichment: '{"website_ok":true}', contact_status: "da_contattare", contact_note: "", contact_updated: null, stars: 4, luxury: 0, price_tier: 3, price_eur: 150, price_src: "€120 - €180" },
  { osm_type: "node", osm_id: 4, name: "Strandhotel Lido", city: "Jesolo", country: "Italy", region: "Veneto", province: null, website: "https://lido.example", phone: null, email: "reception@lido.example", email_status: "ok", source: "OpenStreetMap", lat: 45.5, lon: 12.6, family_fit_score: 72, score_breakdown: "[]", enrichment: '{"website_ok":true}', contact_status: "risposto", contact_note: "", contact_updated: null, stars: 3, luxury: 0, price_tier: 2, price_eur: 95, price_src: "€95 - €140" },
  { osm_type: "way", osm_id: 5, name: "Pension Edelweiss", city: "Sölden", country: "Austria", region: "Tyrol", province: null, website: "https://edelweiss.example", phone: null, email: "info@edelweiss.example", email_status: "ok", source: "OpenStreetMap", lat: 47, lon: 11, family_fit_score: 66, score_breakdown: "[]", enrichment: '{"website_ok":true}', contact_status: "da_contattare", contact_note: "", contact_updated: null, stars: 3, luxury: 0, price_tier: null, price_eur: null, price_src: null },
  { osm_type: "node", osm_id: 6, name: "Resort Costa Calma", city: "Fuerteventura", country: "Spain", region: "Canary Islands", province: null, website: "https://costacalma.example", phone: null, email: "info@costacalma.example", email_status: "ok", source: "OpenStreetMap", lat: 28.2, lon: -14, family_fit_score: 63, score_breakdown: "[]", enrichment: '{"website_ok":true}', contact_status: "partner", contact_note: "", contact_updated: null, stars: 4, luxury: 0, price_tier: 3, price_eur: 160, price_src: "€140 - €210" },
];
const MOCK = {
  list_hotels: HOTELS,
  select_hotels: HOTELS,
  count_hotels: 1240,
  count_select: 1240,
  score_stats: { total: 1240, scored: 910, strong: 388 },
  score_histogram: [30, 28, 35, 60, 120, 175, 210, 150, 70, 32],
  coverage_by_country: [
    { country: "Italy", total: 412, scored: 360, strong: 168 },
    { country: "Austria", total: 286, scored: 240, strong: 132 },
    { country: "Germany", total: 220, scored: 150, strong: 60 },
    { country: "Spain", total: 142, scored: 96, strong: 28 },
    { country: "France", total: 96, scored: 48, strong: 12 },
    { country: "Switzerland", total: 84, scored: 16, strong: 8 },
  ],
  osm_counts: { Italy: 520, Austria: 300, Germany: 480 },
  contact_stats: [
    { status: "da_contattare", count: 240 }, { status: "contattato", count: 86 },
    { status: "risposto", count: 34 }, { status: "trattativa", count: 12 },
    { status: "partner", count: 5 }, { status: "rifiutato", count: 9 },
  ],
  review_counts: {},
  areas_scanned_within: [],
  contact_stats_fallback: [],
};

function initScript(lang, mockJson) {
  return `
    try { window.localStorage.setItem("kidotel.lang", ${JSON.stringify(lang)}); } catch (e) {}
    const DATA = ${mockJson};
    window.__TAURI_INTERNALS__ = {
      transformCallback: (cb) => cb,
      invoke: (cmd) => Promise.resolve(cmd in DATA ? DATA[cmd] : null),
    };
  `;
}

async function waitPort(url, ms = 90000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try { const r = await fetch(url); if (r.ok) return true; } catch { /* non ancora pronto */ }
    await sleep(500);
  }
  throw new Error("dev server non pronto entro il timeout");
}

const LANGS = ["it", "en", "ru"];
const mockJson = JSON.stringify(MOCK);

const dev = spawn("pnpm", ["dev"], { cwd: ROOT, stdio: "ignore" });
let browser;
try {
  await waitPort(URL);
  browser = await chromium.launch();
  for (const lang of LANGS) {
    // scale 1.5: nitido anche su display retina alla larghezza del manuale (~560px), ma file più leggeri.
    const ctx = await browser.newContext({ viewport: { width: 880, height: 1180 }, deviceScaleFactor: 1.5 });
    const page = await ctx.newPage();
    await page.addInitScript(initScript(lang, mockJson));
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(900);

    const shot = async (name) => { await page.screenshot({ path: join(OUT, `${name}.${lang}.png`) }); console.log(`  ${name}.${lang}.png`); };
    const navTab = (i) => page.locator(".menu-tab").nth(i).click({ timeout: 5000 }).catch(() => {});

    // 1) HOTEL — elenco piatto (badge stelle ★ + costo € + family-fit)
    await page.locator(".seg-btn").nth(1).click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(700);
    await shot("hotels");

    // 2) COPERTURA (scansiona + aggiungi paese + completa tutti)
    await navTab(2); await page.waitForTimeout(700); await shot("coverage");

    // 3) CRM (acquisizione partner) — usa gli hotel già caricati
    await navTab(3); await page.waitForTimeout(700); await shot("crm");

    // 4) INFOGRAFICA (cruscotto stampabile)
    await navTab(4); await page.waitForTimeout(1100); await shot("infographic");

    await ctx.close();
  }
  console.log("Manuale: screenshot aggiornati in public/manual/");
} finally {
  if (browser) await browser.close();
  dev.kill("SIGTERM");
}
