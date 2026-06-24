// Generatore del SITO PUBBLICO (motore di domanda / SEO programmatica) dai dati del Radar.
// Legge il database SQLite e produce un sito STATICO (HTML + sitemap) deployabile (Netlify,
// GitHub Pages, ecc.). Bilingue IT/EN. Monetizzazione via link affiliati SWAPPABILI da config.
//
// Principi (dal panel di progettazione, verificati sul DB):
//  - La PROVA citata dal sito guida la pagina; la CTA viene dopo (niente "thin affiliate").
//  - Si generano SOLO pagine che superano le soglie di densità/prova → niente pagine sottili.
//  - Zero dati inventati: si cita solo il testo verbatim già verificato dal Radar.
//  - JSON-LD onesto: il family-fit è un punteggio proprietario etichettato, MAI un aggregateRating.
//
//   node scripts/build-site.mjs            # genera in ./site
//   OUT=/percorso node scripts/build-site.mjs
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const DB = process.env.KIDOTEL_DB ||
  join(homedir(), "Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite");
const OUT = process.env.OUT || join(import.meta.dirname, "../site");
const CFG = JSON.parse(readFileSync(join(import.meta.dirname, "affiliate.config.json"), "utf8"));
const BASE = CFG.base.replace(/\/$/, "");

const CONFIG = {
  MIN_HOTEL_SCORE: 60,
  MIN_PRESENT_SIGNALS: 3,
  MIN_SUBSTANTIAL_QUOTES: 2,
  MIN_QUOTE_CHARS: 40,
  MIN_UNIQUE_QUOTES: 1,
  MIN_REGION_HOTELS: 8,   // hotel eligibili @>=60 per generare un hub regione
  MIN_COUNTRY_HOTELS: 8,  // hotel eligibili per generare un hub paese
  LOCALES: ["it", "en"],
};

