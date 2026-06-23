# Changelog — Kidotel Radar

Tutte le modifiche rilevanti. Formato: [versione] — data.

## [0.2.2] — 2026-06-23
### Aggiunto
- **Persistenza visibile**: all'avvio l'app carica l'archivio salvato (comando `list_hotels`) — gli hotel raccolti e i voti restano tra le sessioni; una nuova scansione si somma all'archivio.
- **Valutazione ripartibile**: "Valuta family-fit" salta gli hotel già valutati (salvataggio incrementale: puoi fermarti e riprendere).
- Messaggio chiaro quando i filtri non mostrano nulla (es. "Solo con voto" senza voti ancora calcolati); limite di 500 righe a video (export/stampa restano completi) con nota di troncamento.
### Corretto
- Con "Solo con voto" attivo e nessun voto, la tabella ora spiega cosa fare invece di restare vuota.

## [0.2.1] — 2026-06-23
### Aggiunto
- Vista risultati con barra strumenti: filtro **Solo con voto**, **ordinamento** (Family-fit ↓ / Nome), **voto minimo**, conteggio "Mostrati".
- **Stampa** (con layout dedicato, anche → PDF dalla finestra di stampa) ed **Esporta CSV** (UTF-8, separatore `;`, apribile in Excel) tramite finestra "salva con nome".
- Plugin `tauri-plugin-dialog` + comando `write_text_file` + permesso `dialog:allow-save`.

## [0.2.0] — 2026-06-23 (compilata e installata su macOS)
### Aggiunto
- Build `.app` + `.dmg` (aarch64), firmata ad-hoc, installata in `/Applications`. Script `pnpm release` (build → firma → installa nuova → cancella vecchia → apri).
- Fase **ARRICCHISCI/VALUTA** nel motore Rust (comando `enrich_hotel`): crawl del sito ufficiale (robots-aware, homepage + fino a 2 pagine "famiglia"), riconoscitore family **multilingue a regole** (IT/EN/DE/ES/FR), **verifica verbatim** della citazione, punteggio `family_fit_score` 0–100 + `score_breakdown` salvati in SQLite. Nessuna API, costo zero.
- UI: colonna **Family-fit** (badge colorato), pulsante "Valuta family-fit" con valutazione a lotti (5 in parallelo) e avanzamento, pannello **Prova** (servizi con citazione + link, e "non dichiarato" per gli assenti), statistica "Family-fit medio", didascalia area.
- Test: 3 unit test del motore di punteggio (rimozione script/style, rilevamento con prova verificata = 66, nessun-segnale = 0) + 1 test live di scoperta (Ortisei: 36 hotel reali da OSM). Tutti verdi.

## [0.1.0] — non ancora rilasciata (in sviluppo)
### Aggiunto
- Scaffold Tauri v2 + Vite + React + TypeScript.
- Documentazione master di continuità (`MASTER.md`, `docs/STATO.md`, `docs/DECISIONI.md`, `docs/ROADMAP.md`).
- Branding "Kidotel Radar" + identifier `co.kidotel.radar` + icona provvisoria.
- i18n IT/EN (frontend) con switch lingua.
- Guscio UI: header con versione, selettore aree, tabella risultati, footer.
- Motore Rust: comando `discover` (Nominatim → Overpass), storage SQLite, backup export/import.
