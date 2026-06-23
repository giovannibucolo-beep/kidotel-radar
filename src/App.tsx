import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import { useI18n, type Lang, type TKey } from "./i18n";
import { APP_VERSION } from "./version";
import MapView, { type MapPoint } from "./components/MapView";
import { Icon } from "./components/Icon";
import "./App.css";

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
  source: string;
  lat: number;
  lon: number;
};

type DiscoverResult = { area_label: string; count: number; hotels: Hotel[] };

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
  lat: number;
  lon: number;
  source: string | null;
  family_fit_score: number | null;
  score_breakdown: string | null;
  enrichment: string | null;
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

type ScoreStats = { total: number; with_site: number; scored: number; strong: number };
type UnscoredRef = { id: string; website: string };

const EXAMPLES = ["Alto Adige", "Toscana", "Costa Brava", "Tokyo"];
const POOL = 8;
const RENDER_CAP = 500;

function BrandIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <rect width="120" height="120" rx="28" fill="#1D9E75" />
      <path d="M60 22C45 22 33 34 33 49C33 68 60 96 60 96C60 96 87 68 87 49C87 34 75 22 60 22Z" fill="#fff" />
      <path d="M60 38 L63.6 45.4 L71 49 L63.6 52.6 L60 60 L56.4 52.6 L49 49 L56.4 45.4 Z" fill="#EF9F27" />
    </svg>
  );
}