// ---------- dati ----------
function db(sql) {
  const r = spawnSync("sqlite3", ["-json", DB], { input: ".timeout 60000\n" + sql, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error("sqlite3: " + (r.stderr || "").slice(0, 300));
  return r.stdout.trim() ? JSON.parse(r.stdout) : [];
}

// ---------- util ----------
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slugify = (s) => String(s ?? "")
  .normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "x";
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };
const cleanAdmin = (s) => String(s ?? "").replace(/^(Provincia di |Provincia Autonoma di |Politischer Bezirk |Province of |Préfecture de |Regione |Comunità )/i, "").trim();
const fmtDate = (s, loc) => { try { return new Date((s || "").replace(" ", "T") + "Z").toLocaleDateString(loc === "it" ? "it-IT" : "en-GB", { year: "numeric", month: "long", day: "numeric" }); } catch { return s || ""; } };

const T = {
  brand: "Kidotel",
  tagline: { it: "Hotel per famiglie, con la prova.", en: "Family hotels, with the proof." },
  segHotels: { it: "hotel-per-famiglie", en: "family-hotels" },
  navHome: { it: "Home", en: "Home" },
  navAll: { it: "Tutti gli hotel", en: "All hotels" },
  method: { it: "metodologia", en: "methodology" },
  methodTitle: { it: "Come verifichiamo", en: "How we verify" },
  disclosurePath: { it: "trasparenza", en: "disclosure" },
  disclosureTitle: { it: "Trasparenza e affiliazione", en: "Transparency & affiliate" },
  verified: { it: "verificati", en: "verified" },
  familyHotelsIn: { it: "Hotel per famiglie", en: "Family hotels" },
  inArea: { it: "in", en: "in" },
  scoreLabel: { it: "family-fit", en: "family-fit" },
  proofStamp: {
    it: "Ogni informazione qui sotto è citata parola per parola dal sito ufficiale dell'hotel e verificata.",
    en: "Every detail below is quoted word-for-word from the hotel's official website and verified.",
  },
  source: { it: "Fonte", en: "Source" },
  ctaHero: { it: "Verifica disponibilità e prezzi", en: "Check availability & prices" },
  ctaProof: { it: "Vedi camere famiglia e disponibilità", en: "See family rooms & availability" },
  ctaCard: { it: "Vedi i prezzi", en: "See prices" },
  details: { it: "Dettagli e prove", en: "Details & proof" },
  lastChecked: { it: "Ultima verifica dal sito dell'hotel", en: "Last checked from the hotel's website" },
  suggest: { it: "Segnala una correzione", en: "Suggest a correction" },
  otherIn: { it: "Altri hotel per famiglie a", en: "More family hotels in" },
  disclosure: {
    it: "Alcuni link sono affiliati: se prenoti tramite essi, Kidotel può ricevere una commissione senza costi aggiuntivi per te. Non influisce sugli hotel elencati né sul loro punteggio famiglia.",
    en: "Some links are affiliate links — if you book through them, Kidotel may earn a commission at no extra cost to you. It never affects which hotels we list or their family score.",
  },
  servicesVerified: { it: "servizi per famiglie verificati", en: "verified family services" },
  ofWhich: { it: "di cui", en: "of which" },
  with: { it: "con", en: "with" },
  introHotel: {
    it: (n, score) => `ha un family-fit score di ${score}/100, basato su ${n} servizi per famiglie verificati — ognuno con la frase originale citata dal sito ufficiale.`,
    en: (n, score) => `has a family-fit score of ${score}/100, based on ${n} verified family services — each with the original sentence quoted from its official website.`,
  },
};

const SIGNALS = {
  kids_club: { it: "Miniclub", en: "Kids club" },
  kids_facilities: { it: "Strutture per bambini", en: "Kids facilities" },
  family_rooms: { it: "Camere familiari", en: "Family rooms" },
  childcare: { it: "Childcare / babysitting", en: "Childcare / babysitting" },
  kids_dining: { it: "Menù per bambini", en: "Kids dining" },
  activities_age: { it: "Attività per età", en: "Age-based activities" },
  safety: { it: "Sicurezza bambini", en: "Child safety" },
};
const sigLabel = (k, loc) => (SIGNALS[k] ? SIGNALS[k][loc] : k);

// ---------- monetizzazione ----------
function buildBookingUrl(h, ctx) {
  if (CFG.provider === "booking" && h.city && h.country) {
    const b = CFG.booking;
    const p = new URLSearchParams({
      aid: b.aid,
      ss: `${h.name}, ${cleanAdmin(h.city)}, ${h.country}`,
      label: b.labelPattern.replace("{lang}", ctx.loc).replace("{regionSlug}", ctx.regionSlug || "").replace("{hotelSlug}", ctx.hotelSlug || ""),
      lang: b.langMap[ctx.loc] || "en-gb",
      group_adults: b.prefill.group_adults,
      no_rooms: b.prefill.no_rooms,
      group_children: b.prefill.age.length,
    });
    b.prefill.age.forEach((a) => p.append("age", a));
    return `${b.baseUrl}?${p.toString()}`;
  }
  const sep = (h.website || "").includes("?") ? "&" : "?";
  return `${h.website}${sep}${CFG.direct.utm}`;
}
// type: 'monetized' | 'proof' | 'internal'
function link(href, type, text, cls) {
  const rel = type === "monetized" ? ' rel="sponsored noopener"' : type === "proof" ? ' rel="nofollow noopener"' : "";
  const blank = type === "internal" ? "" : ' target="_blank"';
  const c = cls ? ` class="${cls}"` : "";
  return `<a href="${esc(href)}"${rel}${blank}${c}>${esc(text)}</a>`;
}

// ---------- struttura URL ----------
const seg = (loc) => T.segHotels[loc];
const countryPath = (loc, cSlug) => `${loc}/${seg(loc)}/${cSlug}/`;
const regionPath = (loc, cSlug, rSlug) => `${loc}/${seg(loc)}/${cSlug}/${rSlug}/`;
const hotelPath = (loc, h) => `${loc}/hotel/${slugify(cleanAdmin(h.city) || h.country)}-${slugify(h.name)}-${h.osm_id}/`;
const methodPath = (loc) => `${loc}/${T.method[loc]}/`;
const discPath = (loc) => `${loc}/${T.disclosurePath[loc]}/`;
const homePath = (loc) => `${loc}/`;
const urlOf = (rel) => `${BASE}/${rel}`;

// ---------- pagina (head/shell) ----------
const sitemap = []; // {it, en} pairs of indexable abs URLs

function head({ loc, title, desc, rel, alt, robots, jsonld }) {
  const canonical = urlOf(rel);
  const hreflang = CONFIG.LOCALES
    .filter((l) => alt[l])
    .map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(urlOf(alt[l]))}">`)
    .join("\n  ");
  const xdefault = alt.en ? `<link rel="alternate" hreflang="x-default" href="${esc(urlOf(alt.en))}">` : "";
  const ld = jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : "";
  const depth = rel.split("/").filter(Boolean).length; // per il path relativo a /assets/site.css
  const cssHref = "../".repeat(depth) + "assets/site.css";
  return `<!doctype html><html lang="${loc}"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <meta name="robots" content="${robots}">
  <link rel="canonical" href="${esc(canonical)}">
  ${hreflang}
  ${xdefault}
  <link rel="stylesheet" href="${esc(cssHref)}">
  ${ld}
</head><body>
<header class="top"><a class="brand" href="${esc(urlOf(homePath(loc)))}">▲ ${T.brand}</a>
  <nav><a href="${esc(urlOf(loc + "/" + seg(loc) + "/"))}">${esc(T.navAll[loc])}</a>
  <a href="${esc(urlOf(methodPath(loc)))}">${esc(T.methodTitle[loc])}</a>
  ${CONFIG.LOCALES.filter((l) => l !== loc && alt[l]).map((l) => `<a class="lang" href="${esc(urlOf(alt[l]))}">${l.toUpperCase()}</a>`).join("")}
  </nav>
</header>
<main>`;
}
function foot(loc) {
  return `</main>
<footer class="foot">
  <a href="${esc(urlOf(methodPath(loc)))}">${esc(T.methodTitle[loc])}</a> ·
  <a href="${esc(urlOf(discPath(loc)))}">${esc(T.disclosureTitle[loc])}</a> ·
  <span>© ${esc(T.brand)} · © OpenStreetMap contributors</span>
</footer></body></html>`;
}
function writePage(rel, html) {
  const dir = join(OUT, dirname(rel + "index.html"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(OUT, rel + "index.html"), html);
}

// ---------- eligibilità hotel ----------
function evalHotel(h, reused) {
  let bd = [];
  try { bd = JSON.parse(h.score_breakdown || "[]"); } catch { /* */ }
  const present = bd.filter((s) => s.present === true);
  const quoted = present.filter((s) => s.quote && s.quote.trim());
  const substantial = quoted.filter((s) => s.quote.trim().length >= CONFIG.MIN_QUOTE_CHARS);
  const unique = substantial.filter((s) => !reused.has(s.quote.trim()));
  const eligible =
    (h.family_fit_score || 0) >= CONFIG.MIN_HOTEL_SCORE &&
    h.website && h.website.trim() &&
    present.length >= CONFIG.MIN_PRESENT_SIGNALS &&
    substantial.length >= CONFIG.MIN_SUBSTANTIAL_QUOTES &&
    unique.length >= CONFIG.MIN_UNIQUE_QUOTES;
  return { present, substantial, unique, eligible };
}

// ---------- render: scheda hotel ----------
function hotelCard(h, loc) {
  const chips = h._ev.present.slice(0, 4).map((s) => `<span class="chip">${esc(sigLabel(s.key, loc))}</span>`).join("");
  const teaser = (h._ev.unique[0] || h._ev.substantial[0] || h._ev.present.find((s) => s.quote));
  const teaserHtml = teaser && teaser.quote ? `<blockquote class="teaser">“${esc(teaser.quote.trim().slice(0, 160))}${teaser.quote.trim().length > 160 ? "…" : ""}”</blockquote>` : "";
  const detail = h._ev.eligible ? link(urlOf(hotelPath(loc, h)), "internal", T.details[loc], "btn ghost") : "";
  const cta = link(buildBookingUrl(h, { loc }), "monetized", T.ctaCard[loc], "btn");
  return `<article class="card">
    <div class="card-h"><h3>${esc(h.name)}</h3><span class="score s${tier(h.family_fit_score)}">${h.family_fit_score}</span></div>
    <p class="loc">${esc([cleanAdmin(h.city), cleanAdmin(h.region)].filter(Boolean).join(" · "))}</p>
    <div class="chips">${chips}</div>
    ${teaserHtml}
    <div class="card-cta">${detail}${cta}</div>
  </article>`;
}
const tier = (s) => (s >= 80 ? "hi" : s >= 60 ? "mid" : "lo");

// ---------- render: pagina hotel ----------
function hotelPage(h, loc, alt, siblings) {
  const ev = h._ev;
  const ctx = { loc, regionSlug: slugify(cleanAdmin(h.region) || ""), hotelSlug: slugify(h.name) };
  const proofBlocks = ev.present.filter((s) => s.quote && s.quote.trim()).map((s) => `
    <div class="proof">
      <div class="proof-k">${esc(sigLabel(s.key, loc))}</div>
      <blockquote cite="${esc(s.url || "")}">“${esc(s.quote.trim())}”</blockquote>
      ${s.url ? link(s.url, "proof", `${T.source[loc]}: ${hostOf(s.url)}`, "src") : ""}
    </div>`).join("");
  const n = ev.present.length;
  const title = `${h.name}, ${cleanAdmin(h.city)} — ${T.familyHotelsIn[loc]} · ${T.scoreLabel[loc]} ${h.family_fit_score}/100 · ${T.brand}`.slice(0, 70);
  const top2 = ev.present.slice(0, 2).map((s) => sigLabel(s.key, loc)).join(", ");
  const desc = (loc === "it"
    ? `${h.name} a ${cleanAdmin(h.city)} (${cleanAdmin(h.region)}): ${n} servizi per famiglie verificati con prova dal sito ufficiale — ${top2}. Punteggio family-fit ${h.family_fit_score}/100.`
    : `${h.name} in ${cleanAdmin(h.city)} (${cleanAdmin(h.region)}): ${n} verified family services with proof from the official site — ${top2}. Family-fit ${h.family_fit_score}/100.`).slice(0, 158);

  const faq = ev.present.filter((s) => s.quote && s.quote.trim().length >= CONFIG.MIN_QUOTE_CHARS).slice(0, 6).map((s) => ({
    "@type": "Question",
    name: loc === "it" ? `${h.name} offre ${sigLabel(s.key, loc).toLowerCase()}?` : `Does ${h.name} offer ${sigLabel(s.key, loc).toLowerCase()}?`,
    acceptedAnswer: { "@type": "Answer", text: s.quote.trim() },
  }));
  const jsonld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: T.brand, item: urlOf(homePath(loc)) },
          { "@type": "ListItem", position: 2, name: h.country, item: urlOf(countryPath(loc, slugify(h.country))) },
          { "@type": "ListItem", position: 3, name: cleanAdmin(h.region), item: urlOf(regionPath(loc, slugify(h.country), slugify(cleanAdmin(h.region)))) },
          { "@type": "ListItem", position: 4, name: h.name, item: urlOf(hotelPath(loc, h)) },
        ],
      },
      {
        "@type": "LodgingBusiness",
        name: h.name,
        url: h.website,
        address: { "@type": "PostalAddress", addressLocality: cleanAdmin(h.city), addressRegion: cleanAdmin(h.region), addressCountry: h.country },
        ...(h.lat && h.lon ? { geo: { "@type": "GeoCoordinates", latitude: h.lat, longitude: h.lon } } : {}),
        ...(h.phone ? { telephone: h.phone } : {}),
        additionalProperty: { "@type": "PropertyValue", name: "Kidotel family-fit score", value: h.family_fit_score, maxValue: 100 },
      },
      ...(faq.length ? [{ "@type": "FAQPage", mainEntity: faq }] : []),
    ],
  };

  const mailto = `mailto:info@kidotel.co?subject=${encodeURIComponent("Correzione: " + h.name)}`;
  const sib = siblings.length
    ? `<section class="siblings"><h2>${esc(T.otherIn[loc])} ${esc(cleanAdmin(h.city) || cleanAdmin(h.region))}</h2><div class="grid">${siblings.map((s) => hotelCard(s, loc)).join("")}</div></section>`
    : "";

  return head({ loc, title, desc, rel: hotelPath(loc, h), alt, robots: "index,follow", jsonld }) + `
  <nav class="crumbs">${link(urlOf(countryPath(loc, slugify(h.country))), "internal", h.country)} › ${link(urlOf(regionPath(loc, slugify(h.country), slugify(cleanAdmin(h.region)))), "internal", cleanAdmin(h.region))}</nav>
  <h1>${esc(h.name)} — ${esc(T.familyHotelsIn[loc])} ${esc(T.inArea[loc])} ${esc(cleanAdmin(h.city))}</h1>
  <div class="badge"><span class="score s${tier(h.family_fit_score)}">${h.family_fit_score}/100</span> <span>${n} ${esc(T.servicesVerified[loc])}</span></div>
  <p class="intro">${esc(h.name)} ${esc(T.introHotel[loc](n, h.family_fit_score))}</p>
  <div class="cta-hero">${link(buildBookingUrl(h, ctx), "monetized", T.ctaHero[loc], "btn big")}</div>
  <p class="disclosure">${esc(T.disclosure[loc])}</p>
  <p class="stamp">✓ ${esc(T.proofStamp[loc])}</p>
  <section class="proofs">${proofBlocks}</section>
  <div class="cta-anchor">${link(buildBookingUrl(h, ctx), "monetized", T.ctaProof[loc], "btn big")}</div>
  <p class="meta">${esc(T.lastChecked[loc])}: ${esc(fmtDate(h.updated_at, loc))} · <a href="${esc(mailto)}">${esc(T.suggest[loc])}</a></p>
  ${sib}
` + foot(loc);
}

