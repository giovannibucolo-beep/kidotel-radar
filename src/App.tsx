import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { useI18n, type Lang, type TKey } from "./i18n";
import { APP_VERSION } from "./version";
import MapView, { type MapPoint } from "./components/MapView";
import { Icon } from "./components/Icon";
import { Wordmark, wordmarkSvg } from "./components/Wordmark";
import { GUIDE, NEWS } from "./guide";
import "./App.css";

// Messaggio LIVE «riparametrato sulla lingua»: invece di salvare una STRINGA già tradotta (che resta
// congelata nella lingua di quando è stata creata), salviamo una funzione che produce il testo con la
// lingua CORRENTE. Così l'avanzamento delle scansioni e la didascalia archivio si traducono al volo
// quando l'utente cambia lingua, anche a scansione in corso.
type LiveMsg = (tr: (k: TKey) => string, lg: Lang) => string;

// Impostazioni dell'app, persistite in localStorage.
type Theme = "auto" | "light" | "dark";
type Settings = { theme: Theme; familyThreshold: number; renderCap: number; erValue: number; erComm: number; erVolume: number; claimBase: string; bookingAid: string };
const DEFAULT_SETTINGS: Settings = { theme: "auto", familyThreshold: 60, renderCap: 500, erValue: 700, erComm: 4, erVolume: 20, claimBase: "https://kidotel.co", bookingAid: "" };
const SETTINGS_KEY = "kidotel.settings";
function loadSettings(): Settings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; } catch { return DEFAULT_SETTINGS; }
}

// #8 — criteri di selezione per l'export "cowork".
type ExportSel = {
  scope: "all" | "continent" | "country";
  continent: string;       // chiave continente (CONTINENT_ORDER) quando scope="continent"
  country: string;         // nome paese quando scope="country"
  useScoreRange: boolean;  // attiva la fascia di punteggio
  scoreMin: number;
  scoreMax: number;
  useTopN: boolean;        // "le migliori N"
  topN: number;
  onlyScored: boolean;
  onlyContactable: boolean;
  onlyDeliverable: boolean;
};
const DEFAULT_EXPORT_SEL: ExportSel = {
  scope: "all", continent: "europe", country: "",
  useScoreRange: false, scoreMin: 60, scoreMax: 100,
  useTopN: false, topN: 1000,
  onlyScored: false, onlyContactable: false, onlyDeliverable: false,
};
// Argomenti per i comandi count_select/select_hotels (camelCase = SelectArgs lato Rust).
type SelectArgs = {
  countries: string[];
  scoreMin: number | null;
  scoreMax: number | null;
  onlyScored: boolean;
  onlyContactable: boolean;
  onlyDeliverable: boolean;
  limit: number | null;
};

type Hotel = {
  osm_type: string;
  osm_id: number;
  name: string;
  city: string | null;
  country: string | null;
  region?: string | null;
  province?: string | null;
  website: string | null;
  phone: string | null;
  email?: string | null;
  email_status?: string | null;
  source: string;
  lat: number;
  lon: number;
  stars?: number | null;
  luxury?: number | null;
  price_tier?: number | null; // fascia di costo REALE dal sito (priceRange) 1–5
  price_eur?: number | null;  // prezzo a notte (≈ EUR) quando il sito lo pubblica
  price_src?: string | null;  // prova: il valore priceRange citato dal sito
};

type DiscoverResult = { area_label: string; count: number; hotels: Hotel[] };
type SubArea = { name: string; osm_type: string; osm_id: number; s: number; n: number; w: number; e: number };

type HotelRow = {
  osm_type: string;
  osm_id: number;
  name: string;
  city: string | null;
  country: string | null;
  region: string | null;
  province: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  lat: number;
  lon: number;
  source: string | null;
  family_fit_score: number | null;
  score_breakdown: string | null;
  enrichment: string | null;
  contact_status: string | null;
  contact_note: string | null;
  contact_updated: string | null;
  email_status: string | null;
  stars: number | null;
  luxury: number | null;
  price_tier: number | null;
  price_eur: number | null;
  price_src: string | null;
};

// Riga LEGGERA per il CRM (corrisponde a CrmRow lato Rust): solo i campi utili all'acquisizione,
// così si carica TUTTO l'archivio contattabile (non solo i primi 5000) senza trasferire i breakdown.
type CrmRowLite = {
  osm_type: string;
  osm_id: number;
  name: string;
  city: string | null;
  country: string | null;
  region: string | null;
  province: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  email_status: string | null;
  lat: number;
  lon: number;
  family_fit_score: number | null;
  stars: number | null;
  contact_status: string | null;
  contact_note: string | null;
};

type SignalResult = {
  key: string;
  weight: number;
  present: boolean;
  quote: string | null;
  url: string | null;
};

type EnrichResult = {
  website_ok: boolean;
  pages_fetched: number;
  family_fit_score: number;
  signals: SignalResult[];
};
// Risultato del comando enrich_batch: un blocco di hotel valutati in una volta sola.
type EnrichOne = EnrichResult & { id: string };
type EnrichBatch = { processed: number; remaining: number; results: EnrichOne[] };

type ScoreStats = { total: number; with_site: number; scored: number; strong: number; to_score: number };

// #9 — dati e opzioni dell'infografica stampabile.
type InfoData = {
  stats: ScoreStats;
  hist: number[]; // 10 fasce 0–9 … 90–100
  topCountries: { country: string; family: number; total: number }[];
  continents: { key: string; total: number; family: number }[];
  funnel: { status: string; count: number }[];
  contactable: number;
  famContactable: number;
  erTotalFamily: number;
};
type InfoOpts = {
  orientation: "portrait" | "landscape";
  kpi: boolean; dist: boolean; countries: boolean; conts: boolean; funnel: boolean; value: boolean;
};
const DEFAULT_INFO_OPTS: InfoOpts = { orientation: "portrait", kpi: true, dist: true, countries: true, conts: true, funnel: true, value: true };

// Indice di valore per paese (assunzione, regolabile in futuro): fascia di prezzo media relativa.
const COUNTRY_VALUE: Record<string, number> = {
  Monaco: 2.0, Maldives: 1.8, Switzerland: 1.7, Norway: 1.5, Iceland: 1.5,
  "United Arab Emirates": 1.4, "United States": 1.3, Denmark: 1.3, "United Kingdom": 1.2,
  Australia: 1.2, Sweden: 1.2, Finland: 1.2, France: 1.1, Germany: 1.1, Austria: 1.1,
  Netherlands: 1.1, Canada: 1.1, Japan: 1.1, "New Zealand": 1.1, Ireland: 1.1, Belgium: 1.1,
  Italy: 1.0, Spain: 0.9, Slovenia: 0.9, Portugal: 0.85, Greece: 0.85, Croatia: 0.85,
  Czechia: 0.8, Poland: 0.75, Hungary: 0.75, "South Africa": 0.7, Mexico: 0.7, Brazil: 0.7,
  "Russian Federation": 0.7, "Tanzania, United Republic of": 0.7, Malaysia: 0.65, Argentina: 0.65,
  Thailand: 0.6, Indonesia: 0.6, Turkey: 0.6, "Türkiye": 0.6, Morocco: 0.6, Tunisia: 0.55,
  Vietnam: 0.55, "Viet Nam": 0.55, Egypt: 0.5, India: 0.5,
};
const COUNTRY_VALUE_DEFAULT = 0.9;
const ARCHIVE_PAGE = 5000; // righe per pagina dell'archivio (paginazione dell'elenco piatto)

// Fascia di costo $ → $$$$$ (1–5). COMBINATO: se il sito pubblica una fascia di prezzo (schema.org
// priceRange, salvata in price_tier) usiamo quel dato REALE; altrimenti una STIMA derivata da segnali
// reali — stelle ★ (da OSM) + lusso + indice costo-vita del paese (COUNTRY_VALUE). Niente prezzo
// inventato: la stima è dichiarata come tale (badge più tenue + tooltip). Restituisce null quando non
// c'è alcun segnale (né prezzo reale, né stelle, né paese noto) per non mostrare un livello a caso.
function priceTierOf(h: Hotel): { tier: number; isReal: boolean; eur: number | null; src: string | null } | null {
  const real = h.price_tier && h.price_tier >= 1 && h.price_tier <= 5 ? h.price_tier : null;
  if (real) return { tier: real, isReal: true, eur: h.price_eur ?? null, src: h.price_src ?? null };
  const stars = h.stars && h.stars >= 1 ? h.stars : null;
  const lux = !!h.luxury;
  const cv = h.country ? COUNTRY_VALUE[h.country] : undefined;
  if (!stars && cv === undefined && !lux) return null; // nessun segnale → niente stima
  const base = lux ? 5 : stars ?? 3;
  const adj = (cv ?? COUNTRY_VALUE_DEFAULT) - 1.0; // paese caro spinge su, economico spinge giù
  const tier = Math.max(1, Math.min(5, Math.round(base + adj * 1.5)));
  return { tier, isReal: false, eur: null, src: null };
}

// Lista CANONICA dei paesi del mondo (nome + continente, ordinati per continente poi alfabetico).
// Guida: (a) il selettore «aggiungi paese» con ricerca, (b) la scansione «Completa tutti» che ora
// copre OGNI paese — non solo quelli già in archivio — con un cursore di ripresa. I nomi sono quelli
// salvati nel DB (pycountry) dove già presenti, così la copertura non si sdoppia; `q` è la query
// Nominatim quando il nome pycountry non si geocodifica bene (es. «Russian Federation» → «Russia»).
type WorldCountry = { n: string; c: string; q?: string };
const WORLD_COUNTRIES: WorldCountry[] = [
  // EUROPA
  { n: "Albania", c: "europe" }, { n: "Andorra", c: "europe" }, { n: "Austria", c: "europe" },
  { n: "Belarus", c: "europe" }, { n: "Belgium", c: "europe" }, { n: "Bosnia and Herzegovina", c: "europe" },
  { n: "Bulgaria", c: "europe" }, { n: "Croatia", c: "europe" }, { n: "Cyprus", c: "europe" },
  { n: "Czechia", c: "europe" }, { n: "Denmark", c: "europe" }, { n: "Estonia", c: "europe" },
  { n: "Finland", c: "europe" }, { n: "France", c: "europe" }, { n: "Germany", c: "europe" },
  { n: "Gibraltar", c: "europe" }, { n: "Greece", c: "europe" },
  { n: "Holy See (Vatican City State)", c: "europe", q: "Vatican City" }, { n: "Hungary", c: "europe" },
  { n: "Iceland", c: "europe" }, { n: "Ireland", c: "europe" }, { n: "Italy", c: "europe" },
  { n: "Kosovo", c: "europe" }, { n: "Latvia", c: "europe" }, { n: "Liechtenstein", c: "europe" },
  { n: "Lithuania", c: "europe" }, { n: "Luxembourg", c: "europe" }, { n: "Malta", c: "europe" },
  { n: "Moldova", c: "europe" }, { n: "Monaco", c: "europe" }, { n: "Montenegro", c: "europe" },
  { n: "Netherlands", c: "europe" }, { n: "North Macedonia", c: "europe" }, { n: "Norway", c: "europe" },
  { n: "Poland", c: "europe" }, { n: "Portugal", c: "europe" }, { n: "Romania", c: "europe" },
  { n: "Russian Federation", c: "europe", q: "Russia" }, { n: "San Marino", c: "europe" },
  { n: "Serbia", c: "europe" }, { n: "Slovakia", c: "europe" }, { n: "Slovenia", c: "europe" },
  { n: "Spain", c: "europe" }, { n: "Sweden", c: "europe" }, { n: "Switzerland", c: "europe" },
  { n: "Türkiye", c: "europe", q: "Turkey" }, { n: "Ukraine", c: "europe" }, { n: "United Kingdom", c: "europe" },
  // ASIA
  { n: "Afghanistan", c: "asia" }, { n: "Armenia", c: "asia" }, { n: "Azerbaijan", c: "asia" },
  { n: "Bahrain", c: "asia" }, { n: "Bangladesh", c: "asia" }, { n: "Bhutan", c: "asia" },
  { n: "Brunei Darussalam", c: "asia", q: "Brunei" }, { n: "Cambodia", c: "asia" }, { n: "China", c: "asia" },
  { n: "Georgia", c: "asia" }, { n: "India", c: "asia" }, { n: "Indonesia", c: "asia" },
  { n: "Iran", c: "asia" }, { n: "Iraq", c: "asia" }, { n: "Israel", c: "asia" }, { n: "Japan", c: "asia" },
  { n: "Jordan", c: "asia" }, { n: "Kazakhstan", c: "asia" }, { n: "Korea, Republic of", c: "asia", q: "South Korea" },
  { n: "Kuwait", c: "asia" }, { n: "Kyrgyzstan", c: "asia" },
  { n: "Lao People's Democratic Republic", c: "asia", q: "Laos" }, { n: "Lebanon", c: "asia" },
  { n: "Malaysia", c: "asia" }, { n: "Maldives", c: "asia" }, { n: "Mongolia", c: "asia" },
  { n: "Myanmar", c: "asia" }, { n: "Nepal", c: "asia" }, { n: "Oman", c: "asia" }, { n: "Pakistan", c: "asia" },
  { n: "Palestine, State of", c: "asia", q: "Palestine" }, { n: "Philippines", c: "asia" }, { n: "Qatar", c: "asia" },
  { n: "Saudi Arabia", c: "asia" }, { n: "Singapore", c: "asia" }, { n: "Sri Lanka", c: "asia" },
  { n: "Tajikistan", c: "asia" }, { n: "Thailand", c: "asia" }, { n: "Timor-Leste", c: "asia" },
  { n: "Turkmenistan", c: "asia" }, { n: "United Arab Emirates", c: "asia" }, { n: "Uzbekistan", c: "asia" },
  { n: "Viet Nam", c: "asia", q: "Vietnam" },
  // AFRICA
  { n: "Algeria", c: "africa" }, { n: "Angola", c: "africa" }, { n: "Benin", c: "africa" },
  { n: "Botswana", c: "africa" }, { n: "Burkina Faso", c: "africa" }, { n: "Burundi", c: "africa" },
  { n: "Cabo Verde", c: "africa", q: "Cape Verde" }, { n: "Cameroon", c: "africa" },
  { n: "Comoros", c: "africa" }, { n: "Côte d'Ivoire", c: "africa", q: "Ivory Coast" },
  { n: "Democratic Republic of the Congo", c: "africa" }, { n: "Djibouti", c: "africa" },
  { n: "Egypt", c: "africa" }, { n: "Eswatini", c: "africa" }, { n: "Ethiopia", c: "africa" },
  { n: "Gabon", c: "africa" }, { n: "Gambia", c: "africa" }, { n: "Ghana", c: "africa" },
  { n: "Guinea", c: "africa" }, { n: "Kenya", c: "africa" }, { n: "Lesotho", c: "africa" },
  { n: "Liberia", c: "africa" }, { n: "Libya", c: "africa" }, { n: "Madagascar", c: "africa" },
  { n: "Malawi", c: "africa" }, { n: "Mali", c: "africa" }, { n: "Mauritania", c: "africa" },
  { n: "Mauritius", c: "africa" }, { n: "Morocco", c: "africa" }, { n: "Mozambique", c: "africa" },
  { n: "Namibia", c: "africa" }, { n: "Niger", c: "africa" }, { n: "Nigeria", c: "africa" },
  { n: "Republic of the Congo", c: "africa" }, { n: "Réunion", c: "africa" }, { n: "Rwanda", c: "africa" },
  { n: "Senegal", c: "africa" }, { n: "Seychelles", c: "africa" }, { n: "Sierra Leone", c: "africa" },
  { n: "Somalia", c: "africa" }, { n: "South Africa", c: "africa" }, { n: "Sudan", c: "africa" },
  { n: "Tanzania, United Republic of", c: "africa", q: "Tanzania" }, { n: "Togo", c: "africa" },
  { n: "Tunisia", c: "africa" }, { n: "Uganda", c: "africa" }, { n: "Zambia", c: "africa" },
  { n: "Zimbabwe", c: "africa" },
  // NORD AMERICA (incl. Caraibi e America Centrale)
  { n: "Antigua and Barbuda", c: "north_america" }, { n: "Aruba", c: "north_america" },
  { n: "Bahamas", c: "north_america" }, { n: "Barbados", c: "north_america" }, { n: "Belize", c: "north_america" },
  { n: "Canada", c: "north_america" }, { n: "Costa Rica", c: "north_america" }, { n: "Cuba", c: "north_america" },
  { n: "Curaçao", c: "north_america", q: "Curacao" }, { n: "Dominica", c: "north_america" },
  { n: "Dominican Republic", c: "north_america" }, { n: "El Salvador", c: "north_america" },
  { n: "Greenland", c: "north_america" }, { n: "Grenada", c: "north_america" }, { n: "Guadeloupe", c: "north_america" },
  { n: "Guatemala", c: "north_america" }, { n: "Haiti", c: "north_america" }, { n: "Honduras", c: "north_america" },
  { n: "Jamaica", c: "north_america" }, { n: "Martinique", c: "north_america" }, { n: "Mexico", c: "north_america" },
  { n: "Nicaragua", c: "north_america" }, { n: "Panama", c: "north_america" }, { n: "Puerto Rico", c: "north_america" },
  { n: "Saint Kitts and Nevis", c: "north_america" }, { n: "Saint Lucia", c: "north_america" },
  { n: "Saint Vincent and the Grenadines", c: "north_america" }, { n: "Trinidad and Tobago", c: "north_america" },
  { n: "United States", c: "north_america" },
  // SUD AMERICA
  { n: "Argentina", c: "south_america" }, { n: "Bolivia, Plurinational State of", c: "south_america", q: "Bolivia" },
  { n: "Brazil", c: "south_america" }, { n: "Chile", c: "south_america" }, { n: "Colombia", c: "south_america" },
  { n: "Ecuador", c: "south_america" }, { n: "French Guiana", c: "south_america" }, { n: "Guyana", c: "south_america" },
  { n: "Paraguay", c: "south_america" }, { n: "Peru", c: "south_america" }, { n: "Suriname", c: "south_america" },
  { n: "Uruguay", c: "south_america" }, { n: "Venezuela, Bolivarian Republic of", c: "south_america", q: "Venezuela" },
  // OCEANIA
  { n: "Australia", c: "oceania" }, { n: "Fiji", c: "oceania" }, { n: "French Polynesia", c: "oceania" },
  { n: "Kiribati", c: "oceania" }, { n: "New Caledonia", c: "oceania" }, { n: "New Zealand", c: "oceania" },
  { n: "Palau", c: "oceania" }, { n: "Papua New Guinea", c: "oceania" }, { n: "Samoa", c: "oceania" },
  { n: "Solomon Islands", c: "oceania" }, { n: "Tonga", c: "oceania" }, { n: "Vanuatu", c: "oceania" },
];
// Alias di nomi alternativi che potrebbero essere salvati nel DB (vecchie scansioni) → continente,
// così la copertura li raggruppa lo stesso invece di buttarli in «(altro)».
const CONTINENT_ALIASES: Record<string, string> = {
  Turkey: "europe", Russia: "europe", Vietnam: "asia", "South Korea": "asia", Laos: "asia",
  Brunei: "asia", Palestine: "asia", Bolivia: "south_america", Venezuela: "south_america",
  Tanzania: "africa", "Ivory Coast": "africa", "Cape Verde": "africa", "Vatican City": "europe",
  Curacao: "north_america",
};
// Continente per paese — derivato dalla lista canonica + alias. Per raggruppare la Copertura.
const CONTINENT: Record<string, string> = {
  ...Object.fromEntries(WORLD_COUNTRIES.map((c) => [c.n, c.c])),
  ...CONTINENT_ALIASES,
};
// Query Nominatim per i paesi col nome pycountry «difficile» (resto: il nome stesso).
const NOMINATIM_Q: Record<string, string> = Object.fromEntries(
  WORLD_COUNTRIES.filter((c) => c.q).map((c) => [c.n, c.q as string]),
);
const nominatimQuery = (country: string) => NOMINATIM_Q[country] ?? country;
const CONTINENT_ORDER = ["europe", "asia", "africa", "north_america", "south_america", "oceania", "other"];

// Ordine di scansione di «Completa tutti»: tutti i paesi del mondo, nell'ordine della lista canonica.
const ALL_COUNTRIES = WORLD_COUNTRIES.map((c) => c.n);
// CURSORE DI RIPRESA: nome dell'ultimo paese COMPLETATO da «Completa tutti». Alla ripresa si parte dal
// paese SUCCESSIVO, non da capo — così, lanciando più volte la scansione, si copre via via tutto il
// mondo invece di ricominciare sempre dall'Europa. Persistito in localStorage (sopravvive al riavvio).
const SCAN_CURSOR_KEY = "kidotel.scanCursor";
function loadScanCursor(): string { try { return localStorage.getItem(SCAN_CURSOR_KEY) || ""; } catch { return ""; } }
function saveScanCursor(name: string) { try { localStorage.setItem(SCAN_CURSOR_KEY, name); } catch { /* */ } }
// Indice da cui ripartire dato il cursore (paese DOPO l'ultimo completato; se finito/assente → 0).
function resumeIndex(cursor: string): number {
  if (!cursor) return 0;
  const idx = ALL_COUNTRIES.indexOf(cursor);
  if (idx < 0) return 0;
  return idx + 1 >= ALL_COUNTRIES.length ? 0 : idx + 1;
}

// Etichette segnali in INGLESE per l'email di outreach (sempre in inglese, a prescindere dalla lingua UI).
const EN_SIGNAL: Record<string, string> = {
  kids_club: "Kids club", kids_facilities: "Kids facilities", family_rooms: "Family rooms",
  childcare: "Childcare / babysitting", kids_dining: "Kids dining",
  activities_age: "Age-appropriate activities", safety: "Child safety",
};

