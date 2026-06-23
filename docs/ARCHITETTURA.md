# ARCHITETTURA — Kidotel Radar

> La "struttura solida" del programma. Si costruisce additivamente su questa base.
> Principio: ogni responsabilità in un modulo; il **valutatore è sostituibile** (regole oggi, AI domani).

## Pipeline
```
SCOPRI → ARRICCHISCI → VALUTA → SALVA → MOSTRA (tabella / mappa)
```

## Backend (Rust, in `src-tauri/src/`)
Stato attuale: tutto in `engine.rs` + `db.rs`. **Direzione (prossimo passo strutturale):** spezzare in moduli netti.

- **`discovery`** — Nominatim (bbox del luogo) + Overpass (`tourism=hotel`), 3 server in cascata. Mondiale.
- **`crawl`** — fetch del sito (TLS di sistema/native-tls, robots-aware) + `html_to_text`.
- **`scoring`** — **interfaccia `Scorer`** (punto chiave dell'estensibilità):
  - `RuleScorer` (oggi): parole-chiave multilingue + citazione verbatim verificata. Gratis. Limite: sotto-rileva siti JS/grandi catene/lingue non coperte.
  - `AiScorer` (v0.3, via Cowork/Claude MCP): legge qualsiasi sito/lingua. È il vero motore di qualità mondiale.
  - Output comune: `family_fit_score` 0–100 + `score_breakdown` (segnali con prova).
- **`db`** — SQLite locale: tabella `hotels` (incl. lat/lon, score, breakdown, enrichment). Backup = file.

## Frontend (React/TS, in `src/`)
- **`App.tsx`** — orchestrazione + stato.
- **`components/`** — `MapView` (fatto). Da estrarre: `Sidebar`, `Stats`, `ResultsTable`, `ProofPanel`, `Toolbar`.
- **`i18n/`** — dizionari IT/EN; ogni stringa passa da `t()`.
- **Vista risultati**: **Tabella ↔ Mappa** (Leaflet + OpenStreetMap, pin colorati per family-fit).

## Dati: tabella `hotels`
`osm_type+osm_id` (chiave), name, city, country, website, phone, lat, lon, source,
`family_fit_score`, `score_breakdown` (JSON segnali+prove), `enrichment` (JSON), timestamps.

## Principi non negoziabili (vedi MASTER.md)
- Zero dati inventati: ogni dato family ha la citazione verbatim verificata; o c'è la prova, o è "non dichiarato".
- Verifica al 100% prima di affermare ([[verifica-sempre-le-affermazioni]]); non esporre funzioni non funzionanti ([[non-mostrare-funzioni-rotte]]).
- Mondiale, bilingue IT/EN, local-first, installabili autosufficienti, versione sempre indicata.

## Limite noto e rotta di qualità
Lo scoring a regole ha un tetto (grandi città / siti JS / lingue diverse → sotto-rileva). La qualità mondiale **reale** arriva con `AiScorer` (v0.3): è la priorità dopo aver consolidato la struttura.