// ---------- render: hub (paese/regione) ----------
function hubPage({ loc, area, parent, hotels, rel, alt, kind }) {
  const eligible = hotels.filter((h) => h._ev.eligible);
  const counts = {};
  for (const h of hotels) for (const s of h._ev.present) counts[s.key] = (counts[s.key] || 0) + 1;
  const topCounts = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, n]) => `${n} ${T.with[loc]} ${sigLabel(k, loc).toLowerCase()}`).join(", ");
  const title = `${T.familyHotelsIn[loc]} ${T.inArea[loc]} ${area} — ${hotels.length} ${T.verified[loc]} | ${T.brand}`;
  const desc = (loc === "it"
    ? `${hotels.length} hotel per famiglie verificati ${T.inArea[loc]} ${area}${topCounts ? ", " + T.ofWhich[loc] + " " + topCounts : ""}. Ogni servizio family con prova citata dal sito ufficiale.`
    : `${hotels.length} verified family hotels in ${area}${topCounts ? ", of which " + topCounts : ""}. Every family service backed by a quote from the official site.`).slice(0, 158);
  const jsonld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: T.brand, item: urlOf(homePath(loc)) },
          ...(parent ? [{ "@type": "ListItem", position: 2, name: parent.name, item: urlOf(parent.rel) }] : []),
          { "@type": "ListItem", position: parent ? 3 : 2, name: area, item: urlOf(rel) },
        ],
      },
      {
        "@type": "ItemList",
        itemListElement: eligible.slice(0, 100).map((h, i) => ({
          "@type": "ListItem", position: i + 1, url: urlOf(hotelPath(loc, h)), name: h.name,
        })),
      },
    ],
  };
  const sorted = [...hotels].sort((a, b) => (b.family_fit_score || 0) - (a.family_fit_score || 0));
  return head({ loc, title, desc, rel, alt, robots: "index,follow", jsonld }) + `
  ${parent ? `<nav class="crumbs">${link(urlOf(parent.rel), "internal", parent.name)}</nav>` : ""}
  <h1>${esc(T.familyHotelsIn[loc])} ${esc(T.inArea[loc])} ${esc(area)}</h1>
  <p class="intro">${hotels.length} ${esc(loc === "it" ? `hotel per famiglie verificati${topCounts ? ", di cui " + topCounts : ""}.` : `verified family hotels${topCounts ? ", of which " + topCounts : ""}.`)}</p>
  <p class="disclosure">${esc(T.disclosure[loc])}</p>
  <div class="grid">${sorted.map((h) => hotelCard(h, loc)).join("")}</div>
` + foot(loc);
}

