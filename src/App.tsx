import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { useI18n, type Lang, type TKey } from "./i18n";
import { APP_VERSION } from "./version";
import MapView, { type MapPoint } from "./components/MapView";
import { Icon } from "./components/Icon";
import { Wordmark, wordmarkSvg } from "./components/Wordmark";
import { GUIDE, NEWS } from "./guide";
import "./App.css";

// Impostazioni dell'app, persistite in localStorage.
type Theme = "auto" | "light" | "dark";
type Settings = { theme: Theme; familyThreshold: number; renderCap: number; erValue: number; erComm: number; erVolume: number };
const DEFAULT_SETTINGS: Settings = { theme: "auto", familyThreshold: 60, renderCap: 500, erValue: 700, erComm: 4, erVolume: 20 };
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

type ScoreStats = { total: number; with_site: number; scored: number; strong: number };

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

// Continente per paese (nomi come da pycountry, quelli salvati nel DB). Per raggruppare la Copertura.
const CONTINENT: Record<string, string> = {
  // Europa
  Austria: "europe", Belgium: "europe", Croatia: "europe", Cyprus: "europe", Czechia: "europe",
  Denmark: "europe", Estonia: "europe", Finland: "europe", France: "europe", Germany: "europe",
  Gibraltar: "europe", Greece: "europe", "Holy See (Vatican City State)": "europe", Hungary: "europe",
  Iceland: "europe", Ireland: "europe", Italy: "europe", Latvia: "europe", Liechtenstein: "europe",
  Lithuania: "europe", Luxembourg: "europe", Malta: "europe", Monaco: "europe", Montenegro: "europe",
  Netherlands: "europe", "North Macedonia": "europe", Norway: "europe", Poland: "europe", Portugal: "europe",
  Romania: "europe", "Russian Federation": "europe", "San Marino": "europe", Serbia: "europe",
  Slovakia: "europe", Slovenia: "europe", Spain: "europe", Sweden: "europe", Switzerland: "europe",
  "Türkiye": "europe", Turkey: "europe", Ukraine: "europe", "United Kingdom": "europe", Bulgaria: "europe", Albania: "europe",
  // Asia
  China: "asia", India: "asia", Indonesia: "asia", Israel: "asia", Japan: "asia", Jordan: "asia",
  Kazakhstan: "asia", Malaysia: "asia", Maldives: "asia", Oman: "asia", Philippines: "asia",
  Qatar: "asia", "Saudi Arabia": "asia", Singapore: "asia", "Sri Lanka": "asia", Thailand: "asia",
  "United Arab Emirates": "asia", Uzbekistan: "asia", "Viet Nam": "asia", Vietnam: "asia", Cambodia: "asia",
  "Korea, Republic of": "asia", Nepal: "asia", Lebanon: "asia", Bahrain: "asia",
  // Africa
  Egypt: "africa", Kenya: "africa", Mauritius: "africa", Morocco: "africa", "Réunion": "africa",
  Seychelles: "africa", "South Africa": "africa", "Tanzania, United Republic of": "africa",
  Tunisia: "africa", Namibia: "africa", Botswana: "africa", Nigeria: "africa", Ghana: "africa", Senegal: "africa",
  // Nord America (incl. Caraibi e America Centrale)
  Aruba: "north_america", Bahamas: "north_america", Barbados: "north_america", Belize: "north_america",
  Canada: "north_america", "Costa Rica": "north_america", Cuba: "north_america", "Dominican Republic": "north_america",
  Guadeloupe: "north_america", Guatemala: "north_america", Haiti: "north_america", Honduras: "north_america",
  Jamaica: "north_america", Martinique: "north_america", Mexico: "north_america", Nicaragua: "north_america",
  Panama: "north_america", "Puerto Rico": "north_america", "United States": "north_america", "El Salvador": "north_america",
  // Sud America
  Argentina: "south_america", "Bolivia, Plurinational State of": "south_america", Brazil: "south_america",
  Chile: "south_america", Colombia: "south_america", Ecuador: "south_america", "French Guiana": "south_america",
  Paraguay: "south_america", Peru: "south_america", Uruguay: "south_america", "Venezuela, Bolivarian Republic of": "south_america",
  // Oceania
  Australia: "oceania", Fiji: "oceania", "French Polynesia": "oceania", "New Zealand": "oceania",
};
const CONTINENT_ORDER = ["europe", "asia", "africa", "north_america", "south_america", "oceania", "other"];

