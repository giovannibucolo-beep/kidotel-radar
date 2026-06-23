# ROADMAP — Kidotel Radar

> Incrementi additivi: ogni versione fa una cosa in più, sempre funzionante. Un milestone per volta.

## v0.1 — Scoperta (in corso)
- Guscio app Tauri + UI bilingue + versione mostrata.
- Selettore aree (mondo → continente → paese → regione/città) con ricerca.
- Motore SCOPRI: Nominatim (bbox) → Overpass (`tourism=hotel`) → SQLite.
- Tabella risultati (nome, località, sito, sorgente).
- Backup export/import del database.
- Icona dal brand (provvisoria fino ai colori reali).

## v0.2 — Arricchimento + punteggio (con prova)
- Crawl del sito ufficiale (robots-aware, rate-limit, cache).
- Estrazione family con Claude → JSON con **citazione verbatim** obbligatoria.
- **Verifica verbatim** della citazione nel testo (scarta se assente).
- `family_fit_score` + `score_breakdown` salvati e mostrati (badge colorati + riquadro "Prova").
- Impostazioni: chiave API Claude (salvata in locale/keychain), lingua, limiti.

## v0.3 — Scala e qualità
- Coda continua + ripresa (scansioni grandi, mondo a tappe per priorità).
- Dedup (URL/telefono canonici, fuzzy nome + distanza).
- Mappa di copertura + filtri (servizi, punteggio, paese).
- Google Places opzionale per arricchire mercati scelti (solo `place_id`).

## v0.4 — Distribuzione
- Release script: bump versione → build → installa nuova → cancella vecchia → aggiorna CHANGELOG/STATO.
- **CI GitHub Actions** per build `.dmg` (macOS) **e** `.exe`/`.msi` (Windows).
- Updater in-app ("pmu") con feed di aggiornamento (da definire hosting).

## Più avanti (valutare)
- Triage/verifica umana semi-automatica per il team.
- SEO programmatico: ogni hotel una pagina-profilo da reclamare (lato sito kidotel.co).
- Outreach GDPR-safe (solo dopo sign-off legale).