// Pesi canonici dei segnali ATTIVI (da src-tauri/src/signals.json; 'reviews' è riservato/futuro → escluso).
// Somma = 94 = massimo family-fit attivo. Usato dall'Analisi premium per breakdown e leve di miglioramento.
const SIGNAL_CATALOG: { key: string; weight: number }[] = [
  { key: "kids_club", weight: 22 }, { key: "kids_facilities", weight: 18 }, { key: "family_rooms", weight: 14 },
  { key: "childcare", weight: 12 }, { key: "kids_dining", weight: 10 }, { key: "activities_age", weight: 10 }, { key: "safety", weight: 8 },
];
const SIGNAL_MAX = SIGNAL_CATALOG.reduce((s, x) => s + x.weight, 0);

// Link di «rivendica la scheda» per-hotel verso kidotel.co. Chiave stabile = osm_type/osm_id (idempotente
// per l'upsert lato sito). La base è configurabile in Impostazioni perché l'endpoint del sito è da costruire
// (vedi piano operativo, Fase 1/2). Deterministico: nessun dato inventato.
function claimUrl(base: string, h: { osm_type: string; osm_id: number }, score: number | null, lang: Lang): string {
  const b = (base || "https://kidotel.co").replace(/\/+$/, "");
  const q = new URLSearchParams({ lang });
  if (score != null) q.set("ff", String(score));
  return `${b}/claim/${h.osm_type}/${h.osm_id}?${q.toString()}`;
}

// Citazione breve attribuita: i FATTI sono liberi, l'ESPRESSIONE no → max ~25 parole (vincolo legale del feed).
function shortQuote(q: string, max = 25): string {
  const w = q.trim().split(/\s+/);
  return w.length <= max ? q.trim() : w.slice(0, max).join(" ") + "…";
}

// Email di outreach trilingue (IT/EN/RU): formale, voce al PLURALE (il team Kidotel), fa sentire l'hotel
// SELEZIONATO dopo una ricerca rigorosa, cita le prove dal sito e invita a rivendicare la scheda gratuita.
function outreachTemplate(lang: Lang, name: string, strengths: string, claim: string): { subject: string; body: string } {
  if (lang === "it") {
    return {
      subject: `${name} — selezionato per la collezione Kidotel di hotel per famiglie verificati`,
      body: `Gentile team di ${name},

Oggi le famiglie vivono una frustrazione silenziosa: è quasi impossibile capire quali hotel siano davvero accoglienti per i bambini e quali lo dichiarino soltanto. Kidotel nasce per mettere fine a questa incertezza — una guida curata che raccomanda solo gli hotel la cui offerta per le famiglie è verificata, parola per parola, dal sito ufficiale della struttura. Nulla di inventato, nulla di pagato: solo ciò che un hotel dichiara e offre davvero.

Il nostro team studia gli hotel di tutto il mondo e applica una selezione volutamente rigorosa. Una struttura merita il suo posto solo quando la sua dedizione alle famiglie è reale e dimostrabile — e ${name} ha superato questo standard. Esaminando il vostro sito ufficiale, abbiamo verificato, tra l'altro:
${strengths || "  •  un'offerta autentica, pensata per le famiglie"}

È proprio per questo che saremmo onorati di presentare ${name} — gratuitamente — alle famiglie che cercano esattamente questo tipo di soggiorno.

Un posto in Kidotel è un'opportunità selettiva e autentica: una vetrina neutrale, basata sulla fiducia, che raggiunge gli ospiti giusti nel momento giusto, accanto a una cerchia ristretta e scelta con cura di hotel per famiglie.

Confermate e attivate la vostra scheda gratuita qui:
${claim}

Un caro saluto,
Il team Kidotel
kidotel.co`,
    };
  }
  if (lang === "ru") {
    return {
      subject: `${name} — выбран для коллекции проверенных семейных отелей Kidotel`,
      body: `Уважаемая команда ${name},

Сегодня семьи сталкиваются с тихой проблемой: почти невозможно понять, какие отели действительно приветливы к детям, а какие лишь заявляют об этом. Kidotel создан, чтобы покончить с этой неопределённостью — это кураторский гид, который рекомендует только те отели, чьё семейное предложение проверено, слово в слово, по официальному сайту самого отеля. Ничего выдуманного, ничего оплаченного: только то, что отель действительно заявляет и предоставляет.

Наша команда изучает отели по всему миру и применяет намеренно строгий отбор. Отель заслуживает своё место только тогда, когда его забота о семьях реальна и доказуема — и ${name} соответствует этому стандарту. Изучив ваш официальный сайт, мы проверили, среди прочего:
${strengths || "  •  подлинное предложение, ориентированное на семьи"}

Именно поэтому мы были бы рады представить ${name} — бесплатно — семьям, которые ищут именно такой отдых.

Место в Kidotel — это избирательная и подлинная возможность: нейтральная витрина, основанная на доверии, которая достигает нужных гостей в нужный момент, рядом с тщательно отобранным кругом семейных отелей.

Подтвердите и активируйте бесплатный профиль здесь:
${claim}

С наилучшими пожеланиями,
Команда Kidotel
kidotel.co`,
    };
  }
  return {
    subject: `${name} — selected for Kidotel's verified family-hotel collection`,
    body: `Dear ${name} Team,

Families today face a quiet frustration: it is almost impossible to tell which hotels are genuinely welcoming to children and which merely claim to be. Kidotel was created to put an end to that uncertainty — a curated guide that recommends only hotels whose family offering is verified, word for word, from the property's own official website. Nothing invented, nothing paid for: only what a hotel truly states and delivers.

Our team studies hotels across the world and applies a deliberately strict selection. A property earns its place only when its dedication to families is real and provable — and ${name} met that standard. Reviewing your official website, we verified, among others:
${strengths || "  •  a genuine, family-focused offering"}

This is precisely why we would be honoured to feature ${name} — at no cost — before the families who are actively searching for exactly this kind of stay.

A place in Kidotel is a selective and genuine opportunity: a neutral, trust-first showcase that reaches the right guests at the right moment, alongside a small, carefully chosen circle of family hotels.

Confirm and claim your free profile here:
${claim}

With our best regards,
The Kidotel Team
kidotel.co`,
  };
}

// CRM / outreach: stati del contatto (devono combaciare con CONTACT_STATES in db.rs).
const CONTACT_STATES = ["da_contattare", "contattato", "risposto", "trattativa", "partner", "rifiutato"] as const;
type ContactStatus = (typeof CONTACT_STATES)[number];
type ContactState = { status: ContactStatus; note: string };

const hkey = (h: Hotel) => `${h.osm_type}/${h.osm_id}`;
// Fascia colore relativa alla soglia "family" scelta dall'utente: "ok" = eccellente (soglia+20),
// "warn" = sopra soglia, "low" = sotto. Con la soglia di default (60) torna 80/60 come prima.
// Colore "heat" CONTINUO del punteggio: sotto soglia = grigio (chiaramente "non family"); da soglia
// a 100 = pesca pallida → ambra profonda. Così la differenza tra i punteggi è subito percepibile a
// colpo d'occhio (un 88 è visibilmente più "caldo" di un 64), non solo 3 fasce piatte.
function scoreHeat(s: number, threshold = 60): { background: string; color: string } {
  if (s >= threshold) {
    const t = Math.min(1, (s - threshold) / Math.max(1, 100 - threshold));
    const lerp = (a: number, b: number) => Math.round(a + (b - a) * t);
    return { background: `rgb(${lerp(255, 233)},${lerp(226, 138)},${lerp(176, 14)})`, color: "#2e2206" };
  }
  const t = Math.max(0, s) / Math.max(1, threshold); // 0..1 fino alla soglia
  const v = Math.round(238 - t * 14); // grigio: leggermente più scuro avvicinandosi alla soglia
  return { background: `rgb(${v},${v},${v - 3})`, color: "#7a7a73" };
}
const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Riga visualizzata in tabella/sfoglia: hotel + voto + valore atteso + (eventuale) dettaglio prove.
type DisplayRow = { h: Hotel; score: number | null; er: number | null; sc?: EnrichResult };

// Converte una riga grezza del DB (HotelRow) in Hotel + EnrichResult (come applyRows, ma per una riga
// sola): serve allo sfoglia-per-paese che carica gli hotel di un paese su richiesta.
function hotelRowToHotel(r: HotelRow): Hotel {
  return {
    osm_type: r.osm_type, osm_id: r.osm_id, name: r.name,
    city: r.city, country: r.country, region: r.region, province: r.province,
    website: r.website, phone: r.phone, email: r.email, email_status: r.email_status,
    source: r.source || "OpenStreetMap", lat: r.lat, lon: r.lon, stars: r.stars, luxury: r.luxury,
    price_tier: r.price_tier, price_eur: r.price_eur, price_src: r.price_src,
  };
}
function breakdownToSc(r: HotelRow): EnrichResult | undefined {
  if (r.family_fit_score === null || !r.score_breakdown) return undefined;
  let signals: SignalResult[] = [];
  try { signals = JSON.parse(r.score_breakdown); } catch { /* */ }
  let website_ok = true;
  try { if (r.enrichment) website_ok = JSON.parse(r.enrichment).website_ok ?? true; } catch { /* */ }
  return { website_ok, pages_fetched: 0, family_fit_score: r.family_fit_score, signals };
}

// Apre un link nel browser/app di sistema. Nel webview Tauri un <a target="_blank"> non apre
// nulla: usiamo il comando open_url (plugin opener). Nel browser di anteprima, fallback a window.open.
async function openExternal(url: string) {
  try {
    await invoke("open_url", { url });
  } catch {
    try { window.open(url, "_blank", "noopener"); } catch { /* ignore */ }
  }
}
const extLink = (url: string) => (e: { preventDefault: () => void }) => { e.preventDefault(); void openExternal(url); };

// Link per RAGGIUNGERE l'hotel, scelti dopo verifica live: SOLO destinazioni consent-free che atterrano
// sull'hotel con i SOLI dati che abbiamo (nome, città, paese, lat/lon, sito). Scartati e perché:
// - Google Hotels / Google Maps: da IT/UE google.com fa 302 → consent.google.com («Prima di continuare»)
//   PRIMA di mostrare l'hotel (causa reale del «non funziona»); e la scheda esatta richiede un entity-id
//   opaco non derivabile dai nostri dati.
// - Expedia / Hotels.com: la scheda richiede il loro hotel-id interno (h…/ho…) → niente link per nome.
// - TripAdvisor / Trivago: pagina-risultati intermedia o 403; il deep-link richiede un location-id.
// Tenuti (verificati consent-free): Sito ufficiale (atterra ESATTAMENTE sull'hotel) · DuckDuckGo (niente
// muro cookie, mette il sito ufficiale #1) · Booking (`?ss=`, hotel come primo risultato + prezzi) ·
// OpenStreetMap su coordinate (pin esatto, niente consenso). Nessun ID inventato.
const hotelQuery = (h: { name: string; city?: string | null; country?: string | null }) =>
  encodeURIComponent([h.name, h.city, h.country].filter(Boolean).join(" "));