function simplePage({ loc, title, rel, alt, bodyHtml }) {
  return head({ loc, title: `${title} · ${T.brand}`, desc: title, rel, alt, robots: "index,follow", jsonld: null }) + bodyHtml + foot(loc);
}

// ---------- CSS (foglio di stile unico, pulito e professionale) ----------
const CSS = `:root{--brand:#1d9e75;--brand-d:#16805f;--ink:#1a1a18;--ink2:#555;--ink3:#888;--line:#e7e7e2;--bg:#fafaf8;--card:#fff;--hi:#1d9e75;--mid:#c98a1a;--lo:#9a9a93}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:var(--ink);background:var(--bg)}
a{color:var(--brand-d);text-decoration:none}a:hover{text-decoration:underline}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 20px;border-bottom:1px solid var(--line);background:#fff;position:sticky;top:0;z-index:5}
.brand{font-weight:800;font-size:18px;color:var(--brand-d)}
.top nav{display:flex;gap:16px;align-items:center;font-size:14px}
.top .lang{border:1px solid var(--line);border-radius:6px;padding:2px 8px;color:var(--ink2)}
main{max-width:1040px;margin:0 auto;padding:24px 20px 56px}
h1{font-size:30px;line-height:1.2;margin:8px 0 6px}h2{font-size:21px;margin:32px 0 12px}h3{font-size:17px;margin:0}
.crumbs{font-size:13px;color:var(--ink3);margin-bottom:8px}
.intro{font-size:17px;color:var(--ink2);max-width:70ch}
.badge{display:flex;align-items:center;gap:10px;margin:10px 0}
.score{display:inline-flex;align-items:center;justify-content:center;min-width:42px;padding:3px 8px;border-radius:8px;font-weight:800;color:#fff;font-variant-numeric:tabular-nums}
.score.shi{background:var(--hi)}.score.smid{background:var(--mid)}.score.slo{background:var(--lo)}
.btn{display:inline-block;background:var(--brand);color:#fff;padding:11px 18px;border-radius:10px;font-weight:700}
.btn:hover{background:var(--brand-d);text-decoration:none}
.btn.big{font-size:17px;padding:14px 24px}
.btn.ghost{background:#fff;color:var(--brand-d);border:1px solid var(--brand)}
.cta-hero,.cta-anchor{margin:16px 0}
.disclosure{font-size:12.5px;color:var(--ink3);background:#f4f4f0;border-radius:8px;padding:8px 12px;max-width:75ch}
.stamp{font-weight:600;color:var(--brand-d);margin:18px 0 10px}
.proofs{display:grid;gap:14px}
.proof{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--brand);border-radius:10px;padding:12px 16px}
.proof-k{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink3);font-weight:700;margin-bottom:4px}
blockquote{margin:0;font-size:16px;color:var(--ink)}
.proof .src{display:inline-block;margin-top:6px;font-size:12.5px;color:var(--ink3)}
.meta{font-size:13px;color:var(--ink3);margin-top:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:8px}
.card-h{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
.card .loc{color:var(--ink3);font-size:13px;margin:0}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-size:11.5px;background:#eef6f2;color:var(--brand-d);border-radius:999px;padding:2px 9px}
.teaser{font-size:13.5px;color:var(--ink2);border:0;background:#f7f7f4;border-radius:8px;padding:8px 10px}
.card-cta{display:flex;gap:8px;margin-top:auto;flex-wrap:wrap}
.card-cta .btn{padding:8px 14px;font-size:14px}
.countries{columns:2;max-width:600px}.countries li{margin:4px 0}
.siblings{margin-top:36px}
.foot{border-top:1px solid var(--line);padding:20px;text-align:center;font-size:13px;color:var(--ink3);background:#fff}
@media(max-width:640px){h1{font-size:24px}.countries{columns:1}}
`;

