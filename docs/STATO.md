# STATO — Kidotel Radar

> Dove siamo adesso. Aggiornare **a ogni sessione/release**, prima di dire "fatto".

- **Versione:** `0.3.0` (installata su macOS)
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
- v0.2.3: **Stampa funzionante** (`open_report`: report HTML aperto nel browser; `window.print()` è no-op in Tauri).
- v0.2.4: **scansione = solo l'area** (non più l'archivio intero) + pulsante "Mostra archivio salvato"; **Overpass con 3 server in cascata** (mondiale robusto). Scoperta mondiale verificata live (6/6 destinazioni).
- v0.2.5: statistiche **per-area** utili (Valutati, Family hotel ≥70) al posto della "media sempre 9"; **TLS di sistema (native-tls)** → recuperati i siti che davano 0 pagine. Diagnostica scoring verificata su hotel reali (family 66-86, città 0-14).
- v0.2.6: **Vista Mappa** (Leaflet/OSM, pin colorati per family-fit) + selettore Tabella↔Mappa; `docs/ARCHITETTURA.md` (struttura solida, valutatore sostituibile); primo componente estratto `MapView`.
- v0.2.7: **dizionario multilingue** (~70 lingue, 3165 termini) come file dato `src-tauri/src/signals.json` caricato dal motore (`signal_defs()`); filtro anti-falsi-positivi; verificato live (recupero su, città non gonfiate). Script `scripts/build-signals.mjs` rigenera il file dall'output del workflow.

- v0.3.0: **AiScorer via Cowork** (ponte a lotti export/import) — `docs/COWORK-AI-SCORING.md`; comandi `import_ai_scores`/`read_text_file`; dimostrato che l'AI supera le regole (Cavallino 26→62 con citazioni).

## Prossimo passo
- **v0.4 — connettore MCP live**: server MCP nell'app, Cowork interroga il DB e scrive i voti senza file a mano (non verificabile headless da me → da collaudare insieme).
- Refactor Rust in moduli `discovery`/`crawl`/`scoring` con interfaccia `Scorer` (oggi: RuleScorer + AiScorer-via-import).
- Estrarre componenti frontend (Sidebar, Stats, ResultsTable, ProofPanel, Toolbar).
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
