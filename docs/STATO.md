# STATO — Kidotel Radar

> Dove siamo adesso. Aggiornare **a ogni sessione/release**, prima di dire "fatto".

- **Versione:** `0.1.0` (in sviluppo)
- **Aggiornato:** 2026-06-23

## Fatto
- Scaffold Tauri v2 + Vite + React + TS in `~/dev/kidotel-radar`.
- Documentazione master di continuità (`MASTER.md` + `docs/`).
- Branding di base: nome "Kidotel Radar", identifier `co.kidotel.radar`.
- Impostazione i18n IT/EN (frontend) — struttura.
- Guscio UI: header (nome + versione + switch lingua), selettore aree, tabella risultati, footer "prova/zero dati inventati".
- Motore Rust: comando `discover` (Nominatim → bounding box → Overpass `tourism=hotel`) + storage SQLite + comandi backup export/import. *(stato esatto: vedi sotto)*

## Verificato (2026-06-23)
- `cargo check` **pulito** (tauri + reqwest + rusqlite, exit 0).
- `pnpm build` **pulito** (tsc + vite).
- Set icone generato da `icon.svg` (icns macOS, ico Windows, png).
- UI verificata nel dev server: bilingue **IT/EN** (ogni stringa) + temi **chiaro/scuro** ok.
- Nota: la scansione reale (`invoke discover`) gira solo nell'app Tauri, non nel browser di anteprima.

## Prossimo passo (milestone v0.2)
- Fase **ARRICCHISCI**: crawl del sito ufficiale (robots-aware, cache) + estrazione family con Claude (JSON, citazione obbligatoria) + **verifica verbatim** della citazione.
- Calcolo `family_fit_score` + `score_breakdown` salvati nel DB.
- Schermata impostazioni con inserimento **chiave API Claude**.

## Note operative
- DB locale in app-data dir (`co.kidotel.radar`).
- Nessun remote configurato (git solo locale finché non deciso diversamente).
- `.exe` Windows: rimandato a CI/macchina Windows (vedi ROADMAP).