// ============================================================
console.log("Leggo il database…");
const rows = db(`SELECT osm_type, osm_id, name, city, province, region, country, website, phone, email,
  lat, lon, family_fit_score, score_breakdown, enrichment, updated_at
  FROM hotels WHERE family_fit_score >= ${CONFIG.MIN_HOTEL_SCORE} AND website IS NOT NULL AND website<>'' AND country IS NOT NULL AND country<>'' AND region IS NOT NULL AND region<>''
    AND (is_chain IS NULL OR is_chain=0)`);
console.log(`Hotel @score>=${CONFIG.MIN_HOTEL_SCORE} con sito/paese/regione: ${rows.length}`);

// set delle citazioni "boilerplate" (riusate da più hotel) → non contano come contenuto unico
const qc = {};
for (const h of rows) { try { for (const s of JSON.parse(h.score_breakdown || "[]")) if (s.present && s.quote) qc[s.quote.trim()] = (qc[s.quote.trim()] || 0) + 1; } catch { /* */ } }
const reused = new Set(Object.entries(qc).filter(([, n]) => n > 1).map(([q]) => q));

for (const h of rows) h._ev = evalHotel(h, reused);

// raggruppa per paese → regione → città
const byCountry = new Map();
for (const h of rows) {
  if (!byCountry.has(h.country)) byCountry.set(h.country, new Map());
  const reg = byCountry.get(h.country);
  const rk = cleanAdmin(h.region);
  if (!reg.has(rk)) reg.set(rk, []);
  reg.get(rk).push(h);
}