const hkey = (h: Hotel) => `${h.osm_type}/${h.osm_id}`;
const tier = (s: number) => (s >= 80 ? "ok" : s >= 60 ? "warn" : "low");
const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

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
  const [sortBy, setSortBy] = useState<"score" | "name">("score");
  const [minScore, setMinScore] = useState(0);
  const [viewMode, setViewMode] = useState<"table" | "map">("table");
  const [dbQuery, setDbQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [archiveTotal, setArchiveTotal] = useState<number | null>(null);
  const [scoreStats, setScoreStats] = useState<ScoreStats | null>(null);
  const stopRef = useRef(false);

  // Costruisce hotels+scores da righe del DB (condiviso da archivio e ricerca).
  function applyRows(rows: HotelRow[]): number {
    const hs: Hotel[] = [];
    const sc: Record<string, EnrichResult> = {};
    for (const r of rows) {
      hs.push({
        osm_type: r.osm_type, osm_id: r.osm_id, name: r.name,
        city: r.city, country: r.country, region: r.region, province: r.province,
        website: r.website, phone: r.phone,
        source: r.source || "OpenStreetMap", lat: r.lat, lon: r.lon,
      });
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
    setExpanded(null);
    return hs.length;
  }

  // Mostra l'INTERO archivio salvato (i più rilevanti per voto).
  async function loadArchive() {
    try {
      const rows = await invoke<HotelRow[]>("list_hotels", { limit: 5000 });
      const n = applyRows(rows);
      let total = n;
      try { total = await invoke<number>("count_hotels"); } catch { /* ignora */ }
      setArchiveTotal(total);
      setDbQuery("");
      if (n > 0) {
        const capped = total > n ? ` — ${t("view.showing")} ${n.toLocaleString(lang)} / ${total.toLocaleString(lang)}` : "";
        setArea(t("archive.label") + capped);
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
    try { setScoreStats(await invoke<ScoreStats>("score_stats")); } catch { /* anteprima */ }
  }

  useEffect(() => { loadArchive(); }, []);
  useEffect(() => {
    refreshStats();
    const id = setInterval(refreshStats, 4000); // barra di avanzamento sempre aggiornata
    return () => clearInterval(id);
  }, []);

  async function scan() {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setExpanded(null);
    try {
      const res = await invoke<DiscoverResult>("discover", { query: q });
      // mostra SOLO gli hotel di quest'area (vengono comunque salvati nell'archivio);
      // i voti già calcolati per questi hotel restano disponibili dalla mappa scores.
      setHotels(res.hotels);
      setArchiveTotal(null); // vista area: la statistica mostra il conteggio dell'area
      setArea(res.area_label);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  // Valuta family-fit (gratis) su TUTTO l'archivio: scorre i non valutati a blocchi,
  // riprendibile e fermabile; la barra globale mostra l'avanzamento.
  async function enrichAll() {
    if (enriching) return;
    stopRef.current = false;
    setEnriching(true);
    try {
      while (!stopRef.current) {
        const batch = await invoke<UnscoredRef[]>("list_unscored", { limit: 80 });
        if (batch.length === 0) break;
        let idx = 0;
        const worker = async () => {
          while (idx < batch.length && !stopRef.current) {
            const u = batch[idx++];
            const [ot, oid] = u.id.split("/");
            try { await invoke("enrich_hotel", { args: { osmType: ot, osmId: Number(oid), website: u.website } }); } catch { /* salta */ }
          }
        };
        await Promise.all(Array.from({ length: POOL }, worker));
        await refreshStats();
      }
    } finally {
      setEnriching(false);
      await refreshStats();
      await loadArchive();
    }
  }
  function stopEnrich() { stopRef.current = true; }

  const getScore = (h: Hotel): number | null => {
    const s = scores[hkey(h)];
    return s && s.website_ok ? s.family_fit_score : null;
  };

  let rows = hotels.map((h) => ({ h, score: getScore(h) }));
  if (onlyScored) rows = rows.filter((r) => r.score !== null);
  if (minScore > 0) rows = rows.filter((r) => (r.score ?? -1) >= minScore);
  rows.sort((a, b) =>
    sortBy === "name"
      ? a.h.name.localeCompare(b.h.name, lang)
      : (b.score ?? -1) - (a.score ?? -1) || a.h.name.localeCompare(b.h.name, lang),
  );

  const points: MapPoint[] = rows.map(({ h, score }) => ({
    lat: h.lat, lon: h.lon, name: h.name, score, website: h.website, loc: locationOf(h),
  }));

  // Statistiche calcolate SULL'AREA CORRENTE (non sull'archivio): cambiano con la scansione.
  const withSite = hotels.filter((h) => h.website).length;
  const scoredInView = hotels.map(getScore).filter((s): s is number => s !== null);
  const scoredCountView = scoredInView.length;
  const strongCount = scoredInView.filter((s) => s >= 60).length;

  async function exportCsv() {
    const sep = ";";
    const header = ["Nome", "Family-fit", "Città", "Provincia", "Regione", "Paese", "Sito", "Telefono", "Lat", "Lon", "Servizi family"];
    const lines = [header];
    for (const { h, score } of rows) {
      const sc = scores[hkey(h)];
      const services = sc ? sc.signals.filter((s) => s.present).map((s) => t(("signal." + s.key) as TKey)).join(", ") : "";
      lines.push([h.name, score ?? "", h.city ?? "", h.province ?? "", h.region ?? "", h.country ?? "", h.website ?? "", h.phone ?? "", h.lat, h.lon, services].map(String));
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
      `<style>body{font-family:-apple-system,Segoe UI,Arial,sans-serif;margin:24px;color:#1a1a18}` +
      `h1{font-size:18px;margin:0 0 4px}.sub{color:#666;font-size:13px;margin-bottom:16px}` +
      `table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #ddd}` +
      `th{color:#666;font-weight:600}.s{font-weight:700}</style></head><body>` +
      `<h1>Kidotel Radar</h1><div class="sub">${esc(area || "")} · ${date} · ${rows.length} hotel</div>` +
      `<table><thead><tr><th>${t("results.hotel")}</th><th>${t("results.score")}</th><th>${t("results.location")}</th><th>${t("results.website")}</th><th>${t("results.proof")}</th></tr></thead><tbody>${body}</tbody></table>` +
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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <BrandIcon />
          <span className="brand-name">Kidotel Radar</span>
          <span className="version">{t("version.label")} {APP_VERSION}</span>
        </div>
        <div className="lang" role="group" aria-label={t("lang.switch")}>
          {(["it", "en"] as Lang[]).map((l) => (
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
      </header>

      <p className="tagline">{t("app.tagline")}</p>

      <div className="body">
        <aside className="sidebar">
          <div className="panel">
            <div className="panel-title"><Icon name="database" size={16} /> {t("search.title")}</div>
            <input
              className="search"
              value={dbQuery}
              onChange={(e) => setDbQuery(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && doDbSearch()}
              placeholder={t("loc.placeholder")}
            />
            <button className="scan-btn outline" onClick={doDbSearch} disabled={loading || !dbQuery.trim()}>
              <Icon name="search" /> {t("search.button")}
            </button>
            <div className="hint">{t("search.hint")}</div>
          </div>

          <div className="panel">
            <div className="panel-title"><Icon name="signal" size={16} /> {t("scan.title")}</div>
            <input
              className="search"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => e.key === "Enter" && scan()}
              placeholder={t("loc.placeholder")}
            />
            <button className="scan-btn" onClick={scan} disabled={loading || !query.trim()}>
              <Icon name="signal" /> {loading ? t("scan.scanning") : t("scan.button")}
            </button>
            <div className="hint">{t("scan.hint")}</div>
            <div className="examples">
              {EXAMPLES.map((ex) => (
                <button key={ex} className="chip" onClick={() => setQuery(ex)}>{ex}</button>
              ))}
            </div>
          </div>

          <div className="panel">
            {enriching ? (
              <button className="enrich-btn" onClick={stopEnrich}><Icon name="stop" /> {t("enrich.stop")}</button>
            ) : (
              <button className="enrich-btn" onClick={enrichAll}><Icon name="sparkles" /> {t("enrich.button")}</button>
            )}
            <button className="link-btn" onClick={loadArchive}><Icon name="database" size={16} /> {t("archive.show")}</button>
          </div>

          <div className="panel">
            <div className="panel-title"><Icon name="download" size={16} /> {t("data.title")}</div>
            <button className="link-btn" onClick={exportBackup}><Icon name="download" size={16} /> {t("backup.export")}</button>
            <button className="link-btn" onClick={importBackup}><Icon name="upload" size={16} /> {t("backup.import")}</button>
          </div>

          <div className="panel">
            <div className="panel-title"><Icon name="sparkles" size={16} /> {t("ai.title")}</div>
            <button className="link-btn" onClick={exportAiBatch}><Icon name="download" size={16} /> {t("ai.export")}</button>
            <button className="link-btn" onClick={importAiScores}><Icon name="upload" size={16} /> {t("ai.import")}</button>
          </div>
        </aside>

        <main className="main">
          <div className="stats">
            <div className="stat">
              <div className="stat-label">{t("stats.found")}</div>
              <div className="stat-value">{(archiveTotal ?? hotels.length).toLocaleString(lang)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">{t("stats.scored")}</div>
              <div className="stat-value">{scoredCountView.toLocaleString(lang)}<span className="stat-sub"> / {withSite.toLocaleString(lang)}</span></div>
            </div>
            <div className="stat">
              <div className="stat-label">{t("stats.strong")}</div>
              <div className="stat-value">{strongCount.toLocaleString(lang)}</div>
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
          {notice && <div className="notice">{notice}</div>}

          {error && <div className="error">{t("scan.error")}: {error}</div>}

          {hotels.length > 0 && (
            <div className="toolbar">
              <label className="tb-item">
                <input type="checkbox" checked={onlyScored} onChange={(e) => setOnlyScored(e.currentTarget.checked)} />
                {t("view.onlyscored")}
              </label>
              <label className="tb-item">
                {t("view.sort")}
                <select value={sortBy} onChange={(e) => setSortBy(e.currentTarget.value as "score" | "name")}>
                  <option value="score">{t("view.sortscore")}</option>
                  <option value="name">{t("view.sortname")}</option>
                </select>
              </label>
              <label className="tb-item">
                {t("view.minscore")}
                <input
                  type="number" min={0} max={100} value={minScore}
                  onChange={(e) => setMinScore(Math.max(0, Math.min(100, Number(e.currentTarget.value) || 0)))}
                  style={{ width: 60 }}
                />
              </label>
              <span className="tb-count">{t("view.showing")}: {rows.length.toLocaleString(lang)}</span>
              <span className="tb-spacer" />
              <div className="seg" role="group">
                <button className={"seg-btn" + (viewMode === "table" ? " active" : "")} onClick={() => setViewMode("table")}><Icon name="list" size={15} /> {t("view.table")}</button>
                <button className={"seg-btn" + (viewMode === "map" ? " active" : "")} onClick={() => setViewMode("map")}><Icon name="map" size={15} /> {t("view.map")}</button>
              </div>
              <button className="tb-btn" onClick={printReport}><Icon name="printer" size={15} /> {t("action.print")}</button>
              <button className="tb-btn" onClick={exportCsv}><Icon name="download" size={15} /> {t("action.export")}</button>
            </div>
          )}

          {hotels.length === 0 && !error ? (
            <div className="placeholder">{loading ? t("scan.scanning") : t("scan.empty")}</div>
          ) : viewMode === "map" ? (
            <>
              <MapView points={points} />
              <div className="map-legend">
                <span><i className="dot" style={{ background: "#1d9e75" }} /> ≥60</span>
                <span><i className="dot" style={{ background: "#ef9f27" }} /> 40–59</span>
                <span><i className="dot" style={{ background: "#9a9a93" }} /> &lt;40 / —</span>
              </div>
            </>
          ) : (
            <>
              <div className="print-only print-head">
                Kidotel Radar — {area} — {printDate} — {rows.length} hotel
              </div>
              <div className="table">
                <div className="thead">
                  <span>{t("results.hotel")}</span>
                  <span>{t("results.score")}</span>
                  <span>{t("results.website")}</span>
                  <span className="no-print">{t("results.proof")}</span>
                </div>
                {rows.length === 0 && <div className="trow-empty">{t("view.nomatch")}</div>}
                {rows.slice(0, RENDER_CAP).map(({ h, score }) => {
                  const k = hkey(h);
                  const sc = scores[k];
                  const isOpen = expanded === k;
                  return (
                    <div key={k}>
                      <div className="trow">
                        <span className="cell-name">
                          {h.name}
                          <span className="cell-loc">{locationOf(h)}</span>
                        </span>
                        <span>
                          {score !== null ? (
                            <span className={"score score-" + tier(score)}>{score}</span>
                          ) : (
                            <span className="muted">{t("results.notscored")}</span>
                          )}
                        </span>
                        <span className="cell-site">
                          {h.website ? (
                            <a href={h.website} target="_blank" rel="noreferrer">{prettyHost(h.website)}</a>
                          ) : (
                            <span className="muted">{t("results.nosite")}</span>
                          )}
                        </span>
                        <span className="no-print">
                          <button
                            className="proof-toggle"
                            disabled={!sc}
                            onClick={() => setExpanded(isOpen ? null : k)}
                            aria-expanded={isOpen}
                          >
                            {t("results.proof")}
                          </button>
                        </span>
                      </div>
                      {isOpen && sc && <ProofPanel sc={sc} t={t} />}
                    </div>
                  );
                })}
              </div>
              {rows.length > RENDER_CAP && (
                <div className="trunc-note">
                  {t("view.truncated")} {RENDER_CAP} {t("view.of")} {rows.length.toLocaleString(lang)}
                </div>
              )}
            </>
          )}

          <div className="footer">
            <span className="footer-ico" aria-hidden="true"><Icon name="check" size={16} /></span>
            {t("footer.proof")}
          </div>
        </main>
      </div>
    </div>
  );
}

function ProofPanel({ sc, t }: { sc: EnrichResult; t: (k: TKey) => string }) {
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
          {s.quote && <div className="proof-quote">«{s.quote}»</div>}
          {s.url && (
            <a className="proof-src" href={s.url} target="_blank" rel="noreferrer">{prettyHost(s.url)}</a>
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

export function locationOf(h: { city: string | null; province?: string | null; region?: string | null; country: string | null }): string {
  const parts = [h.city, h.province, h.region, h.country].map((x) => (x ? cleanAdmin(x) : "")).filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const k = p.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(p); }
  }
  return out.join(" · ") || "—";
}
