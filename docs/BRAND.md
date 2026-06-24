# Brand Kidotel — guida applicata a Kidotel Radar

Fonte: brand book ufficiale Kidotel (slide colore/tipografia + wordmark). Adottato nell'app dalla v0.8.6.

## Colori
| Ruolo | HEX | Uso |
|---|---|---|
| Testo / "ink" | `#222223` | testo, bottoni primari (su pesca), wordmark |
| Grigio sfondo | `#F5F5F5` | sfondo pagina (`--bg`) |
| Superficie | `#FFFFFF` | card, pannelli (`--surface`) |
| Peach (accento) | `#FFC27B` | accento del brand: bottone primario, riempimenti, stati attivi, fascia "eccellente" (`--brand`) |
| Ambra | `#EF9F27` | accento secondario, indicatori, barre family (`--accent`) |
| Ambra profonda | `#A8650F` | testo accento/link su chiaro, titoli sezione (contrasto AA) (`--brand-strong`) |
| Velo pesca | `#FFF3E4` | hover/attivi leggeri (`--brand-soft`) |

**Niente verde** nella veste del brand. Gradiente "summer vibes" = caldo (pesca→ambra→giallo), usato per la card "Valore atteso" dell'infografica.

**Eccezione consentita**: i pallini di stato CRM (`.st-*`) sono una palette *funzionale* di codifica dati (grigio/blu/ambra/viola/verde=partner/rosso=rifiutato): distinguono 6 stati e NON sono veste del brand. Anche il rosso d'errore è semantico. Questi restano.

## Tipografia
- **Sora** (titoli): `--font-head`, su `h1/h2/h3`, wordmark suffix, numeri KPI/stat.
- **Manrope** (corpo): `--font-body`, tutto il resto.
- Bundle **offline** via `@fontsource-variable/sora` e `@fontsource-variable/manrope` (import in `src/main.tsx`). Niente CDN nell'app.
- Le pagine HTML generate (infografica, report) — che si stampano dal **browser di sistema** — caricano Sora/Manrope da Google Fonts con fallback al system stack.

## Logo
- Wordmark ufficiale "Kidotel" + scia radar: `src/components/Wordmark.tsx` (unica fonte dei tracciati).
  - `<Wordmark />` (React) usa `currentColor` → eredita `--ink`, si **inverte nel tema scuro**.
  - `wordmarkSvg(height, color)` → stringa SVG per le pagine HTML generate.
- In testata: wordmark + suffisso "Radar". Nell'infografica/report: wordmark + divisore + "Radar".
- Favicon: `public/kidotel.svg` (quadrato scuro + scia radar pesca). `index.html` title = "Kidotel Radar".

## Temi
`:root` = chiaro. Override completi in `@media (prefers-color-scheme: dark)`, `html[data-theme="dark"]`, `html[data-theme="light"]` — **ognuno deve ridefinire anche `--ink`, `--brand-strong`, `--brand-soft`** (altrimenti su sistema scuro + tema manuale chiaro il wordmark resta chiaro su fondo chiaro → invisibile: bug risolto in v0.8.6).