// reset output
if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const report = { countries: 0, regions: 0, hotels: 0, skippedRegions: 0 };
const allIndexable = []; // {it, en} per sitemap

// genera hub paese + regione + schede hotel
for (const [country, regions] of byCountry) {
  const countryHotels = [...regions.values()].flat();
  const countryEligible = countryHotels.filter((h) => h._ev.eligible);
  if (countryEligible.length < CONFIG.MIN_COUNTRY_HOTELS) { continue; }
  const cSlug = slugify(country);

  // hub paese
  const cAlt = Object.fromEntries(CONFIG.LOCALES.map((l) => [l, countryPath(l, cSlug)]));
  for (const loc of CONFIG.LOCALES) {
    writePage(countryPath(loc, cSlug), hubPage({
      loc, area: country, parent: null, hotels: countryHotels,
      rel: countryPath(loc, cSlug), alt: cAlt, kind: "country",
    }));
  }
  allIndexable.push(cAlt);
  report.countries++;

  for (const [region, hs] of regions) {
    const regionEligible = hs.filter((h) => h._ev.eligible);
    if (regionEligible.length < CONFIG.MIN_REGION_HOTELS) { report.skippedRegions++; continue; }
    const rSlug = slugify(region);
    const rAlt = Object.fromEntries(CONFIG.LOCALES.map((l) => [l, regionPath(l, cSlug, rSlug)]));
    for (const loc of CONFIG.LOCALES) {
      writePage(regionPath(loc, cSlug, rSlug), hubPage({
        loc, area: `${region} (${country})`, parent: { name: country, rel: countryPath(loc, cSlug) },
        hotels: hs, rel: regionPath(loc, cSlug, rSlug), alt: rAlt, kind: "region",
      }));
    }
    allIndexable.push(rAlt);
    report.regions++;

    // schede hotel (solo eligibili)
    for (const h of regionEligible) {
      const hAlt = Object.fromEntries(CONFIG.LOCALES.map((l) => [l, hotelPath(l, h)]));
      const siblings = regionEligible.filter((x) => x !== h && cleanAdmin(x.city) === cleanAdmin(h.city)).slice(0, 4);
      const sib2 = siblings.length ? siblings : regionEligible.filter((x) => x !== h).slice(0, 4);
      for (const loc of CONFIG.LOCALES) writePage(hotelPath(loc, h), hotelPage(h, loc, hAlt, sib2));
      allIndexable.push(hAlt);
      report.hotels++;
    }
  }
}

