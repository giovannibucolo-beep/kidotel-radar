# Changelog — Kidotel Radar

Tutte le modifiche rilevanti. Formato: [versione] — data.

## [0.8.27] — 2026-06-25
### Corretto — il ticker e la didascalia archivio ora si TRADUCONO; scorrimento più fluido
- **Testo non tradotto** (ticker «Assegnazione stelle: … controllati …» e «Archivio salvato — pagina X/Y» restavano in italiano in un'app russa): erano **stringhe già tradotte salvate in stato**, congelate nella lingua di quando venivano create; cambiando lingua non si ri-traducevano. Ora avanzamenti delle scansioni e didascalia archivio sono **funzioni `(t, lang) → testo`** valutate al RENDER → si traducono **al volo**, anche a scansione in corso (es. IT «Assegnazione stelle… rimasti» → RU «Присвоение звёзд… осталось», numeri formattati nella lingua corrente). Tipo `LiveMsg`; `runCompleteCountry` prende un prefisso-funzione invece di una stringa pre-tradotta.
- **Ticker più fluido, senza spazio vuoto**: con poche/corte voci le ripetiamo (≥4 istanze) per riempire il nastro → niente più grande vuoto; due metà identiche + scorrimento di -50% = loop continuo da destra a sinistra senza salti; durata stabile (non si resetta ad ogni aggiornamento dei dati).
- **Audit completezza trilingue (tutto in IT/EN/RU)**: parità chiavi i18n verificata a tappeto (**275 × 3**, nessuna mancante) e Guida 13 sezioni + 28 «Novità» tutte tradotte. Caccia alle stringhe hardcoded (workflow multi-agente con verifica avversariale): corrette le 3 trovate — chip «LIVE» (RU «В ЭФИРЕ»), «hotel» nell'intestazione di stampa, «family» nella riga paese di «Sfoglia». Ora passano da `t()`.
### Verificato
- `tsc` pulito; parità i18n 275×3 OK; anteprima: ticker avviato in IT, **cambiando lingua a RU si è tradotto sul posto** mantenendo i numeri live; chip «LIVE»→«В ЭФИРЕ»; nastro riempito (1 voce → 4 ripetizioni) e scorrevole; «Ход оценивания 79 443 / 79 443 — 100%» coerente; 0 errori console.

## [0.8.26] — 2026-06-25
### Corretto — numeri coerenti + la scansione non si blocca più sull'Austria
- **Avanzamento valutazione incoerente (>100%)**: mostrava «valutati / con-sito» (es. 79.443 / 79.416, numeratore > denominatore!). Causa: l'upsert al ri-scan faceva `website = excluded.website`, **azzerando il sito** di un hotel già valutato quando OSM non lo riportava più → restavano hotel con voto ma senza sito (scored > with_site). **Doppia correzione**: (a) l'upsert ora **preserva** l'ultimo sito/telefono conosciuto (`COALESCE(NULLIF(excluded.website,''), hotels.website)`), così non si perde più il sito; (b) l'avanzamento ora è **valutati / (valutati + in-coda)** — denominatore = già valutati + ancora da valutare (sito presente, voto mancante): non supera mai il 100%. Nuovo campo `to_score` in `score_stats`.
- **«Completa tutti» si bloccava sempre sull'Austria**: se un paese falliva (Nominatim/Overpass momentaneamente giù) l'eccezione **fermava l'intero giro del mondo** col cursore bloccato PRIMA di quel paese → ad ogni riavvio si ritentava sempre lo stesso. Ora un paese che fallisce viene **saltato** e la scansione **prosegue avanzando il cursore** (il paese si ritenta al giro successivo); `list_subareas` degrada con 0 regioni invece di lanciare. Stessa resilienza per «Completa continente». Così la copertura **progredisce davvero** verso tutti i paesi.
### Verificato
- `tsc` + `cargo test` 13/13 puliti; anteprima (mock): avanzamento «79.443 / 79.443 — 100%» (coda 0) e «79.443 / 100.000 — 79%» (coda 20.557), mai più numeratore > denominatore; 0 errori console.

## [0.8.25] — 2026-06-25
### Aggiunto — metodo del punteggio nella Guida + ticker «breaking news» delle scansioni
- **Metodologia del family-fit nella Guida** (nuova sezione trilingue): spiega QUALI fattori valutiamo, con QUALE peso e PERCHÉ, e quindi perché si arriva a un certo voto. Pesi reali (somma 100, presi da `signals.json`): Miniclub/animazione 22 · Strutture bimbi 18 · Camere family 14 · Childcare 12 · Menù bimbi 10 · Attività per età 10 · Sicurezza 8 (+ Recensioni 6, riservato). Ribadito: ogni servizio conta solo con la frase del sito verificata parola per parola (in «Prova»); niente sito = 0; nessun dato inventato.
- **Ticker «breaking news» delle scansioni in corso**: il banner di avanzamento ora è una barra scura con chip **● LIVE** in cui SCORRONO insieme le diverse scansioni attive — Copertura, Stelle, Valutazione — ognuna coi suoi **dati aggiornati in tempo reale**. Avanzamenti separati per canale (`covNote`/`starsNote`/`enrichNote`): non si sovrascrivono più a vicenda quando girano in parallelo. On-brand (ink + peach), si mette in pausa al passaggio del mouse, rispetta `prefers-reduced-motion`.
### Verificato
- `tsc` pulito; anteprima (mock, 2 scansioni in parallelo): ticker con «● LIVE» e DUE voci che scorrono — «Valutazione family-fit: 1560 valutati · 53.440 rimasti» + «Assegnazione stelle: 10.500 controllati · 2100 classificati · 129.311 rimasti» — con numeri che salgono live; sezione Guida «Come si calcola il punteggio (metodo)» con i pesi 22·18·14·12…; 0 errori console. i18n it/en/ru.

## [0.8.24] — 2026-06-25
### Corretto/Migliorato — il CRM mostra TUTTO l'archivio contattabile (non più 5000)
- Il CRM mostrava solo gli hotel della pagina d'archivio caricata (**max 5000**). Ora carica **tutto l'archivio contattabile** (hotel con email/sito/telefono) tramite un nuovo comando **`select_crm`** — riga LEGGERA (niente `score_breakdown`/`enrichment`, che per decine di migliaia di righe peserebbero centinaia di MB), così si possono caricare anche 50–100k contatti in fretta.
- **Filtri cumulabili** (già presenti) ora operano sull'INTERO set: paese, stelle ★, family-fit ≥, valore atteso ≥ €, solo email recapitabile + i chip di stato. Conteggio e **valore atteso totale** sono sull'intero archivio contattabile. La tabella ne renderizza al massimo `renderCap` (impostazioni) con la nota «Mostro i primi N / Totale — restringi con i filtri».
- Dataset CRM **disaccoppiato** dalla pagina d'archivio (stato `crmRows` dedicato, caricato a ingresso vista con indicatore di caricamento + «aggiorna»). `contactable` memoizzato (niente ri-ordino a ogni tasto su set enormi).
### Verificato
- `tsc` + `cargo build` puliti; anteprima (mock 7000 contatti): il CRM conta **7000 · € 2.327.355** (non 5000), nota «Mostro i primi 500 / 7000»; filtri cumulabili → paese «Switzerland» 1166, + family-fit ≥ 80 = 466 (stack corretto); 0 errori console. i18n it/en/ru.

## [0.8.23] — 2026-06-25
### Aggiunto — Manuale in-app con SCREENSHOT auto-aggiornati ad ogni release
- La Guida integrata ora mostra, sotto le sezioni principali (Hotel, Copertura, CRM, Infografica), uno **screenshot reale dell'interfaccia** nella lingua dell'app (IT/EN/RU).
- **`scripts/capture-manual.mjs`** (Playwright): avvia il dev server, carica l'app in un browser headless con **dati finti** (mock dell'invoke Tauri → niente backend, niente dati reali/email: manuale pulito e riproducibile), naviga ogni vista e salva i PNG in `public/manual/<vista>.<lingua>.png` (12 immagini: 4 viste × 3 lingue).
- **Integrato nel rilascio**: `release.mjs` rigenera gli screenshot **prima** del build → il manuale riflette sempre l'interfaccia di QUESTA versione («sempre allo stato dell'arte»). Best-effort: se la cattura fallisce, si usano gli ultimi disponibili senza bloccare il rilascio.
- Guida: campo `shot?` sulle sezioni; `<img>` con la lingua corrente, lazy + fallback che nasconde l'immagine se manca. CSS `.guide-shot`. `playwright` aggiunto come devDependency.
### Verificato
- `tsc` pulito; cattura eseguita: **12 PNG** generati; anteprima: la Guida mostra lo screenshot della vista Hotel (badge ★/€/family-fit) sotto la sezione, immagini servite 200 in IT/EN/RU, lazy-load + fallback ok, 0 errori console.