const httpUrl = (u: string) => (/^[a-z]+:\/\//i.test(u) ? u : `https://${u}`);

function OtaLinks({ h, t }: { h: Hotel; t: (k: TKey) => string }) {
  const q = hotelQuery(h);
  const hasCoord = Number.isFinite(h.lat) && Number.isFinite(h.lon) && (h.lat !== 0 || h.lon !== 0);
  const links: { name: string; url: string; title: string }[] = [];
  if (h.website) links.push({ name: t("link.site"), url: httpUrl(h.website), title: prettyHost(h.website) });
  links.push({ name: t("link.search"), url: `https://duckduckgo.com/?q=${q}`, title: decodeURIComponent(q) });
  links.push({ name: "Booking", url: `https://www.booking.com/searchresults.html?ss=${q}`, title: decodeURIComponent(q) });
  if (hasCoord) links.push({ name: t("link.map"), url: `https://www.openstreetmap.org/?mlat=${h.lat}&mlon=${h.lon}#map=18/${h.lat}/${h.lon}`, title: `${h.lat}, ${h.lon}` });
  return (
    <div className="ota-row no-print">
      <span className="ota-lab">{t("ota.open")}:</span>
      {links.map((o) => (
        <a key={o.name} className="ota-chip" href={o.url} target="_blank" rel="noreferrer" onClick={extLink(o.url)} title={`${o.name} — ${o.title}`}>{o.name}</a>
      ))}
    </div>
  );
}

export default function App() {
  const { t, lang, setLang } = useI18n();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [area, setArea] = useState<LiveMsg | null>(null);
  const [scores, setScores] = useState<Record<string, EnrichResult>>({});
  const [enriching, setEnriching] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [onlyScored, setOnlyScored] = useState(false);
  const [sortBy, setSortBy] = useState<"score" | "name" | "er">("score");
  const [minScore, setMinScore] = useState(0);
  const [viewMode, setViewMode] = useState<"hotel" | "map" | "coverage" | "crm">("hotel");
  // Vista Hotel: "country" = sfoglia a fisarmonica per paese (default); "flat" = elenco ordinato.
  const [hotelMode, setHotelMode] = useState<"country" | "flat">("country");
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  // Sfoglia-per-paese: paesi aperti + hotel del paese caricati su richiesta (cache).
  const [openCountries, setOpenCountries] = useState<Set<string>>(() => new Set());
  const [countryRows, setCountryRows] = useState<Record<string, DisplayRow[] | "loading">>({});
  const [coverage, setCoverage] = useState<{ country: string; total: number; scored: number; strong: number }[]>([]);
  const [osmTotals, setOsmTotals] = useState<Record<string, number>>({});
  const [covBusy, setCovBusy] = useState<string | null>(null);
  const [starsBusy, setStarsBusy] = useState(false);
  const [scanCursor, setScanCursor] = useState(loadScanCursor()); // ripresa di «Completa tutti»
  const [crmRows, setCrmRows] = useState<{ h: Hotel; score: number | null; er: number | null }[]>([]); // CRM: TUTTO l'archivio contattabile
  const [crmLoading, setCrmLoading] = useState(false);
  const [contacts, setContacts] = useState<Record<string, ContactState>>({});
  const [reviewCounts, setReviewCounts] = useState<Record<string, number>>({});
  const [crmFilter, setCrmFilter] = useState<ContactStatus | "all">("all");
  const [showAssump, setShowAssump] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [overlay, setOverlay] = useState<"guide" | "settings" | "export" | "info" | "ftool" | null>(null);
  // #8 — selezione a criteri per l'export "cowork": compone il gruppo di hotel da esportare.
  const [exportSel, setExportSel] = useState<ExportSel>(DEFAULT_EXPORT_SEL);
  const [exportCount, setExportCount] = useState<number | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  // #9 — infografica stampabile
  const [infoData, setInfoData] = useState<InfoData | null>(null);
  const [infoOpts, setInfoOpts] = useState<InfoOpts>(DEFAULT_INFO_OPTS);
  const [infoBusy, setInfoBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  // «Family-Fit as a Service»: valuta un sito fornito dal cliente, senza toccare il DB.
  const [ftUrl, setFtUrl] = useState("");
  const [ftBusy, setFtBusy] = useState(false);
  const [ftResult, setFtResult] = useState<EnrichResult | null>(null);
  const [ftErr, setFtErr] = useState("");
  const erValue = settings.erValue, erComm = settings.erComm, erVolume = settings.erVolume;
  function updateSettings(p: Partial<Settings>) {
    setSettings((s) => {
      const n = { ...s, ...p };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(n)); } catch { /* */ }
      return n;
    });
  }
  const [dbQuery, setDbQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  // Avanzamenti LIVE delle scansioni in corso (una per canale: copertura, stelle, valutazione). Vengono
  // mostrati insieme in un ticker «breaking news» che scorre, ognuno con i suoi dati aggiornati.
  const [covNote, setCovNote] = useState<LiveMsg | null>(null);
  const [starsNote, setStarsNote] = useState<LiveMsg | null>(null);
  const [enrichNote, setEnrichNote] = useState<LiveMsg | null>(null);
  const [archiveTotal, setArchiveTotal] = useState<number | null>(null);
  const [archivePage, setArchivePage] = useState(0); // pagina dell'archivio (5000 per pagina)
  const [scoreStats, setScoreStats] = useState<ScoreStats | null>(null);
  const stopRef = useRef(false);
  const covStopRef = useRef(false);
  // Cosa sta guardando l'utente: serve a NON sostituirgli la vista con l'archivio a fine valutazione.
  const viewSourceRef = useRef<"scan" | "search" | "archive">("archive");

  // Costruisce hotels+scores da righe del DB (condiviso da archivio e ricerca).
  function applyRows(rows: HotelRow[]): number {
    const hs: Hotel[] = [];
    const sc: Record<string, EnrichResult> = {};
    const ct: Record<string, ContactState> = {};
    for (const r of rows) {
      hs.push({
        osm_type: r.osm_type, osm_id: r.osm_id, name: r.name,
        city: r.city, country: r.country, region: r.region, province: r.province,
        website: r.website, phone: r.phone, email: r.email, email_status: r.email_status,
        source: r.source || "OpenStreetMap", lat: r.lat, lon: r.lon, stars: r.stars, luxury: r.luxury,
        price_tier: r.price_tier, price_eur: r.price_eur, price_src: r.price_src,
      });
      const status = (r.contact_status as ContactStatus) || "da_contattare";
      ct[`${r.osm_type}/${r.osm_id}`] = { status, note: r.contact_note || "" };
      if (r.family_fit_score !== null && r.score_breakdown) {
        let signals: SignalResult[] = [];
        try { signals = JSON.parse(r.score_breakdown); } catch { /* ignore */ }
        let website_ok = true;
        try { if (r.enrichment) website_ok = JSON.parse(r.enrichment).website_ok ?? true; } catch { /* ignore */ }
        sc[`${r.osm_type}/${r.osm_id}`] = { website_ok, pages_fetched: 0, family_fit_score: r.family_fit_score, signals };
      }
    }
    setHotels(hs);
    setScores(sc);
    setContacts(ct);
    setExpanded(null);
    return hs.length;
  }

  // Mostra l'archivio salvato, a PAGINE da 5000 (ordinate per voto). page = pagina 0-based.
  async function loadArchive(page = 0) {
    try {
      viewSourceRef.current = "archive";
      const rows = await invoke<HotelRow[]>("list_hotels", { limit: ARCHIVE_PAGE, offset: page * ARCHIVE_PAGE });
      const n = applyRows(rows);
      let total = n;
      try { total = await invoke<number>("count_hotels"); } catch { /* ignora */ }
      setArchiveTotal(total);
      setArchivePage(page);
      setDbQuery("");
      if (n > 0 || total > 0) {
        const pages = Math.max(1, Math.ceil(total / ARCHIVE_PAGE));
        setArea(() => (tr: (k: TKey) => string) => tr("archive.label") + (pages > 1 ? ` — ${tr("page.page")} ${page + 1}/${pages}` : ""));
      }
    } catch {
      /* nel browser di anteprima non c'è Tauri */
    }
  }

  // CERCA nel database (per nome/città/provincia/regione/paese): non scarica nulla di nuovo.
  async function doDbSearch() {
    const q = dbQuery.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    try {
      viewSourceRef.current = "search";
      const rows = await invoke<HotelRow[]>("list_hotels", { limit: 5000, search: q });
      const n = applyRows(rows);
      setArchiveTotal(n);
      setArea(() => (tr: (k: TKey) => string, lg: Lang) => `${tr("search.results")}: «${q}» (${n.toLocaleString(lg)}${n >= 5000 ? "+" : ""})`);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  async function refreshStats() {
    try { setScoreStats(await invoke<ScoreStats>("score_stats", { threshold: settings.familyThreshold })); } catch { /* anteprima */ }
  }

  async function loadCoverage(): Promise<typeof coverage> {
    try { const c = await invoke<typeof coverage>("coverage_by_country", { threshold: settings.familyThreshold }); setCoverage(c); return c; } catch { return coverage; }
  }
  const coverageTotalOf = (rows: typeof coverage, country: string) => rows.find((c) => c.country === country)?.total ?? 0;

  // Apre la vista Copertura caricando il grado di scansione per paese.
  function openCoverage() { setViewMode("coverage"); loadCoverage(); }

  // Apre la vista Hotel; in modalità "sfoglia per paese" servono i conteggi per paese (coverage).
  function openHotel() {
    setViewMode("hotel");
    if (hotelMode === "country" && coverage.length === 0) loadCoverage();
  }

  // Sfoglia per paese: apre/chiude un paese e, alla prima apertura, carica i suoi hotel dal DB
  // (riusa select_hotels → scala all'intero archivio, non solo ai 5000 in vista).
  async function toggleCountry(country: string) {
    setOpenCountries((prev) => {
      const next = new Set(prev);
      if (next.has(country)) next.delete(country);
      else next.add(country);
      return next;
    });
    if (countryRows[country]) return; // già caricato (o in corso)
    setCountryRows((prev) => ({ ...prev, [country]: "loading" }));
    try {
      const list = await invoke<HotelRow[]>("select_hotels", {
        args: { countries: [country], scoreMin: null, scoreMax: null, onlyScored: false, onlyContactable: false, onlyDeliverable: false, limit: 20000 },
      });
      const rows: DisplayRow[] = list.map((r) => {
        const h = hotelRowToHotel(r);
        const sc = breakdownToSc(r);
        const score = sc && sc.website_ok ? sc.family_fit_score : null;
        return { h, score, er: erFromRow(r), sc };
      });
      // ordina per voto ↓ poi nome
      rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.h.name.localeCompare(b.h.name, lang));
      setCountryRows((prev) => ({ ...prev, [country]: rows }));
    } catch (e) {
      setCountryRows((prev) => { const n = { ...prev }; delete n[country]; return n; });
      setError(String(e));
    }
  }

  // Misura il GRADO DI COPERTURA reale: hotel che abbiamo / hotel su OSM per quel paese.
  async function gradeCountry(country: string) {
    if (covBusy) return;
    setCovBusy(country);
    setNotice(`${t("cov.measuring")} ${country}…`);
    try {
      const osm = await invoke<number>("osm_hotel_count", { query: country });
      setOsmTotals((p) => ({ ...p, [country]: osm }));
      setNotice(null);
    } catch (e) {
      setNotice(null); // niente "misuro…" appeso se la misura fallisce
      setError(String(e));
    } finally {
      setCovBusy(null); setCovNote(null);
    }
  }

  // Porta un paese verso il 100%: enumera le sue regioni e le scansiona una per una (funziona anche
  // per i paesi enormi/antimeridiano, che per bbox sarebbero bloccati). Mostra l'avanzamento.
  function stopComplete() { covStopRef.current = true; }
  // Azzera il cursore di ripresa: la prossima «Completa tutti» riparte dal primo paese del mondo.
  function resetScanCursor() { saveScanCursor(""); setScanCursor(""); }
  // #2 — scansiona un paese SCELTO dal selettore (anche uno non ancora in archivio): porta a 100%.
  function pickCountry(country: string) { if (country) void completeCountry(country); }

  // Core riusabile (no guard, no covBusy): scansiona un paese regione per regione. Ritorna i NUOVI.
  // `prefix` (es. "Europa 2/5 · ") antepone il contesto continente alle note durante lo scan continente.
  async function runCompleteCountry(country: string, prefix: (tr: (k: TKey) => string) => string = () => "", force = false): Promise<number> {
    setCovNote(() => (tr: (k: TKey) => string) => `${prefix(tr)}${country}: ${tr("cov.enumerating")}…`);
    // Nominatim: usa l'alias di query quando il nome pycountry non si geocodifica bene; il paese
    // TIMBRATO sugli hotel resta però il nome canonico (così la copertura raggruppa con il resto).
    // Se Nominatim è momentaneamente giù NON lanciamo (bloccava l'intero giro del mondo): 0 regioni →
    // il paese si salta e si riprende al giro successivo.
    const regions = await invoke<SubArea[]>("list_subareas", { query: nominatimQuery(country) }).catch(() => [] as SubArea[]);
    if (!regions.length) { setCovNote(() => (tr: (k: TKey) => string) => `${prefix(tr)}${country}: ${tr("cov.noregions")}`); return 0; }
    // INCREMENTALE: salta le regioni già scansionate negli ultimi 30 giorni (niente da capo ogni volta).
    const keys = regions.map((r) => `${r.osm_type}/${r.osm_id}`);
    const done = force ? new Set<string>() : new Set(await invoke<string[]>("areas_scanned_within", { keys, days: 30 }).catch(() => []));
    const before = coverageTotalOf(await loadCoverage(), country);
    let latest = before, skipped = 0;
    for (let i = 0; i < regions.length; i++) {
      if (covStopRef.current) break;
      const rg = regions[i];
      if (done.has(`${rg.osm_type}/${rg.osm_id}`)) { skipped++; continue; } // già fatta di recente
      const sk = skipped, gained = latest - before, rgName = rg.name, idx = i + 1, tot = regions.length;
      setCovNote(() => (tr: (k: TKey) => string, lg: Lang) => `${prefix(tr)}${country}: ${tr("cov.region")} ${idx}/${tot} — ${rgName}… (+${gained.toLocaleString(lg)} ${tr("cov.new")}${sk ? `, ${sk} ${tr("cov.skipped")}` : ""})`);
      try {
        await invoke<number>("discover_area", { args: { osmType: rg.osm_type, osmId: rg.osm_id, s: rg.s, n: rg.n, w: rg.w, e: rg.e, country } });
        latest = coverageTotalOf(await loadCoverage(), country);
      } catch { /* salta la regione, continua */ }
      if (covStopRef.current) break;
      await new Promise((r) => setTimeout(r, 600)); // garbo verso Overpass + punto di stop
    }
    try { const osm = await invoke<number>("osm_hotel_count", { query: nominatimQuery(country) }); setOsmTotals((p) => ({ ...p, [country]: osm })); } catch { /* grado opzionale */ }
    return latest - before;
  }

  async function completeCountry(country: string) {
    if (covBusy || loading) return;
    covStopRef.current = false;
    setCovBusy(country);
    setError(null);
    try {
      const added = await runCompleteCountry(country);
      setNotice(`${country}: +${added.toLocaleString(lang)} ${t("cov.new")}${covStopRef.current ? ` (${t("cov.stopped")})` : ""}.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setCovBusy(null); setCovNote(null);
    }
  }

  // Scan completo di un CONTINENTE: completa ogni paese del continente, in sequenza.
  async function completeContinent(contKey: string) {
    if (covBusy || loading) return;
    const list = coverage
      .filter((c) => !c.country.startsWith("(") && (CONTINENT[c.country] || "other") === contKey)
      .map((c) => c.country)
      .sort((a, b) => a.localeCompare(b, lang));
    if (!list.length) return;
    covStopRef.current = false;
    setCovBusy("cont:" + contKey);
    setError(null);
    try {
      let total = 0;
      for (let i = 0; i < list.length; i++) {
        if (covStopRef.current) break;
        // un paese che fallisce non ferma il resto del continente: lo saltiamo e proseguiamo.
        try { total += await runCompleteCountry(list[i], (tr) => `${tr(("cont." + contKey) as TKey)} ${i + 1}/${list.length} · `); }
        catch (e) { console.warn("Completa continente: paese saltato", list[i], e); }
      }
      setNotice(`${t(("cont." + contKey) as TKey)}: +${total.toLocaleString(lang)} ${t("cov.new")}${covStopRef.current ? ` (${t("cov.stopped")})` : ""}.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setCovBusy(null); setCovNote(null);
    }
  }

  // Scan di TUTTI i paesi del mondo, uno dopo l'altro. RIPRENDE dal punto in cui si era fermato (cursore)
  // invece di ricominciare dall'inizio, così a furia di lanciarlo si copre tutto il mondo. L'incrementale
  // (regioni già fatte <30gg) rende comunque rapidi i paesi già scansionati di recente.
  async function completeAllContinents() {
    if (covBusy || loading) return;
    covStopRef.current = false;
    setCovBusy("cont:all");
    setError(null);
    const start = resumeIndex(loadScanCursor());
    try {
      let total = 0;
      let i = start;
      for (; i < ALL_COUNTRIES.length; i++) {
        if (covStopRef.current) break;
        const country = ALL_COUNTRIES[i];
        const k = CONTINENT[country] || "other";
        try {
          total += await runCompleteCountry(country, (tr) => `${tr(("cont." + k) as TKey)} · ${i + 1}/${ALL_COUNTRIES.length} · `);
        } catch (e) {
          // Un paese che fallisce (es. Nominatim/Overpass momentaneamente giù) NON deve FERMARE il giro
          // del mondo: prima un'eccezione qui interrompeva tutto col cursore bloccato PRIMA del paese →
          // ad ogni riavvio si ritentava sempre lo stesso (es. «ricomincia da Austria»). Ora lo saltiamo
          // e proseguiamo, avanzando comunque il cursore: la scansione PROGREDISCE e il paese verrà
          // ritentato al prossimo giro.
          console.warn("Completa tutti: paese saltato", country, e);
        }
        // Avanza il cursore se il paese è stato attraversato (completato o saltato per errore); NON se
        // l'ha fermato l'utente (in quel caso si riprende da questo stesso paese, regioni fatte saltate).
        if (!covStopRef.current) saveScanCursor(country);
      }
      // se siamo arrivati in fondo senza fermarci → giro del mondo finito: la prossima volta riparte da capo.
      if (!covStopRef.current && i >= ALL_COUNTRIES.length) saveScanCursor("");
      setScanCursor(loadScanCursor());
      setNotice(`${t("coverage.completeAll")}: +${total.toLocaleString(lang)} ${t("cov.new")}${covStopRef.current ? ` (${t("cov.stopped")})` : ""}.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setCovBusy(null); setCovNote(null);
    }
  }

  // Ri-scansione del database per le STELLE: chiede a OSM la classificazione degli hotel che non ce
  // l'hanno e la salva. A blocchi, con avanzamento; fermabile con «Ferma».
  async function backfillStars() {
    if (starsBusy || covBusy || loading) return;
    setStarsBusy(true);
    covStopRef.current = false;
    setError(null);
    let checked = 0, withStars = 0;
    try {
      while (!covStopRef.current) {
        // blocco grande: il backend lo spezza in query concorrenti (una per endpoint Overpass) → ~3,8× più veloce.
        const b = await invoke<{ processed: number; with_stars: number; remaining: number }>("backfill_stars", { limit: 700 });
        if (b.processed === 0) break;
        checked += b.processed;
        withStars += b.with_stars;
        const ck = checked, ws = withStars, rem = b.remaining;
        setStarsNote(() => (tr: (k: TKey) => string, lg: Lang) => `${tr("stars.backfilling")}: ${ck.toLocaleString(lg)} ${tr("stars.checked")} · ${ws.toLocaleString(lg)} ${tr("stars.classified")} · ${rem.toLocaleString(lg)} ${tr("stars.remaining")}`);
        if (b.remaining === 0) break;
      }
      setNotice(`${t("stars.done")}: ${withStars.toLocaleString(lang)} / ${checked.toLocaleString(lang)}${covStopRef.current ? ` (${t("cov.stopped")})` : ""}.`);
      if (viewSourceRef.current === "archive") await loadArchive();
    } catch (e) {
      setError(String(e));
    } finally {
      setStarsBusy(false); setStarsNote(null);
    }
  }

  function openCrm() { setViewMode("crm"); if (crmRows.length === 0) void loadCrm(); }

  // CRM: genera l'email di outreach. SEMPRE in inglese, formale, voce al PLURALE (il team Kidotel,
  // mai prima persona singolare): racconta la filosofia del progetto, fa sentire l'hotel SELEZIONATO
  // dopo una ricerca rigorosa, presenta l'adesione come opportunità. Cita le prove verbatim dal sito.
  function emailContact(h: Hotel) {
    const sc = scores[hkey(h)];
    const present = sc ? sc.signals.filter((s) => s.present && s.quote).slice(0, 3) : [];
    // etichetta segnale NELLA lingua dell'email (= lingua UI); la citazione resta verbatim dal sito.
    const strengths = present.map((s) => `  •  ${t(("signal." + s.key) as TKey)}: “${s.quote}”`).join("\n");
    const claim = claimUrl(settings.claimBase, h, sc?.family_fit_score ?? null, lang);
    const { subject, body } = outreachTemplate(lang, h.name, strengths, claim);
    // non aprire mailto verso un indirizzo non recapitabile (rimbalzerebbe): copia la bozza.
    const undeliverable = h.email_status === "no_mx" || h.email_status === "bad";
    if (h.email && !undeliverable) {
      void openExternal(`mailto:${h.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
      setNotice(t("crm.opened"));
    } else {
      try { void navigator.clipboard.writeText(`${subject}\n\n${body}`); } catch { /* */ }
      setNotice(h.email && undeliverable ? t("crm.bademail") : t("crm.copied"));
    }
  }

  // CRM: aggiorna stato/nota del contatto e salva nel database (sopravvive a scan e backup).
  async function saveContact(h: Hotel, status: ContactStatus, note: string) {
    const k = hkey(h);
    setContacts((prev) => ({ ...prev, [k]: { status, note } }));
    try {
      await invoke("set_contact", { args: { osmType: h.osm_type, osmId: h.osm_id, status, note } });
    } catch (e) {
      setError(String(e));
    }
  }

  // All'avvio: archivio (per CRM/elenco) + copertura (per lo sfoglia-per-paese, vista predefinita) +
  // misure OSM salvate (così il grado di copertura «Austria 100%» NON si perde alla riapertura).
  useEffect(() => {
    loadArchive();
    loadCoverage();
    invoke<{ country: string; osm_total: number }[]>("osm_counts")
      .then((rows) => setOsmTotals(Object.fromEntries(rows.map((r) => [r.country, r.osm_total]))))
      .catch(() => { /* anteprima senza Tauri */ });
    invoke<Record<string, number>>("review_counts").then(setReviewCounts).catch(() => { /* */ });
  }, []);
  // I banner informativi si chiudono da soli dopo 6s (oltre al click per chiuderli subito). MA NON
  // mentre è in corso una scansione/completamento/valutazione: lì il banner è la PROGRESSIONE in
  // tempo reale (una regione può durare minuti) e va lasciato visibile finché il lavoro è attivo.
  useEffect(() => {
    if (!notice || covBusy || loading || enriching) return;
    const id = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(id);
  }, [notice, covBusy, loading, enriching]);
  // #8 — conteggio live della selezione mentre l'utente regola i criteri di export.
  useEffect(() => {
    if (overlay !== "export") return;
    if (coverage.length === 0) loadCoverage(); // servono i paesi per i menu continente/paese
    let alive = true;
    setExportCount(null);
    invoke<number>("count_select", { args: selToArgs(exportSel) })
      .then((n) => { if (alive) setExportCount(n); })
      .catch(() => { if (alive) setExportCount(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlay, exportSel]);
  // Solo in sviluppo: espone il generatore dell'infografica con dati finti, per verificare la resa
  // nell'anteprima (dove non c'è Tauri/DB). In produzione non viene incluso.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const mock: InfoData = {
      stats: { total: 132480, with_site: 61230, scored: 48910, strong: 12740, to_score: 12320 },
      hist: [820, 1840, 4120, 7350, 9980, 11240, 7860, 3920, 1480, 400],
      topCountries: [
        { country: "Italy", family: 2140, total: 21336 }, { country: "Germany", family: 1980, total: 18420 },
        { country: "France", family: 1530, total: 16210 }, { country: "Austria", family: 1280, total: 7340 },
        { country: "Spain", family: 1120, total: 12890 }, { country: "Switzerland", family: 760, total: 4210 },
        { country: "Greece", family: 540, total: 6120 }, { country: "Croatia", family: 480, total: 3980 },
        { country: "Netherlands", family: 420, total: 5230 }, { country: "Portugal", family: 360, total: 4110 },
      ],
      continents: [
        { key: "europe", total: 84200, family: 9800 }, { key: "asia", total: 21400, family: 1600 },
        { key: "north_america", total: 14800, family: 820 }, { key: "south_america", total: 6100, family: 240 },
        { key: "africa", total: 3900, family: 180 }, { key: "oceania", total: 2080, family: 100 },
      ],
      funnel: [
        { status: "da_contattare", count: 11200 }, { status: "contattato", count: 980 },
        { status: "risposto", count: 320 }, { status: "trattativa", count: 110 },
        { status: "partner", count: 38 }, { status: "rifiutato", count: 92 },
      ],
      contactable: 25040, famContactable: 9860, erTotalFamily: 4831200,
    };
    (window as unknown as { __infoHtml?: string }).__infoHtml = buildInfographicHtml(mock, infoOpts);
    (window as unknown as { __insightsHtml?: string }).__insightsHtml = buildInsightsHtml(mock.stats, mock.hist, mock.topCountries.map((c) => ({ country: c.country, total: c.total, strong: c.family })) as CoverageRow[]);
    const mockH = { osm_type: "way", osm_id: 777, name: "Familienhotel Sole", city: "Lutago", province: null, region: "Alto Adige", country: "Italy", website: "https://example.com", phone: null, source: "OpenStreetMap", lat: 46.9, lon: 11.9, stars: 4, luxury: 1 } as Hotel;
    const mockSc = { website_ok: true, pages_fetched: 3, family_fit_score: 76, signals: [
      { key: "kids_club", weight: 22, present: true, quote: "Our kids club welcomes children from 3 to 12 with daily supervised activities and a dedicated playroom", url: "https://example.com/family" },
      { key: "kids_facilities", weight: 18, present: true, quote: "Heated outdoor pool with a children's section, water slides and a baby pool", url: "https://example.com/pool" },
      { key: "family_rooms", weight: 14, present: true, quote: "Spacious family rooms sleep up to 5 with bunk beds and connecting options", url: "https://example.com/rooms" },
      { key: "childcare", weight: 12, present: true, quote: "Professional childcare from 9am with qualified staff", url: "https://example.com/care" },
      { key: "kids_dining", weight: 10, present: true, quote: "Daily children's buffet with healthy options and early dinner times", url: null },
      { key: "activities_age", weight: 10, present: false, quote: null, url: null },
      { key: "safety", weight: 8, present: false, quote: null, url: null },
    ] } as EnrichResult;
    (window as unknown as { __certHtml?: string }).__certHtml = buildCertificateHtml(mockH, mockSc);
    (window as unknown as { __analyticsHtml?: string }).__analyticsHtml = buildAnalyticsHtml(mockH, mockSc, mock.hist, mock.topCountries.map((c) => ({ country: c.country, total: c.total, strong: c.family })) as CoverageRow[]);
    (window as unknown as { __scoreHeat?: typeof scoreHeat }).__scoreHeat = scoreHeat;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoOpts, lang, settings.familyThreshold]);
  // tema: "auto" = segue il sistema (nessun attributo); altrimenti forza chiaro/scuro.
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", settings.theme);
  }, [settings.theme]);
  useEffect(() => {
    refreshStats();
    const id = setInterval(refreshStats, 4000); // barra di avanzamento sempre aggiornata
    return () => clearInterval(id);
  }, []);

  function scan() { return scanArea(query); }

  async function scanArea(q0: string) {
    const q = q0.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setExpanded(null);
    try {
      viewSourceRef.current = "scan";
      const res = await invoke<DiscoverResult>("discover", { query: q });
      // mostra SOLO gli hotel di quest'area (vengono comunque salvati nell'archivio);
      // i voti già calcolati per questi hotel restano disponibili dalla mappa scores.
      setHotels(res.hotels);
      setArchiveTotal(null); // vista area: la statistica mostra il conteggio dell'area
      setArea(() => () => res.area_label); // nome dell'area dal backend: non si traduce
      // la scansione vive in Copertura, ma i risultati si guardano in Hotel (elenco piatto dell'area)
      setViewMode("hotel");
      setHotelMode("flat");
      loadCoverage(); // aggiorna i conteggi per paese (lo sfoglia per paese ne ha bisogno)
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  // Valuta family-fit (gratis) su TUTTO l'archivio. Ogni «blocco» è UN solo comando Rust che scarica
  // e valuta i siti in parallelo e scrive i voti in un'unica transazione (veloce, niente stalli).
  async function enrichAll() {
    if (enriching) return;
    stopRef.current = false;
    setEnriching(true);
    // Chiavi degli hotel ATTUALMENTE in vista: aggiorniamo i loro voti sul posto.
    const inView = new Set(hotels.map(hkey));
    let evaluated = 0;
    try {
      while (!stopRef.current) {
        const batch = await invoke<EnrichBatch>("enrich_batch", { limit: 24 });
        if (batch.processed === 0) break;
        evaluated += batch.processed;
        const ev = evaluated, rem = batch.remaining;
        setEnrichNote(() => (tr: (k: TKey) => string, lg: Lang) => `${tr("enrich.scoring")}: ${ev.toLocaleString(lg)} ${tr("enrich.evaluated")} · ${rem.toLocaleString(lg)} ${tr("stars.remaining")}`);
        const live: Record<string, EnrichResult> = {};
        for (const r of batch.results) {
          if (inView.has(r.id)) live[r.id] = { website_ok: r.website_ok, pages_fetched: r.pages_fetched, family_fit_score: r.family_fit_score, signals: r.signals };
        }
        if (Object.keys(live).length) setScores((prev) => ({ ...prev, ...live }));
        await refreshStats();
        if (batch.remaining === 0) break;
      }
    } finally {
      setEnrichNote(null);
      setEnriching(false);
      await refreshStats();
      // Solo se l'utente sta guardando l'archivio lo ricarichiamo; con una scan/ricerca attiva
      // i voti in vista sono già stati aggiornati sopra e NON gli stravolgiamo la schermata.
      if (viewSourceRef.current === "archive") await loadArchive();
    }
  }
  function stopEnrich() { stopRef.current = true; }

  const getScore = (h: Hotel): number | null => {
    const s = scores[hkey(h)];
    return s && s.website_ok ? s.family_fit_score : null;
  };

  // Motore di redditività: valore atteso stimato (€/anno) di un hotel come partner.
  // ER = valore prenotazione × indice paese × commissione% × prob.partner × volume atteso,
  // dove prob.partner e volume crescono col family-fit (un family hotel vero converte e produce di più).
  const erOf = (h: Hotel, score: number | null): number | null => {
    if (score === null || !h.website) return null;
    const idx = COUNTRY_VALUE[h.country ?? ""] ?? COUNTRY_VALUE_DEFAULT;
    const p = score / 100;                 // probabilità che diventi partner
    const vol = erVolume * (score / 100);  // prenotazioni/anno attese tramite Kidotel
    return Math.round(erValue * idx * (erComm / 100) * p * vol);
  };

  let rows = hotels.map((h) => {
    const score = getScore(h);
    return { h, score, er: erOf(h, score) };
  });
  if (onlyScored) rows = rows.filter((r) => r.score !== null);
  if (minScore > 0) rows = rows.filter((r) => (r.score ?? -1) >= minScore);
  rows.sort((a, b) =>
    sortBy === "name"
      ? a.h.name.localeCompare(b.h.name, lang)
      : sortBy === "er"
        ? (b.er ?? -1) - (a.er ?? -1) || a.h.name.localeCompare(b.h.name, lang)
        : (b.score ?? -1) - (a.score ?? -1) || a.h.name.localeCompare(b.h.name, lang),
  );

  const erTotal = rows.reduce((sum, r) => sum + (r.er ?? 0), 0);

  const points: MapPoint[] = rows.map(({ h, score }) => ({
    lat: h.lat, lon: h.lon, name: h.name, score, website: h.website, loc: locationOf(h),
  }));


  async function exportCsv() {
    const sep = ";";
    const header = (["csv.name", "csv.score", "csv.er", "csv.status", "csv.note", "csv.city", "csv.province", "csv.region", "csv.country", "csv.website", "csv.email", "csv.phone", "csv.lat", "csv.lon", "csv.services"] as TKey[]).map((k) => t(k));
    const lines = [header];
    for (const { h, score, er } of rows) {
      const sc = scores[hkey(h)];
      const services = sc ? sc.signals.filter((s) => s.present).map((s) => t(("signal." + s.key) as TKey)).join(", ") : "";
      const c = contacts[hkey(h)];
      const cStatus = c ? t(("crm.status." + c.status) as TKey) : "";
      lines.push([h.name, score ?? "", er ?? "", cStatus, c?.note ?? "", h.city ?? "", h.province ?? "", h.region ?? "", h.country ?? "", h.website ?? "", h.email ?? "", h.phone ?? "", h.lat, h.lon, services].map(String));
    }
    const csv = "﻿" + lines.map((r) => r.map(csvCell).join(sep)).join("\r\n");
    const safe = (area ? area(t, lang) : "hotels").replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
    try {
      const path = await save({ defaultPath: `kidotel-${safe}.csv`, filters: [{ name: "CSV", extensions: ["csv"] }] });
      if (path) await invoke("write_text_file", { path, content: csv });
    } catch (e) {
      setError(String(e));
    }
  }

  // #8 — export "cowork": traduce i criteri scelti negli argomenti dei comandi count_select/select_hotels.
  function selToArgs(s: ExportSel): SelectArgs {
    let countries: string[] = [];
    if (s.scope === "continent") countries = coverage.map((c) => c.country).filter((c) => CONTINENT[c] === s.continent);
    else if (s.scope === "country") countries = s.country ? [s.country] : ["\u0000"]; // sentinella: niente paese → nessun match
    if (s.scope === "continent" && countries.length === 0) countries = ["\u0000"];
    return {
      countries,
      scoreMin: s.useScoreRange ? s.scoreMin : null,
      scoreMax: s.useScoreRange ? s.scoreMax : null,
      onlyScored: s.onlyScored || s.useScoreRange || s.useTopN, // top-N e fascia hanno senso solo sui valutati
      onlyContactable: s.onlyContactable,
      onlyDeliverable: s.onlyDeliverable,
      limit: s.useTopN ? Math.max(1, s.topN) : null,
    };
  }

  // ER da una riga grezza del DB (stessa formula di erOf, ma su HotelRow).
  function erFromRow(h: HotelRow): number | null {
    const score = h.family_fit_score;
    if (score === null || !h.website) return null;
    const idx = COUNTRY_VALUE[h.country ?? ""] ?? COUNTRY_VALUE_DEFAULT;
    return Math.round(erValue * idx * (erComm / 100) * (score / 100) * (erVolume * (score / 100)));
  }

  // CRM: carica TUTTO l'archivio contattabile (non più solo i 5000 della pagina), via `select_crm`
  // (righe leggere, senza breakdown). Ordinato per voto lato DB; il CRM poi ordina per valore atteso e
  // applica i filtri cumulabili in memoria. Si renderizza comunque al massimo `renderCap` righe.
  async function loadCrm() {
    setCrmLoading(true);
    setError(null);
    try {
      const args: SelectArgs = { countries: [], scoreMin: null, scoreMax: null, onlyScored: false, onlyContactable: true, onlyDeliverable: false, limit: null };
      const list = await invoke<CrmRowLite[]>("select_crm", { args });
      const cr = list.map((r) => {
        const h: Hotel = {
          osm_type: r.osm_type, osm_id: r.osm_id, name: r.name,
          city: r.city, country: r.country, region: r.region, province: r.province,
          website: r.website, phone: r.phone, email: r.email, email_status: r.email_status,
          source: "OpenStreetMap", lat: r.lat, lon: r.lon, stars: r.stars, luxury: null,
          price_tier: null, price_eur: null, price_src: null,
        };
        return { h, score: r.family_fit_score, er: erOf(h, r.family_fit_score) };
      });
      setCrmRows(cr);
      // stato/nota del contatto per questi hotel (dato reale, per i chip e l'editor di stato).
      setContacts((prev) => {
        const next = { ...prev };
        for (const r of list) next[`${r.osm_type}/${r.osm_id}`] = { status: (r.contact_status as ContactStatus) || "da_contattare", note: r.contact_note || "" };
        return next;
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setCrmLoading(false);
    }
  }

  function rowsToCsv(list: HotelRow[]): string {
    const sep = ";";
    const header = (["csv.name", "csv.score", "csv.er", "csv.status", "csv.note", "csv.city", "csv.province", "csv.region", "csv.country", "csv.website", "csv.email", "csv.phone", "csv.lat", "csv.lon", "csv.services"] as TKey[]).map((k) => t(k));
    const lines = [header];
    for (const h of list) {
      let services = "";
      try {
        const sig: SignalResult[] = h.score_breakdown ? JSON.parse(h.score_breakdown) : [];
        services = sig.filter((s) => s.present).map((s) => t(("signal." + s.key) as TKey)).join(", ");
      } catch { /* breakdown assente/non valido */ }
      const cStatus = h.contact_status ? t(("crm.status." + h.contact_status) as TKey) : "";
      lines.push([h.name, h.family_fit_score ?? "", erFromRow(h) ?? "", cStatus, h.contact_note ?? "", h.city ?? "", h.province ?? "", h.region ?? "", h.country ?? "", h.website ?? "", h.email ?? "", h.phone ?? "", h.lat, h.lon, services].map(String));
    }
    return "﻿" + lines.map((r) => r.map(csvCell).join(sep)).join("\r\n");
  }

  function rowsToJson(list: HotelRow[]): string {
    const out = list.map((h) => {
      let breakdown: SignalResult[] = [];
      try { breakdown = h.score_breakdown ? JSON.parse(h.score_breakdown) : []; } catch { /* */ }
      return {
        id: `${h.osm_type}/${h.osm_id}`,
        name: h.name,
        family_fit_score: h.family_fit_score,
        stars: h.stars || null,
        luxury: h.luxury ? true : false,
        expected_value_eur: erFromRow(h),
        city: h.city, province: h.province, region: h.region, country: h.country,
        lat: h.lat, lon: h.lon,
        website: h.website, email: h.email, email_status: h.email_status, phone: h.phone,
        contact_status: h.contact_status, contact_note: h.contact_note,
        proof: breakdown.filter((s) => s.present).map((s) => ({ signal: s.key, quote: s.quote })),
      };
    });
    return JSON.stringify({ app: "Kidotel Radar", exported: out.length, hotels: out }, null, 2);
  }

  // Feed «sito» per kidotel.co: SOLO campi pubblicabili come PRODUCED WORK (identità + punteggio + fatti +
  // UNA citazione breve attribuita con la fonte + link claim/affiliato + tier prezzo etichettato «stima»).
  // NIENTE contatti privati (email/telefono/stato CRM): quelli restano nell'export CRM, non nel feed pubblico.
  function rowsToFeed(list: HotelRow[]): string {
    const base = settings.claimBase;
    const aid = settings.bookingAid.trim();
    const out = list.map((h) => {
      let sig: SignalResult[] = [];
      try { sig = h.score_breakdown ? JSON.parse(h.score_breakdown) : []; } catch { /* breakdown assente */ }
      const present = sig.filter((s) => s.present);
      const q = encodeURIComponent([h.name, h.city, h.country].filter(Boolean).join(" "));
      const hasCoord = Number.isFinite(h.lat) && Number.isFinite(h.lon) && (h.lat !== 0 || h.lon !== 0);
      return {
        id: `${h.osm_type}/${h.osm_id}`,
        name: h.name,
        city: h.city, province: h.province, region: h.region, country: h.country,
        lat: h.lat, lon: h.lon,
        website: h.website || null,
        stars: h.stars || null,
        luxury: !!h.luxury,
        family_fit_score: h.family_fit_score,
        // fascia di prezzo SOLO come stima etichettata (mai un importo/prezzo OTA reale)
        price_tier: h.price_tier ? { tier: h.price_tier, note: "Kidotel estimate — not an OTA price" } : null,
        // feature come FATTI (la chiave; il sito la localizza), con un'etichetta EN d'appoggio
        features: present.map((s) => ({ key: s.key, label_en: EN_SIGNAL[s.key] || s.key })),
        // prova: citazione BREVE attribuita con la pagina-fonte
        proof: present.filter((s) => s.quote).map((s) => ({ signal: s.key, quote: shortQuote(s.quote as string), source: s.url || h.website || null })),
        claim_url: claimUrl(base, h, h.family_fit_score, lang),
        links: {
          booking: `https://www.booking.com/searchresults.html?ss=${q}${aid ? `&aid=${encodeURIComponent(aid)}` : ""}`,
          map: hasCoord ? `https://www.openstreetmap.org/?mlat=${h.lat}&mlon=${h.lon}#map=18/${h.lat}/${h.lon}` : null,
        },
        source: "OpenStreetMap",
      };
    });
    return JSON.stringify({
      app: "Kidotel Radar",
      feed: "website",
      generated: out.length,
      attribution: "© OpenStreetMap contributors",
      license_note: "Hotel base data © OpenStreetMap contributors under ODbL. Publish as a Produced Work (rendered pages) with attribution; do NOT redistribute as a raw database. The price tier is a Kidotel estimate, not an OTA price.",
      hotels: out,
    }, null, 2);
  }

  // Esegue l'export nel formato scelto: prende gli hotel selezionati e li salva su file.
  async function runExport(format: "csv" | "json" | "feed") {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      const list = await invoke<HotelRow[]>("select_hotels", { args: selToArgs(exportSel) });
      if (list.length === 0) { setNotice(t("xp.none")); return; }
      const content = format === "csv" ? rowsToCsv(list) : format === "feed" ? rowsToFeed(list) : rowsToJson(list);
      const ext = format === "csv" ? "csv" : "json";
      const tag =
        exportSel.scope === "continent" ? exportSel.continent :
        exportSel.scope === "country" ? exportSel.country.toLowerCase().replace(/[^a-z0-9]+/gi, "-").slice(0, 30) :
        "tutti";
      const suffix = format === "feed" ? "-feed" : "";
      const path = await save({ defaultPath: `kidotel-${tag}${suffix}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
      if (path) {
        await invoke("write_text_file", { path, content });
        setNotice(`${list.length} ${t("xp.done")}`);
        setOverlay(null);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setExportBusy(false);
    }
  }

  // #9 — raccoglie i dati reali per l'infografica e apre il dialog.
  async function openInfographic() {
    if (infoBusy) return;
    setInfoBusy(true);
    try {
      const thr = settings.familyThreshold;
      const [stats, hist, cov, funnel, contactable, famContactable, famRows] = await Promise.all([
        invoke<ScoreStats>("score_stats", { threshold: thr }),
        invoke<number[]>("score_histogram"),
        invoke<CoverageRow[]>("coverage_by_country", { threshold: thr }),
        invoke<{ status: string; count: number }[]>("contact_stats"),
        invoke<number>("count_select", { args: { countries: [], scoreMin: null, scoreMax: null, onlyScored: false, onlyContactable: true, onlyDeliverable: false, limit: null } }),
        invoke<number>("count_select", { args: { countries: [], scoreMin: thr, scoreMax: null, onlyScored: true, onlyContactable: true, onlyDeliverable: false, limit: null } }),
        invoke<HotelRow[]>("select_hotels", { args: { countries: [], scoreMin: thr, scoreMax: null, onlyScored: true, onlyContactable: false, onlyDeliverable: false, limit: 200000 } }),
      ]);
      const topCountries = [...cov].filter((c) => c.country !== "(sconosciuto)").sort((a, b) => b.strong - a.strong).slice(0, 10)
        .map((c) => ({ country: c.country, family: c.strong, total: c.total }));
      const cont: Record<string, { total: number; family: number }> = {};
      for (const c of cov) {
        const k = CONTINENT[c.country] ?? "other";
        if (!cont[k]) cont[k] = { total: 0, family: 0 };
        cont[k].total += c.total; cont[k].family += c.strong;
      }
      const continents = CONTINENT_ORDER.filter((k) => cont[k]?.total).map((k) => ({ key: k, total: cont[k].total, family: cont[k].family }));
      const erTotalFamily = famRows.reduce((s, h) => s + (erFromRow(h) ?? 0), 0);
      setInfoData({ stats, hist, topCountries, continents, funnel, contactable, famContactable, erTotalFamily });
      setOverlay("info");
    } catch (e) {
      setError(String(e));
    } finally {
      setInfoBusy(false);
    }
  }

  // Costruisce l'infografica come HTML autonomo (stampabile dal browser di sistema con tutte le sue
  // opzioni: PDF, A4/Lettera, orientamento). In Tauri window.print() è no-op → si apre con open_report.
  function buildInfographicHtml(d: InfoData, o: InfoOpts): string {
    const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    const date = new Date().toLocaleDateString(lang);
    const nf = (n: number) => n.toLocaleString(lang);
    const thr = settings.familyThreshold;

    const kpi = (val: string, label: string, accent = false) =>
      `<div class="kpi${accent ? " kpi-acc" : ""}"><div class="kpi-v">${esc(val)}</div><div class="kpi-l">${esc(label)}</div></div>`;

    const kpiBlock = !o.kpi ? "" : `<section class="grid kpis">
      ${kpi(nf(d.stats.total), t("info.k.total"))}
      ${kpi(nf(d.stats.scored), t("info.k.scored"))}
      ${kpi(nf(d.stats.strong), t("info.k.family") + " (≥" + thr + ")", true)}
      ${kpi(nf(d.contactable), t("info.k.contactable"))}
    </section>`;

    const histMax = Math.max(1, ...d.hist);
    const histBlock = !o.dist ? "" : `<section class="card"><h3>${esc(t("info.s.dist"))}</h3>
      <div class="hist">${d.hist.map((n, i) => {
        const lo = i * 10, hi = i === 9 ? 100 : i * 10 + 9;
        const h = Math.round((n / histMax) * 120);
        const fam = lo >= thr;
        return `<div class="hb"><div class="hb-bar${fam ? " fam" : ""}" style="height:${h}px" title="${nf(n)}"></div><div class="hb-n">${n ? nf(n) : ""}</div><div class="hb-x">${lo}–${hi}</div></div>`;
      }).join("")}</div>
      <div class="legend"><span class="sw fam"></span>${esc(t("info.l.family"))} (≥${thr}) · <span class="sw"></span>${esc(t("info.l.other"))}</div>
    </section>`;

    const cMax = Math.max(1, ...d.topCountries.map((c) => c.family));
    const countriesBlock = !o.countries || !d.topCountries.length ? "" : `<section class="card"><h3>${esc(t("info.s.countries"))}</h3>
      <div class="bars">${d.topCountries.map((c) => `<div class="bar-row"><div class="bar-lab">${esc(c.country)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.round((c.family / cMax) * 100)}%"></div></div><div class="bar-val">${nf(c.family)}</div></div>`).join("")}</div>
    </section>`;

    const contMax = Math.max(1, ...d.continents.map((c) => c.total));
    const contBlock = !o.conts || !d.continents.length ? "" : `<section class="card"><h3>${esc(t("info.s.conts"))}</h3>
      <div class="bars">${d.continents.map((c) => `<div class="bar-row"><div class="bar-lab">${esc(t(("cont." + c.key) as TKey))}</div><div class="bar-track"><div class="bar-fill alt" style="width:${Math.round((c.total / contMax) * 100)}%"></div></div><div class="bar-val">${nf(c.total)} · <b>${nf(c.family)}</b></div></div>`).join("")}</div>
      <div class="legend">${esc(t("info.l.totfam"))}</div>
    </section>`;

    const order = ["da_contattare", "contattato", "risposto", "trattativa", "partner", "rifiutato"];
    const fmap: Record<string, number> = {};
    for (const f of d.funnel) fmap[f.status] = f.count;
    const fMax = Math.max(1, ...order.map((s) => fmap[s] ?? 0));
    const funnelBlock = !o.funnel ? "" : `<section class="card"><h3>${esc(t("info.s.funnel"))}</h3>
      <div class="bars">${order.map((s) => `<div class="bar-row"><div class="bar-lab">${esc(t(("crm.status." + s) as TKey))}</div><div class="bar-track"><div class="bar-fill ${s === "partner" ? "ok" : "alt"}" style="width:${Math.round(((fmap[s] ?? 0) / fMax) * 100)}%"></div></div><div class="bar-val">${nf(fmap[s] ?? 0)}</div></div>`).join("")}</div>
    </section>`;

    const valueBlock = !o.value ? "" : `<section class="card value"><h3>${esc(t("info.s.value"))}</h3>
      <div class="big">€ ${nf(d.erTotalFamily)}</div>
      <div class="value-sub">${esc(t("info.v.sub").replace("{n}", nf(d.famContactable)))}</div>
    </section>`;

    const page = o.orientation === "landscape" ? "A4 landscape" : "A4 portrait";
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kidotel Radar — ${esc(t("info.title"))}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&family=Sora:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  @page { size: ${page}; margin: 14mm; }
  :root { --ink:#222223; --peach:#ffc27b; --amber:#ef9f27; --deep:#925a0c; --mut:#6b6b66; --line:#e6e4de; --soft:#fff3e4; }
  * { box-sizing: border-box; }
  body { font-family:"Manrope","Manrope Variable",-apple-system,"Segoe UI",Roboto,Arial,sans-serif; color: var(--ink); margin: 0; padding: 28px; background:#fff; }
  h1,h2,h3 { font-family:"Sora","Sora Variable",-apple-system,"Segoe UI",Arial,sans-serif; }
  .head { display:flex; align-items:center; gap:16px; border-bottom:3px solid var(--peach); padding-bottom:14px; margin-bottom:20px; }
  .head .mark { color:var(--ink); flex:0 0 auto; }
  .head .mark svg { display:block; }
  .head .divider { width:1px; height:34px; background:var(--line); }
  .head h1 { font-size:19px; margin:0; font-weight:600; }
  .head .sub { color:var(--mut); font-size:13px; margin-top:2px; }
  .grid { display:grid; gap:14px; }
  .kpis { grid-template-columns: repeat(4, 1fr); margin-bottom:18px; }
  .kpi { border:1px solid var(--line); border-radius:14px; padding:16px; text-align:center; }
  .kpi-acc { background:var(--soft); border-color:var(--peach); }
  .kpi-v { font-family:"Sora","Sora Variable",sans-serif; font-size:26px; font-weight:800; color:var(--ink); font-variant-numeric:tabular-nums; }
  .kpi-l { font-size:12px; color:var(--mut); margin-top:4px; }
  .card { border:1px solid var(--line); border-radius:14px; padding:16px 18px; margin-bottom:16px; break-inside:avoid; }
  .card h3 { margin:0 0 12px; font-size:15px; color:var(--deep); }
  .hist { display:flex; align-items:flex-end; gap:8px; height:150px; padding-top:10px; }
  .hb { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:4px; }
  .hb-bar { width:100%; background:#dcd8d0; border-radius:6px 6px 0 0; min-height:2px; }
  .hb-bar.fam { background:var(--amber); }
  .hb-n { font-size:10px; color:var(--mut); font-variant-numeric:tabular-nums; }
  .hb-x { font-size:10px; color:var(--mut); }
  .legend { font-size:11.5px; color:var(--mut); margin-top:10px; }
  .sw { display:inline-block; width:10px; height:10px; border-radius:3px; background:#dcd8d0; vertical-align:middle; margin:0 4px; }
  .sw.fam { background:var(--amber); }
  .bars { display:flex; flex-direction:column; gap:8px; }
  .bar-row { display:grid; grid-template-columns: 150px 1fr 90px; align-items:center; gap:10px; }
  .bar-lab { font-size:12.5px; }
  .bar-track { background:#f0efe9; border-radius:6px; height:14px; overflow:hidden; }
  .bar-fill { height:100%; background:var(--amber); border-radius:6px; }
  .bar-fill.alt { background:var(--peach); }
  .bar-fill.ok { background:var(--deep); }
  .bar-val { font-size:12px; color:var(--mut); text-align:right; font-variant-numeric:tabular-nums; }
  .value { text-align:center; background:linear-gradient(160deg,var(--peach),var(--soft) 70%,#fff); border-color:var(--peach); }
  .value .big { font-family:"Sora","Sora Variable",sans-serif; font-size:34px; font-weight:800; color:var(--ink); font-variant-numeric:tabular-nums; }
  .value-sub { font-size:12.5px; color:var(--ink); margin-top:6px; }
  .two { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .foot { margin-top:14px; font-size:11px; color:var(--mut); border-top:1px solid var(--line); padding-top:10px; }
  .noprint { margin:0 0 16px; }
  .pbtn { font:inherit; font-weight:600; font-size:13px; padding:9px 18px; border-radius:8px; border:none; background:var(--ink); color:#fff; cursor:pointer; }
  @media print { .noprint { display:none; } body { padding:0; } }
</style></head><body>
  <div class="noprint"><button class="pbtn" onclick="window.print()">${esc(t("info.print"))}</button></div>
  <div class="head">
    <div class="mark">${wordmarkSvg(30, "#222223")}</div>
    <div class="divider"></div>
    <div><h1>Radar</h1><div class="sub">${esc(t("info.title"))} · ${date}</div></div>
  </div>
  ${kpiBlock}
  ${histBlock}
  <div class="two">${countriesBlock}${contBlock}</div>
  <div class="two">${funnelBlock}${valueBlock}</div>
  <div class="foot">${esc(t("footer.proof"))} · ${esc(t("footer.copyright"))} · Kidotel Radar ${APP_VERSION}</div>
</body></html>`;
  }

  async function printInfographic() {
    if (!infoData) return;
    try { await invoke("open_report", { html: buildInfographicHtml(infoData, infoOpts) }); }
    catch (e) { setError(String(e)); }
  }
  async function saveInfographic() {
    if (!infoData) return;
    try {
      const path = await save({ defaultPath: "kidotel-infografica.html", filters: [{ name: "HTML", extensions: ["html"] }] });
      if (path) await invoke("write_text_file", { path, content: buildInfographicHtml(infoData, infoOpts) });
    } catch (e) { setError(String(e)); }
  }

  // «Da fare ora» #2 del piano economico: REPORT INSIGHT vendibile. Solo dati AGGREGATI (mai righe-record)
  // → è un Produced Work (ODbL §4.5b: niente share-alike) e, essendo statistiche anonime, è fuori dal GDPR.
  // NIENTE dati interni (funnel CRM, valore atteso): è la versione esterna/commerciale dell'infografica.
  async function openInsightsReport() {
    if (reportBusy) return;
    setReportBusy(true);
    try {
      const thr = settings.familyThreshold;
      const [stats, hist, cov] = await Promise.all([
        invoke<ScoreStats>("score_stats", { threshold: thr }),
        invoke<number[]>("score_histogram"),
        invoke<CoverageRow[]>("coverage_by_country", { threshold: thr }),
      ]);
      await invoke("open_report", { html: buildInsightsHtml(stats, hist, cov) });
    } catch (e) { setError(String(e)); }
    finally { setReportBusy(false); }
  }

  function buildInsightsHtml(stats: ScoreStats, hist: number[], cov: CoverageRow[]): string {
    const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    const date = new Date().toLocaleDateString(lang);
    const nf = (n: number) => n.toLocaleString(lang);
    const thr = settings.familyThreshold;
    const countries = cov.filter((c) => c.country && c.country !== "(sconosciuto)");
    const famPct = stats.scored ? Math.round((stats.strong / stats.scored) * 100) : 0;
    const top = [...countries].sort((a, b) => b.strong - a.strong).slice(0, 15);
    const cont: Record<string, { total: number; family: number }> = {};
    for (const c of countries) { const k = CONTINENT[c.country] ?? "other"; (cont[k] ??= { total: 0, family: 0 }); cont[k].total += c.total; cont[k].family += c.strong; }
    const continents = CONTINENT_ORDER.filter((k) => cont[k]?.total).map((k) => ({ key: k, total: cont[k].total, family: cont[k].family }));

    const kpi = (val: string, label: string, acc = false) => `<div class="kpi${acc ? " kpi-acc" : ""}"><div class="kpi-v">${esc(val)}</div><div class="kpi-l">${esc(label)}</div></div>`;
    const histMax = Math.max(1, ...hist);
    const histBlock = `<section class="card"><h3>${esc(t("info.s.dist"))}</h3><div class="hist">${hist.map((n, i) => {
      const lo = i * 10, hi = i === 9 ? 100 : i * 10 + 9; const h = Math.round((n / histMax) * 120); const fam = lo >= thr;
      return `<div class="hb"><div class="hb-bar${fam ? " fam" : ""}" style="height:${h}px"></div><div class="hb-n">${n ? nf(n) : ""}</div><div class="hb-x">${lo}–${hi}</div></div>`;
    }).join("")}</div><div class="legend"><span class="sw fam"></span>${esc(t("info.l.family"))} (≥${thr}) · <span class="sw"></span>${esc(t("info.l.other"))}</div></section>`;
    const tMax = Math.max(1, ...top.map((c) => c.strong));
    const topBlock = !top.length ? "" : `<section class="card"><h3>${esc(t("insights.s.top"))}</h3><div class="bars">${top.map((c) => `<div class="bar-row"><div class="bar-lab">${esc(c.country)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.round((c.strong / tMax) * 100)}%"></div></div><div class="bar-val">${nf(c.strong)} / ${nf(c.total)}</div></div>`).join("")}</div></section>`;
    const coMax = Math.max(1, ...continents.map((c) => c.total));
    const contBlock = !continents.length ? "" : `<section class="card"><h3>${esc(t("info.s.conts"))}</h3><div class="bars">${continents.map((c) => `<div class="bar-row"><div class="bar-lab">${esc(t(("cont." + c.key) as TKey))}</div><div class="bar-track"><div class="bar-fill alt" style="width:${Math.round((c.total / coMax) * 100)}%"></div></div><div class="bar-val">${nf(c.total)} · <b>${nf(c.family)}</b></div></div>`).join("")}</div><div class="legend">${esc(t("info.l.totfam"))}</div></section>`;

    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kidotel — ${esc(t("insights.title"))}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Sora:wght@600;700;800&display=swap" rel="stylesheet">
<style>
  @page { size: A4 portrait; margin: 14mm; }
  :root { --ink:#222223; --peach:#ffc27b; --amber:#ef9f27; --deep:#925a0c; --mut:#6b6b66; --line:#e6e4de; --soft:#fff3e4; }
  * { box-sizing:border-box; } body { font-family:"Manrope",-apple-system,"Segoe UI",Arial,sans-serif; color:var(--ink); margin:0; padding:28px; background:#fff; }
  h1,h3 { font-family:"Sora",-apple-system,"Segoe UI",Arial,sans-serif; }
  .head { display:flex; align-items:center; gap:16px; border-bottom:3px solid var(--peach); padding-bottom:14px; margin-bottom:8px; }
  .head .divider { width:1px; height:34px; background:var(--line); } .head h1 { font-size:19px; margin:0; font-weight:700; } .head .sub { color:var(--mut); font-size:13px; margin-top:2px; }
  .intro { font-size:12.5px; color:var(--mut); margin:10px 0 18px; max-width:70ch; }
  .grid { display:grid; gap:14px; } .kpis { grid-template-columns:repeat(4,1fr); margin-bottom:18px; }
  .kpi { border:1px solid var(--line); border-radius:14px; padding:16px; text-align:center; } .kpi-acc { background:var(--soft); border-color:var(--peach); }
  .kpi-v { font-family:"Sora",sans-serif; font-size:24px; font-weight:800; font-variant-numeric:tabular-nums; } .kpi-l { font-size:12px; color:var(--mut); margin-top:4px; }
  .card { border:1px solid var(--line); border-radius:14px; padding:16px 18px; margin-bottom:16px; break-inside:avoid; } .card h3 { margin:0 0 12px; font-size:15px; color:var(--deep); }
  .hist { display:flex; align-items:flex-end; gap:8px; height:150px; padding-top:10px; } .hb { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; gap:4px; }
  .hb-bar { width:100%; background:#dcd8d0; border-radius:6px 6px 0 0; min-height:2px; } .hb-bar.fam { background:var(--amber); } .hb-n,.hb-x { font-size:10px; color:var(--mut); font-variant-numeric:tabular-nums; }
  .legend { font-size:11.5px; color:var(--mut); margin-top:10px; } .sw { display:inline-block; width:10px; height:10px; border-radius:3px; background:#dcd8d0; vertical-align:middle; margin:0 4px; } .sw.fam { background:var(--amber); }
  .bars { display:flex; flex-direction:column; gap:8px; } .bar-row { display:grid; grid-template-columns:150px 1fr 110px; align-items:center; gap:10px; } .bar-lab { font-size:12.5px; }
  .bar-track { background:#f0efe9; border-radius:6px; height:14px; overflow:hidden; } .bar-fill { height:100%; background:var(--amber); border-radius:6px; } .bar-fill.alt { background:var(--peach); }
  .bar-val { font-size:12px; color:var(--mut); text-align:right; font-variant-numeric:tabular-nums; }
  .two { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
  .foot { margin-top:14px; font-size:11px; color:var(--mut); border-top:1px solid var(--line); padding-top:10px; line-height:1.6; }
  .foot a { color:var(--deep); }
  .noprint { margin:0 0 16px; } .pbtn { font:inherit; font-weight:600; font-size:13px; padding:9px 18px; border-radius:8px; border:none; background:var(--ink); color:#fff; cursor:pointer; }
  @media print { .noprint { display:none; } body { padding:0; } }
</style></head><body>
  <div class="noprint"><button class="pbtn" onclick="window.print()">${esc(t("info.print"))}</button></div>
  <div class="head"><div class="mark">${wordmarkSvg(30, "#222223")}</div><div class="divider"></div><div><h1>${esc(t("insights.title"))}</h1><div class="sub">${date}</div></div></div>
  <p class="intro">${esc(t("insights.intro"))}</p>
  <section class="grid kpis">
    ${kpi(nf(stats.total), t("insights.k.analyzed"))}
    ${kpi(nf(stats.strong), t("insights.k.family") + " (≥" + thr + ")", true)}
    ${kpi(famPct + "%", t("insights.k.familypct"))}
    ${kpi(nf(countries.length), t("insights.k.countries"))}
  </section>
  ${histBlock}
  <div class="two">${topBlock}${contBlock}</div>
  <div class="foot">${esc(t("insights.method"))}<br>${esc(t("insights.aggregated"))} · © OpenStreetMap contributors (<a href="https://www.openstreetmap.org/copyright">ODbL</a>) · ${esc(t("footer.copyright"))} · Kidotel Radar ${APP_VERSION}</div>
</body></html>`;
  }

  // «Kidotel Certified» (via economica: l'hotel paga l'audit/badge). Genera un CERTIFICATO brandizzato
  // (Produced Work: punteggio + prova citata dal sito, attribuzione OSM) da inviare/stampare, e copia
  // negli appunti uno SNIPPET BADGE che l'hotel incolla sul proprio sito (link a kidotel.co → backlink/SEO).
  function badgeSnippet(h: Hotel, score: number): string {
    const base = (settings.claimBase || "https://kidotel.co").replace(/\/+$/, "");
    const url = `${base}/hotel/${h.osm_type}/${h.osm_id}`;
    return `<a href="${url}" rel="noopener" target="_blank" style="display:inline-flex;align-items:center;gap:8px;font-family:system-ui,-apple-system,Segoe UI,sans-serif;text-decoration:none;background:#222223;color:#ffffff;padding:8px 14px;border-radius:999px;font-size:14px;font-weight:600;line-height:1"><b style="color:#FFC27B">Kidotel Certified</b><span style="opacity:.85;font-weight:500">Family-Fit ${score}/100</span></a>`;
  }

  function buildCertificateHtml(h: Hotel, sc: EnrichResult): string {
    const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    const date = new Date().toLocaleDateString(lang);
    const score = sc.family_fit_score ?? 0;
    const present = sc.signals.filter((s) => s.present && s.quote).slice(0, 8);
    const proof = present.map((s) => `<li><div class="pf-sig">${esc(t(("signal." + s.key) as TKey))}</div><blockquote>“${esc(shortQuote(s.quote as string, 32))}”</blockquote>${s.url ? `<a class="pf-src" href="${esc(s.url)}">${esc(t("cert.source"))}: ${esc(prettyHost(s.url))}</a>` : ""}</li>`).join("");
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kidotel Certified — ${esc(h.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4 portrait; margin: 16mm; }
  :root { --ink:#222223; --peach:#ffc27b; --amber:#ef9f27; --deep:#925a0c; --mut:#6b6b66; --line:#e6e4de; --soft:#fff3e4; }
  * { box-sizing:border-box; } body { font-family:"Manrope",-apple-system,"Segoe UI",Arial,sans-serif; color:var(--ink); margin:0; padding:32px; background:#fff; }
  h1,h2,h3 { font-family:"Sora",-apple-system,"Segoe UI",Arial,sans-serif; margin:0; }
  .cert { max-width:760px; margin:0 auto; border:2px solid var(--peach); border-radius:22px; padding:34px 40px; position:relative; }
  .top { display:flex; align-items:center; justify-content:space-between; gap:16px; border-bottom:1px solid var(--line); padding-bottom:16px; }
  .seal { font-family:"Sora",sans-serif; font-weight:800; font-size:12px; letter-spacing:.16em; text-transform:uppercase; color:var(--deep); background:var(--soft); border:1px solid var(--peach); padding:7px 13px; border-radius:999px; }
  .hotel { margin:26px 0 4px; font-size:30px; font-weight:800; line-height:1.1; }
  .loc { color:var(--mut); font-size:15px; }
  .scorewrap { display:flex; align-items:center; gap:18px; margin:24px 0; }
  .score { font-family:"Sora",sans-serif; font-weight:800; font-size:54px; color:var(--ink); font-variant-numeric:tabular-nums; line-height:1; }
  .score small { font-size:22px; color:var(--mut); }
  .score-l { font-size:14px; color:var(--deep); font-weight:700; text-transform:uppercase; letter-spacing:.08em; }
  .vh { font-size:14px; color:var(--deep); font-weight:700; margin:18px 0 8px; }
  ul.proof { list-style:none; padding:0; margin:0; display:grid; gap:12px; }
  ul.proof li { border:1px solid var(--line); border-radius:12px; padding:12px 14px; break-inside:avoid; }
  .pf-sig { font-family:"Sora",sans-serif; font-weight:700; font-size:13.5px; color:var(--ink); margin-bottom:4px; }
  blockquote { margin:0; font-size:13.5px; color:#3a3a36; border-left:3px solid var(--peach); padding-left:10px; }
  .pf-src { display:inline-block; margin-top:6px; font-size:11.5px; color:var(--deep); text-decoration:none; }
  .foot { margin-top:22px; padding-top:14px; border-top:1px solid var(--line); font-size:11px; color:var(--mut); line-height:1.6; }
  .foot a { color:var(--deep); }
  .issued { font-size:13px; color:var(--mut); margin-top:10px; }
  .noprint { max-width:760px; margin:0 auto 16px; } .pbtn { font:inherit; font-weight:600; font-size:13px; padding:9px 18px; border-radius:8px; border:none; background:var(--ink); color:#fff; cursor:pointer; }
  @media print { .noprint { display:none; } body { padding:0; } }
</style></head><body>
  <div class="noprint"><button class="pbtn" onclick="window.print()">${esc(t("info.print"))}</button></div>
  <div class="cert">
    <div class="top"><div class="mark">${wordmarkSvg(26, "#222223")}</div><div class="seal">${esc(t("cert.doc.title"))}</div></div>
    <h1 class="hotel">${esc(h.name)}</h1>
    <div class="loc">${esc(locationOf(h))}</div>
    <div class="scorewrap"><div class="score">${esc(score)}<small>/100</small></div><div><div class="score-l">${esc(t("cert.score"))}</div><div class="loc">${esc(t("cert.tagline"))}</div></div></div>
    <div class="vh">${esc(t("cert.verified"))}</div>
    <ul class="proof">${proof || `<li><blockquote>${esc(t("cert.tagline"))}</blockquote></li>`}</ul>
    <div class="issued">${esc(t("cert.issued"))}: ${date}</div>
    <div class="foot">${esc(t("cert.method"))}<br>© OpenStreetMap contributors (<a href="https://www.openstreetmap.org/copyright">ODbL</a>) · ${esc(t("footer.copyright"))} · Kidotel Radar ${APP_VERSION}</div>
  </div>
</body></html>`;
  }

  async function openCertificate(h: Hotel) {
    const sc = scores[hkey(h)];
    if (!sc || sc.family_fit_score == null) { setNotice(t("cert.noscore")); return; }
    try {
      await invoke("open_report", { html: buildCertificateHtml(h, sc) });
      try { await navigator.clipboard.writeText(badgeSnippet(h, sc.family_fit_score)); } catch { /* clipboard non disponibile */ }
      setNotice(t("cert.badged"));
    } catch (e) { setError(String(e)); }
  }

  // ANALISI PREMIUM per hotel (via economica: analytics a pagamento). Trasforma il punteggio in insight
  // AZIONABILE: percentile vs concorrenti (da score_histogram), da dove arriva il punteggio (breakdown
  // segnali), e LEVE DI MIGLIORAMENTO (segnali mancanti pesati). È un Produced Work: niente dati interni.
  function buildAnalyticsHtml(h: Hotel, sc: EnrichResult, hist: number[], cov: CoverageRow[]): string {
    const esc = (s: unknown) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    const nf = (n: number) => n.toLocaleString(lang);
    const date = new Date().toLocaleDateString(lang);
    const fill = (s: string, v: Record<string, string | number>) => Object.keys(v).reduce((a, k) => a.replace("{" + k + "}", String(v[k])), s);
    const score = sc.family_fit_score ?? 0;
    const present = new Set(sc.signals.filter((s) => s.present).map((s) => s.key));
    const rows = SIGNAL_CATALOG.map((c) => ({ key: c.key, weight: c.weight, present: present.has(c.key), label: t(("signal." + c.key) as TKey) }));
    const earned = rows.filter((r) => r.present).reduce((s, r) => s + r.weight, 0);
    const missing = rows.filter((r) => !r.present).sort((a, b) => b.weight - a.weight);
    const potential = missing.reduce((s, r) => s + r.weight, 0);
    // percentile globale dalla distribuzione punteggi
    const totalScored = Math.max(1, hist.reduce((s, n) => s + n, 0));
    const b = Math.min(9, Math.max(0, Math.floor(score / 10)));
    let cumBelow = 0; for (let i = 0; i < b; i++) cumBelow += hist[i] || 0;
    const pctBetter = Math.min(100, Math.round(((cumBelow + (hist[b] || 0) / 2) / totalScored) * 100));
    const topPct = Math.max(1, 100 - pctBetter);
    // benchmark di paese
    const cc = cov.find((c) => c.country === h.country);
    const cStrong = cc ? cc.strong : 0, cTotal = cc ? cc.total : 0;
    const cRate = cTotal ? Math.round((cStrong / cTotal) * 100) : 0;

    const wMax = SIGNAL_CATALOG[0].weight;
    const breakdown = rows.map((r) => `<div class="sg ${r.present ? "on" : "off"}"><div class="sg-lab">${esc(r.label)}</div><div class="sg-track"><div class="sg-fill" style="width:${Math.round((r.weight / wMax) * 100)}%"></div></div><div class="sg-w">${r.present ? "+" + r.weight : "—"}</div><div class="sg-st">${esc(r.present ? t("analytics.present") : t("analytics.missing"))}</div></div>`).join("");
    const levers = missing.length
      ? `<ul class="levers">${missing.map((r) => `<li><span class="lv-pts">+${r.weight}</span> ${esc(fill(t("analytics.lever"), { label: r.label }))}</li>`).join("")}</ul><div class="lv-tot">${esc(fill(t("analytics.potential"), { n: potential }))}</div>`
      : `<div class="lv-max">${esc(t("analytics.levermax"))}</div>`;

    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kidotel — ${esc(t("analytics.title"))} · ${esc(h.name)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  @page { size: A4 portrait; margin: 15mm; }
  :root { --ink:#222223; --peach:#ffc27b; --amber:#ef9f27; --deep:#925a0c; --mut:#6b6b66; --line:#e6e4de; --soft:#fff3e4; }
  * { box-sizing:border-box; } body { font-family:"Manrope",-apple-system,"Segoe UI",Arial,sans-serif; color:var(--ink); margin:0; padding:30px; background:#fff; }
  h1,h2,h3 { font-family:"Sora",-apple-system,"Segoe UI",Arial,sans-serif; margin:0; }
  .head { display:flex; align-items:center; gap:14px; border-bottom:3px solid var(--peach); padding-bottom:14px; }
  .head .divider { width:1px; height:32px; background:var(--line); } .head h1 { font-size:18px; } .head .sub { color:var(--mut); font-size:13px; }
  .hero { display:flex; align-items:center; gap:24px; margin:22px 0; flex-wrap:wrap; }
  .big { font-family:"Sora",sans-serif; font-weight:800; font-size:58px; line-height:1; font-variant-numeric:tabular-nums; } .big small { font-size:24px; color:var(--mut); }
  .toppct { background:var(--ink); color:#fff; font-family:"Sora",sans-serif; font-weight:800; font-size:15px; padding:8px 16px; border-radius:999px; }
  .hero-txt { font-size:14px; color:var(--mut); max-width:46ch; }
  .hotel { font-size:22px; font-weight:800; margin:2px 0; } .loc { color:var(--mut); font-size:14px; }
  .card { border:1px solid var(--line); border-radius:14px; padding:16px 18px; margin:14px 0; break-inside:avoid; } .card h3 { font-size:15px; color:var(--deep); margin:0 0 12px; }
  .pos { display:grid; grid-template-columns:1fr 1fr; gap:16px; } .pos .lab { font-size:12px; color:var(--mut); } .pos .v { font-family:"Sora",sans-serif; font-weight:700; font-size:18px; margin-top:2px; }
  .sg { display:grid; grid-template-columns:170px 1fr 46px 90px; align-items:center; gap:10px; padding:5px 0; font-size:13px; }
  .sg-lab { font-weight:600; } .sg-track { background:#f0efe9; border-radius:6px; height:12px; overflow:hidden; } .sg-fill { height:100%; background:#dcd8d0; border-radius:6px; }
  .sg.on .sg-fill { background:var(--amber); } .sg-w { text-align:right; font-variant-numeric:tabular-nums; font-weight:700; color:var(--deep); }
  .sg.off { opacity:.7; } .sg-st { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; } .sg.on .sg-st { color:var(--deep); } .sg.off .sg-st { color:#b23b21; }
  .earned { margin-top:10px; font-size:13px; color:var(--mut); } .earned b { color:var(--ink); font-family:"Sora",sans-serif; }
  .levers { list-style:none; padding:0; margin:0; display:grid; gap:9px; } .levers li { font-size:13.5px; display:flex; align-items:center; gap:10px; }
  .lv-pts { flex:0 0 auto; background:var(--soft); color:var(--deep); font-family:"Sora",sans-serif; font-weight:800; font-size:13px; padding:3px 10px; border-radius:999px; border:1px solid var(--peach); }
  .lv-tot { margin-top:12px; font-weight:700; font-family:"Sora",sans-serif; } .lv-max { font-weight:700; color:var(--deep); }
  .foot { margin-top:18px; padding-top:12px; border-top:1px solid var(--line); font-size:11px; color:var(--mut); line-height:1.6; } .foot a { color:var(--deep); }
  .noprint { margin:0 0 14px; } .pbtn { font:inherit; font-weight:600; font-size:13px; padding:9px 18px; border-radius:8px; border:none; background:var(--ink); color:#fff; cursor:pointer; }
  @media print { .noprint { display:none; } body { padding:0; } }
</style></head><body>
  <div class="noprint"><button class="pbtn" onclick="window.print()">${esc(t("info.print"))}</button></div>
  <div class="head"><div class="mark">${wordmarkSvg(26, "#222223")}</div><div class="divider"></div><div><h1>${esc(t("analytics.title"))}</h1><div class="sub">${date}</div></div></div>
  <div class="hotel">${esc(h.name)}</div><div class="loc">${esc(locationOf(h))}</div>
  <div class="hero">
    <div class="big">${esc(score)}<small>/100</small></div>
    <div class="toppct">${esc(fill(t("analytics.toppct"), { n: topPct }))}</div>
    <div class="hero-txt">${esc(fill(t("analytics.percentile"), { pct: pctBetter }))}</div>
  </div>
  <section class="card"><h3>${esc(t("analytics.position"))}</h3><div class="pos">
    <div><div class="lab">${esc(t("analytics.posglobal"))}</div><div class="v">${esc(fill(t("analytics.toppct"), { n: topPct }))}</div></div>
    <div><div class="lab">${esc(fill(t("analytics.country"), { c: h.country || "—" }))}</div><div class="v">${esc(fill(t("analytics.countryStat"), { fam: nf(cStrong), tot: nf(cTotal), rate: cRate }))}</div></div>
  </div></section>
  <section class="card"><h3>${esc(t("analytics.breakdown"))}</h3>${breakdown}
    <div class="earned">${esc(t("analytics.earned")).replace("{e}", `<b>${esc(nf(earned))}</b>`).replace("{m}", esc(nf(SIGNAL_MAX)))}</div>
  </section>
  <section class="card"><h3>${esc(t("analytics.levers"))}</h3>${levers}</section>
  <div class="foot">${esc(t("analytics.method"))}<br>© OpenStreetMap contributors (<a href="https://www.openstreetmap.org/copyright">ODbL</a>) · ${esc(t("footer.copyright"))} · Kidotel Radar ${APP_VERSION}</div>
</body></html>`;
  }

  // «Family-Fit as a Service»: valuta il sito fornito dal cliente. Non legge né scrive il DB Kidotel:
  // la metodologia è il prodotto, il dato resta del cliente. Dimostra l'API come servizio.
  async function runFtool() {
    const url = ftUrl.trim();
    if (!url || ftBusy) return;
    setFtBusy(true); setFtErr(""); setFtResult(null);
    try {
      const r = await invoke<EnrichResult>("score_website", { website: url });
      setFtResult(r);
      if (!r.website_ok) setFtErr(t("ftool.unreachable"));
    } catch (e) { setFtErr(String(e)); }
    finally { setFtBusy(false); }
  }

  async function openHotelAnalytics(h: Hotel) {
    const sc = scores[hkey(h)];
    if (!sc || sc.family_fit_score == null) { setNotice(t("analytics.noscore")); return; }
    try {
      const [hist, cov] = await Promise.all([
        invoke<number[]>("score_histogram"),
        invoke<CoverageRow[]>("coverage_by_country", { threshold: settings.familyThreshold }),
      ]);
      await invoke("open_report", { html: buildAnalyticsHtml(h, sc, hist, cov) });
    } catch (e) { setError(String(e)); }
  }

  function buildReportHtml(): string {
    const esc = (s: unknown) =>
      String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
    const date = new Date().toLocaleDateString(lang);
    const body = rows
      .map(({ h, score }) => {
        const sc = scores[hkey(h)];
        const services = sc ? sc.signals.filter((s) => s.present).map((s) => t(("signal." + s.key) as TKey)).join(", ") : "";
        return `<tr><td>${esc(h.name)}</td><td class="s">${score ?? "—"}</td><td>${esc([h.city, h.country].filter(Boolean).join(", "))}</td><td>${esc(h.website ? prettyHost(h.website) : "")}</td><td>${esc(services)}</td></tr>`;
      })
      .join("");
    return (
      `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>Kidotel Radar</title>` +
      `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` +
      `<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Sora:wght@600;700&display=swap" rel="stylesheet">` +
      `<style>body{font-family:"Manrope",-apple-system,Segoe UI,Arial,sans-serif;margin:24px;color:#222223}` +
      `.head{display:flex;align-items:center;gap:14px;border-bottom:3px solid #ffc27b;padding-bottom:12px;margin-bottom:14px}` +
      `.head .divider{width:1px;height:28px;background:#e6e4de}` +
      `h1{font-family:"Sora",sans-serif;font-size:17px;margin:0;font-weight:600}.sub{color:#6b6b66;font-size:13px;margin-bottom:16px}` +
      `table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #e6e4de}` +
      `th{color:#6b6b66;font-weight:600}.s{font-weight:700;color:#925a0c}</style></head><body>` +
      `<div class="head">${wordmarkSvg(26, "#222223")}<div class="divider"></div><h1>Radar</h1></div>` +
      `<div class="sub">${esc(area || "")} · ${date} · ${rows.length} ${t("report.hotels")}</div>` +
      `<table><thead><tr><th>${t("results.hotel")}</th><th>${t("results.score")}</th><th>${t("results.location")}</th><th>${t("results.website")}</th><th>${t("results.proof")}</th></tr></thead><tbody>${body}</tbody></table>` +
      `<div class="sub" style="margin-top:18px">${esc(t("footer.copyright"))} · Kidotel Radar ${APP_VERSION}</div>` +
      `</body></html>`
    );
  }

  async function printReport() {
    try {
      await invoke("open_report", { html: buildReportHtml() });
    } catch (e) {
      setError(String(e));
    }
  }

  // AI via Cowork: esporta gli hotel da valutare (nome+sito); Cowork/Claude li legge e li valuta;
  // poi reimporti i voti. Niente chiave API, supera il tetto delle regole.
  async function exportAiBatch() {
    const targets = rows.filter((r) => r.h.website && r.score === null).slice(0, 300);
    if (targets.length === 0) {
      setNotice(t("ai.none"));
      return;
    }
    const batch = {
      app: "Kidotel Radar",
      task: "family_fit_scoring",
      istruzioni:
        "Per ogni hotel apri il sito (campo website), leggi le pagine rilevanti in qualsiasi lingua e valuta quanto è adatto alle famiglie con bambini (family_fit_score 0-100). Per ogni servizio family trovato aggiungi un elemento in breakdown con key (kids_club|kids_facilities|family_rooms|childcare|kids_dining|activities_age|safety), present=true, quote (frase citata dal sito) e url. NON inventare: se non c'è prova sul sito, non assegnare il punto. Restituisci un JSON con chiave 'results' e lo stesso 'id' di ogni hotel.",
      schema_risultati: {
        results: [{ id: "node/123", family_fit_score: 0, breakdown: [{ key: "kids_club", present: true, quote: "…", url: "…" }] }],
      },
      hotels: targets.map(({ h }) => ({ id: hkey(h), name: h.name, website: h.website, city: h.city, country: h.country })),
    };
    try {
      const path = await save({ defaultPath: "kidotel-ai-batch.json", filters: [{ name: "JSON", extensions: ["json"] }] });
      if (path) {
        await invoke("write_text_file", { path, content: JSON.stringify(batch, null, 2) });
        setNotice(`${targets.length} ${t("ai.exported")}`);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function importAiScores() {
    try {
      const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (typeof path === "string") {
        const n = await invoke<number>("import_ai_scores", { path });
        await loadArchive();
        setNotice(`${n} ${t("ai.imported")}`);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  // Importa le recensioni raccolte da Cowork (JSON: { reviews:[{id:"node/123",author,rating,text,source,date}] }).
  async function importReviews() {
    try {
      const path = await open({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
      if (typeof path === "string") {
        const n = await invoke<number>("import_reviews", { path });
        try { setReviewCounts(await invoke<Record<string, number>>("review_counts")); } catch { /* */ }
        setNotice(`${n} ${t("reviews.imported")}`);
      }
    } catch (e) {
      setError(String(e));
    }
  }

  // Backup: l'intero database in un file .sqlite, esportabile e re-importabile.
  async function exportBackup() {
    try {
      const path = await save({ defaultPath: "kidotel-radar-backup.sqlite", filters: [{ name: "SQLite", extensions: ["sqlite"] }] });
      if (path) {
        await invoke("export_backup", { path });
        setNotice(t("backup.exported"));
      }
    } catch (e) {
      setError(String(e));
    }
  }

  async function importBackup() {
    try {
      const path = await open({ multiple: false, filters: [{ name: "SQLite", extensions: ["sqlite"] }] });
      if (typeof path === "string") {
        await invoke("import_backup", { path });
        await loadArchive();
        setNotice(t("backup.imported"));
      }
    } catch (e) {
      setError(String(e));
    }
  }

  const printDate = new Date().toLocaleDateString(lang);

  // Una riga hotel (condivisa da elenco piatto e sfoglia-per-paese): nome+luogo, voto heat, valore
  // atteso, sito, e il pannello "prova" espandibile.
  const renderHotelRow = (dr: DisplayRow) => {
    const { h, score, er, sc } = dr;
    const k = hkey(h);
    const isOpen = expanded === k;
    return (
      <div key={k}>
        <div className="trow">
          <span className="cell-name">
            {h.name}
            <span className="cell-loc">
              {h.stars ? (
                <span className="stars" title={`${h.stars}★${h.luxury ? " Superior · " + t("stars.luxury") : ""} (OpenStreetMap)`}>
                  {"★".repeat(h.stars)}{h.luxury ? <span className="lux">{t("stars.luxury")}</span> : null}
                  <span className="cell-loc-sep"> · </span>
                </span>
              ) : null}
              {(() => {
                const p = priceTierOf(h);
                if (!p) return null;
                const title = p.isReal
                  ? `${t("price.level")} ${p.tier}/5 · ${t("price.fromSite")}${p.eur ? ` (≈€${p.eur} ${t("price.perNight")})` : ""}${p.src ? ` — «${p.src}»` : ""}`
                  : `${t("price.level")} ${p.tier}/5 · ${t("price.estimate")}`;
                return (
                  <span className={"price " + (p.isReal ? "real" : "est")} title={title} aria-label={title}>
                    {"€".repeat(p.tier)}<span className="price-empty">{"€".repeat(5 - p.tier)}</span>
                    <span className="cell-loc-sep"> · </span>
                  </span>
                );
              })()}
              {locationOf(h)}
            </span>
          </span>
          <span>{score !== null ? <span className="score" style={scoreHeat(score, settings.familyThreshold)}>{score}</span> : <span className="muted">{t("results.notscored")}</span>}</span>
          <span className="cell-er">{er !== null ? <span className="er-val">€ {er.toLocaleString(lang)}</span> : <span className="muted">—</span>}</span>
          <span className="cell-site">{h.website ? <a href={h.website} target="_blank" rel="noreferrer" onClick={extLink(h.website)}>{prettyHost(h.website)}</a> : <span className="muted">{t("results.nosite")}</span>}</span>
          <span className="no-print">
            {(reviewCounts[k] ?? 0) > 0 && <span className="rev-badge" title={t("reviews.title")}><Icon name="chat" size={12} /> {reviewCounts[k]}</span>}
            {/* sempre espandibile: anche un hotel senza voto/recensioni mostra i link «cerca su» OTA */}
            <button className="proof-toggle" onClick={() => setExpanded(isOpen ? null : k)} aria-expanded={isOpen}>{t("results.proof")}</button>
          </span>
        </div>
        {isOpen && (
          <>
            <OtaLinks h={h} t={t} />
            {sc && sc.family_fit_score != null && (
              <div className="cert-row no-print">
                <button className="cert-btn" onClick={() => void openCertificate(h)} title={t("cert.hint")}><Icon name="check" size={14} /> {t("cert.btn")}</button>
                <button className="cert-btn analytics-btn" onClick={() => void openHotelAnalytics(h)} title={t("analytics.hint")}><Icon name="chart" size={14} /> {t("analytics.btn")}</button>
              </div>
            )}
            {sc && <ProofPanel sc={sc} t={t} lang={lang} />}
            {(reviewCounts[k] ?? 0) > 0 && <ReviewsPanel h={h} t={t} lang={lang} />}
          </>
        )}
      </div>
    );
  };
  const tableHead = (
    <div className="thead">
      <span>{t("results.hotel")}</span>
      <span>{t("results.score")}</span>
      <span title={t("er.note")}>{t("results.er")}</span>
      <span>{t("results.website")}</span>
      <span className="no-print">{t("results.proof")}</span>
    </div>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Wordmark height={22} />
          <span className="brand-suffix">Radar</span>
          <span className="version">{t("version.label")} {APP_VERSION}</span>
        </div>
        <div className="topbar-actions">
          <div className="lang" role="group" aria-label={t("lang.switch")}>
            {(["it", "en", "ru"] as Lang[]).map((l) => (
              <button
                key={l}
                className={"lang-btn" + (lang === l ? " active" : "")}
                onClick={() => setLang(l)}
                aria-pressed={lang === l}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
          <button className="icon-btn" onClick={() => setOverlay("guide")} title={t("header.guide")} aria-label={t("header.guide")}><Icon name="help" size={18} /></button>
          <button className="icon-btn" onClick={() => setOverlay("settings")} title={t("header.settings")} aria-label={t("header.settings")}><Icon name="cog" size={18} /></button>
        </div>
      </header>
      {overlay === "guide" && <GuideOverlay lang={lang} t={t} onClose={() => setOverlay(null)} />}
      {overlay === "settings" && (
        <SettingsOverlay
          settings={settings} updateSettings={updateSettings} lang={lang} setLang={setLang}
          t={t} onClose={() => setOverlay(null)}
        />
      )}
      {overlay === "export" && (
        <ExportSelectOverlay
          sel={exportSel} setSel={setExportSel} coverage={coverage} count={exportCount}
          busy={exportBusy} t={t} lang={lang} onExport={runExport} onClose={() => setOverlay(null)}
        />
      )}
      {overlay === "info" && infoData && (
        <InfographicOverlay
          opts={infoOpts} setOpts={setInfoOpts} html={buildInfographicHtml(infoData, infoOpts)}
          t={t} onPrint={printInfographic} onSave={saveInfographic} onClose={() => setOverlay(null)}
        />
      )}
      {overlay === "ftool" && (
        <FtoolOverlay
          url={ftUrl} setUrl={setFtUrl} busy={ftBusy} result={ftResult} err={ftErr}
          onRun={runFtool} t={t} lang={lang} onClose={() => setOverlay(null)}
        />
      )}

      <nav className="menubar" aria-label={t("nav.label")}>
        <button className={"menu-tab" + (viewMode === "hotel" ? " active" : "")} onClick={openHotel}><Icon name="list" size={16} /> {t("nav.hotel")}</button>
        <button className={"menu-tab" + (viewMode === "map" ? " active" : "")} onClick={() => setViewMode("map")}><Icon name="map" size={16} /> {t("nav.map")}</button>
        <button className={"menu-tab" + (viewMode === "coverage" ? " active" : "")} onClick={openCoverage}><Icon name="pin" size={16} /> {t("nav.coverage")}</button>
        <button className={"menu-tab" + (viewMode === "crm" ? " active" : "")} onClick={openCrm}><Icon name="mail" size={16} /> {t("nav.crm")}</button>
        <span className="menu-spacer" />
        <button className="menu-tab" onClick={openInfographic} disabled={infoBusy}><Icon name="chart" size={16} /> {infoBusy ? t("info.loading") : t("nav.info")}</button>
        <div className="menu-dd">
          <button className={"menu-tab" + (dataMenuOpen ? " active" : "")} onClick={() => setDataMenuOpen((v) => !v)} aria-expanded={dataMenuOpen} aria-haspopup="menu">
            <Icon name="download" size={16} /> {t("nav.data")} <span className="menu-caret">▾</span>
          </button>
          {dataMenuOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setDataMenuOpen(false)} />
              <div className="menu-pop" role="menu">
                <div className="menu-group">{t("xp.title")}</div>
                <button role="menuitem" onClick={() => { setDataMenuOpen(false); setExportSel(DEFAULT_EXPORT_SEL); setOverlay("export"); }}><Icon name="download" size={15} /> {t("xp.open")}</button>
                <div className="menu-sep" />
                <div className="menu-group">{t("report.group")}</div>
                <button role="menuitem" disabled={reportBusy} onClick={() => { setDataMenuOpen(false); void openInsightsReport(); }}><Icon name="chart" size={15} /> {reportBusy ? t("info.loading") : t("report.menu")}</button>
                <div className="menu-sep" />
                <div className="menu-group">{t("data.title")}</div>
                <button role="menuitem" onClick={() => { setDataMenuOpen(false); exportBackup(); }}><Icon name="download" size={15} /> {t("backup.export")}</button>
                <button role="menuitem" onClick={() => { setDataMenuOpen(false); importBackup(); }}><Icon name="upload" size={15} /> {t("backup.import")}</button>
                <div className="menu-sep" />
                <div className="menu-group">{t("ai.title")}</div>
                <button role="menuitem" onClick={() => { setDataMenuOpen(false); exportAiBatch(); }}><Icon name="download" size={15} /> {t("ai.export")}</button>
                <button role="menuitem" onClick={() => { setDataMenuOpen(false); importAiScores(); }}><Icon name="upload" size={15} /> {t("ai.import")}</button>
                <div className="menu-sep" />
                <div className="menu-group">{t("reviews.title")}</div>
                <button role="menuitem" onClick={() => { setDataMenuOpen(false); importReviews(); }}><Icon name="upload" size={15} /> {t("reviews.import")}</button>
                <div className="menu-sep" />
                <div className="menu-group">{t("ftool.group")}</div>
                <button role="menuitem" onClick={() => { setDataMenuOpen(false); setOverlay("ftool"); }}><Icon name="signal" size={15} /> {t("ftool.open")}</button>
              </div>
            </>
          )}
        </div>
      </nav>

      <div className="body">
        <main className="main">
          <div className="stats">
            <div className="stat">
              <div className="stat-label">{t("stats.found")}</div>
              <div className="stat-value">{(scoreStats?.total ?? archiveTotal ?? hotels.length).toLocaleString(lang)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">{t("stats.scored")}</div>
              <div className="stat-value">{(scoreStats?.scored ?? 0).toLocaleString(lang)}<span className="stat-sub"> / {(scoreStats?.total ?? 0).toLocaleString(lang)}</span></div>
            </div>
            <div className="stat">
              <div className="stat-label">{t("stats.strong")} (≥{settings.familyThreshold})</div>
              <div className="stat-value">{(scoreStats?.strong ?? 0).toLocaleString(lang)}</div>
            </div>
          </div>

          {scoreStats && (scoreStats.scored + scoreStats.to_score) > 0 && (() => {
            // Universo della valutazione = già valutati + ancora in coda (sito presente, voto mancante).
            // NB: il denominatore NON è «hotel con sito», perché un hotel può aver perso il sito DOPO
            // essere stato valutato → altrimenti valutati > con-sito e l'avanzamento superava il 100%.
            const denom = scoreStats.scored + scoreStats.to_score;
            const pct = Math.min(100, Math.round((scoreStats.scored / denom) * 100));
            return (
              <div className="progress">
                <div className="progress-head">
                  <span>
                    {t("progress.label")}: {scoreStats.scored.toLocaleString(lang)} / {denom.toLocaleString(lang)}
                    {enriching && <span className="progress-live"> · {t("progress.running")}</span>}
                  </span>
                  <span>{pct}%</span>
                </div>
                <div className="bar">
                  <div className="bar-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })()}

          {area && <div className="area-caption">{area(t, lang)}</div>}
          {/* Ticker «breaking news»: le scansioni in corso scorrono insieme, tradotte nella lingua
              corrente (i messaggi sono funzioni (t,lang)→testo, non stringhe congelate). Se nessuna è
              in corso, resta il notice statico. */}
          {(() => {
            const live = [enrichNote, covNote, starsNote].filter((m): m is LiveMsg => !!m).map((m) => m(t, lang));
            if (live.length === 0) {
              return notice ? <div className="notice" role="status" title={t("settings.close")} onClick={() => setNotice(null)}>{notice}</div> : null;
            }
            // Riempi il nastro ripetendo le voci (≥4 istanze) così non resta spazio vuoto con poche/corte
            // voci; due metà identiche + scorrimento di -50% = loop senza salti, da destra a sinistra.
            const copies = Math.max(1, Math.ceil(4 / live.length));
            const seg = Array.from({ length: copies }, () => live).flat();
            const dur = Math.max(18, seg.length * 7); // velocità ~costante, stabile (niente reset a ogni dato)
            return (
              <div className="ticker" role="status" aria-live="polite">
                <span className="ticker-live"><span className="ticker-dot" /> {t("ticker.live")}</span>
                <div className="ticker-mask">
                  <div className="ticker-track" style={{ animationDuration: `${dur}s` }}>
                    {[...seg, ...seg].map((s, i) => (
                      <span className="ticker-item" key={i} aria-hidden={i >= seg.length}><span className="ticker-sep">●</span>{s}</span>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {error && <div className="error">{t("scan.error")}: {error}</div>}

          {viewMode === "hotel" && (
            <div className="toolbar hotel-bar">
              <div className="hb-search">
                <Icon name="search" size={15} />
                <input
                  className="hb-input"
                  value={dbQuery}
                  onChange={(e) => setDbQuery(e.currentTarget.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && hotelMode === "flat") doDbSearch(); }}
                  placeholder={hotelMode === "country" ? t("hotel.filterCountry") : t("hotel.searchFlat")}
                />
                {dbQuery && <button className="hb-clear" onClick={() => setDbQuery("")} aria-label={t("settings.close")}><Icon name="x" size={14} /></button>}
              </div>
              {enriching ? (
                <button className="enrich-btn sm" onClick={stopEnrich}><Icon name="stop" size={15} /> {t("enrich.stop")}</button>
              ) : (
                <button className="enrich-btn sm" onClick={enrichAll}><Icon name="sparkles" size={15} /> {t("enrich.button")}</button>
              )}
              <span className="tb-spacer" />
              <div className="seg" role="group">
                <button className={"seg-btn" + (hotelMode === "country" ? " active" : "")} onClick={() => { setHotelMode("country"); if (coverage.length === 0) loadCoverage(); }}><Icon name="pin" size={15} /> {t("hotel.byCountry")}</button>
                <button className={"seg-btn" + (hotelMode === "flat" ? " active" : "")} onClick={() => { setHotelMode("flat"); if (hotels.length === 0) loadArchive(); }}><Icon name="list" size={15} /> {t("hotel.flat")}</button>
              </div>
              {hotelMode === "flat" && (
                <>
                  <label className="tb-item">
                    <input type="checkbox" checked={onlyScored} onChange={(e) => setOnlyScored(e.currentTarget.checked)} />
                    {t("view.onlyscored")}
                  </label>
                  <label className="tb-item">
                    {t("view.sort")}
                    <select value={sortBy} onChange={(e) => setSortBy(e.currentTarget.value as "score" | "name" | "er")}>
                      <option value="score">{t("view.sortscore")}</option>
                      <option value="er">{t("view.sorter")}</option>
                      <option value="name">{t("view.sortname")}</option>
                    </select>
                  </label>
                  <label className="tb-item">
                    {t("view.minscore")}
                    <input type="number" min={0} max={100} value={minScore} style={{ width: 60 }}
                      onChange={(e) => setMinScore(Math.max(0, Math.min(100, Number(e.currentTarget.value) || 0)))} />
                  </label>
                  <button className={"tb-btn" + (showAssump ? " active" : "")} onClick={() => setShowAssump((v) => !v)}><Icon name="sparkles" size={15} /> {t("er.assumptions")}</button>
                  <button className="tb-btn" onClick={printReport}><Icon name="printer" size={15} /> {t("action.print")}</button>
                  <button className="tb-btn" onClick={exportCsv}><Icon name="download" size={15} /> {t("action.export")}</button>
                </>
              )}
            </div>
          )}

          {showAssump && viewMode === "hotel" && hotelMode === "flat" && (
            <div className="assump">
              <div className="assump-title"><Icon name="sparkles" size={15} /> {t("er.assumptions")}</div>
              <div className="assump-knobs">
                <label className="knob">
                  <span>{t("er.value")}</span>
                  <input type="number" min={0} step={50} value={erValue}
                    onChange={(e) => updateSettings({ erValue: Math.max(0, Number(e.currentTarget.value) || 0) })} />
                </label>
                <label className="knob">
                  <span>{t("er.comm")}</span>
                  <input type="number" min={0} max={100} step={0.5} value={erComm}
                    onChange={(e) => updateSettings({ erComm: Math.max(0, Math.min(100, Number(e.currentTarget.value) || 0)) })} />
                </label>
                <label className="knob">
                  <span>{t("er.volume")}</span>
                  <input type="number" min={0} step={1} value={erVolume}
                    onChange={(e) => updateSettings({ erVolume: Math.max(0, Number(e.currentTarget.value) || 0) })} />
                </label>
                <div className="assump-total">
                  <span className="assump-total-label">{t("er.total")}</span>
                  <span className="assump-total-val">€ {erTotal.toLocaleString(lang)}</span>
                </div>
              </div>
              <div className="assump-note">{t("er.note")}</div>
            </div>
          )}

          {viewMode === "coverage" ? (
            <CoverageView
              coverage={coverage} osmTotals={osmTotals} t={t} lang={lang} threshold={settings.familyThreshold}
              query={query} setQuery={setQuery} onScan={scan} scanning={loading}
              onGrade={gradeCountry} onComplete={completeCountry} onCompleteContinent={completeContinent}
              onCompleteAll={completeAllContinents} onBackfillStars={backfillStars} starsBusy={starsBusy}
              onStop={stopComplete} busy={covBusy} loading={loading}
              scanCursor={scanCursor} onResetCursor={resetScanCursor} onPickCountry={pickCountry}
            />
          ) : viewMode === "crm" ? (
            <CrmView
              rows={crmRows} contacts={contacts} crmFilter={crmFilter} setCrmFilter={setCrmFilter}
              onSave={saveContact} onEmail={emailContact} t={t} lang={lang}
              threshold={settings.familyThreshold} renderCap={settings.renderCap}
              loading={crmLoading} onRefresh={loadCrm}
            />
          ) : viewMode === "map" ? (
            hotels.length === 0 && !error ? (
              <div className="placeholder">{loading ? t("scan.scanning") : t("scan.empty")}</div>
            ) : (
              <>
                <MapView points={points} threshold={settings.familyThreshold} />
                <div className="map-legend">
                  <span><i className="dot" style={{ background: "#ef9f27" }} /> ≥{settings.familyThreshold}</span>
                  <span><i className="dot" style={{ background: "#ffc27b" }} /> {settings.familyThreshold - 20}–{settings.familyThreshold - 1}</span>
                  <span><i className="dot" style={{ background: "#9a9a93" }} /> &lt;{settings.familyThreshold - 20} / —</span>
                </div>
              </>
            )
          ) : hotelMode === "country" ? (
            (() => {
              const filter = dbQuery.trim().toLowerCase();
              if (coverage.length === 0) return <div className="placeholder">{loading ? t("scan.scanning") : t("browse.empty")}</div>;
              const list = coverage
                .filter((c) => c.country && c.country !== "(sconosciuto)")
                .filter((c) => !filter || c.country.toLowerCase().includes(filter))
                .sort((a, b) => a.country.localeCompare(b.country, lang));
              if (list.length === 0) return <div className="placeholder">{t("browse.noCountry")}</div>;
              return (
                <div className="browse">
                  {list.map((c) => {
                    const open = openCountries.has(c.country);
                    const cr = countryRows[c.country];
                    return (
                      <div className={"bc" + (open ? " open" : "")} key={c.country}>
                        <button className="bc-head" onClick={() => toggleCountry(c.country)} aria-expanded={open}>
                          <span className="bc-caret">{open ? "▾" : "▸"}</span>
                          <span className="bc-name">{c.country}</span>
                          <span className="bc-meta">{c.total.toLocaleString(lang)} · <b>{c.strong.toLocaleString(lang)}</b> {t("browse.family")}</span>
                        </button>
                        {open && (
                          <div className="bc-body">
                            {cr === "loading" || cr === undefined ? (
                              <div className="bc-note">{t("browse.loading")}</div>
                            ) : cr.length === 0 ? (
                              <div className="bc-note">{t("view.nomatch")}</div>
                            ) : (
                              <>
                                <div className="table er-on">
                                  {tableHead}
                                  {cr.slice(0, settings.renderCap).map(renderHotelRow)}
                                </div>
                                {cr.length > settings.renderCap && (
                                  <div className="trunc-note">{t("view.truncated")} {settings.renderCap} {t("view.of")} {cr.length.toLocaleString(lang)}</div>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()
          ) : hotels.length === 0 && !error ? (
            <div className="placeholder">{loading ? t("scan.scanning") : t("scan.empty")}</div>
          ) : (
            <>
              <div className="print-only print-head">
                Kidotel Radar — {area ? area(t, lang) : ""} — {printDate} — {rows.length} {t("print.hotels")}
              </div>
              <div className="table er-on">
                {tableHead}
                {rows.length === 0 && <div className="trow-empty">{t("view.nomatch")}</div>}
                {rows.slice(0, settings.renderCap).map(({ h, score, er }) => renderHotelRow({ h, score, er, sc: scores[hkey(h)] }))}
              </div>
              {rows.length > settings.renderCap && (
                <div className="trunc-note">
                  {t("view.truncated")} {settings.renderCap} {t("view.of")} {rows.length.toLocaleString(lang)}
                </div>
              )}
              {/* Paginazione dell'archivio: oltre i primi 5000, pagina per pagina ("pagina i di N"). */}
              {archiveTotal !== null && archiveTotal > ARCHIVE_PAGE && (
                <div className="pager">
                  <button className="tb-btn" disabled={archivePage === 0 || loading} onClick={() => loadArchive(archivePage - 1)}>← {t("page.prev")}</button>
                  <span className="pager-info">{t("page.page")} {archivePage + 1} {t("view.of")} {Math.ceil(archiveTotal / ARCHIVE_PAGE).toLocaleString(lang)}</span>
                  <button className="tb-btn" disabled={(archivePage + 1) * ARCHIVE_PAGE >= archiveTotal || loading} onClick={() => loadArchive(archivePage + 1)}>{t("page.next")} →</button>
                </div>
              )}
            </>
          )}

          <div className="footer">
            <span className="footer-ico" aria-hidden="true"><Icon name="check" size={16} /></span>
            {t("footer.proof")}
            <span className="footer-copy">{t("footer.copyright")}</span>
          </div>
        </main>
      </div>
    </div>
  );
}

function ProofPanel({ sc, t, lang }: { sc: EnrichResult; t: (k: TKey) => string; lang: Lang }) {
  // Traduzione automatica delle prove (l'originale verbatim resta SEMPRE visibile).
  const [tr, setTr] = useState<Record<string, string>>({});
  async function toggleTr(key: string, text: string) {
    if (tr[key]) { setTr((p) => { const n = { ...p }; delete n[key]; return n; }); return; }
    setTr((p) => ({ ...p, [key]: "…" }));
    try {
      const out = await invoke<string>("translate", { text, target: lang });
      setTr((p) => ({ ...p, [key]: out }));
    } catch {
      setTr((p) => ({ ...p, [key]: "⚠ " + t("tr.error") }));
    }
  }
  if (!sc.website_ok) return <div className="proof"><div className="proof-empty">{t("proof.nosite")}</div></div>;
  const present = sc.signals.filter((s) => s.present);
  const absent = sc.signals.filter((s) => !s.present);
  return (
    <div className="proof">
      <div className="proof-title">{t("proof.title")}</div>
      {present.length === 0 && <div className="proof-empty">{t("proof.none")}</div>}
      {present.map((s) => (
        <div className="proof-item" key={s.key}>
          <div className="proof-sig">
            <span className="dot ok" aria-hidden="true" />
            {t(("signal." + s.key) as TKey)} <span className="proof-w">+{s.weight}</span>
          </div>
          {s.quote && (
            <div className="proof-quote">
              «{s.quote}»
              <button className="proof-tr-btn" onClick={() => toggleTr(s.key, s.quote!)}>
                <Icon name="help" size={12} /> {tr[s.key] ? t("tr.hide") : t("tr.translate")}
              </button>
              {tr[s.key] && <div className="proof-tr">→ {tr[s.key]}</div>}
            </div>
          )}
          {s.url && (
            <a className="proof-src" href={s.url} target="_blank" rel="noreferrer" onClick={extLink(s.url)}>{prettyHost(s.url)}</a>
          )}
        </div>
      ))}
      {absent.length > 0 && (
        <div className="proof-absent">
          {absent.map((s) => (
            <span className="absent-chip" key={s.key}>
              {t(("signal." + s.key) as TKey)}: {t("proof.notstated")}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

type Review = { author: string | null; rating: number | null; text: string; source: string | null; date: string | null };

// Recensioni dell'hotel (importate da Cowork), caricate quando si espande la riga. Ogni recensione ha
// un pulsante «Traduci» (stesso meccanismo delle prove); l'originale resta visibile.
function ReviewsPanel({ h, t, lang }: { h: Hotel; t: (k: TKey) => string; lang: Lang }) {
  const [reviews, setReviews] = useState<Review[] | "loading">("loading");
  const [tr, setTr] = useState<Record<number, string>>({});
  useEffect(() => {
    invoke<Review[]>("get_reviews", { osmType: h.osm_type, osmId: h.osm_id }).then(setReviews).catch(() => setReviews([]));
  }, [h.osm_type, h.osm_id]);
  async function toggleTr(i: number, text: string) {
    if (tr[i]) { setTr((p) => { const n = { ...p }; delete n[i]; return n; }); return; }
    setTr((p) => ({ ...p, [i]: "…" }));
    try { const out = await invoke<string>("translate", { text, target: lang }); setTr((p) => ({ ...p, [i]: out })); }
    catch { setTr((p) => ({ ...p, [i]: "⚠ " + t("tr.error") })); }
  }
  if (reviews === "loading") return <div className="proof reviews"><div className="proof-empty">{t("reviews.loading")}</div></div>;
  if (reviews.length === 0) return null;
  return (
    <div className="proof reviews">
      <div className="proof-title"><Icon name="chat" size={14} /> {t("reviews.title")} ({reviews.length})</div>
      {reviews.map((r, i) => (
        <div className="review-item" key={i}>
          <div className="review-head">
            {r.rating != null && <span className="review-rating">{"★".repeat(Math.max(0, Math.min(5, Math.round(r.rating))))} {r.rating}</span>}
            {r.author && <span className="review-author">{r.author}</span>}
            {r.source && <span className="review-src">{r.source}</span>}
            {r.date && <span className="review-date">{r.date}</span>}
          </div>
          <div className="review-text">
            {r.text}
            <button className="proof-tr-btn" onClick={() => toggleTr(i, r.text)}><Icon name="help" size={12} /> {tr[i] ? t("tr.hide") : t("tr.translate")}</button>
            {tr[i] && <div className="proof-tr">→ {tr[i]}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function CrmView({
  rows, contacts, crmFilter, setCrmFilter, onSave, onEmail, t, lang, threshold, renderCap, loading, onRefresh,
}: {
  rows: { h: Hotel; score: number | null; er: number | null }[];
  contacts: Record<string, ContactState>;
  crmFilter: ContactStatus | "all";
  setCrmFilter: (s: ContactStatus | "all") => void;
  onSave: (h: Hotel, status: ContactStatus, note: string) => void;
  onEmail: (h: Hotel) => void;
  t: (k: TKey) => string;
  lang: Lang;
  threshold: number;
  renderCap: number;
  loading: boolean;
  onRefresh: () => void;
}) {
  // Targeting: filtri CUMULABILI per concentrarsi sui prospect più redditizi (paese, stelle, family-fit,
  // email recapitabile, valore atteso minimo). Operano su TUTTO l'archivio contattabile (caricato da
  // select_crm), non più solo sui primi 5000. La tabella mostra al massimo `renderCap` righe.
  const [fCountry, setFCountry] = useState("");
  const [fStars, setFStars] = useState(0);
  const [fMinScore, setFMinScore] = useState(0);
  const [fDeliverable, setFDeliverable] = useState(false);
  const [fMinEr, setFMinEr] = useState(0);

  // Hotel contattabili (con almeno un canale), ordinati per Valore atteso ↓ (priorità acquisizione).
  // memoizzati: con decine di migliaia di righe non vanno ri-ordinati a ogni tasto dei filtri.
  const contactable = useMemo(
    () => rows
      .filter((r) => r.h.website || r.h.email || r.h.phone)
      .sort((a, b) => (b.er ?? -1) - (a.er ?? -1) || a.h.name.localeCompare(b.h.name, lang)),
    [rows, lang],
  );

  const countriesAvail = useMemo(
    () => [...new Set(contactable.map((r) => r.h.country).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, lang)),
    [contactable, lang],
  );
  const targeted = contactable.filter((r) => {
    if (fCountry && r.h.country !== fCountry) return false;
    if (fStars && (r.h.stars ?? 0) < fStars) return false;
    if (fMinScore && (r.score ?? -1) < fMinScore) return false;
    if (fDeliverable && !(r.h.email && (r.h.email_status === "ok" || r.h.email_status === "role"))) return false;
    if (fMinEr && (r.er ?? -1) < fMinEr) return false;
    return true;
  });
  const targetValue = targeted.reduce((s, r) => s + (r.er ?? 0), 0);

  const statusOf = (h: Hotel): ContactStatus => contacts[hkey(h)]?.status ?? "da_contattare";
  const counts: Record<string, number> = { all: targeted.length };
  for (const s of CONTACT_STATES) counts[s] = 0;
  for (const r of targeted) counts[statusOf(r.h)]++;

  const shown = crmFilter === "all" ? targeted : targeted.filter((r) => statusOf(r.h) === crmFilter);

  if (loading && rows.length === 0) {
    return <div className="placeholder">{t("crm.loading")}</div>;
  }
  if (contactable.length === 0) {
    return <div className="placeholder">{t("crm.empty")}</div>;
  }
  const capped = shown.length > renderCap; // ne mostriamo al massimo renderCap, ma il conteggio è sull'intero set
  return (
    <div className="crm">
      <div className="crm-intro">
        {t("crm.intro")}
        <button className="link-btn" disabled={loading} onClick={onRefresh}>{loading ? t("crm.loading") : t("crm.refresh")}</button>
      </div>
      <div className="crm-target">
        <label className="tb-item">
          <select value={fCountry} onChange={(e) => setFCountry(e.currentTarget.value)}>
            <option value="">{t("crm.allCountries")}</option>
            {countriesAvail.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="tb-item">★
          <select value={fStars} onChange={(e) => setFStars(Number(e.currentTarget.value))}>
            <option value={0}>{t("crm.anyStars")}</option>
            <option value={3}>≥3★</option>
            <option value={4}>≥4★</option>
            <option value={5}>5★</option>
          </select>
        </label>
        <label className="tb-item">{t("crm.minScore")}
          <input type="number" min={0} max={100} value={fMinScore} style={{ width: 56 }}
            onChange={(e) => setFMinScore(Math.max(0, Math.min(100, Number(e.currentTarget.value) || 0)))} />
        </label>
        <label className="tb-item">{t("crm.minValue")}
          <input type="number" min={0} step={50} value={fMinEr} style={{ width: 80 }}
            onChange={(e) => setFMinEr(Math.max(0, Number(e.currentTarget.value) || 0))} />
        </label>
        <label className="tb-item">
          <input type="checkbox" checked={fDeliverable} onChange={(e) => setFDeliverable(e.currentTarget.checked)} />
          {t("crm.onlyDeliverable")}
        </label>
        <span className="tb-spacer" />
        <span className="crm-target-sum">{targeted.length.toLocaleString(lang)} · <b>€ {targetValue.toLocaleString(lang)}</b></span>
      </div>
      <div className="crm-filters">
        <button className={"crm-chip" + (crmFilter === "all" ? " active" : "")} onClick={() => setCrmFilter("all")}>
          {t("crm.all")} <span className="crm-chip-n">{counts.all.toLocaleString(lang)}</span>
        </button>
        {CONTACT_STATES.map((s) => (
          <button key={s} className={"crm-chip st-" + s + (crmFilter === s ? " active" : "")} onClick={() => setCrmFilter(s)}>
            <i className={"st-dot st-" + s} /> {t(("crm.status." + s) as TKey)} <span className="crm-chip-n">{(counts[s] ?? 0).toLocaleString(lang)}</span>
          </button>
        ))}
      </div>
      <div className="crm-table">
        <div className="crm-head">
          <span>{t("results.hotel")}</span>
          <span>{t("results.score")}</span>
          <span>{t("results.er")}</span>
          <span>{t("crm.contacts")}</span>
          <span>{t("crm.state")}</span>
          <span>{t("crm.note")}</span>
        </div>
        {shown.length === 0 && <div className="trow-empty">{t("crm.nofilter")}</div>}
        {capped && <div className="crm-capped">{t("crm.showingTop")} {renderCap.toLocaleString(lang)} / {shown.length.toLocaleString(lang)} — {t("crm.narrow")}</div>}
        {shown.slice(0, renderCap).map(({ h, score, er }) => {
          const k = hkey(h);
          const c = contacts[k] ?? { status: "da_contattare" as ContactStatus, note: "" };
          return (
            <div className="crm-row" key={k}>
              <span className="cell-name">
                {h.name}
                <span className="cell-loc">{locationOf(h)}</span>
              </span>
              <span>{score !== null ? <span className="score" style={scoreHeat(score, threshold)}>{score}</span> : <span className="muted">—</span>}</span>
              <span className="cell-er">{er !== null ? <span className="er-val">€ {er.toLocaleString(lang)}</span> : <span className="muted">—</span>}</span>
              <span className="crm-contacts">
                {h.email && <a className={"crm-link em-" + (h.email_status || "unknown")} href={`mailto:${h.email}`} onClick={extLink(`mailto:${h.email}`)} title={`${h.email}${h.email_status ? " · " + t(("emailst." + h.email_status) as TKey) : ""}`}><Icon name="mail" size={14} /> {h.email}</a>}
                {h.website && <a className="crm-link" href={h.website} target="_blank" rel="noreferrer" onClick={extLink(h.website)} title={h.website}>{prettyHost(h.website)}</a>}
                {h.phone && <a className="crm-link" href={`tel:${h.phone}`} onClick={extLink(`tel:${h.phone}`)} title={h.phone}><Icon name="phone" size={14} /> {h.phone}</a>}
                <button className="crm-write" onClick={() => onEmail(h)} title={t("crm.genEmail")}><Icon name="mail" size={14} /> {t("crm.write")}</button>
                <OtaLinks h={h} t={t} />
              </span>
              <span>
                <select
                  className={"crm-status st-" + c.status}
                  value={c.status}
                  onChange={(e) => onSave(h, e.currentTarget.value as ContactStatus, c.note)}
                >
                  {CONTACT_STATES.map((s) => (
                    <option key={s} value={s}>{t(("crm.status." + s) as TKey)}</option>
                  ))}
                </select>
              </span>
              <span>
                <input
                  key={k + ":" + (c.note ?? "")}
                  className="crm-note"
                  defaultValue={c.note}
                  placeholder={t("crm.noteph")}
                  onBlur={(e) => { const v = e.currentTarget.value; if (v !== c.note) onSave(h, c.status, v); }}
                />
              </span>
            </div>
          );
        })}
      </div>
      {shown.length > renderCap && (
        <div className="trunc-note">{t("view.truncated")} {renderCap} {t("view.of")} {shown.length.toLocaleString(lang)}</div>
      )}
    </div>
  );
}

type CoverageRow = { country: string; total: number; scored: number; strong: number };

function CoverageView({
  coverage, osmTotals, t, lang, threshold, query, setQuery, onScan, scanning,
  onGrade, onComplete, onCompleteContinent, onCompleteAll, onBackfillStars, starsBusy, onStop, busy, loading,
  scanCursor, onResetCursor, onPickCountry,
}: {
  coverage: CoverageRow[];
  osmTotals: Record<string, number>;
  t: (k: TKey) => string;
  lang: Lang;
  threshold: number;
  query: string;
  setQuery: (q: string) => void;
  onScan: () => void;
  scanning: boolean;
  onGrade: (area: string) => void;
  onComplete: (area: string) => void;
  onCompleteContinent: (contKey: string) => void;
  onCompleteAll: () => void;
  onBackfillStars: () => void;
  starsBusy: boolean;
  onStop: () => void;
  busy: string | null;
  loading: boolean;
  scanCursor: string;
  onResetCursor: () => void;
  onPickCountry: (country: string) => void;
}) {
  const anyBusy = busy !== null || starsBusy || loading || scanning;
  const [pick, setPick] = useState(""); // paese scelto nel selettore «aggiungi paese»
  // paese di ripresa per «Completa tutti»: il successivo a quello completato per ultimo.
  const resumeCountry = scanCursor ? (ALL_COUNTRIES[resumeIndex(scanCursor)] ?? ALL_COUNTRIES[0]) : ALL_COUNTRIES[0];
  // Pannello "Scansiona" (scoperta nuovi hotel da OSM): vive in Copertura per analogia con Misura/Completa.
  const scanPanel = (
    <div className="cov-scanbox">
      <div className="cov-scanbox-t"><Icon name="signal" size={16} /> {t("scan.title")}</div>
      <div className="cov-scanbox-row">
        <input
          className="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && onScan()}
          placeholder={t("loc.placeholder")}
        />
        <button className="scan-btn" onClick={onScan} disabled={scanning || !query.trim()}>
          <Icon name="signal" /> {scanning ? t("scan.scanning") : t("scan.button")}
        </button>
      </div>
      <div className="hint">{t("scan.hint")}</div>
      {/* #2 — aggiungi/scansiona un PAESE scelto da una lista con ricerca (anche non ancora in archivio). */}
      <div className="cov-scanbox-row cov-pick">
        <input
          className="search"
          list="kidotel-countries"
          value={pick}
          onChange={(e) => setPick(e.currentTarget.value)}
          placeholder={t("scan.pickCountry")}
        />
        <datalist id="kidotel-countries">
          {ALL_COUNTRIES.map((c) => <option key={c} value={c} />)}
        </datalist>
        <button className="scan-btn" disabled={anyBusy || !ALL_COUNTRIES.includes(pick)} onClick={() => onPickCountry(pick)}>
          <Icon name="pin" /> {t("scan.addCountry")}
        </button>
      </div>
      {/* azioni globali: completa TUTTI i paesi del mondo (ripresa dal cursore) + ri-scansione stelle da OSM */}
      <div className="cov-global">
        {busy === "cont:all" || (starsBusy) ? (
          <button className="cov-cont-btn stop" onClick={onStop}><Icon name="stop" size={13} /> {t("coverage.stop")}</button>
        ) : (
          <>
            <button className="cov-cont-btn" disabled={anyBusy} onClick={onCompleteAll}><Icon name="signal" size={13} /> {t("coverage.completeAll")}</button>
            <button className="cov-cont-btn" disabled={anyBusy} onClick={onBackfillStars}><Icon name="sparkles" size={13} /> {t("stars.assign")}</button>
          </>
        )}
      </div>
      {/* #3 — ripresa: mostra da quale paese ricomincerà «Completa tutti», con reset «da capo». */}
      {scanCursor ? (
        <div className="hint cov-resume">
          {t("coverage.resumeFrom")}: <b>{resumeCountry}</b>
          <button className="link-btn" disabled={anyBusy} onClick={onResetCursor}>{t("coverage.restart")}</button>
        </div>
      ) : null}
    </div>
  );
  if (coverage.length === 0) {
    return <div className="coverage">{scanPanel}<div className="placeholder">{t("coverage.empty")}</div></div>;
  }
  return (
    <div className="coverage">
      {scanPanel}
      <div className="coverage-intro">{t("coverage.intro2")}</div>
      <div className="cov-table cov6">
        <div className="cov-head">
          <span>{t("coverage.country")}</span>
          <span>{t("coverage.found")}</span>
          <span>{t("coverage.scored")}</span>
          <span>{t("coverage.strong")} (≥{threshold})</span>
          <span>{t("coverage.grade")}</span>
          <span className="no-print">{t("coverage.action")}</span>
        </div>
        {(() => {
          const renderRow = (c: CoverageRow) => {
            const pct = c.total > 0 ? Math.round((c.scored / c.total) * 100) : 0;
            const unknown = c.country.startsWith("(");
            const osm = osmTotals[c.country];
            const gradePct = osm && osm > 0 ? Math.min(100, Math.round((c.total / osm) * 100)) : null;
            const isBusy = busy === c.country;
            return (
              <div className="cov-row" key={c.country}>
                <span className="cov-country">{c.country}</span>
                <span className="cov-num">{c.total.toLocaleString(lang)}</span>
                <span className="cov-num">
                  {c.scored.toLocaleString(lang)}
                  <span className={"cov-pct" + (pct >= 80 ? " ok" : pct >= 30 ? " warn" : " low")}>{pct}%</span>
                </span>
                <span className="cov-num">{c.strong.toLocaleString(lang)}</span>
                <span className="cov-grade">
                  {gradePct !== null ? (
                    <span className="cov-gradebox" title={`${c.total.toLocaleString(lang)} / ${osm.toLocaleString(lang)} OSM`}>
                      <span className="cov-bar"><span className={"cov-bar-fill g" + (gradePct >= 90 ? "hi" : gradePct >= 50 ? "mid" : "lo")} style={{ width: `${gradePct}%` }} /></span>
                      <b className={gradePct >= 90 ? "ok" : gradePct >= 50 ? "warn" : "low"}>{gradePct}%</b>
                    </span>
                  ) : (
                    <button className="cov-mini" disabled={loading || unknown || isBusy} onClick={() => onGrade(c.country)}>{t("coverage.measure")}</button>
                  )}
                </span>
                <span className="no-print">
                  {isBusy ? (
                    <button className="cov-scan stop" onClick={onStop}>
                      <Icon name="stop" size={14} /> {t("coverage.stop")}
                    </button>
                  ) : (
                    <button className="cov-scan" disabled={loading || unknown || busy !== null} onClick={() => onComplete(c.country)}>
                      <Icon name="signal" size={14} /> {t("coverage.complete")}
                    </button>
                  )}
                </span>
              </div>
            );
          };
          // raggruppa per continente; ordine alfabetico dei paesi DENTRO il continente.
          const groups: Record<string, CoverageRow[]> = {};
          for (const c of coverage) {
            const cont = c.country.startsWith("(") ? "other" : (CONTINENT[c.country] || "other");
            (groups[cont] ||= []).push(c);
          }
          return CONTINENT_ORDER.filter((k) => groups[k]?.length).map((k) => {
            const contBusy = busy === "cont:" + k;
            const scannable = k !== "other";
            return (
              <div className="cov-group" key={k}>
                <div className="cov-cont">
                  <span>{t(("cont." + k) as TKey)}</span>
                  {scannable && (contBusy ? (
                    <button className="cov-cont-btn stop" onClick={onStop}><Icon name="stop" size={13} /> {t("coverage.stop")}</button>
                  ) : (
                    <button className="cov-cont-btn" disabled={loading || busy !== null} onClick={() => onCompleteContinent(k)}><Icon name="signal" size={13} /> {t("coverage.completeCont")}</button>
                  ))}
                </div>
                {groups[k].slice().sort((a, b) => a.country.localeCompare(b.country, lang)).map(renderRow)}
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}

// Accessibilità dei modali: Esc per chiudere + focus iniziale sul bottone di chiusura.
function useModalA11y(onClose: () => void) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return closeRef;
}

// #9 — dialog infografica: opzioni di stampa a sinistra, anteprima dal vivo (iframe) a destra.
function InfographicOverlay({
  opts, setOpts, html, t, onPrint, onSave, onClose,
}: {
  opts: InfoOpts;
  setOpts: (o: InfoOpts) => void;
  html: string;
  t: (k: TKey) => string;
  onPrint: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const closeRef = useModalA11y(onClose);
  const up = (p: Partial<InfoOpts>) => setOpts({ ...opts, ...p });
  const sections: { key: keyof InfoOpts; label: TKey }[] = [
    { key: "kpi", label: "info.s.kpi" },
    { key: "dist", label: "info.s.dist" },
    { key: "countries", label: "info.s.countries" },
    { key: "conts", label: "info.s.conts" },
    { key: "funnel", label: "info.s.funnel" },
    { key: "value", label: "info.s.value" },
  ];
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-label={t("info.title")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2><Icon name="chart" size={18} /> {t("info.title")}</h2>
          <button ref={closeRef} className="modal-close" onClick={onClose} aria-label={t("settings.close")}><Icon name="x" size={18} /></button>
        </div>
        <div className="info-layout">
          <div className="info-controls">
            <div className="set-group set-group-hint">{t("info.orientation")}</div>
            <div className="seg">
              {(["portrait", "landscape"] as InfoOpts["orientation"][]).map((o) => (
                <button key={o} className={"seg-btn" + (opts.orientation === o ? " active" : "")} onClick={() => up({ orientation: o })}>{t(("info.or." + o) as TKey)}</button>
              ))}
            </div>
            <div className="set-group set-group-hint">{t("info.sections")}</div>
            {sections.map((s) => (
              <label key={s.key} className="xp-check"><input type="checkbox" checked={opts[s.key] as boolean} onChange={(e) => up({ [s.key]: e.currentTarget.checked } as Partial<InfoOpts>)} /> {t(s.label)}</label>
            ))}
            <div className="info-actions">
              <button className="tb-btn" onClick={onPrint}><Icon name="printer" size={15} /> {t("info.print")}</button>
              <button className="tb-btn" onClick={onSave}><Icon name="download" size={15} /> {t("info.save")}</button>
            </div>
            <div className="set-foot">{t("info.printHint")}</div>
          </div>
          <div className="info-preview">
            <iframe title={t("info.title")} srcDoc={html} className="info-frame" />
          </div>
        </div>
      </div>
    </div>
  );
}

// #8 — dialog di selezione a criteri per l'export "cowork".
function ExportSelectOverlay({
  sel, setSel, coverage, count, busy, t, lang, onExport, onClose,
}: {
  sel: ExportSel;
  setSel: (s: ExportSel) => void;
  coverage: CoverageRow[];
  count: number | null;
  busy: boolean;
  t: (k: TKey) => string;
  lang: Lang;
  onExport: (format: "csv" | "json" | "feed") => void;
  onClose: () => void;
}) {
  const closeRef = useModalA11y(onClose);
  const up = (p: Partial<ExportSel>) => setSel({ ...sel, ...p });
  // paesi presenti nell'archivio, ordinati alfabeticamente, per il menu "un paese".
  const countries = coverage.map((c) => c.country).filter((c) => c && c !== "(sconosciuto)").sort((a, b) => a.localeCompare(b, lang));
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("xp.title")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2><Icon name="download" size={18} /> {t("xp.title")}</h2>
          <button ref={closeRef} className="modal-close" onClick={onClose} aria-label={t("settings.close")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="xp-hint">{t("xp.intro")}</div>

          <div className="set-row">
            <div className="set-label">{t("xp.scope")}</div>
            <div className="seg">
              {(["all", "continent", "country"] as ExportSel["scope"][]).map((s) => (
                <button key={s} className={"seg-btn" + (sel.scope === s ? " active" : "")} onClick={() => up({ scope: s })}>{t(("xp.scope." + s) as TKey)}</button>
              ))}
            </div>
          </div>

          {sel.scope === "continent" && (
            <div className="set-row">
              <div className="set-label">{t("xp.continent")}</div>
              <select className="xp-select" value={sel.continent} onChange={(e) => up({ continent: e.currentTarget.value })}>
                {CONTINENT_ORDER.map((k) => <option key={k} value={k}>{t(("cont." + k) as TKey)}</option>)}
              </select>
            </div>
          )}
          {sel.scope === "country" && (
            <div className="set-row">
              <div className="set-label">{t("xp.country")}</div>
              <select className="xp-select" value={sel.country} onChange={(e) => up({ country: e.currentTarget.value })}>
                <option value="">{t("xp.pickCountry")}</option>
                {countries.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          )}

          <div className="set-row">
            <label className="xp-check"><input type="checkbox" checked={sel.useScoreRange} onChange={(e) => up({ useScoreRange: e.currentTarget.checked })} /> {t("xp.scoreRange")}</label>
            {sel.useScoreRange && (
              <div className="xp-range">
                <input type="number" min={0} max={100} value={sel.scoreMin} onChange={(e) => up({ scoreMin: Math.max(0, Math.min(100, Number(e.currentTarget.value) || 0)) })} />
                <span>–</span>
                <input type="number" min={0} max={100} value={sel.scoreMax} onChange={(e) => up({ scoreMax: Math.max(0, Math.min(100, Number(e.currentTarget.value) || 100)) })} />
              </div>
            )}
          </div>

          <div className="set-row">
            <label className="xp-check"><input type="checkbox" checked={sel.useTopN} onChange={(e) => up({ useTopN: e.currentTarget.checked })} /> {t("xp.topN")}</label>
            {sel.useTopN && (
              <input className="xp-num" type="number" min={1} step={100} value={sel.topN} onChange={(e) => up({ topN: Math.max(1, Number(e.currentTarget.value) || 1) })} />
            )}
          </div>

          <div className="xp-filters">
            <label className="xp-check"><input type="checkbox" checked={sel.onlyScored} onChange={(e) => up({ onlyScored: e.currentTarget.checked })} /> {t("xp.onlyScored")}</label>
            <label className="xp-check"><input type="checkbox" checked={sel.onlyContactable} onChange={(e) => up({ onlyContactable: e.currentTarget.checked })} /> {t("xp.onlyContactable")}</label>
            <label className="xp-check"><input type="checkbox" checked={sel.onlyDeliverable} onChange={(e) => up({ onlyDeliverable: e.currentTarget.checked })} /> {t("xp.onlyDeliverable")}</label>
          </div>

          <div className="xp-foot">
            <div className="xp-count">{count === null ? "…" : `${count.toLocaleString(lang)} ${t("xp.selected")}`}</div>
            <div className="xp-actions">
              <button className="tb-btn" disabled={busy || !count} onClick={() => onExport("csv")}><Icon name="download" size={15} /> CSV</button>
              <button className="tb-btn" disabled={busy || !count} onClick={() => onExport("json")}><Icon name="download" size={15} /> JSON</button>
              <button className="tb-btn xp-feed-btn" disabled={busy || !count} onClick={() => onExport("feed")} title={t("xp.feedHint")}><Icon name="download" size={15} /> {t("xp.feed")}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function GuideOverlay({ lang, t, onClose }: { lang: Lang; t: (k: TKey) => string; onClose: () => void }) {
  const closeRef = useModalA11y(onClose);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("guide.title")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2><Icon name="help" size={18} /> {t("guide.title")}</h2>
          <button ref={closeRef} className="modal-close" onClick={onClose} aria-label={t("settings.close")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="guide-version">{t("version.label")} {APP_VERSION}</div>
          <div className="guide-news">
            <div className="guide-news-t">{t("guide.news")}</div>
            <ul>{NEWS.map((n, i) => <li key={i}>{n[lang] ?? n.en}</li>)}</ul>
          </div>
          {GUIDE.map((s, i) => (
            <div className="guide-sec" key={i}>
              <div className="guide-sec-h"><Icon name={s.icon} size={16} /> {(s[lang] ?? s.en).t}</div>
              <p>{(s[lang] ?? s.en).b}</p>
              {/* screenshot aggiornato ad ogni release (scripts/capture-manual.mjs). Se manca, si nasconde. */}
              {s.shot ? (
                <img
                  className="guide-shot"
                  src={`/manual/${s.shot}.${lang}.png`}
                  alt={(s[lang] ?? s.en).t}
                  loading="lazy"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                />
              ) : null}
            </div>
          ))}
          <div className="guide-foot"><Icon name="check" size={15} /> {t("footer.proof")} · {t("footer.copyright")}</div>
        </div>
      </div>
    </div>
  );
}

// «Family-Fit as a Service»: incolli un sito → punteggio + prova, senza toccare il DB. Demo dell'API.
function FtoolOverlay({
  url, setUrl, busy, result, err, onRun, t, lang, onClose,
}: {
  url: string; setUrl: (s: string) => void; busy: boolean; result: EnrichResult | null; err: string;
  onRun: () => void; t: (k: TKey) => string; lang: Lang; onClose: () => void;
}) {
  const closeRef = useModalA11y(onClose);
  const present = result ? result.signals.filter((s) => s.present).length : 0;
  const apiJson = result ? JSON.stringify({
    website_ok: result.website_ok,
    pages_fetched: result.pages_fetched,
    family_fit_score: result.family_fit_score,
    signals: result.signals.filter((s) => s.present).map((s) => ({ key: s.key, weight: s.weight, quote: s.quote, source: s.url })),
  }, null, 2) : "";
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("ftool.title")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2><Icon name="signal" size={18} /> {t("ftool.title")}</h2>
          <button ref={closeRef} className="modal-close" onClick={onClose} aria-label={t("settings.close")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="xp-hint">{t("ftool.intro")}</div>
          <div className="ft-row">
            <input className="ft-url" type="url" inputMode="url" value={url} placeholder={t("ftool.placeholder")}
              onChange={(e) => setUrl(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === "Enter") onRun(); }} autoFocus />
            <button className="tb-btn ft-run" disabled={busy || !url.trim()} onClick={onRun}>
              <Icon name="signal" size={15} /> {busy ? t("ftool.scoring") : t("ftool.run")}
            </button>
          </div>
          <div className="ft-note"><Icon name="check" size={13} /> {t("ftool.note")}</div>
          {err && <div className="ft-err">{err}</div>}
          {result && result.website_ok && (
            <div className="ft-result">
              <div className="ft-scorebar">
                <div className="ft-score"><span className="ft-score-v">{result.family_fit_score}</span><span className="ft-score-m">/100</span></div>
                <div className="ft-meta">{t("ftool.meta").replace("{pages}", String(result.pages_fetched)).replace("{n}", String(present))}</div>
              </div>
              <ProofPanel sc={result} t={t} lang={lang} />
              <details className="ft-json"><summary>{t("ftool.json")}</summary><pre>{apiJson}</pre></details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsOverlay({
  settings, updateSettings, lang, setLang, t, onClose,
}: {
  settings: Settings;
  updateSettings: (p: Partial<Settings>) => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: TKey) => string;
  onClose: () => void;
}) {
  const closeRef = useModalA11y(onClose);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={t("settings.title")} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2><Icon name="cog" size={18} /> {t("settings.title")}</h2>
          <button ref={closeRef} className="modal-close" onClick={onClose} aria-label={t("settings.close")}><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">
          <div className="set-row">
            <div className="set-label">{t("settings.lang")}</div>
            <div className="seg">
              {(["it", "en", "ru"] as Lang[]).map((l) => (
                <button key={l} className={"seg-btn" + (lang === l ? " active" : "")} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <div className="set-label">{t("settings.theme")}</div>
            <div className="seg">
              {(["auto", "light", "dark"] as Theme[]).map((th) => (
                <button key={th} className={"seg-btn" + (settings.theme === th ? " active" : "")} onClick={() => updateSettings({ theme: th })}>{t(("settings.theme." + th) as TKey)}</button>
              ))}
            </div>
          </div>
          <div className="set-row">
            <div><div className="set-label">{t("settings.familyThreshold")}</div><div className="set-hint">{t("settings.familyHint")}</div></div>
            <input type="number" min={0} max={100} value={settings.familyThreshold}
              onChange={(e) => updateSettings({ familyThreshold: Math.max(0, Math.min(100, Number(e.currentTarget.value) || 0)) })} />
          </div>
          <div className="set-row">
            <div><div className="set-label">{t("settings.renderCap")}</div><div className="set-hint">{t("settings.renderHint")}</div></div>
            <input type="number" min={50} max={20000} step={50} value={settings.renderCap}
              onChange={(e) => updateSettings({ renderCap: Math.max(50, Math.min(20000, Number(e.currentTarget.value) || 500)) })} />
          </div>
          <div className="set-group">{t("settings.kidotelGroup")}</div>
          <div className="set-row">
            <div><div className="set-label">{t("settings.claimBase")}</div><div className="set-hint">{t("settings.claimHint")}</div></div>
            <input type="text" inputMode="url" value={settings.claimBase} placeholder="https://kidotel.co"
              onChange={(e) => updateSettings({ claimBase: e.currentTarget.value.trim() })} />
          </div>
          <div className="set-row">
            <div><div className="set-label">{t("settings.bookingAid")}</div><div className="set-hint">{t("settings.bookingHint")}</div></div>
            <input type="text" value={settings.bookingAid} placeholder="—"
              onChange={(e) => updateSettings({ bookingAid: e.currentTarget.value.trim() })} />
          </div>
          <div className="set-group">{t("er.assumptions")}</div>
          <div className="set-hint set-group-hint">{t("er.note")}</div>
          <div className="set-row"><div className="set-label">{t("er.value")}</div>
            <input type="number" min={0} step={50} value={settings.erValue} onChange={(e) => updateSettings({ erValue: Math.max(0, Number(e.currentTarget.value) || 0) })} /></div>
          <div className="set-row"><div className="set-label">{t("er.comm")}</div>
            <input type="number" min={0} max={100} step={0.5} value={settings.erComm} onChange={(e) => updateSettings({ erComm: Math.max(0, Math.min(100, Number(e.currentTarget.value) || 0)) })} /></div>
          <div className="set-row"><div className="set-label">{t("er.volume")}</div>
            <input type="number" min={0} step={1} value={settings.erVolume} onChange={(e) => updateSettings({ erVolume: Math.max(0, Number(e.currentTarget.value) || 0) })} /></div>
          <div className="set-foot">{t("settings.saved")}</div>
        </div>
      </div>
    </div>
  );
}

function prettyHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function cleanAdmin(s: string): string {
  return s.replace(/^(Provincia di |Provincia Autonoma di |Politischer Bezirk |Province of |Préfecture de |Regione |Comunità )/i, "").trim();
}

function locationOf(h: { city: string | null; province?: string | null; region?: string | null; country: string | null }): string {
  const parts = [h.city, h.province, h.region, h.country].map((x) => (x ? cleanAdmin(x) : "")).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  }
  return out.join(" · ") || "—";
}