// indice globale + home + metodologia + trasparenza (per locale)
for (const loc of CONFIG.LOCALES) {
  const alt = Object.fromEntries(CONFIG.LOCALES.map((l) => [l, homePath(l)]));
  const countriesList = [...byCountry.entries()]
    .map(([c, regs]) => ({ c, n: [...regs.values()].flat().filter((h) => h._ev.eligible).length, slug: slugify(c) }))
    .filter((x) => x.n >= CONFIG.MIN_COUNTRY_HOTELS)
    .sort((a, b) => b.n - a.n);
  const list = countriesList.map((x) => `<li>${link(urlOf(countryPath(loc, x.slug)), "internal", `${x.c} (${x.n})`)}</li>`).join("");
  const homeBody = `<h1>${esc(T.brand)} — ${esc(T.tagline[loc])}</h1>
    <p class="intro">${esc(loc === "it" ? "Hotel per famiglie scelti dai dati, ognuno con la prova citata dal sito ufficiale. Niente recensioni finte, niente dati inventati." : "Family hotels chosen from data, each with the proof quoted from the official website. No fake reviews, nothing invented.")}</p>
    <h2>${esc(loc === "it" ? "Esplora per paese" : "Browse by country")}</h2><ul class="countries">${list}</ul>`;
  writePage(homePath(loc), simplePage({ loc, title: T.tagline[loc], rel: homePath(loc), alt, bodyHtml: homeBody }));

  // indice = stessa lista, URL /{loc}/family-hotels/
  const idxRel = `${loc}/${seg(loc)}/`;
  const idxAlt = Object.fromEntries(CONFIG.LOCALES.map((l) => [l, `${l}/${seg(l)}/`]));
  writePage(idxRel, simplePage({ loc, title: T.navAll[loc], rel: idxRel, alt: idxAlt, bodyHtml: `<h1>${esc(T.familyHotelsIn[loc])}</h1><ul class="countries">${list}</ul>` }));

  const mAlt = Object.fromEntries(CONFIG.LOCALES.map((l) => [l, methodPath(l)]));
  const mBody = loc === "it" ? `<h1>Come verifichiamo</h1>
    <p>Gli hotel sono scoperti da <strong>OpenStreetMap</strong>. Il <strong>family-fit score (0–100)</strong> è calcolato leggendo il sito ufficiale di ogni hotel con un riconoscitore multilingue a regole: ogni servizio per famiglie vale solo se accompagnato dalla <strong>frase originale citata dal sito</strong> e ri-verificata parola per parola.</p>
    <p><strong>Zero dati inventati.</strong> L'assenza di un servizio nei nostri dati non significa che l'hotel non lo offra: significa che non l'abbiamo trovato dichiarato sul sito. Pubblichiamo una scheda solo quando ci sono prove sufficienti.</p>
    <p>Il punteggio è una nostra valutazione proprietaria, <strong>non</strong> una media di recensioni.</p>`
    : `<h1>How we verify</h1>
    <p>Hotels are discovered from <strong>OpenStreetMap</strong>. The <strong>family-fit score (0–100)</strong> is computed by reading each hotel's official website with a multilingual rule-based recognizer: a family service counts only if backed by the <strong>original sentence quoted from the site</strong>, re-verified word for word.</p>
    <p><strong>Nothing is invented.</strong> A missing service in our data doesn't mean the hotel lacks it — only that we didn't find it stated on the site. We publish a page only when there is enough proof.</p>
    <p>The score is our own proprietary assessment, <strong>not</strong> an average of reviews.</p>`;
  writePage(methodPath(loc), simplePage({ loc, title: T.methodTitle[loc], rel: methodPath(loc), alt: mAlt, bodyHtml: mBody }));

  const dAlt = Object.fromEntries(CONFIG.LOCALES.map((l) => [l, discPath(l)]));
  writePage(discPath(loc), simplePage({ loc, title: T.disclosureTitle[loc], rel: discPath(loc), alt: dAlt, bodyHtml: `<h1>${esc(T.disclosureTitle[loc])}</h1><p>${esc(T.disclosure[loc])}</p>` }));
}