## [0.8.22] — 2026-06-25
### Aggiunto — copertura del mondo: aggiungi paesi + scansione a RIPRESA
- **Aggiungi paese (con ricerca)**: in «Copertura», un selettore con ricerca su **~190 paesi del mondo** (lista canonica `WORLD_COUNTRIES`, nome + continente, con alias di query Nominatim per i nomi «difficili» tipo *Russian Federation → Russia*). Si può scegliere e scansionare anche **paesi non ancora in archivio** — non più solo quelli già scoperti. I nuovi paesi si raggruppano nel continente giusto (niente più «(altro)»).
- **«Completa tutti» ora copre TUTTO il mondo e RIPRENDE**: prima iterava solo i paesi già in archivio e **ripartiva sempre dall'Europa** → impossibile coprire tutto. Ora itera l'intera lista mondiale e usa un **cursore di ripresa** (localStorage, per nome-paese): riparte dal **paese successivo all'ultimo completato**. In UI: «riprende da: <paese>» + «ricomincia da capo». Combinato con l'incrementale (regioni già fatte <30gg saltate).
- La query Nominatim usa l'alias quando serve, ma il paese **timbrato** sugli hotel resta il nome canonico (la copertura non si sdoppia).
### Confermato — la .exe Windows si genera a OGNI dmg
- Il flusso di release (da 0.8.20) committa+tagga ad ogni dmg → la CI costruisce la .exe: nessuna dmg senza .exe. (Parte solo con repo pubblico o billing CI attivo.)
### Verificato
- `tsc` pulito; anteprima (IT/EN/RU): selettore paese con **193 voci** (inclusi nuovi: Iceland, Madagascar…), pulsante «Aggiungi e scansiona», «riprende da: <paese>» corretto (cursore «Germany» → Gibraltar; «Italy» → Kosovo) e reset «ricomincia da capo» che azzera il cursore; 0 errori console. Sezione Guida + 2 voci «Novità» trilingui.

## [0.8.21] — 2026-06-25
### Corretto — la scansione stelle veloce ora si attiva DAVVERO
- Il frontend chiedeva ancora blocchi da **180** alla ri-scansione stelle: con 180 il backend resta a **un solo blocco** (1 endpoint) e la concorrenza introdotta in 0.8.20 non entrava in gioco. Ora chiede **700** → 4 query concorrenti (una per mirror Overpass) → il **~3,8×** misurato si applica anche nell'app installata.
- `release.mjs`: controllo di esistenza del tag «silenzioso» (niente riga `fatal:` al primo tag di una versione).
### Verificato
- `tsc` pulito; lo stesso percorso (limite 700 → 4 blocchi) è quello provato live in 0.8.20 (700 hotel in ~42s).

