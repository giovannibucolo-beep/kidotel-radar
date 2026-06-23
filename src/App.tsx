import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useI18n, type Lang, type TKey } from "./i18n";
import { APP_VERSION } from "./version";
import "./App.css";

type Hotel = {
  osm_type: string;
  osm_id: number;
  name: string;
  city: string | null;
  country: string | null;
  website: string | null;
  phone: string | null;
  source: string;
  lat: number;
  lon: number;
};

type DiscoverResult = { area_label: string; count: number; hotels: Hotel[] };

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

const EXAMPLES = ["Alto Adige", "Toscana", "Costa Brava", "Tokyo"];
const POOL = 5;

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
  const [scoredCount, setScoredCount] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [onlyScored, setOnlyScored] = useState(false);
  const [sortBy, setSortBy] = useState<"score" | "name">("score");
  const [minScore, setMinScore] = useState(0);

  async function scan() {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
    setScores({});
    setExpanded(null);
    try {
      const res = await invoke<DiscoverResult>("discover", { query: q });
      setHotels(res.hotels);
      setArea(res.area_label);
    } catch (e) {
      setError(String(e));
      setHotels([]);
      setArea(null);
    } finally {
      setLoading(false);
    }
  }

  async function enrichAll() {
    if (enriching) return;
    const targets = hotels.filter((h) => h.website);
    if (targets.length === 0) return;
    setEnriching(true);
    setScoredCount(0);
    let done = 0;
    let idx = 0;
    const worker = async () => {
      while (idx < targets.length) {
        const h = targets[idx++];
        try {
          const res = await invoke<EnrichResult>("enrich_hotel", {
            args: { osmType: h.osm_type, osmId: h.osm_id, website: h.website },
          });
          setScores((prev) => ({ ...prev, [hkey(h)]: res }));
        } catch {
          /* salta il singolo hotel in errore */
        }
        done++;
        setScoredCount(done);
      }
    };
    await Promise.all(Array.from({ length: Math.min(POOL, targets.length) }, worker));
    setEnriching(false);
    setSortBy("score");
  }

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

  const withSite = hotels.filter((h) => h.website).length;
  const scoredVals = Object.values(scores).filter((s) => s.website_ok);
  const avgScore =
    scoredVals.length > 0
      ? Math.round(scoredVals.reduce((a, s) => a + s.family_fit_score, 0) / scoredVals.length)
      : null;

  async function exportCsv() {
    const sep = ";";
    const header = ["Nome", "Family-fit", "Città", "Paese", "Sito", "Telefono", "Lat", "Lon", "Servizi family"];
    const lines = [header];
    for (const { h, score } of rows) {
      const sc = scores[hkey(h)];
      const services = sc ? sc.signals.filter((s) => s.present).map((s) => t(("signal." + s.key) as TKey)).join(", ") : "";
      lines.push([h.name, score ?? "", h.city ?? "", h.country ?? "", h.website ?? "", h.phone ?? "", h.lat, h.lon, services].map(String));
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
          <div className="side-title">{t("area.title")}</div>
          <input
            className="search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => e.key === "Enter" && scan()}
            placeholder={t("area.search")}
          />
          <div className="hint">{t("area.hint")}</div>
          <div className="examples-label">{t("area.examples")}</div>
          <div className="examples">
            {EXAMPLES.map((ex) => (
              <button key={ex} className="chip" onClick={() => setQuery(ex)}>
                {ex}
              </button>
            ))}
          </div>
          <button className="scan-btn" onClick={scan} disabled={loading || !query.trim()}>
            {loading ? t("scan.scanning") : t("scan.button")}
          </button>
          {hotels.length > 0 && (
            <button className="enrich-btn" onClick={enrichAll} disabled={enriching || withSite === 0}>
              {enriching ? `${t("enrich.running")} ${scoredCount}/${withSite}` : t("enrich.button")}
            </button>
          )}
        </aside>

        <main className="main">
          <div className="stats">
            <div className="stat">
              <div className="stat-label">{t("stats.found")}</div>
              <div className="stat-value">{hotels.length.toLocaleString(lang)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">{t("stats.avgscore")}</div>
              <div className="stat-value">{avgScore ?? "—"}</div>
            </div>
            <div className="stat">
              <div className="stat-label">{t("stats.withsite")}</div>
              <div className="stat-value">{withSite.toLocaleString(lang)}</div>
            </div>
          </div>

          {area && <div className="area-caption">{area}</div>}

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
              <button className="tb-btn" onClick={() => window.print()}>{t("action.print")}</button>
              <button className="tb-btn" onClick={exportCsv}>{t("action.export")}</button>
            </div>
          )}

          {hotels.length === 0 && !error ? (
            <div className="placeholder">{loading ? t("scan.scanning") : t("scan.empty")}</div>
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
                {rows.map(({ h, score }) => {
                  const k = hkey(h);
                  const sc = scores[k];
                  const isOpen = expanded === k;
                  return (
                    <div key={k}>
                      <div className="trow">
                        <span className="cell-name">
                          {h.name}
                          <span className="cell-loc">
                            {[h.city, h.country].filter(Boolean).join(", ") || "—"}
                          </span>
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
            </>
          )}

          <div className="footer">
            <span className="shield" aria-hidden="true">✓</span>
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