// sitemap (solo pagine indicizzabili) + robots + redirect radice + CSS
const allUrls = [];
for (const loc of CONFIG.LOCALES) { allUrls.push(urlOf(homePath(loc)), urlOf(`${loc}/${seg(loc)}/`), urlOf(methodPath(loc)), urlOf(discPath(loc))); }
for (const pair of allIndexable) for (const loc of CONFIG.LOCALES) if (pair[loc]) allUrls.push(urlOf(pair[loc]));
const sm = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(allUrls)].map((u) => `<url><loc>${esc(u)}</loc></url>`).join("\n")}\n</urlset>\n`;
writeFileSync(join(OUT, "sitemap.xml"), sm);
writeFileSync(join(OUT, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${BASE}/sitemap.xml\n`);
writeFileSync(join(OUT, "index.html"), `<!doctype html><meta charset="utf-8"><link rel="canonical" href="${BASE}/it/"><meta http-equiv="refresh" content="0; url=./it/"><a href="./it/">Kidotel</a>`);
mkdirSync(join(OUT, "assets"), { recursive: true });
writeFileSync(join(OUT, "assets/site.css"), CSS);

console.log(`\nFatto. Pagine indicizzabili: ${report.countries} paesi · ${report.regions} regioni · ${report.hotels} hotel (×${CONFIG.LOCALES.length} lingue). Regioni sotto soglia saltate: ${report.skippedRegions}.`);
console.log(`Output: ${OUT}  ·  URL totali in sitemap: ${new Set(allUrls).size}`);
console.log(`Affiliazione: provider="${CFG.provider}" (cambia in scripts/affiliate.config.json e rigenera).`);