## [0.8.20] — 2026-06-25
### Aggiunto — Fascia di costo € → €€€€€ (il classico $ → $$$$$)
- Ogni hotel ha ora un **indicatore di costo a 5 livelli** (€ economico → €€€€€ molto caro), accanto a stelle e voto. **COMBINATO** (scelta dell'utente): se il sito pubblica una fascia di prezzo strutturata (schema.org **`priceRange`**) usiamo quel **dato REALE** — il tooltip mostra il prezzo a notte stimato e la **citazione verbatim** dal sito (badge più marcato); altrimenti una **STIMA** da segnali reali — stelle ★ (OSM) + lusso + indice costo-vita del paese (badge più tenue). **Nessun prezzo inventato.**
- Backend: `extract_price` legge `priceRange` (simboli «€€€» → livello, o fascia numerica «120-300»/«€90 - €140» → prezzo a notte → livello), con conversione valuta grezza e gestione separatori migliaia/decimali. Salvato in `price_tier`/`price_eur`/`price_src` durante la valutazione (in `enrich_batch`/`enrich_hotel`, dove già si scarica il sito). Frontend `priceTierOf` per la stima + badge €→€€€€€ (pip pieni/tenui, reale/stima). i18n `price.*` it/en/ru; sezione Guida trilingue.
### Migliorato — ri-scansione STELLE «ultra-veloce»
- La classificazione ★ (da OSM, pulsante «Assegna stelle») ora scarica **in parallelo con rotazione degli endpoint**: pochi blocchi grandi (uno per mirror Overpass, una sola ondata) invece di un'unica query sequenziale → **≈3,8× più veloce** (misurato live: **700 hotel in ~42s, ≈17 hotel/s**, prima ≈4–7/s). Client Overpass **condiviso**, timeout brevi con failover. I **blocchi falliti vengono ritentati** (restano `stars=NULL`) invece di marcare gli hotel «senza stelle».
### Aggiunto — la .exe Windows si genera a ogni release (come la dmg)
- `scripts/release.mjs`: dopo dmg+install, **committa il rilascio** (messaggio dal CHANGELOG) e **spinge branch+tag** → GitHub Actions costruisce la **.exe** (+ .dmg) e le allega a una **release in bozza**, **ripulendo le bozze vecchie**. Tutto best-effort: se manca remote/`gh` o la CI è bloccata (repo privato/billing), il rilascio macOS resta completo. (La .exe non si costruisce su macOS: la fa la CI.)
### Corretto
- `applyRows` (elenco piatto) non passava le nuove colonne prezzo all'oggetto Hotel → il prezzo REALE non sarebbe comparso nell'Elenco. Allineato a `hotelRowToHotel`.
### Verificato
- `cargo test` 13/13 (incl. nuovo `extract_price_reads_schema_pricerange`) + **live**: `live_backfill_stars` (700 in 42s) e `live_score_samples` (estrazione reale: Hotel Schwarzenstein → `priceRange «€€€€»` → livello 4). `tsc` + `vite build` puliti.
- **Anteprima (mock dati)**: badge €→€€€€€ reso su 4 hotel di prova — reale vs stima, pip pieni/tenui leggibili a colpo d'occhio — con tooltip corretti e **localizzati IT/EN/RU**; sezione Guida «Уровень цен / Price range / Fascia di costo» presente; 0 errori console.

## [0.8.19] — 2026-06-25
### Aggiunto — Manuale completo in russo
- **Guida/manuale interamente in russo**: tutte le **11 sezioni** della Guida e le voci **«Novità»** ora tradotte in russo (workflow multi-agente in parallelo: 22 stringhe Guida + 16 voci changelog). Il russo non ripiega più sull'inglese (`s[lang] ?? s.en`).
- **Allineamento ai nomi reali dei pulsanti dell'app**: i riferimenti nel manuale russo combaciano con l'UI tradotta — «Измерить», «Завершить 100%», «Остановить», «Люкс», «Написать email», «Оценить family-fit», «По странам» (riconciliati con `src/i18n`, niente più termini italiani residui dei traduttori).
- Aggiunta voce «Novità» di testa («Manuale completo in russo…») e rimossa la promessa ormai obsoleta «il manuale verrà tradotto a breve».
### Corretto
- **`src/App.tsx` conteneva 2 byte NUL** (sentinella usata come «nessun paese → nessun match») che rendevano il file **binario** per grep e per `file` (classificato «data»). Sostituiti con l'escape testuale `"\u0000"`: **stesso identico comportamento a runtime**, ma sorgente di nuovo UTF-8 valido.
### Verificato
- `tsc` pulito; anteprima (RU): Guida aperta → **tutte le 11 sezioni + le voci Novità rese in russo**, **0 leak italiani** e nomi pulsanti coincidenti con l'UI reale (verifica a runtime sul DOM), **0 errori** in console.

## [0.8.18] — 2026-06-25
### Aggiunto — Recensioni per hotel (import) + traducibili
- Nuova tabella `reviews` + comandi `import_reviews` (JSON da Cowork: `{reviews:[{id,author,rating,text,source,date}]}`; re-import = sostituisce le recensioni dell'hotel), `get_reviews`, `review_counts`. Voce **Dati ▾ → Importa recensioni** (gruppo «Recensioni»). Esempio in `docs/reviews-sample.json`.
- Le recensioni compaiono **espandendo la riga** dell'hotel (`ReviewsPanel`): voto ★, autore, fonte, data, testo + pulsante **«Traduci»** (riusa il motore di traduzione). Badge col **numero** di recensioni nell'elenco (icona Heroicon chat). La riga è espandibile anche per soli hotel con recensioni (senza voto).
### Verificato
- `tsc` + `cargo build` puliti; build di produzione ok; anteprima: voce «Импорт отзывов» nel menu Dati (RU), 0 errori (display recensioni su dati reali nell'app).

## [0.8.17] — 2026-06-25
### Aggiunto — Traduzione automatica delle prove
- Comando `translate` (servizio gratuito senza chiave, auto-rileva la lingua di origine) → pulsante **«Traduci»** sotto ogni citazione nel pannello Prove: la rende nella lingua dell'app (IT/EN/RU). L'**originale verbatim resta sempre visibile** (la prova non si tocca). i18n `tr.*` it/en/ru.
- È la base anche per la futura traduzione delle reviews.
### Verificato
- `cargo test` 12/12 + **test live** `live_translate` (DE→IT «Camere per bambini e famiglie», IT→RU «миниклуб и детское меню»); `tsc` pulito.

## [0.8.16] — 2026-06-24
### Aggiunto — CRM mirato (redditività) + paginazione
- **CRM · targeting**: barra di filtri per concentrarsi sui prospect più redditizi — **paese**, **stelle ★** (≥3/≥4/5), **family-fit ≥**, **valore atteso ≥ €**, **solo email recapitabile**. In fondo, conteggio + **valore atteso totale** del gruppo filtrato (la pipeline che stai puntando). I filtri si combinano con i chip di stato. (Operano sul set caricato = i migliori per voto.)
- **Paginazione archivio**: l'elenco piatto si sfoglia a **pagine da 5000** (← Precedente / Successiva →, «pagina i di N») — non più solo i primi 5000. `list_hotels` ora accetta `offset`; `loadArchive(page)`.
### Verificato
- `tsc` + `cargo build` puliti; anteprima 0 errori. CRM/paginazione si vedono con dati reali sull'app installata (in anteprima senza Tauri restano vuoti).

## [0.8.15] — 2026-06-24
### Aggiunto/Corretto — scansione incrementale, tutti i continenti, stelle in-app, misura salvata
- **Scansione INCREMENTALE**: ogni regione scansionata viene registrata (`scan_log`); «Completa» (paese/continente) **salta le regioni già fatte negli ultimi 30 giorni** invece di rifarle da capo → riprese rapide. (`discover_area` → `mark_area_scanned`; comando `areas_scanned_within`.)
- **«Completa tutti i continenti»**: nuovo pulsante in Copertura che completa tutti i continenti in sequenza (sfruttando l'incrementale per saltare il già fatto).
- **«Assegna stelle (da OSM)»**: ri-scansione del database per la classificazione a ★ **direttamente dall'app** (comando `backfill_stars` a blocchi, con avanzamento e Ferma) — prima esisteva solo come script.
- **Misura di copertura PERSISTITA**: `osm_hotel_count` salva il conteggio OSM in `coverage_meta`; all'avvio si ricarica (`osm_counts`). Prima «Austria 100%» spariva chiudendo l'app.
### Verificato
- `cargo test` 12/12; `tsc` pulito; anteprima: pulsanti «Завершить все континенты» / «Присвоить звёзды» resi in Copertura (RU), 0 errori. La logica di rete (incrementale/stelle/misura) gira sull'app installata; il meccanismo stelle era già provato live (script: 71/180).

## [0.8.14] — 2026-06-24
### Aggiunto — Terza lingua: RUSSO 🇷🇺
- L'intera interfaccia (235 stringhe) è ora tradotta anche in **russo**; selettore lingua in alto **IT · EN · RU** (anche nelle Impostazioni). `Lang` = it|en|ru, persistito. Termini tecnici mantenuti (Kidotel, family-fit, CRM, Cowork, OpenStreetMap, €, ★…).
- Traduzione prodotta con un workflow multi-agente (6 traduttori in parallelo), parità chiavi 235/235 verificata.
- La **Guida/manuale** ripiega temporaneamente sull'inglese per il russo (tradurrò il manuale nel prossimo step, con l'espansione in manuale completo).
### Verificato
- `tsc` pulito (dizionario trilingue, parità chiavi); anteprima: UI in russo **verificata via screenshot** (menu, statistiche, toolbar, footer), 0 errori console.

## [0.8.13] — 2026-06-24
### Corretto — Non si vedeva più la progressione di «Completa» (paesi/continenti)
- L'auto-chiusura dei banner dopo 6s (introdotta in 0.8.3) cancellava anche il banner di **progressione in tempo reale** della scansione per paese/continente — ma una regione può durare fino a 240s, quindi il banner «regione 3/20 — +240 nuovi» spariva dopo 6s e restava vuoto fino alla regione successiva. Ora il banner **resta visibile mentre una scansione/completamento/valutazione è in corso** (`covBusy`/`loading`/`enriching`); i messaggi transitori continuano a chiudersi da soli quando si è inattivi.

## [0.8.12] — 2026-06-24
### Cambiato — I riquadri in alto ora sono GLOBALI (non più della sola vista)
- Prima «Valutati» mostrava i conteggi della **vista caricata** (max 5000 righe) → inutile mentre sfogli l'archivio. Ora i tre riquadri leggono i totali dell'**intero archivio** (da `score_stats`): **Hotel trovati** = totale in archivio, **Valutati** = valutati **/ totale**, **Family hotel** = totale family ≥ soglia. Rimosse le statistiche per-vista (withSite/scoredInView/…). Il conteggio della singola scansione resta nell'etichetta dell'area e nell'elenco.

## [0.8.11] — 2026-06-24
### Aggiunto — Classificazione internazionale a stelle (★1–5 + Lusso)
- Ogni hotel mostra la **classificazione ufficiale a stelle** (★1–5) presa dal tag OSM `stars` (dove c'è — ~28–40% degli hotel), con bollino **«Lusso»** per i 5★ Superior. Dato REALE, non inventato: dove manca non si mostra nulla. È **distinto** dal voto family-fit (categoria vs adeguatezza alle famiglie).
- Catturata in fase di scansione (`parse_stars`: gestisce "4S"/"5S"/Superior; lusso = 5★ Superior o `luxury=yes`); preservata al ri-scan (COALESCE). Colonne `stars`/`luxury` nel DB. Inclusa nell'export JSON.
- **Backfill** per gli hotel già in archivio: `scripts/backfill-stars.mjs` (interroga OSM per osm_id a blocchi, resumibile). Provato sul DB reale: 71/180 hotel classificati nel primo blocco.
### Verificato
- `cargo test` 12/12 (incl. `parse_stars`); `tsc` pulito; markup ★/Lusso verificato in anteprima; backfill provato live (scrive `stars`/`luxury` corretti).

## [0.8.10] — 2026-06-24
### Corretto — La mappa «rimbalzava» e non era navigabile
- La mappa rifaceva il **fitBounds a ogni re-render** (es. l'aggiornamento statistiche ogni 4s e durante la valutazione), riportando di continuo la vista all'inquadratura automatica: appena spostavi/zoomavi, «si restringeva» da sola. Ora il **fitBounds avviene SOLO quando cambia l'area** (nuova scansione/paese); i marker si **ricolorano** quando cambiano i voti senza toccare zoom/posizione. Pan e zoom restano dove li metti. (`MapView.tsx`, firme geoSig/colorSig.)

## [0.8.9] — 2026-06-24
### Corretto — LA VERA causa del «la valutazione si blocca» 🎯
Diagnosi empirica sul database reale (test `live_enrich_real_batch`): non erano i timeout, era un **panic nel parser**.
- **`extract_family_links` andava in panic** (slicing di stringa con indici di byte fuori limite / non su confine di carattere) su HTML reale con virgolette non chiuse o caratteri multibyte (frequente sui siti tedeschi). Quando `enrich_hotel` va in panic dentro un comando Tauri, **l'`invoke` non si risolve mai → il worker resta appeso → la coda si svuota → valutazione completamente ferma**. E gli hotel «velenosi», essendo in cima alla coda (ordinata per `osm_id`), venivano ri-presi a ogni giro. Riscritta la funzione lavorando **sui byte** con `from_utf8_lossy` (mai panic). Test di regressione aggiunto.
### Cambiato — Valutazione in blocchi (architettura)
- Nuovo comando **`enrich_batch`**: legge un blocco di non valutati, **scarica e valuta i siti in parallelo** (un task per hotel, client condiviso, tetto 16s) e scrive **tutti i voti in un'unica transazione** (una sola connessione, niente `migrate` né contesa per-hotel). Sostituisce le 8 chiamate `invoke` + 8 connessioni per blocco.
- Misurato sul DB reale: **24 hotel valutati in 6,0s** (parallelo) + scrittura 0,00s ≈ **~14.000 hotel/ora**, costante.
### Verificato
- `tsc` + `cargo test` (12 unit, incl. regressione panic) puliti; **test live sul database reale**: valutati 62.255 → 62.279 (+24) in 6s, nessun panic.

## [0.8.8] — 2026-06-24
### Cambiato — Riorganizzazione della struttura (IA)
Ridisegnata la navigazione su indicazione dell'utente (titoli e funzioni non più allo stesso livello).
- **Barra dei menu** in alto al posto della colonna laterale: **Hotel · Mappa · Copertura · CRM · Infografica · Dati ▾**. Ogni vista ha i propri controlli in una toolbar; **niente più sidebar** (risolve «la data è un titolo ma sembra una funzione»).
- **Infografica** è ora una voce di menu a sé (non più dentro il gruppo Backup).
- **Scansiona** spostata in **Copertura** (per analogia con Misura/Completa): pannello «Scansiona» in cima alla vista; i risultati si guardano in «Hotel».
- **Dati ▾**: menu a tendina che raggruppa con titoli chiari Esporta selezione, Backup esporta/importa, AI Cowork esporta/importa.
### Aggiunto — Sfoglia hotel per paese
- Vista **«Hotel»** con due modalità: **Per paese** (fisarmonica: apri un paese → carica e mostra i suoi hotel **su richiesta** dal DB via `select_hotels`, scala all'intero archivio) ed **Elenco** (tabella piatta ordinata per voto/valore). La ricerca filtra i paesi (modalità Per paese) o cerca per nome/città/regione (modalità Elenco).
### Verificato
- `tsc` pulito; build di produzione ok; anteprima: menu bar + tab attivi, toggle Per paese/Elenco (placeholder e filtri cambiano), menu Dati con gruppi, pannello Scansiona in Copertura — **verificati via screenshot**; 0 errori console. Lo sfoglia con dati reali (espandi un paese) va provato sull'app installata.

## [0.8.7] — 2026-06-24
### Cambiato — punteggi più percepibili
- Il badge del voto usa ora una **scala "heat" continua** calcolata dal punteggio (`scoreHeat`): **grigio** sotto soglia → **pesca** alla soglia → **ambra profonda** verso 100. La differenza tra i punteggi è immediata a colpo d'occhio (numeri in grassetto, tabulari); rimosse le 3 fasce piatte.
### Corretto — la valutazione «si bloccava quasi subito»
Cause e fix:
- **Client web ricostruito a ogni hotel** + timeout da 20s: un sito lento inchiodava il worker. Ora c'è un **client dedicato e condiviso** (riusa connessioni) con timeout più corti (connect 6s, totale 10s).
- **Tetto duro di 16s per hotel** (`tokio::time::timeout` su `gather_pages`): un sito lento/morto viene abbandonato, non blocca la coda.
- **Avanzamento solo a fine blocco da 80**: sembrava fermo. Ora la barra e i voti si aggiornano **ogni ~8 hotel** (blocco ridotto a 60), feedback continuo.
### Verificato
- `tsc` pulito; `cargo test` 10/10; anteprima: scala heat 10→100 **verificata via screenshot** (grigi sotto soglia, ambra crescente sopra), 0 errori console.
- **Test live del tetto di tempo** (`enrich_dead_host_is_bounded`): un host morto rientra in ~12s (< 16s) e ritorna invece di restare appeso — prima poteva occupare un worker fino a ~80s. Resta utile una prova end-to-end con «Valuta family-fit» sull'app installata.

## [0.8.6] — 2026-06-24
### Cambiato — Veste grafica del brand Kidotel
Adottati **logo, colori e tipografia ufficiali** del brand Kidotel (da brand book). Dettaglio in `docs/BRAND.md`.
- **Logo**: nuovo **wordmark «Kidotel» con la scia radar** (`src/components/Wordmark.tsx`, `currentColor` → si inverte nel tema scuro) in testata (+ suffisso «Radar»), nell'infografica e nel report. Sostituisce il vecchio quadratino verde con il pin. Nuova **favicon** `public/kidotel.svg` (scia radar) e title corretto «Kidotel Radar».
- **Colori**: palette ufficiale — testo `#222223`, sfondo grigio `#F5F5F5`, **Peach `#FFC27B`** (accento/bottone primario), ambra `#EF9F27`, ambra profonda `#A8650F` (link/testo accento, contrasto AA). **Rimosso il verde** dalla veste (bottoni, fasce punteggio, mappa, infografica, focus ring). I pallini di stato CRM e il rosso d'errore restano colori *funzionali* (codifica dati/semantica).
- **Tipografia**: **Sora** (titoli) + **Manrope** (corpo), in bundle **offline** (`@fontsource-variable/*`); le pagine HTML generate caricano i font con fallback.
- **Icona dell'app** (dock/Finder/.dmg/Windows): rigenerata on-brand (quadrato scuro + scia radar pesca, `src-tauri/icons/icon.svg` + `tauri icon`). Prima era ancora il vecchio pin verde. Rimossi asset scaffold orfani (tauri/vite/react .svg).
- **Fix tema**: ogni blocco tema ora ridefinisce anche `--ink/--brand-strong/--brand-soft` (su sistema scuro + tema manuale chiaro il wordmark restava invisibile).
- **Contrasto (WCAG AA)** dopo verifica avversariale: testo su pesca ora sempre scuro `#222223` (bottoni Scansiona/Scrivi-email, segmenti attivi, pill lingua — prima bianco su pesca = illeggibile); `--brand-strong` portato a `#925a0c` e ambra-testo a `#8a5d12` (≥4.5:1 su grigio/superfici); `--text-3` a `#71716b` (testo informativo leggibile). Introdotto `--on-brand` (scuro fisso) per i riempimenti pesca, indipendente dal tema.
### Verificato
- `tsc` pulito; anteprima: testata col wordmark, palette pesca/ambra, infografica rebrandizzata, tema scuro (wordmark invertito), segmenti/pill leggibili, icona app — **verificati via screenshot**; 0 errori console. Verifica avversariale multi-agente (colori residui = 0 violazioni / contrasto WCAG / completezza brand) → blocker e major risolti.

## [0.8.5] — 2026-06-24
### Aggiunto — Infografica stampabile (#9)
- Nuovo **«Infografica»** (pannello Dati): un cruscotto visivo **dai dati reali dell'archivio**, con **anteprima dal vivo** (iframe) e **stampa**.
  - Sezioni: **numeri chiave** (hotel / valutati / family ≥soglia / contattabili), **distribuzione dei punteggi** (istogramma a 10 fasce, family in verde), **top 10 paesi per family hotel**, **copertura per continente** (totali + family), **funnel di acquisizione CRM**, **valore atteso** dei family hotel contattabili.
  - **Opzioni di stampa**: orientamento Verticale/Orizzontale + scelta delle sezioni da includere. «Stampa» apre l'HTML nel **browser di sistema** (dove ci sono PDF, A4/Lettera, margini), perché in Tauri `window.print()` è no-op. «Salva HTML» per archiviare/inviare il file.
  - Design moderno on-brand (verde Kidotel / ambra), `@media print`, tutto **100% dati reali** (niente valori inventati).
- Backend: nuovo comando `score_histogram` (distribuzione punteggi in 10 fasce); l'infografica riusa `score_stats`/`coverage_by_country`/`contact_stats`/`count_select`/`select_hotels`.
### Verificato
- `tsc` pulito; `cargo test` 10/10; anteprima: infografica generata con dati di prova e **resa verificata via screenshot** (KPI, istogramma, barre paesi/continenti, funnel, valore atteso), 0 errori console. (Sui dati reali gira nell'app Tauri.)

## [0.8.4] — 2026-06-24
### Aggiunto — Esporta selezione (cowork) (#8)
- Nuovo dialog **«Esporta selezione»** (pannello Dati) per **comporre il gruppo di hotel** da condividere con i collaboratori, con conteggio live della selezione:
  - **Ambito**: Tutti · un **Continente** · un **Paese**.
  - **Fascia di punteggio** (es. 59–100) e/o **«le migliori N»** (per punteggio).
  - **Filtri**: solo valutati · solo contattabili (sito/email/telefono) · solo email recapitabile.
  - **Formati**: **CSV** (BOM + `;`, apre in Excel/Numbers/Sheets, colonne localizzate) e **JSON strutturato** (hotel + voto + valore atteso + prove citate, per AI/altri strumenti).
- Backend: comandi `count_select` (conteggio live) e `select_hotels` (righe) con **query parametrica** (WHERE costruito con parametri legati, niente interpolazione → niente SQL injection). Test unitari su `build_select_where`.
### Verificato
- `tsc` pulito; `cargo test` 10/10 (3 nuovi test selezione); anteprima: dialog reso, segmenti ambito/menu continente (7) /fascia punteggio funzionanti, 0 errori console. (Conteggio ed export su file richiedono l'app Tauri.)

## [0.8.3] — 2026-06-24
### Revisione completa (audit) — bug, coerenza, armonizzazione
Audit multi-agente di tutto il programma; applicate le correzioni con priorità.
#### Corretto (bug)
- **BLOCKER — importazione backup**: dopo la copia del `.sqlite` restavano i sidecar `-wal`/`-shm` del vecchio DB, che SQLite ri-applicava sul file importato → corruzione / dati vecchi a ogni ripristino. Ora vengono rimossi (si rigenerano alla prossima apertura). (`db.rs import_backup`)
- **Copertura — doppioni «(sconosciuto)»**: `coverage_by_country` raggruppava per `country` ma etichettava con `COALESCE(...)`, generando due righe «(sconosciuto)» con conteggi spezzati. Ora `GROUP BY` sulla stessa espressione. (`db.rs`)
- **Estrazione email** (`engine.rs find_email`): la denylist a sottostringa (`name@`, `user@`, `@email`, …) scartava indirizzi veri (`firstname@…`, `superuser@…`, `info@email-resort.com`). Ora è strutturale: spazzatura su dominio/estensioni per sottostringa + segnaposto nel local-part per confronto **esatto**. Allineate anche `score-free.mjs` e `harvest-emails.mjs`. Test unitari aggiunti.
- **Nota CRM**: l'input non controllato (`defaultValue` con chiave stabile) mostrava testo vecchio dopo un reload e poteva sovrascrivere il DB con valore stantio. Ora la chiave include la nota salvata → si riallinea ai dati. (`App.tsx`)
- **Valutazione (`enrichAll`)**: a fine valutazione sostituiva sempre la vista con l'archivio globale, facendo «sparire» l'area scansionata/ricercata. Ora aggiorna i voti **sul posto** nella vista corrente e ricarica l'archivio **solo** se è quello che si sta guardando. (`App.tsx`)
- **`release.mjs`**: il dmg da tenere aveva l'architettura inchiodata (`aarch64`) → su Intel cancellava il dmg appena costruito. Ora tiene qualunque dmg della versione corrente.
#### Armonizzazione — soglia «family hotel» unica
La soglia delle Impostazioni ora è l'**unica fonte di verità**, applicata ovunque:
- `score_stats` e `coverage_by_country` accettano il parametro `threshold` (niente più `>=60` inchiodato lato Rust).
- `tier()` (badge voto in tabella e CRML) e `MapView.colorFor()` calcolano le fasce **relative alla soglia** (soglia / soglia+20).
- Intestazione Copertura «Family» mostra dinamicamente `(≥soglia)`; rimosso «≥60» fisso da i18n.
- Header CSV dell'export ora **localizzato** (IT/EN) come le celle; nomi paese `Türkiye`/`Viet Nam` aggiunti alla mappa valore atteso.
#### Rifiniture
- Modali Guida/Impostazioni: **Esc per chiudere**, `role="dialog" aria-modal`, focus iniziale sul bottone di chiusura.
- Banner informativi: **auto-chiusura dopo 6s** + clic per chiudere; niente più «misuro…» appeso se la misura fallisce.
- `email_checked` aggiunto allo schema canonico (`migrate()`), così la ripresa dell'harvester funziona anche su installazioni nuove.
- `open_db`: `busy_timeout` applicato via API (sempre, anche senza WAL) + verifica/diagnostica del `journal_mode`.
- `backup-db.mjs`: se il checkpoint WAL fallisce, copia anche i sidecar (niente backup silenziosamente parziale).
- Nit: `CrmView` rispetta `settings.renderCap`; rimossi `RENDER_CAP` morto, chiave i18n `archive.capped` morta, `export` inutile su `locationOf`; conteggio «N hotel» del report localizzato.
### Verificato
- `tsc` pulito; `cargo test` 7/7 (inclusi i nuovi casi `find_email`); 4 test live ignorati (richiedono rete).

## [0.8.2] — 2026-06-24
### Aggiunto
- **Scansione completa per CONTINENTE**: in Copertura, ogni intestazione di continente ha un pulsante **«Completa continente»** che lancia «Completa 100%» su tutti i paesi di quel continente, in sequenza, con avanzamento e **Ferma**. (`completeContinent` riusa il core `runCompleteCountry`.)
- **Copyright «© Giovanni Bucolo»** nel footer dell'app, nella Guida e nel report di stampa.
### Verificato
- `tsc` pulito; anteprima: pulsanti «Completa continente» per ogni continente, copyright nel footer, 0 errori console.

## [0.8.1] — 2026-06-24
### Corretto — "Completa" su paesi senza regioni + Copertura per continente
- **"no regions found" (Grecia, Giamaica, Aruba…)**: alcuni paesi non hanno suddivisioni `admin_level=4` con codice ISO (la Grecia ha "amministrazioni decentralizzate" senza ISO, e per contaminazione di confine compariva persino "Muğla" turca). Ora `list_subareas` usa una **cascata di criteri**: prova i livelli amministrativi **4 → 6 → 5 → 3** (filtrati al paese via ISO3166-2); **se nessuno dà regioni valide, ripiega sull'intero PAESE come un'unica area** scansionata a tasselli ritagliati sul confine. Così **ogni paese è scansionabile**, con o senza regioni.
- **Copertura raggruppata per CONTINENTE**, paesi in **ordine alfabetico** dentro ciascun continente (Europa · Asia · Africa · Nord America · Sud America · Oceania · Altro). Mappa paese→continente per ~140 paesi.
### Verificato
- `cargo check`/`tsc` ok; anteprima: Copertura raggruppata correttamente (Europa: Austria, Germany, Greece, Italy…; ordine alfabetico), 0 errori console. Cascata diagnosticata sui dati reali della Grecia (admin_level=4 → 0 ISO GR-; fallback paese-intero attivo).

## [0.8.0] — 2026-06-24
### Aggiunto — Guida integrata + Impostazioni
- **Guida in-app** (icona ? in alto): bilingue IT/EN, spiega ogni funzione (Cerca, Scansiona, Valutazione+Prova, Copertura/Misura/Completa, CRM, Valore atteso, Dati/Backup, AI·Cowork), mostra la versione e le **«Novità di questa versione»**. Contenuto in `src/guide.ts`, da aggiornare a ogni release (come il changelog).
- **Impostazioni** (icona ⚙): **Lingua** (IT/EN), **Tema** (Auto/Chiaro/Scuro, applicato e persistito), **Soglia «family hotel» (≥N)** (usata nella statistica), **Righe mostrate in tabella**, **Assunzioni del modello** (valore/commissione/volume del valore atteso). Tutto **persistito in localStorage** e applicato in tempo reale.
- Tema manuale: override del `prefers-color-scheme` via `html[data-theme]`. Nuove icone Heroicon (cog, help, x).
### Verificato
- `tsc` pulito; anteprima: Guida resa (versione 0.7.x + novità + sezioni), Impostazioni (cambio tema Auto→Chiaro applicato e salvato in localStorage), 0 errori console. Responsive (modale a tutta larghezza + righe in colonna su mobile).

## [0.7.6] — 2026-06-24
### Corretto — "Completa": numeri chiari e grado onesto
- "I numeri dell'Italia non cambiano": **non era un bug** — l'Italia è già coperta al ~96% (21.336 dei 22.107 hotel italiani CON NOME su OSM; gli anonimi non sono usabili). "Completa" trovava quasi solo hotel già presenti. Reso evidente:
  - Il **grado di copertura** ora conta solo gli hotel **con nome** (`osm_hotel_count` con `["name"]`) → denominatore onesto (niente più % gonfiata da hotel anonimi che non possiamo usare).
  - La nota di "Completa" ora mostra gli hotel **NUOVI** aggiunti (delta reale nel DB), non quelli trovati → niente più "+22000" mentre il totale non si muove. Es.: "+0 nuovi hotel" su un paese già completo, "+240 nuovi hotel" dove c'è margine.
- Il vero valore di "Completa" è sui paesi **sotto-coperti** (USA, ecc.): lì aggiunge molto.

## [0.7.5] — 2026-06-24
### Migliorato — tono dell'email di outreach
- Email di contatto del CRM riscritta: **sempre in inglese, formale e professionale**, **voce al plurale** (The Kidotel Team — mai prima persona singolare). Racconta la **filosofia** di Kidotel (verificato parola-per-parola, niente dati inventati né a pagamento), cattura l'attenzione, comunica una **selezione rigorosa** ("deliberately strict selection… met that standard") e presenta l'adesione come **opportunità selettiva e preziosa**. Mantiene le **prove verbatim** citate dal sito come dimostrazione. Oggetto: "{hotel} — selected for Kidotel's verified family-hotel collection".

## [0.7.4] — 2026-06-24
### Corretto — "Completa 100%" sistemata alla radice (+0 e Stop)
- **"18 regioni scansionate (+0)"**: "Completa" ri-geocodificava OGNI regione su Nominatim → raffica di ~20 richieste → Nominatim **bloccava l'IP** → ogni scansione falliva in silenzio (+0). Ora le regioni si scansionano **PER AREA** (osm_id + bounding box presi in un'unica query): nuovo comando `discover_area`, `list_subareas` restituisce id+bbox. **Zero chiamate Nominatim per regione** → i numeri crescono davvero (verificato: +300/regione, "Trovati" sale live).
- **Stop non rispondeva**: il ciclo restava incastrato in un `discover` lento (retry Nominatim). Ora ogni regione è veloce e il flag di stop è controllato **prima e dopo** ogni regione → Stop interrompe subito (verificato: "fermato 1/3"). Aggiunto piccolo intervallo (garbo verso Overpass).
- `cargo check` ok, `tsc` pulito, anteprima: list_subareas→discover_area per area, conteggio live, Stop funzionante, 0 errori console.

## [0.7.3] — 2026-06-24
### Aggiunto — gate di deliverability delle email (outreach sicuro)
- Nuovo `scripts/verify-emails.mjs`: verifica via **DNS/MX** (niente API, niente invii) che il dominio possa ricevere posta e classifica ogni email — `ok` (personale) · `role` (info@/booking@…) · `risky` (no MX, c'è A) · `no_mx` (dominio senza posta) · `bad` (sintassi). Colonna `email_status`, riprendibile.
- Eseguito su ~25.6k email: **25.049 contattabili** (ok 9.035 + role 16.014), 293 no_mx, 216 risky, 35 bad.
- **CRM**: l'email mostra ora lo stato (verde=recapitabile, barrata=non recapitabile) con spiegazione; **"Scrivi email" NON apre il client verso indirizzi non recapitabili** (copia la bozza e avvisa) → niente bounce/danni alla reputazione del dominio.
- `email_status` aggiunto allo schema (`db.rs`) e a `list_hotels`. Pronto per filtrare l'outreach di massa su ok/role.

## [0.7.2] — 2026-06-24
### Corretto — "Completa" non faceva crescere il paese (causa reale)
- Gli hotel scoperti venivano salvati col **codice paese OSM ("IT")** o vuoto → in Copertura finivano in un bucket diverso da "Italy", quindi la riga del paese **non cresceva** e "Completa" sembrava non funzionare. Ora `discover` **timbra il nome paese pieno** (dalla geocodifica Nominatim) su tutti gli hotel dell'area scansionata → la colonna "Trovati" del paese cresce correttamente a ogni regione. (`cargo test` 7/7.)

## [0.7.1] — 2026-06-24
### Corretto/Migliorato — "Completa 100%" ora è visibilmente vivo
- "Completa" sembrava non partire: in realtà girava ma in silenzio (primo passo lento su Overpass, conteggio aggiornato solo alla fine). Ora **aggiorna la tabella dopo OGNI regione** → la colonna "Trovati" del paese cresce in tempo reale, e c'è un **pulsante Ferma** per interrompere. (Backend verificato ok live: Italia 22.923 hotel su OSM, 20 regioni IT enumerate correttamente con `area(area_id)`.)

## [0.7.0] — 2026-06-24
### Aggiunto — copertura per paese: grado reale + "Completa 100%"
- **Grado di copertura reale per paese**: pulsante **"Misura"** in Copertura → calcola quanti hotel esistono su OpenStreetMap per quel paese (comando `osm_hotel_count`, query per CONFINE → funziona anche per i paesi enormi/antimeridiano) e mostra `trovati / totale OSM (%)` con barra colorata. Risolve "indicare quale grado di copertura si è ottenuto". (Verificato: Austria 6.257/6.371 = **98%**.)
- **"Completa 100%"**: enumera le **regioni** del paese (comando `list_subareas`, admin_level=4 filtrato per `ISO3166-2` così niente regioni estere confinanti) e le scansiona **una per una**, con avanzamento, poi ri-misura il grado. Così anche **USA, Francia, Russia** (bloccati per bbox) si coprono — regione per regione. Risolve il paradosso "paesi grandi sotto-rappresentati".
- `Bbox` ora cattura il `country_code` (Nominatim addressdetails) per filtrare le sotto-aree.
### Verificato
- `cargo check` ok, `tsc` pulito. Anteprima: grado mostrato (Austria 98%, Italy 77%), "Completa" chiama `list_subareas`+`discover` per ogni regione+ri-misura, 0 errori console. Conteggio/enumerazione OSM validati live (Austria 6.371; Francia 29→regioni FR dopo filtro ISO).

## [0.6.2] — 2026-06-24
### Migliorato — prestazioni, sicurezza dati, pulizia (avvio del piano "al massimo livello")
- **SQLite in WAL + busy_timeout 60s + synchronous=NORMAL + indici** (`family_fit_score`, `country`, indice parziale "non valutati"): niente più "database is locked" tra app e crawler, query calde non più full-scan su 130k+ righe. Applicato anche al DB live.
- **Backup sicuro**: `export_backup` fa un `wal_checkpoint(TRUNCATE)` prima della copia (in WAL il .sqlite da solo perdeva le scritture recenti). Nuovo `scripts/backup-db.mjs`: backup versionato locale (tiene gli ultimi N) — uccide il rischio "copia unica". Primo backup creato (72 MB).
- **Pulizia catene**: colonna `is_chain` + `scripts/flag-chains.mjs` (domini di catena/OTA curati + brand nel nome, con PRECISIONE: i portali regionali tipo `valgardena.it` NON vengono toccati e gli hotel family≥60 non si marcano per sola omonimia). Marcati **18.012** catene/OTA. Il **generatore del sito ora le esclude**.
### Nota (verifica onesta)
- Il "fix del valutatore a regole" del piano è stato **declassato dopo verifica sui dati reali**: i falsi positivi (negazione/adults-only) sono rarissimi (2 hotel ≥60, uno legittimo) e un guard rischierebbe NUOVI falsi positivi. La vera leva di qualità è il *recupero* via AI (piano Claude/Cowork), non le regole.

## [0.6.1] — 2026-06-24
### Corretto — scansione di paesi grandi
- **"United States" (e Francia, Russia) davano "area troppo grande".** Causa: il loro bounding box attraversa l'antimeridiano / include territori d'oltremare → larghezza ~360°, area enorme e priva di senso. Ora il guard distingue due casi:
  - **paese "sparso"** (span > 90° in lat o lon: USA/Francia/Russia/Australia) → messaggio chiaro "scansiona per **stato, regione o città**" (es. California, Texas, Florida).
  - **vero continente** → rifiutato. Poiché Nominatim dà ai continenti bbox più piccoli (Africa ~2500) dei grandi paesi (Canada ~3694), sopra le 2000 deg² si consente SOLO un `addresstype=country` → **Canada/Cina/Brasile ora si scansionano** (a tasselli), mentre Africa/Asia/Europa restano bloccate.
- **world-scan**: aggiunti **USA per stato** (California, Florida, Texas, NY, Colorado…) e **Canada per provincia** (Ontario, Quebec, BC, Alberta) per far crescere la copertura dei paesi enormi nel modo giusto.
- Verificato sui bbox reali (Nominatim) + `cargo test` 7/7.

## [0.6.0] — 2026-06-24
### Aggiunto — motore di DOMANDA (sito SEO) + outreach
- **Generatore del sito pubblico** `scripts/build-site.mjs`: produce un sito STATICO bilingue IT/EN dai dati (SEO programmatica → traffico → affiliazione). La **prova citata guida la pagina, la CTA segue**; soglie anti-thin (paese/regione/hotel); JSON-LD onesto (niente aggregateRating finto); affiliazione **swappabile** (`scripts/affiliate.config.json`, oggi "direct"); disclosure FTC, sitemap, hreflang. Oggi: 5 paesi · 5 regioni · 91 hotel ×2 lingue. Anteprima via launch `kidotel-site`. *(progettato con un panel multi-agente: SEO, dati strutturati, monetizzazione, E-E-A-T)*
- **CRM · "Scrivi email"**: genera un'email di outreach **personalizzata** per ogni hotel, citando i suoi punti di forza family **verificati (verbatim dal sito)**; apre il client di posta precompilato (se c'è l'email) o copia la bozza. Icone Heroicon `mail`/`phone`.
### Corretto
- **`country` tornava al codice ISO ("AT") al ri-scan**: `upsert_hotels` ora **preserva** city/country (COALESCE) — la geo precisa la mette il reverse-geocoding, non l'`addr:country` di OSM. Evita di frammentare il raggruppamento per paese (e la vista Copertura).
### Verificato
- `cargo check` ok, `tsc` pulito. Anteprima: sito (scheda hotel + hub regione, JSON-LD valido, link conformi) e CRM email (mailto personalizzato con prove + fallback clipboard), 0 errori console.

## [0.5.2] — 2026-06-24
### Migliorato — menù laterale più pulito e professionale
- Rimossi i **chip di esempio** ("Alto Adige/Toscana/Costa Brava/Tokyo") sotto Scansiona: erano suggerimenti superflui.
- **Hint accorciati** all'essenziale, mantenendo la distinzione chiara tra le due funzioni: *Cerca nel database* → "Solo nell'archivio locale."; *Scansiona* → "Aggiunge nuovi hotel da OpenStreetMap.".
- Ogni pannello ora ha un **titolo** (aggiunto "Valutazione", prima senza titolo) → sidebar coerente: Cerca nel database · Scansiona · Valutazione · Dati · AI · Cowork.

## [0.5.1] — 2026-06-24
### Corretto
- **I link non si aprivano** (siti, email, telefono): nel webview Tauri un `<a target="_blank">` è un no-op. Ora ogni link esterno passa dal comando `open_url` (plugin opener) → si apre nel browser / client di posta / telefono di sistema. Vale per la colonna Sito, i contatti del CRM e le fonti nella Prova. (In anteprima browser, fallback a `window.open`.)
- **Scansione che falliva sulla geocodifica** ("error sending request … nominatim …"): Nominatim è severo (rate-limit / reset). Ora:
  - **3 tentativi con attesa crescente** (un "luogo non trovato" non viene ritentato).
  - **Fallback dall'archivio**: se Nominatim resta irraggiungibile, il bounding box viene ricavato dagli hotel **già salvati** per quell'area → ri-scansionare un paese noto funziona comunque (a tasselli per bbox). Messaggio d'errore chiaro solo se manca pure il dato locale.
### Aggiunto
- **Email di contatto estratta dal sito** durante la valutazione (`enrich_hotel`): legge l'HTML grezzo (anche i `mailto:` e i JSON-LD), scarta i falsi positivi (loghi `@2x`, sentry, ecc.), preferisce gli indirizzi "ufficiali" (info@/reception/booking…). Dato **reale dal sito**, salvato solo se l'hotel non aveva già un'email. Le email compaiono man mano che valuti gli hotel dentro l'app. *(Nota: OSM raramente fornisce l'email; per questo i 65k già in archivio ne sono privi finché non li si rivaluta.)*
### Verificato
- `cargo test` **7/7** (nuovo test puro `find_email`: mailto preferito, scarto loghi/sentry, testo semplice). `tsc` pulito. Anteprima: i link chiamano `open_url` con l'URL giusto (sito/mailto/tel) in tabella e CRM; l'email reale è mostrata; nessun errore console.

## [0.5.0] — 2026-06-24
### Aggiunto — CRM / Outreach (acquisizione partner)
- **Vista "CRM"**: gli hotel contattabili (con sito, email o telefono) ordinati per **valore atteso ↓**, con per ciascuno: **stato del contatto** (Da contattare → Contattato → Ha risposto → In trattativa → Partner / Rifiutato), **nota** libera e i **contatti** cliccabili (email/sito/telefono). Filtri per stato con conteggi.
- Lo **stato e la nota vivono nel database** e **sopravvivono ai ri-scan** (l'upsert non li tocca) e ai **backup** (sono colonne del .sqlite). Comandi Rust `set_contact` / `contact_stats`.
- **Email catturata da OpenStreetMap** (`email`/`contact:email`) in scansione e nel CSV. Export CSV ora include **stato, nota, email**.
### Corretto — scansione robusta alla radice (segue review avversariale di v0.4.1)
- La review ha evidenziato che v0.4.1 toglieva il tetto di 20s **senza metterne un altro**: nel caso peggiore (doppia cascata area+bbox × 2 giri × 150s) una scansione poteva restare appesa **decine di minuti**. Risolto:
  - **Scansione a TASSELLI** per aree grandi (paese/regione estesa): il bounding box è diviso in riquadri ~1.5° e ogni riquadro è una query **piccola e veloce** (intersecata col confine se disponibile → niente sconfini). Niente più singola query nazionale che va in timeout/sovraccarico.
  - **Budget complessivo** (240s): oltre, restituisce i **risultati parziali** già raccolti invece di restare appeso.
  - Cascata **a giro singolo + 1 ritentativo** (non più 2 giri completi); **non ritenta** le query non valide (HTTP 400); diagnostica errori più fedele (timeout / connessione / lettura interrotta).
- **Schema autosufficiente**: `open_db` ora crea le colonne opzionali (region/province/email/contact_*) via migrazione — prima region/province le aggiungeva solo lo script Python, quindi una **installazione nuova** sarebbe stata difettosa.
### Verificato
- `cargo test` **6/6** (3 nuovi test puri su `split_tiles`: griglia, tetto max, coordinate invertite/minuscole). `tsc --noEmit` pulito. Anteprima: CRM reso, ordinamento per valore atteso, cambio stato che chiama `set_contact` con gli argomenti giusti, filtri e conteggi, nessun errore console (IT+EN).

## [0.4.1] — 2026-06-24
### Corretto
- **Le scansioni di paesi/regioni andavano in errore** ("Server Overpass momentaneamente non disponibile"). Causa verificata: il client HTTP interrompeva **ogni** richiesta dopo **20s**, ma una query Overpass a scala nazionale (es. "Germany", migliaia di hotel) richiede oltre un minuto lato server → veniva uccisa prima di finire, poi cadeva sul mirror instabile `maps.mail.ru` e si arrendeva. Inoltre Nominatim funzionava (la geocodifica passava): il problema era solo lo step Overpass.
### Migliorato (robustezza Overpass)
- **Timeout per-richiesta Overpass portato a 150s** (più lungo del timeout lato server 90-120s), mantenendo 20s per Nominatim/crawl. Aggiunto **connect_timeout 10s** così gli endpoint morti vengono scartati in fretta senza bloccare la cascata.
- **Lista endpoint rinnovata e riordinata**: `overpass.kumi.systems` (più affidabile) → `lz4.overpass-api.de` (endpoint per **query grandi/nazionali**) → `overpass.private.coffee` → `overpass-api.de` → `z.overpass-api.de`. Rimosso `maps.mail.ru` (instabile/irraggiungibile).
- **Due giri con attesa di 3s** tra l'uno e l'altro (il sovraccarico 429 è spesso transitorio); errori più chiari (429 / 504 / timeout / connessione) e messaggio finale che suggerisce di scegliere un'area più piccola.
### Nota
- `cargo test` 3/3 verde, `cargo check` ok. Il percorso di rete non è testabile da qui (ambiente senza rete in uscita): verifica live nell'app.

## [0.4.0] — 2026-06-24
### Aggiunto
- **Motore di redditività (valore atteso €/anno).** Nuova colonna "Valore atteso" in tabella e ordinamento dedicato: stima quanto vale ogni hotel come partner = `valore prenotazione × indice paese × commissione% × prob.partner × volume`, dove probabilità di diventare partner e volume crescono col family-fit. Pannello **"Assunzioni del modello"** con 3 manopole regolabili (valore medio prenotazione, commissione %, prenotazioni/anno) + valore atteso totale della vista. Indice di valore per ~45 paesi (assunzione, regolabile). Incluso nell'export CSV.
  - *Chiaro che è una stima*: il valore atteso è etichettato come stima per **dare priorità**, NON un dato verificato; i dati family restano tutti con prova citata dal sito. Footer aggiornato di conseguenza.
- **Vista "Copertura" (grado di scansione per paese).** Per ogni paese: hotel trovati, valutati (con %), family (≥60), con barra del volume relativo e % colorata. Comando Rust `coverage_by_country`. Da ogni riga pulsante **"Scansiona"** che concentra subito una scansione su quel paese (disabilitato per "(sconosciuto)").
### Verificato
- ER: Testerhof (94, Austria) = €544; Familienhotel (66, Italy) = €244; Albergo Rosa (14, Spain) = €10 — calcolo confermato. Totale vista €1173.
- `coverage_by_country` confrontato con `sqlite3` sul DB reale (Italy 7315/2411/36, Germany 6942/2694/25, ecc.).
- `cargo check` ok, `tsc --noEmit` pulito, anteprima senza errori in console; rese verificate in tabella, assunzioni e copertura (IT+EN).

## [0.3.8] — 2026-06-24
### Corretto
- **La scansione di una regione restituiva anche le zone vicine** (es. "Lazio" includeva Abruzzo/Umbria/Toscana): si interrogava OpenStreetMap per **rettangolo (bounding box)**. Ora si interroga per **confine amministrativo** (poligono, via `area:` da osm_type/osm_id di Nominatim), con fallback al rettangolo solo se l'area non è disponibile. Verificato: Ortisei per confine = 20 hotel (vs 36 del rettangolo).

## [0.3.7] — 2026-06-24
### Aggiunto
- **Barra di avanzamento della valutazione** (sempre visibile, si aggiorna ogni 4s): "Valutati N / M con sito (X%)". Risponde a "la valutazione sta continuando?".
- **"Valuta family-fit" ora lavora su TUTTO l'archivio** (non solo i 5000 mostrati): scorre i non valutati a blocchi dal DB, **riprendibile** e **fermabile** (pulsante Stop). Comandi `score_stats` e `list_unscored`.
### Chiarito
- "Hotel trovati" mostra il **totale reale** (49.544); la tabella ne mostra 5.000 (i più rilevanti) solo per velocità — gli altri con Cerca/Scansiona. (I dati ci sono tutti.)

## [0.3.6] — 2026-06-24
### Migliorato
- **Dashboard razionalizzata + Heroicons.** Due funzioni nette e separate, entrambe per paese/regione/provincia/città:
  - 🗄️ **Cerca nel database** — filtra gli hotel già salvati (`list_hotels` con `search`; non scarica nulla).
  - 📡 **Scansiona (aggiungi)** — scopre hotel nuovi da OSM e li aggiunge.
  - Sidebar in pannelli titolati con icone Heroicon (database, signal, sparkles, download/upload, check); icone anche su Tabella/Mappa, Stampa, Esporta, footer.

## [0.3.5] — 2026-06-24
### Aggiunto
- **Località completa per ogni hotel**: città · provincia · regione · paese, in tabella, mappa (popup) e CSV. Riempita OFFLINE dalla posizione con `scripts/backfill-geo.py` (reverse_geocoder + pycountry, nessuna chiamata online). Verificato: La Grotta → Vigo di Fassa · Trento · Trentino-Alto Adige · Italia.
- **Ricerca testuale** nella barra: filtra per nome o luogo (città/provincia/regione/paese).
- `list_hotels` restituisce anche `region`/`province` (colonne aggiunte al DB).
### Nota
- Le nuove scansioni hanno la località dopo `python3 scripts/backfill-geo.py --new`.

## [0.3.4] — 2026-06-24
### Corretto
- **"Hotel trovati" mostrava 5000 invece del totale reale** (effetto del cap di caricamento 0.3.3): sembrava che gli hotel fossero spariti. Ora mostra il **totale vero del database** (`count_hotels`) con la nota "mostrati 5000 / N". I dati erano sempre tutti nel DB.

## [0.3.3] — 2026-06-24
### Migliorato
- **Prestazioni con archivi grandi** (49k+ hotel): `list_hotels` ora carica i più rilevanti (voto più alto) con un limite (default 5000) invece di tutti → app scattante. Didascalia "primi 5000 per voto" quando l'archivio è più grande. (Filtri/scansione per area restano per il resto.)

## [0.3.2] — 2026-06-23
### Aggiunto
- **Scansione mondiale incrementale** `scripts/world-scan.mjs`: scandaglia a tappe ~58 zone family di tutti i continenti (Nominatim → Overpass → inserimento nel DB con dedup), **riprendibile** (stato in `scripts/.world-scan-done.json`) e **incrementabile** (rilancia / aggiungi zone). Verificato live: DB cresciuto 10.091 → 14.000+ in pochi minuti.
### Corretto
- **Scansione di un intero continente** (es. "africa", "europa"): prima dava un errore Overpass fuorviante (l'area è troppo grande, milioni di hotel → timeout). Ora messaggio chiaro: "Area troppo grande… scegli un paese, una regione o una città".
- **"Family hotel" soglia ≥70 → ≥60**: a regole i family hotel veri spesso fanno 66 (4 servizi) e restavano sotto 70 → il contatore mostrava pochissimo (3). A ≥60 il numero è realistico (verificato sul DB reale: 3 → **20**). Aggiornati stat, colore mappa (verde ≥60), legenda e stat MCP (`family_hotel_ge60`).

## [0.4.0] — 2026-06-23 (connettore MCP live)
### Aggiunto
- **Server MCP `kidotel-mcp`** (`mcp-server/`, binario separato): Cowork/Claude interroga il database e **scrive i voti direttamente**, senza file a mano. Strumenti: `kidotel_stats`, `kidotel_get_unscored`, `kidotel_query_hotels`, `kidotel_set_score`. Guida: `docs/MCP-COWORK.md`.
### Verificato
- Protocollo stdio JSON-RPC: `initialize`, `tools/list`, giro lettura→scrittura (`get_unscored`→`set_score`→`query_hotels`/`stats`) su DB di prova. Da confermare insieme: collegamento effettivo di Cowork.
### Nota
- App desktop invariata (0.3.1); il connettore è un binario a sé (`kidotel-mcp` 0.1.0).

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
