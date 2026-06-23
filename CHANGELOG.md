# Changelog — Kidotel Radar

Tutte le modifiche rilevanti. Formato: [versione] — data.

## [0.3.1] — 2026-06-23
### Aggiunto
- **Backup del database** (requisito): sidebar "Dati" → **Esporta backup** / **Importa backup** (file `.sqlite` completo, re-importabile). Verificato nel frontend.
- **Legenda colori sulla mappa** (≥70 verde · 40–69 ambra · <40/non valutato grigio).

## [0.3.0] — 2026-06-23
### Aggiunto
- **AiScorer via Cowork (ponte a lotti).** Sidebar "AI · Cowork": **Esporta lotto per AI** (gli hotel senza voto con sito → `kidotel-ai-batch.json`, con istruzioni+schema) e **Importa valutazioni AI** (`results.json` → voti nel DB, sorgente "ai-cowork"). Niente chiave API: l'AI gira in Cowork col tuo Claude e legge i siti in qualsiasi lingua. Contratto in `docs/COWORK-AI-SCORING.md`.
- Comandi Rust `import_ai_scores`, `read_text_file`; permesso `dialog:allow-open`.
- **Script deterministico `scripts/score-batch.mjs`**: valuta il lotto chiamando il `claude` di Claude Code (auth sottoscrizione, niente API key) — apre i siti con WebFetch, scrive `results.json`, riprendibile. Flag verificati con `claude --help`; logica verificata con stub (chunk/parse/scrittura/ripresa).
### Verificato
- Plumbing nel frontend: export costruisce il lotto coi soli hotel con sito senza voto (id corretti, istruzioni+schema); import chiama `import_ai_scores` e aggiorna l'archivio.
- Qualità AI dimostrata: Cavallino Bianco a regole 26 → l'AI (sola homepage) 62, con citazioni. Supera il tetto del crawl/lingue.
### Nota
- Il connettore MCP live (Cowork interroga il DB senza file) è il prossimo passo (v0.4): non verificabile da me ora, quindi non incluso finché non collaudato.

## [0.2.7] — 2026-06-23
### Aggiunto
- **Dizionario family-fit multilingue** (~70 lingue ufficiali di Stati sovrani, **3165 termini**) generato con workflow multi-agente, con filtro anti-falsi-positivi (no parole singole troppo generiche).
- **Struttura dati pulita**: i termini sono ora un file esterno `src-tauri/src/signals.json` caricato una volta dal motore (`signal_defs()` + OnceLock), invece che hard-coded. Più estensibile/manutenibile.
### Verificato (live, dati reali)
- Recupero migliorato senza effetti collaterali: Schwarzenstein 66→76, Cavallino Bianco 14→26; Feuerstein 86 e Sonnwies 66 invariati; hotel di città restano corretti (Greif 0, Laurin 14) → nessun falso positivo nonostante 3165 termini.
### Nota onesta
- Resta il tetto del crawl (siti JS/contenuti in pagine profonde): più lingue ≠ tutto risolto. La qualità mondiale piena è l'AiScorer (v0.3).

## [0.2.6] — 2026-06-23
### Aggiunto
- **Vista Mappa** (Leaflet + OpenStreetMap, nessuna chiave): pin di tutti gli hotel dell'area colorati per family-fit (verde ≥70, ambra 40–69, grigio sotto/non valutato), con popup nome+voto+sito. Selettore **Tabella ↔ Mappa**. Verificato nel frontend (Alto Adige).
- **Struttura del programma documentata** (`docs/ARCHITETTURA.md`): moduli netti e **valutatore sostituibile** (`Scorer`: regole oggi, AI/Cowork domani). Primo componente estratto: `MapView`.
### Nota
- Lo scoring a regole ha un tetto noto (grandi città / siti JS / lingue diverse → sotto-rileva): la qualità mondiale reale è il prossimo passo con l'AI (v0.3). Documentato, non nascosto.

## [0.2.5] — 2026-06-23
### Corretto
- **"Family-fit medio sempre 9" risolto.** Era una metrica sbagliata e calcolata sull'archivio: sostituita con statistiche utili e **calcolate sull'area corrente** → "Hotel trovati", "Valutati (su con-sito)", "Family hotel (≥70)". Verificato: su 3 hotel (2 col sito) → 3 / 2 / 1.
- **Molti siti davano "0 pagine" → voto 0** (es. Greif, Laurin): causa verificata = handshake TLS fallito con rustls su certi server. Passato al **TLS di sistema (native-tls)**, come il browser → quei siti ora scaricano le pagine (verificato: 200 OK).
### Note oneste (verificate su dati reali)
- Scoring a regole: family hotel veri segnano bene (Feuerstein 86, Sonnwies/Schwarzenstein 66), hotel di città bassi (Greif 0, Laurin 14) → discrimina correttamente. Limite: alcuni siti ricchi ma JS/strutturati diversamente vengono sottovalutati (es. Cavallino Bianco 14) — si supera con l'AI multilingua via Cowork (v0.3).

## [0.2.4] — 2026-06-23
### Corretto
- **La scansione mostra solo l'area cercata** (prima, dopo lo scan, mostrava l'intero archivio: cercando "Calabria"/"Trapani" si vedevano gli hotel dell'Alto Adige già valutati in cima). Verificato: scan di Calabria → solo hotel calabresi; gli hotel di altre aree spariscono.
- **Discovery robusta in tutto il mondo**: Overpass ora prova 3 server in cascata e gestisce risposte non-JSON/sovraccarico (prima Reykjavík e Bariloche davano "error decoding response body"; ora 6/6 destinazioni mondiali restituiscono hotel).
### Aggiunto
- Pulsante **"Mostra archivio salvato"**: per vedere tutti gli hotel raccolti (tutte le aree) accumulati nel database. All'avvio l'app mostra l'archivio salvato con etichetta dedicata.
### Verificato (live, dati reali)
- Scoperta mondiale: Queenstown 52, Cancún 157, Zanzibar 373, Reykjavík 81, Bariloche 137, Phuket 917.

## [0.2.3] — 2026-06-23
### Corretto
- **Stampa ora funziona davvero.** Prima usava `window.print()`, che nel webview Tauri (WebKit) è un no-op: il pulsante non faceva nulla. Ora genera un report HTML e lo apre nel browser di sistema (comando `open_report` via plugin opener), dove Stampa e "Salva in PDF" funzionano. Il report contiene tutte le righe filtrate (non solo le 500 a video).

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