// Etichette segnali in INGLESE per l'email di outreach (sempre in inglese, a prescindere dalla lingua UI).
const EN_SIGNAL: Record<string, string> = {
  kids_club: "Kids club", kids_facilities: "Kids facilities", family_rooms: "Family rooms",
  childcare: "Childcare / babysitting", kids_dining: "Kids dining",
  activities_age: "Age-appropriate activities", safety: "Child safety",
};

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

export default function App() {
  const { t, lang, setLang } = useI18n();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [area, setArea] = useState<string | null>(null);
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
  const [contacts, setContacts] = useState<Record<string, ContactState>>({});
  const [reviewCounts, setReviewCounts] = useState<Record<string, number>>({});
  const [crmFilter, setCrmFilter] = useState<ContactStatus | "all">("all");
  const [showAssump, setShowAssump] = useState(false);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [overlay, setOverlay] = useState<"guide" | "settings" | "export" | "info" | null>(null);
  // #8 — selezione a criteri per l'export "cowork": compone il gruppo di hotel da esportare.
  const [exportSel, setExportSel] = useState<ExportSel>(DEFAULT_EXPORT_SEL);
  const [exportCount, setExportCount] = useState<number | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  // #9 — infografica stampabile
  const [infoData, setInfoData] = useState<InfoData | null>(null);
  const [infoOpts, setInfoOpts] = useState<InfoOpts>(DEFAULT_INFO_OPTS);
  const [infoBusy, setInfoBusy] = useState(false);
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
        const pageNote = pages > 1 ? ` — ${t("page.page")} ${page + 1}/${pages}` : "";
        setArea(t("archive.label") + pageNote);
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
      setArea(`${t("search.results")}: «${q}» (${n.toLocaleString(lang)}${n >= 5000 ? "+" : ""})`);
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
      setCovBusy(null);
    }
  }

  // Porta un paese verso il 100%: enumera le sue regioni e le scansiona una per una (funziona anche
  // per i paesi enormi/antimeridiano, che per bbox sarebbero bloccati). Mostra l'avanzamento.
  function stopComplete() { covStopRef.current = true; }

  // Core riusabile (no guard, no covBusy): scansiona un paese regione per regione. Ritorna i NUOVI.
  // `prefix` (es. "Europa 2/5 · ") antepone il contesto continente alle note durante lo scan continente.
  async function runCompleteCountry(country: string, prefix = "", force = false): Promise<number> {
    setNotice(`${prefix}${country}: ${t("cov.enumerating")}…`);
    const regions = await invoke<SubArea[]>("list_subareas", { query: country });
    if (!regions.length) { setNotice(`${prefix}${country}: ${t("cov.noregions")}`); return 0; }
    // INCREMENTALE: salta le regioni già scansionate negli ultimi 30 giorni (niente da capo ogni volta).
    const keys = regions.map((r) => `${r.osm_type}/${r.osm_id}`);
    const done = force ? new Set<string>() : new Set(await invoke<string[]>("areas_scanned_within", { keys, days: 30 }).catch(() => []));
    const before = coverageTotalOf(await loadCoverage(), country);
    let latest = before, skipped = 0;
    for (let i = 0; i < regions.length; i++) {
      if (covStopRef.current) break;
      const rg = regions[i];
      if (done.has(`${rg.osm_type}/${rg.osm_id}`)) { skipped++; continue; } // già fatta di recente
      const skipNote = skipped ? `, ${skipped} ${t("cov.skipped")}` : "";
      setNotice(`${prefix}${country}: ${t("cov.region")} ${i + 1}/${regions.length} — ${rg.name}… (+${(latest - before).toLocaleString(lang)} ${t("cov.new")}${skipNote})`);
      try {
        await invoke<number>("discover_area", { args: { osmType: rg.osm_type, osmId: rg.osm_id, s: rg.s, n: rg.n, w: rg.w, e: rg.e, country } });
        latest = coverageTotalOf(await loadCoverage(), country);
      } catch { /* salta la regione, continua */ }
      if (covStopRef.current) break;
      await new Promise((r) => setTimeout(r, 600)); // garbo verso Overpass + punto di stop
    }
    try { const osm = await invoke<number>("osm_hotel_count", { query: country }); setOsmTotals((p) => ({ ...p, [country]: osm })); } catch { /* grado opzionale */ }
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
      setCovBusy(null);
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
        total += await runCompleteCountry(list[i], `${t(("cont." + contKey) as TKey)} ${i + 1}/${list.length} · `);
      }
      setNotice(`${t(("cont." + contKey) as TKey)}: +${total.toLocaleString(lang)} ${t("cov.new")}${covStopRef.current ? ` (${t("cov.stopped")})` : ""}.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setCovBusy(null);
    }
  }

  // Scan di TUTTI i continenti, uno dopo l'altro (paese per paese). Grazie all'incrementale, i paesi
  // già scansionati di recente vengono saltati → la ripresa è rapida.
  async function completeAllContinents() {
    if (covBusy || loading) return;
    covStopRef.current = false;
    setCovBusy("cont:all");
    setError(null);
    try {
      let total = 0;
      for (const k of CONTINENT_ORDER) {
        if (covStopRef.current) break;
        const list = coverage
          .filter((c) => !c.country.startsWith("(") && (CONTINENT[c.country] || "other") === k)
          .map((c) => c.country)
          .sort((a, b) => a.localeCompare(b, lang));
        for (let i = 0; i < list.length; i++) {
          if (covStopRef.current) break;
          total += await runCompleteCountry(list[i], `${t(("cont." + k) as TKey)} ${i + 1}/${list.length} · `);
        }
      }
      setNotice(`${t("coverage.completeAll")}: +${total.toLocaleString(lang)} ${t("cov.new")}${covStopRef.current ? ` (${t("cov.stopped")})` : ""}.`);
    } catch (e) {
      setError(String(e));
    } finally {
      setCovBusy(null);
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
        setNotice(`${t("stars.backfilling")}: ${checked.toLocaleString(lang)} ${t("stars.checked")} · ${withStars.toLocaleString(lang)} ${t("stars.classified")} · ${b.remaining.toLocaleString(lang)} ${t("stars.remaining")}`);
        if (b.remaining === 0) break;
      }
      setNotice(`${t("stars.done")}: ${withStars.toLocaleString(lang)} / ${checked.toLocaleString(lang)}${covStopRef.current ? ` (${t("cov.stopped")})` : ""}.`);
      if (viewSourceRef.current === "archive") await loadArchive();
    } catch (e) {
      setError(String(e));
    } finally {
      setStarsBusy(false);
    }
  }

  function openCrm() { setViewMode("crm"); }

  // CRM: genera l'email di outreach. SEMPRE in inglese, formale, voce al PLURALE (il team Kidotel,
  // mai prima persona singolare): racconta la filosofia del progetto, fa sentire l'hotel SELEZIONATO
  // dopo una ricerca rigorosa, presenta l'adesione come opportunità. Cita le prove verbatim dal sito.
  function emailContact(h: Hotel) {
    const sc = scores[hkey(h)];
    const present = sc ? sc.signals.filter((s) => s.present && s.quote).slice(0, 3) : [];
    const strengths = present.map((s) => `  •  ${EN_SIGNAL[s.key] ?? s.key}: “${s.quote}”`).join("\n");

    const subject = `${h.name} — selected for Kidotel's verified family-hotel collection`;
    const body =
`Dear ${h.name} Team,

Families today face a quiet frustration: it is almost impossible to tell which hotels are genuinely welcoming to children and which merely claim to be. Kidotel was created to put an end to that uncertainty — a curated guide that recommends only hotels whose family offering is verified, word for word, from the property's own official website. Nothing invented, nothing paid for: only what a hotel truly states and delivers.

Our team studies hotels across the world and applies a deliberately strict selection. A property earns its place only when its dedication to families is real and provable — and ${h.name} met that standard. Reviewing your official website, we verified, among others:
${strengths || "  •  a genuine, family-focused offering"}

This is precisely why we would be honoured to feature ${h.name} — at no cost — before the families who are actively searching for exactly this kind of stay.

A place in Kidotel is a selective and genuine opportunity: a neutral, trust-first showcase that reaches the right guests at the right moment, alongside a small, carefully chosen circle of family hotels. We would be truly glad to welcome you among them.

Might we ask you to confirm your interest? We will gladly share the next steps and how to make the most of your presence with us.

With our best regards,
The Kidotel Team
kidotel.co`;
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
      stats: { total: 132480, with_site: 61230, scored: 48910, strong: 12740 },
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
      setArea(res.area_label);
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
    try {
      while (!stopRef.current) {
        const batch = await invoke<EnrichBatch>("enrich_batch", { limit: 24 });
        if (batch.processed === 0) break;
        const live: Record<string, EnrichResult> = {};
        for (const r of batch.results) {
          if (inView.has(r.id)) live[r.id] = { website_ok: r.website_ok, pages_fetched: r.pages_fetched, family_fit_score: r.family_fit_score, signals: r.signals };
        }
        if (Object.keys(live).length) setScores((prev) => ({ ...prev, ...live }));
        await refreshStats();
        if (batch.remaining === 0) break;
      }
    } finally {
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
    const safe = (area || "hotels").replace(/[^a-z0-9]+/gi, "-").slice(0, 40);
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

  // Esegue l'export nel formato scelto: prende gli hotel selezionati e li salva su file.
  async function runExport(format: "csv" | "json") {
    if (exportBusy) return;
    setExportBusy(true);
    try {
      const list = await invoke<HotelRow[]>("select_hotels", { args: selToArgs(exportSel) });
      if (list.length === 0) { setNotice(t("xp.none")); return; }
      const content = format === "csv" ? rowsToCsv(list) : rowsToJson(list);
      const ext = format === "csv" ? "csv" : "json";
      const tag =
        exportSel.scope === "continent" ? exportSel.continent :
        exportSel.scope === "country" ? exportSel.country.toLowerCase().replace(/[^a-z0-9]+/gi, "-").slice(0, 30) :
        "tutti";
      const path = await save({ defaultPath: `kidotel-${tag}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
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
            <button className="proof-toggle" disabled={!sc && (reviewCounts[k] ?? 0) === 0} onClick={() => setExpanded(isOpen ? null : k)} aria-expanded={isOpen}>{t("results.proof")}</button>
          </span>
        </div>
        {isOpen && (
          <>
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

          {scoreStats && scoreStats.with_site > 0 && (
            <div className="progress">
              <div className="progress-head">
                <span>
                  {t("progress.label")}: {scoreStats.scored.toLocaleString(lang)} / {scoreStats.with_site.toLocaleString(lang)}
                  {enriching && <span className="progress-live"> · {t("progress.running")}</span>}
                </span>
                <span>{Math.round((scoreStats.scored / scoreStats.with_site) * 100)}%</span>
              </div>
              <div className="bar">
                <div className="bar-fill" style={{ width: `${Math.min(100, Math.round((scoreStats.scored / scoreStats.with_site) * 100))}%` }} />
              </div>
            </div>
          )}

          {area && <div className="area-caption">{area}</div>}
          {notice && <div className="notice" role="status" title={t("settings.close")} onClick={() => setNotice(null)}>{notice}</div>}

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
            />
          ) : viewMode === "crm" ? (
            <CrmView
              rows={rows} contacts={contacts} crmFilter={crmFilter} setCrmFilter={setCrmFilter}
              onSave={saveContact} onEmail={emailContact} t={t} lang={lang}
              threshold={settings.familyThreshold} renderCap={settings.renderCap}
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
                          <span className="bc-meta">{c.total.toLocaleString(lang)} · <b>{c.strong.toLocaleString(lang)}</b> family</span>
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
                Kidotel Radar — {area} — {printDate} — {rows.length} hotel
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
  rows, contacts, crmFilter, setCrmFilter, onSave, onEmail, t, lang, threshold, renderCap,
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
}) {
  // Targeting: filtri per concentrarsi sui prospect più redditizi (paese, stelle, family-fit, email
  // recapitabile, valore atteso minimo). Operano sul set caricato (i migliori per voto).
  const [fCountry, setFCountry] = useState("");
  const [fStars, setFStars] = useState(0);
  const [fMinScore, setFMinScore] = useState(0);
  const [fDeliverable, setFDeliverable] = useState(false);
  const [fMinEr, setFMinEr] = useState(0);

  // Hotel contattabili (con almeno un canale), ordinati per Valore atteso ↓ (priorità acquisizione).
  const contactable = rows
    .filter((r) => r.h.website || r.h.email || r.h.phone)
    .sort((a, b) => (b.er ?? -1) - (a.er ?? -1) || a.h.name.localeCompare(b.h.name, lang));

  const countriesAvail = [...new Set(contactable.map((r) => r.h.country).filter((c): c is string => !!c))].sort((a, b) => a.localeCompare(b, lang));
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

  if (contactable.length === 0) {
    return <div className="placeholder">{t("crm.empty")}</div>;
  }
  return (
    <div className="crm">
      <div className="crm-intro">{t("crm.intro")}</div>
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
}) {
  const anyBusy = busy !== null || starsBusy || loading || scanning;
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
      {/* azioni globali: completa TUTTI i continenti (incrementale) + ri-scansione stelle da OSM */}
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
  onExport: (format: "csv" | "json") => void;
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
            </div>
          ))}
          <div className="guide-foot"><Icon name="check" size={15} /> {t("footer.proof")} · {t("footer.copyright")}</div>
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
