# STATO — Kidotel Radar

> Dove siamo adesso. Aggiornare **a ogni sessione/release**, prima di dire "fatto".

- **Versione:** `0.2.3` (installata su macOS)
- **Aggiornato:** 2026-06-23

## Fatto
- Scaffold Tauri v2 + Vite + React + TS in `~/dev/kidotel-radar`.
- Documentazione master di continuità (`MASTER.md` + `docs/`).
- Branding di base: nome "Kidotel Radar", identifier `co.kidotel.radar`.
- Impostazione i18n IT/EN (frontend) — struttura.
- Guscio UI: header (nome + versione + switch lingua), selettore aree, tabella risultati, footer "prova/zero dati inventati".
- Motore Rust: comando `discover` (Nominatim → bounding box → Overpass `tourism=hotel`) + storage SQLite + comandi backup export/import. *(stato esatto: vedi sotto)*

## Fatto v0.2 (2026-06-23) — family-fit, gratis e con prova
- Motore Rust `enrich_hotel`: crawl sito (robots-aware) + riconoscitore family **multilingue a regole** + **verifica verbatim** + punteggio 0–100 + breakdown in SQLite. Nessuna API.
- UI: colonna Family-fit (badge), pulsante "Valuta family-fit" a lotti con avanzamento, pannello "Prova", statistica family-fit medio.
- v0.2.1: barra **filtro/ordina/voto-min**, **Stampa** (→ anche PDF) ed **Esporta CSV** (finestra salva con nome).
- v0.2.2: **archivio persistente caricato all'avvio** (`list_hotels`), nuova scansione si somma, **valutazione ripartibile** (salta i già valutati), messaggio anti-vuoto sui filtri, cap 500 righe a video.
- **Build 0.2.0 fatta e installata** in `/Applications/Kidotel Radar.app` (firmata ad-hoc, precedente rimossa, app aperta). DMG: `src-tauri/target/release/bundle/dmg/Kidotel Radar_0.2.0_aarch64.dmg`.
- Script release riutilizzabile: `pnpm release` (o `node scripts/release.mjs [versione]`) — build → firma → installa nuova → cancella vecchia → apri.

## Verificato (2026-06-23)
- `cargo test` **3/3 verdi** (rimozione script/style; rilevamento con prova verificata = 66; nessun-segnale = 0).
- `cargo test --ignored live_discover_small_area`: **36 hotel reali** trovati a Ortisei via OSM (con siti).
- `pnpm build` **pulito** (tsc + vite) con la nuova UI di scoring.
- UI nel dev server: bilingue **IT/EN** + temi **chiaro/scuro** ok.
- Nota: scansione e valutazione reali girano nell'app Tauri (nel browser di anteprima `invoke` non è disponibile, atteso).

## Prossimo
- Su richiesta: **build `.dmg` 0.2.0** (installa nuova / cancella vecchia) per collaudo live sull'Alto Adige.
- Poi v0.3 (server MCP per Cowork). Dettaglio in ROADMAP.md.

## Note operative
- DB locale in app-data dir (`co.kidotel.radar`).
- Nessun remote configurato (git solo locale finché non deciso diversamente).
- `.exe` Windows: rimandato a CI/macchina Windows (vedi ROADMAP).
