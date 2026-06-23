import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n, type Lang } from "./i18n";
import { APP_VERSION } from "./version";
import "./App.css";

type Hotel = {
  name: string;
  city: string | null;
  country: string | null;
  website: string | null;
  source: string;
  lat: number;
  lon: number;
};

type DiscoverResult = {
  area_label: string;
  count: number;
  hotels: Hotel[];
};

const EXAMPLES = ["Alto Adige", "Toscana", "Costa Brava", "Tokyo"];

function BrandIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-hidden="true">
      <rect width="120" height="120" rx="28" fill="#1D9E75" />
      <path d="M60 22C45 22 33 34 33 49C33 68 60 96 60 96C60 96 87 68 87 49C87 34 75 22 60 22Z" fill="#fff" />
      <path d="M60 38 L63.6 45.4 L71 49 L63.6 52.6 L60 60 L56.4 52.6 L49 49 L56.4 45.4 Z" fill="#EF9F27" />
    </svg>
  );
}

export default function App() {
  const { t, lang, setLang } = useI18n();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hotels, setHotels] = useState<Hotel[]>([]);
  const [area, setArea] = useState<string | null>(null);

  async function scan() {
    const q = query.trim();
    if (!q || loading) return;
    setLoading(true);
    setError(null);
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

  const withSite = hotels.filter((h) => h.website && h.website.length > 0).length;

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
        </aside>

        <main className="main">
          <div className="stats">
            <div className="stat">
              <div className="stat-label">{t("stats.found")}</div>
              <div className="stat-value">{hotels.length.toLocaleString(lang)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">{t("stats.area")}</div>
              <div className="stat-value small">{area ?? "—"}</div>
            </div>
            <div className="stat">
              <div className="stat-label">{t("stats.withsite")}</div>
              <div className="stat-value">{withSite.toLocaleString(lang)}</div>
            </div>
          </div>

          {error && <div className="error">{t("scan.error")}: {error}</div>}

          {hotels.length === 0 && !error ? (
            <div className="placeholder">{loading ? t("scan.scanning") : t("scan.empty")}</div>
          ) : (
            <div className="table">
              <div className="thead">
                <span>{t("results.hotel")}</span>
                <span>{t("results.location")}</span>
                <span>{t("results.website")}</span>
                <span>{t("results.source")}</span>
              </div>
              {hotels.map((h, i) => (
                <div className="trow" key={i}>
                  <span className="cell-name">{h.name}</span>
                  <span className="cell-loc">{[h.city, h.country].filter(Boolean).join(", ") || "—"}</span>
                  <span className="cell-site">
                    {h.website ? (
                      <a href={h.website} target="_blank" rel="noreferrer">{prettyHost(h.website)}</a>
                    ) : (
                      <span className="muted">{t("results.nosite")}</span>
                    )}
                  </span>
                  <span className="cell-src">{h.source}</span>
                </div>
              ))}
            </div>
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

function prettyHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
