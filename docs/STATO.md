# STATO — Kidotel Radar

> Dove siamo adesso. Aggiornare **a ogni sessione/release**, prima di dire "fatto".

- **Versione:** `0.8.42` (installata su macOS) + connettore MCP `kidotel-mcp`
- **Aggiornato:** 2026-07-01

## Fatto v0.8.42 (2026-07-01) — Opzione A: descrizione + facilities NOMINATE dal sito ufficiale
- Su domanda di Vova (kidotel.co mostra descrizioni + nomi facilities, dal feed OTA Expedia; Radar prima teneva solo categorie+prova): Radar ora estrae e salva **`description`** (frase di presentazione VERBATIM dal sito) e **`facilities`** = lista nominata (nome reale del servizio, es. «Mini Club»/«Young Club», + prova + URL + fascia d'età quando dichiarata). Backend `engine.rs` (`extract_description`/`extract_facilities`/`detect_age` multilingue, struct `Facility`; scritte in enrich singolo+batch; il FaaS `score_website` le ritorna). DB `db.rs` colonne + `update_content` (i punteggi-AI non le sovrascrivono). UI: pannello «Prova» con descrizione + chip facilities (i18n `proof.facilities` IT/EN/RU). Export feed kidotel.co + JSON le includono.
- Verificato: `cargo test` 18/18 (nuovo test estrazione); CONFRONTO REALE `live_extract_content` su hotel-cormoran.com → descrizione verbatim + «Mini Club»/«Young Club» con prova; `tsc` pulito. Differenza onesta vs sito: Radar riporta SOLO ciò che è verbatim sul sito ufficiale (meno voci del feed OTA, ma provate e coi **nomi reali**).
- **Nota join**: gli id di kidotel.co (es. 22402) potrebbero non coincidere con `osm_id` (id Expedia vs OSM) → per collegare i due dataset servirà una chiave (nome+città+geo o mappatura). Da chiarire con Vova.

## Fatto v0.8.41 (2026-06-26) — keep-awake leak-proof (niente caffeinate orfano)
- v0.8.40 lasciava un `caffeinate` attivo anche a riposo (corsa fire-and-forget tra start/stop → Mac sveglio sempre). Fix: chiamate keep-awake serializzate (catena di promesse) + dedup su stato locale → segue esattamente «scan attiva sì/no»; + `RunEvent::Exit` chiude il caffeinate alla chiusura app (niente orfano).
- Verificato (Mac reale): caffeinate figlio dell'app a riposo, dopo kill non re-spawna (= leak confermato e ora prevenuto); cargo build ok, tsc, 0 NUL.

## Fatto v0.8.40 (2026-06-26) — scansioni che finiscono di notte (keep-awake) + ripresa risolta
- Mentre una scansione è attiva (covBusy/starsBusy/enriching) l'app tiene sveglio il Mac con `caffeinate -dimsu` → niente screen saver → finestra non occlusa → i cicli WebView non vengono fermati da App Nap → la scansione finisce di notte E i paesi si completano (cursore avanza → niente più «riparte da Albania»). Modulo Rust `keepawake` (keep_awake_start/stop), choke-point unico (useEffect su booleano). macOS-only, best-effort.
- Verificato: cargo 17/17, tsc, anteprima monta 0 errori; verifica OS (pmset mostra le assertion PreventUserIdleDisplaySleep/SystemSleep; kill pulito).
- **Nota**: fix mirato al problema reale (screen saver). Un vero worker di background in Rust (scan anche a finestra nascosta) resta opzione futura. **Prossimo (piano valore)**: freschezza datata, nuove famiglie di segnali. **Operativo (tuo)**: affiliazione, Certified ricorrente.

## Fatto v0.8.39 (2026-06-26) — lista paesi completa (207) + diagnosi ripresa scansione
- `WORLD_COUNTRIES` da 193 a **207**: aggiunti i 14 mancanti (Chad, Yemen, Syria, Eritrea, South Sudan, Central African Rep., Equatorial Guinea, Guinea-Bissau, Sao Tome, North Korea, Micronesia, Marshall Is., Nauru, Tuvalu) + alias continente. «Completa tutti» e selettore ora coprono tutto il mondo.
- **«Riparte sempre da Albania»**: NON è bug di ripresa (`resumeIndex` corretto, cursore salvato per paese). Il cursore resta vuoto solo se nessun paese si completa → causa reale = la scansione si FERMA con lo screen saver (cicli in WebView soggetti ad App Nap/throttling). Fix definitivo = **scheduler di background in Rust** (mossa #6, da fare); rimedio subito = screen saver/display «Mai».
- Verificato: tsc, 207 paesi, anteprima selettore 207 opzioni coi nuovi, 0 errori, 0 NUL.
- **Aperti**: scheduler background (risolve sia la scansione notturna sia la ripresa); poi freschezza/nuovi segnali. Operativo (tuo): affiliazione, Certified ricorrente.

## Fatto v0.8.38 (2026-06-26) — cattura i tag OSM già scaricati (dato a costo zero, #4)
- `parse_elements` ora salva un set curato di tag OSM (wheelchair, internet_access, swimming_pool, brand/operator, opening_hours/seasonal, smoking, rooms/beds, breakfast, addr completo) in `osm_attrs` (JSON). Colonna `osm_attrs TEXT` (migrazione), upsert con COALESCE (non azzera al ri-scan). Zero richieste rete in più. Foundation per dimensioni report (% accessibili/regione) + esclusione catene. Mossa #4 del piano valore.
- Verificato: cargo 17 test (2 nuovi su osm_attrs), tsc, 0 NUL. Nota: i 165k esistenti si arricchiscono solo a ri-scansione.
- **Vie #3 e #4 del piano fatte** (esclusioni/adults-only + tag OSM). **Prossimo (Prossimo orizzonte)**: freschezza datata, scheduler interno, nuove famiglie di segnali. **Operativo (tuo)**: affiliazione (aid in affiliate.config.json), Certified ricorrente.

## Fatto v0.8.37 (2026-06-26) — credibilità punteggio: esclusioni + gate solo-adulti (qualità #3)
- `score_pages`: scarta una frase-segnale se contiene un'esclusione (27 pattern, 6 lingue) → niente più «adults only, no kids club» che accende kids_club. Gate «solo adulti» (26 pattern, verbatim) → family-fit azzerato + flag `adults_only` con prova; segnali family forzati assenti. `SignalsFile`+`signals_cfg()`, i18n `signal.adults_only`.
- Mossa #3 del piano di massimizzazione valore (dalla valutazione strategica): chiude il falso positivo più grave per certificati/report/analytics.
- Verificato: cargo 15 test (2 nuovi) + live no-regressione (schwarzenstein 76); tsc, parità 339×3, signals.json valido (8+27+26), 0 NUL.
- **Prossimo (dal piano)**: #4 leggere i tag OSM già scaricati (wheelchair/piscina/catena/orari); poi freschezza datata, scheduler, nuovi segnali. Vie operative (tue): affiliazione, Certified ricorrente.

## Fatto v0.8.36 (2026-06-25) — Family-Fit as a Service (valuta un sito su richiesta, no DB)
- Menu Dati → «Valuta un hotel su richiesta»: incolli un sito, Radar applica lo stesso scoring e restituisce punteggio + prova citata + risposta API (JSON). Non tocca il DB Kidotel (solo il sito fornito). Rust `score_website` (riusa gather_pages+score_pages, no DB) registrato; frontend `FtoolOverlay`+`runFtool`. Implementa la via «family-fit as a service».
- Verificato: cargo test 13 passati + live `score_website` reale (schwarzenstein.com → score 76, 5 segnali, 1,7s); tsc pulito, parità 338×3; anteprima (overlay + wiring + risultato con mock realistico + JSON), 0 errori console.
- **Tutte le vie economiche interne fatte**: SEO/feed · report di mercato · Kidotel Certified · analytics premium · **family-fit as a service**. Resta: outreach 1:1 (motore già pronto), e lato kidotel.co import feed + /claim (nota tecnica consegnata).

## Fatto v0.8.35 (2026-06-25) — Analisi premium per hotel (insight azionabile vendibile)
- Riga hotel valutato → «Analisi premium»: report che trasforma il punteggio in insight: percentile mondiale (da score_histogram, es. Top 8%), benchmark di paese, breakdown dei 7 segnali attivi (pesi da signals.json, max 94), leve di miglioramento (segnali mancanti pesati + potenziale). Produced Work ODbL-safe, nessun dato di altri hotel/interno. Implementa la via «analytics premium». `SIGNAL_CATALOG`, `buildAnalyticsHtml`/`openHotelAnalytics`.
- Fix: riga «earned su 94» mostrava `<b>` escapizzato → corretto.
- Verificato: tsc pulito, parità 327×3, anteprima (mock realistico score 76), matematica controllata (Top 8%/92%, 76/94, +18 potenziale, Italy 10%), attribuzione OSM, no dati interni, 0 errori console.
- **Vie economiche fatte**: SEO/feed, report di mercato, Kidotel Certified, **analytics premium**. **Prossimo**: API «family-fit as a service», outreach 1:1. Lato kidotel.co: import feed + /claim (nota tecnica pronta).

## Fatto v0.8.34 (2026-06-25) — Kidotel Certified (certificato + badge per-hotel)
- Riga hotel valutato → «Certificato Kidotel»: certificato brandizzato (Produced Work) con punteggio + servizi famiglia e PROVA citata dal sito (con fonte) + attribuzione OSM, da inviare/stampare; e badge HTML copiato negli appunti (link `{base}/hotel/{osm_type}/{osm_id}` → backlink kidotel.co). Implementa la via economica «Kidotel Certified». `buildCertificateHtml`/`badgeSnippet`/`openCertificate`.
- Verificato: tsc pulito, parità 308×3, anteprima (certificato on-brand, screenshot; struttura: nome/punteggio/sigillo/3 prove+fonte/attribuzione OSM/metodo/wordmark; no contatti; badge URL ok), 0 errori console.
- **Nota tecnica per kidotel.co** pronta (trilingue): `presentazione/kidotel-nota-tecnica-kidotelco.html` (import Feed + endpoint /claim).
- **Prossimo (piano economico)**: metodologia/scoring come API, analytics premium per hotel, outreach 1:1 mirato. Lato kidotel.co: import feed + /claim (vedi nota tecnica).

## Fatto v0.8.33 (2026-06-25) — Report di mercato vendibile (uso economico dato, «da fare ora» #2)
- Nuovo **Report insight** (menu Dati): HTML stampabile con SOLO aggregati (analizzati, family, distribuzione, top destinazioni, continenti) → opera derivata/Produced Work (ODbL §4.5b, no share-alike; statistiche anonime = fuori GDPR), con attribuzione OSM + «non un database». Niente schede-hotel, niente dati interni (funnel/valore). Riusa score_stats/score_histogram/coverage_by_country. Implementa la «da fare ora» #2 del piano economico; la #1 (SEO/classifiche) è coperta dal Feed sito (v0.8.32).
- Verificato: tsc pulito, parità 297×3, anteprima (menu + report renderizzato on-brand, screenshot), controlli strutturali (attribuzione OSM, no contatti, no dati interni), 0 errori console.
- **In sospeso**: lato kidotel.co import feed + endpoint /claim (Django); altre vie economiche (metodologia/API, Kidotel Certified, outreach) = fasi successive del piano.

## Fatto v0.8.32 (2026-06-25) — Fase 1 verso kidotel.co (feed sito + link claim + outreach trilingue)
- Implementata la **Fase 1** del piano operativo (vedi `presentazione/kidotel-piano-operativo.html`): export **«Feed sito»** Produced-Work per kidotel.co (identità+punteggio+fatti+prova breve con fonte+claim_url+links booking(aid)/mappa+attribuzione OSM; NIENTE contatti privati), **link di claim per-hotel** `{base}/claim/{osm_type}/{osm_id}?lang&ff` (base configurabile in Impostazioni→Integrazione kidotel.co), **ID affiliato Booking (aid)** opzionale, **outreach CRM trilingue** (IT/EN/RU) col link di claim.
- Verificato: tsc pulito, parità 286×3, anteprima (gruppo Impostazioni + pulsante «Feed sito» + 0 errori), test logico feed (claim url, no contatti, aid, stima, prova+source). Rispettati i vincoli legali verificati (ODbL produced-work, verbatim, no prezzi reali).
- **Prossimo**: lato kidotel.co servono import feed + endpoint `/claim` (Django) — vedi piano. In sospeso: piano di uso economico della banca dati (ricerca verificata pronta, da presentare).

## Fatto v0.8.31 (2026-06-25) — link hotel che FUNZIONANO (Google falliva per muro cookie UE)
- «Google Hotels non funziona» = da IT google.com/* fa 302→consent.google.com (gl=IT) prima dell'hotel, e seguendo il flusso si arriva a `/travel/unsupported`; la scheda esatta richiede un entity-id opaco non derivabile. → Google tolto del tutto (Hotels+Maps).
- Nuovo set «Apri l'hotel», verificato live (workflow 8 schemi, verifica avversariale), tutto consent-free e che atterra sull'hotel coi soli dati nostri: **Sito** (sito ufficiale, esatto; solo se presente), **Cerca** (DuckDuckGo, sito ufficiale #1), **Booking** (`?ss=`, hotel 1° risultato + prezzi), **Mappa** (OpenStreetMap su coordinate, pin esatto; coord. piena precisione 7 decimali).
- Expedia/Hotels.com: ri-confermato impossibile senza il loro hotel-id interno → roadmap affiliazione.
- Verificato: tsc pulito, parità 279×3 (rimosso ota.find, aggiunti ota.open/link.site/search/map), curl live (Sito/DDG/OSM 200, Booking 202, nessuno tocca consent.google.com; vecchio Google→/travel/unsupported), anteprima monta senza errori coi 4 href corretti.

## Fatto v0.8.30 (2026-06-25) — tolti Expedia/Hotels.com (impossibili senza la loro API) + presentazione RU
- Niente link per-nome alla scheda di un hotel su Expedia/Hotels.com: `destination=` è solo località e il ripiego Google apriva Google (non Expedia) senza mostrare l'hotel. Serve l'hotel-ID via affiliazione EPS (roadmap). Regola «niente funzioni rotte» → rimossi i 2 pulsanti. Restano i 3 che arrivano all'hotel: Google Hotels (mostra anche il prezzo Expedia/Hotels.com con link diretto), Booking, TripAdvisor. NEWS Guida aggiornata it/en/ru.
- Presentazione RU pronta: `presentazione/kidotel-radar-presentation-ru.html` si apre già in russo (default RU robusto). Trilingue invariato.
- Verificato: tsc pulito, parità 276×3, lista OTA = Google Hotels·Booking·TripAdvisor.

## Fatto v0.8.29 (2026-06-25, superato) — tentativo `site:` per Expedia/Hotels.com
- Apriva Google, non Expedia, e non mostrava l'hotel → rimpiazzato in 0.8.30.

## Fatto v0.8.28 (2026-06-25) — «Cerca su» le OTA (ricerca pre-compilata)
- Espandi riga hotel (e CRM) → pulsanti «Cerca su» Google Hotels/Booking/Expedia/Hotels.com/TripAdvisor con ricerca pre-compilata (nome+città+paese). È una RICERCA, non la pagina esatta (quella = API/affiliazione, roadmap v0.5): nessun ID inventato. Riga sempre espandibile. `OTA_SITES`+`OtaLinks`, i18n `ota.find` it/en/ru, CSS `.ota-*`.
- Verificato (anteprima): chip resi, URL corretti, etichetta «Cerca su/Search on/Найти на»; tsc+parità 276×3, 0 errori.

## Fatto v0.8.27 (2026-06-25) — ticker/didascalia traducibili al volo + scorrimento fluido
- Causa «testo non tradotto»: stringhe già tradotte salvate in stato (area, covNote/starsNote/enrichNote) → congelate. Fix: tipo `LiveMsg = (t,lang)=>string`; i messaggi sono FUNZIONI valutate al render → si traducono cambiando lingua anche a scansione in corso. `runCompleteCountry` riceve un prefisso-funzione. Export/print usano `area(t,lang)`.
- Ticker: ripete le voci (≥4) per riempire il nastro (niente spazio vuoto), durata stabile (no reset ad ogni dato), loop -50% continuo destra→sinistra.
- AUDIT trilingue completo: parità chiavi i18n 275×3 (nessuna mancante), Guida 13 sez + 28 NEWS tutte tradotte; workflow multi-agente (verifica avversariale) ha trovato 3 stringhe hardcoded → corrette via t(): «LIVE»→ticker.live (RU «В ЭФИРЕ»), «hotel» (intestazione stampa)→print.hotels, «family» (riga paese Sfoglia)→browse.family. Memoria: [[kidotel-trilingue-sempre]].
- Verificato (anteprima): ticker IT→RU tradotto sul posto coi numeri live; chip LIVE→В ЭФИРЕ; nastro pieno e fluido; progress coerente; tsc ok, parità 275×3, 0 errori.

## Fatto v0.8.26 (2026-06-25) — numeri coerenti + scansione non più bloccata sull'Austria
- **Avanzamento valutazione >100%** (79.443/79.416): causa = upsert `website = excluded.website` azzerava il sito di hotel già valutati (scored > with_site). Fix: upsert `COALESCE(NULLIF(excluded.website,''), hotels.website)` (+phone) preserva il sito; avanzamento = scored/(scored+to_score) con nuovo campo `to_score` in score_stats. Mai più >100%.
- **«Completa tutti» bloccato sull'Austria**: un paese che falliva (Nominatim/Overpass) lanciava e fermava l'intero giro col cursore PRIMA del paese → riavvio ritentava sempre lo stesso. Fix: try/catch per paese → salta e AVANZA il cursore (ritenta al giro dopo); `list_subareas` → 0 regioni invece di throw; stessa resilienza in completeContinent. La copertura ora progredisce.
- Verificato (anteprima mock): avanzamento 79.443/79.443=100% e 79.443/100.000=79%, coerente; tsc+cargo 13/13; 0 errori.

## Fatto v0.8.25 (2026-06-25) — metodo punteggio in Guida + ticker «breaking news» scansioni
- Guida: nuova sezione trilingue «Come si calcola il punteggio (metodo)» — fattori, pesi reali (da signals.json: 22/18/14/12/10/10/8 +6 riservato = 100) e perché; verbatim obbligatorio, no sito = 0, niente inventato.
- Ticker «breaking news»: avanzamenti scansioni separati per canale (`covNote`/`starsNote`/`enrichNote`, non più un solo `notice` che si sovrascrive) → barra ink con chip ● LIVE che fa scorrere INSIEME le scansioni attive coi dati live. CSS `.ticker*` (pausa su hover, reduced-motion). i18n enrich.scoring/evaluated it/en/ru.
- Verificato (mock 2 scansioni //): ticker con 2 voci scorrevoli + numeri live; sezione metodo coi pesi; 0 errori; tsc ok.

## Fatto v0.8.24 (2026-06-25) — CRM su TUTTO l'archivio contattabile (non più 5000)
- Nuovo comando `select_crm` (riga leggera CrmRow, niente breakdown) → il CRM carica tutto l'archivio contattabile in stato dedicato `crmRows` (disaccoppiato dalla pagina d'archivio da 5000). Filtri cumulabili (paese/stelle/family-fit/valore/recapitabile + chip stato) sull'intero set; conteggio+valore totale sull'intero set; tabella max `renderCap` con nota «Mostro i primi N/Totale». Loading + «aggiorna». `contactable` memoizzato. i18n it/en/ru.
- Verificato (mock 7000): conta 7000·€2.327.355 (non 5000), «primi 500/7000»; filtri stack (Switzerland 1166 → +score≥80 = 466); 0 errori. tsc+cargo ok.

## Fatto v0.8.23 (2026-06-25) — manuale in-app con screenshot auto-aggiornati
- Guida con SCREENSHOT reali sotto le sezioni (Hotel/Copertura/CRM/Infografica), nella lingua dell'app (IT/EN/RU). `scripts/capture-manual.mjs` (Playwright + mock invoke Tauri, niente backend/dati reali) → `public/manual/<vista>.<lingua>.png` (12 PNG, scale 1.5). `release.mjs` li rigenera PRIMA del build → manuale sempre allo stato dell'arte. Guida: campo `shot?` + `<img>` lazy con fallback; CSS `.guide-shot`. `playwright` devDep.
- Verificato: 12 PNG generati, anteprima Guida mostra lo screenshot Hotel sotto la sezione, immagini 200 IT/EN/RU, 0 errori; tsc pulito. Le 4 richieste dell'utente (exe-ogni-dmg, aggiungi paesi, scansione a ripresa, manuale con screenshot) COMPLETE.

## Fatto v0.8.22 (2026-06-25) — aggiungi paesi (mondo) + scansione a ripresa
- **WORLD_COUNTRIES** (~190 paesi, nome+continente, alias query Nominatim): selettore «Aggiungi e scansiona» con ricerca in Copertura → scansiona QUALSIASI paese, anche nuovo. CONTINENT derivato dalla lista + alias (no più «(altro)»). `nominatimQuery()` per i nomi pycountry difficili; il timbro resta canonico.
- **«Completa tutti» = mondo intero + RIPRESA**: itera ALL_COUNTRIES (non più solo `coverage`) e usa un cursore `kidotel.scanCursor` (localStorage, per nome): riparte dal paese DOPO l'ultimo completato; UI «riprende da: <paese>» + «ricomincia da capo». Niente più restart dall'Europa.
- .exe Windows: confermato che parte ad OGNI dmg (release.mjs da 0.8.20).
- Verificato (anteprima IT/EN/RU): 193 voci nel selettore, resume corretto (Germany→Gibraltar, Italy→Kosovo), reset ok, 0 errori; Guida+NEWS trilingui. tsc pulito.
- **Prossimo (#4)**: manuale in-app con SCREENSHOT auto-aggiornati ad ogni release (serve Playwright — non ancora presente).

## Fatto v0.8.21 (2026-06-25) — la velocità stelle si attiva davvero
- Il frontend chiedeva ancora `limit:180` → 1 blocco, niente concorrenza. Ora `limit:700` → 4 query concorrenti (1/endpoint): il ~3,8× vale anche nell'app. + release.mjs: check tag silenzioso (niente `fatal:`).

## Fatto v0.8.20 (2026-06-25) — fascia di costo €→€€€€€ + stelle ultra-veloci + .exe automatica
- **Costo €→€€€€€ ($→$$$$$)**: indicatore a 5 livelli per hotel. COMBINATO: `priceRange` schema.org dal sito = REALE (con prova nel tooltip + prezzo/notte), altrimenti STIMA da stelle+lusso+indice-paese. Niente prezzi inventati. Rust `extract_price` (+colonne `price_tier/eur/src`, `set_price`), frontend `priceTierOf`+badge, i18n `price.*` it/en/ru, sezione Guida.
- **Stelle ultra-veloci**: `fetch_stars_for` concorrente con ROTAZIONE endpoint (≤4 blocchi, uno per mirror, una ondata) + client Overpass condiviso + failover. **≈3,8× più veloce** (live: 700 in 42s, ~17/s). Blocchi falliti ritentati (no falso «senza stelle»). Default batch 700.
- **.exe a ogni release**: `release.mjs` ora committa (msg dal CHANGELOG) + spinge branch+tag → CI costruisce .exe+.dmg in bozza e ripulisce le bozze vecchie. Best-effort (serve remote + CI attiva: repo pubblico o billing).
- **Fix**: `applyRows` non passava le colonne prezzo → reale assente nell'Elenco. Allineato.
- Verificato: cargo 13/13 + live (stars 42s, price Schwarzenstein «€€€€»→liv.4); tsc+vite build ok; anteprima (mock) badge €→€€€€€ reale/stima leggibile, tooltip IT/EN/RU, sezione Guida, 0 errori.
- **In sospeso**: Windows (#12) la .exe parte solo con repo PUBBLICO o billing GitHub attivo (l'utente ha scelto «rendi pubblico» — verificata la history pulita: nessun dato/segreto). Presentazione HTML (#13).

## Fatto v0.8.19 (2026-06-25) — manuale completo in russo
- Guida/manuale **interamente in russo**: 11 sezioni Guida + voci NEWS tradotte (workflow multi-agente; 22+16 stringhe), riconciliate con i nomi reali dei pulsanti UI (Измерить, Завершить 100%, Остановить, Люкс, Написать email, Оценить family-fit, По странам). Niente più ripiego inglese per `ru`.
- **Fix corruzione**: `src/App.tsx` aveva 2 **byte NUL** (sentinella `["\0"]` «nessun paese») → file binario per grep/`file`. Sostituiti con escape `"\u0000"` (runtime identico, sorgente UTF-8 valido). Anche 1 NUL accidentale nel CHANGELOG ripulito.
- Verificato a runtime (anteprima RU): Guida aperta, 11 sezioni + NEWS in russo, 0 leak italiani, 0 errori console. tsc pulito.
- **In sospeso**: Windows `.exe` (#12) **bloccato** sul billing GitHub Actions del repo privato (run fallita: pagamenti account). Presentazione HTML (#13) ancora da fare.

## Fatto v0.8.18 (2026-06-25) — recensioni per hotel (import + traducibili)
- Tabella `reviews` + `import_reviews`/`get_reviews`/`review_counts`. Dati▾→Importa recensioni. `ReviewsPanel` nella riga espansa (voto/autore/fonte/data + Traduci), badge conteggio (icona chat). i18n reviews.* it/en/ru. Esempio docs/reviews-sample.json. tsc+cargo+build ok.

## Fatto v0.8.17 (2026-06-25) — traduzione automatica delle prove
- Comando `translate` (gtx, no key, auto-detect) → ProofPanel pulsante «Traduci» per citazione (target=lang app), originale sempre visibile. i18n tr.* it/en/ru. Test live `live_translate` ok. Base per traduzione reviews.

## Fatto v0.8.16 (2026-06-24) — CRM mirato + paginazione
- CRM: filtri targeting (paese/stelle/family-fit/valore≥/solo recapitabile) su `rows`, + valore atteso totale del gruppo. i18n crm.* it/en/ru.
- Paginazione archivio: `list_hotels` +offset; `loadArchive(page)`; stato `archivePage`; pager (← → «pagina i/N») in Elenco quando archiveTotal>5000. i18n page.* it/en/ru. ARCHIVE_PAGE=5000.
- tsc+cargo ok, anteprima 0 errori (CRM/pager su Tauri). Batch utente COMPLETO (6/6).

## Fatto v0.8.15 (2026-06-24) — scansione incrementale + tutti i continenti + stelle in-app + misura salvata
- `scan_log`(area_key,scanned_at) → `discover_area` marca; `areas_scanned_within(keys,days)`; runCompleteCountry salta i fatti <30gg (param force). `completeAllContinents`. `backfill_stars` (comando in-app, blocchi) + pulsante «Assegna stelle». `coverage_meta`+`save_osm_count`/`osm_counts`: misura OSM persistita (caricata al mount). i18n it/en/ru. cargo 12/12, tsc ok, pulsanti RU via DOM.
- Restano del batch utente: **paginazione** (oltre 5000) ; **CRM** (redditività, da scopare).

## Fatto v0.8.14 (2026-06-24) — terza lingua RUSSO
- 235 stringhe UI tradotte in russo via workflow multi-agente (6 traduttori //, parità 235/235). `Lang`=it|en|ru; toggle IT·EN·RU (testata + Impostazioni); init localStorage accetta "ru". Inserito blocco `ru:` nel DICT (i18n). Verificato via screenshot (UI russa pulita).
- Guida/NEWS: `s[lang] ?? s.en` (fallback inglese per ru) + tipo `ru?` opzionale in GuideSection/NEWS. **Manca**: tradurre il MANUALE in russo (parte del prossimo step «manuale completo»).
- Bug workflow risolto: `args` arrivava come STRINGA → `JSON.parse` nello script.
- Resta del batch #16/#17: espandere Guida→manuale (e tradurlo) ; reviews import JSON + traduzione MyMemory.

## Fatto v0.8.13 (2026-06-24) — ripristinata la progressione di «Completa» (paesi/continenti)
- L'auto-chiusura banner a 6s (0.8.3) cancellava anche il banner di progressione live della scansione (una regione dura fino a 240s → spariva subito). Ora l'effetto non si attiva mentre `covBusy`/`loading`/`enriching` sono attivi: il banner «regione i/N — +N nuovi» resta visibile per tutta la scansione.

## Fatto v0.8.12 (2026-06-24) — riquadri statistiche GLOBALI
- I tre riquadri in alto ora leggono `score_stats` (intero archivio): Trovati=total, Valutati=scored/total, Family=strong. Prima «Valutati» mostrava i conteggi della sola vista (≤5000) → inutile sfogliando l'archivio. Rimosse withSite/scoredInView/scoredCountView/strongCount.

## Fatto v0.8.11 (2026-06-24) — stelle internazionali ★1–5 + Lusso (da OSM)
- Tag OSM `stars` catturato allo scan (`parse_stars` gestisce "4S"/"5S"; lusso=5★ Superior o luxury=yes). Colonne `stars`/`luxury` (db.rs migrate + upsert COALESCE + HotelRow/HOTEL_COLS/row_to_hotel). Frontend: tipi Hotel/HotelRow + ★ in `renderHotelRow` (badge `.stars`/`.lux`), i18n `stars.luxury`. Export JSON include stars/luxury.
- Backfill esistenti: `scripts/backfill-stars.mjs` (Overpass per osm_id a blocchi, resumibile, ALTER auto). Verificato live: 71/180 classificati nel 1° blocco. Copertura OSM ~28–40%.
- Distinto dal family-fit (categoria vs adeguatezza famiglie). Test `parse_stars`. cargo 12/12, tsc ok.
- **Batch utente — restano**: 3ª lingua RUSSO + manuale integrato (faccio io); traduzione automatica proof/review (MyMemory, ok inviare a terzi); reviews via import JSON (Cowork). Decisioni già prese.

## Fatto v0.8.10 (2026-06-24) — mappa navigabile (fix «rimbalzo»)
- `MapView`: il `fitBounds` veniva rifatto a OGNI re-render (points = nuovo array ogni render; refreshStats ogni 4s) → la vista tornava all'inquadratura auto e «si restringeva». Ora due firme: `geoSig` (coordinate) → fitBounds SOLO se cambia l'area; `colorSig` (voti+soglia) → ricolora i marker senza toccare la vista. Se nulla di visibile cambia, l'effetto esce subito. Pan/zoom preservati.
- In sospeso (batch richiesto dall'utente, in attesa di decisioni): 3ª lingua RUSSO; traduzione automatica del proof; raccolta reviews traducibili; manuale d'uso integrato; valutazione internazionale ★1–5 + lusso (da OSM `stars`).

## Fatto v0.8.9 (2026-06-24) — VERA causa dello stallo valutazione (panic) + enrich_batch
- **Root cause (diagnosi empirica su DB reale)**: `extract_family_links` andava in **panic** (byte-slicing di &str fuori limite / non su confine char) su HTML reale (virgolette non chiuse, multibyte → siti .de). Panic in un comando async Tauri → `invoke` mai risolto → worker appeso → coda svuotata → **stallo totale**; hotel velenosi in cima a `osm_id` ri-presi ogni giro. Riscritta sui byte con `from_utf8_lossy`. **Test di regressione** `extract_family_links_never_panics` + test live `live_enrich_real_batch`.
- **`enrich_batch`** (nuovo comando): legge blocco → scarica+valuta in parallelo (un task/hotel, client condiviso, 16s) → scrive in **una transazione**. Frontend `enrichAll` ora chiama enrich_batch(24) in loop (rimosse list_unscored-loop, POOL, UnscoredRef). Misurato: 24 hotel in 6s ≈ 14k/h.
- Lezione: **misurare batte indovinare** — i fix timeout (v0.7) erano sul problema sbagliato; il test sul DB reale ha trovato subito il panic (byte 22125).
- Verificato: tsc + cargo test 12/12 + live (62.255→62.279).

## Fatto v0.8.8 (2026-06-24) — riorganizzazione struttura (menu bar + sfoglia per paese)
Su richiesta dell'utente (confermati i 3 default via AskUserQuestion).
- **Menu bar** (Hotel · Mappa · Copertura · CRM · Infografica · Dati▾) sostituisce la **sidebar**. `viewMode` "table"→"hotel"; ogni vista ha la sua toolbar.
- **Scan in Copertura**: pannello «Scansiona» in cima a `CoverageView` (nuove props query/setQuery/onScan/scanning); dopo lo scan si va in Hotel/Elenco.
- **Dati▾** dropdown (Esporta selezione, Backup esp/imp, AI esp/imp) con titoli di gruppo. **Infografica** voce di menu a sé.
- **Sfoglia per paese**: `hotelMode` "country"|"flat". Country = fisarmonica da `coverage`; espandi → `toggleCountry` carica via `select_hotels({countries:[c]})` (cache `countryRows`), mappa con `hotelRowToHotel`/`breakdownToSc`/`erFromRow`, render con `renderHotelRow` (condiviso con l'elenco piatto). `loadCoverage()` aggiunto al mount.
- Verificato: tsc + build ok, screenshot (menu bar, toggle, Dati, scan in Copertura), 0 errori. Sfoglia con dati reali da provare sull'app.
- Limite noto: la cache `countryRows` non si auto-rinfresca dopo enrich/scan (riapri il paese per aggiornare).

## Fatto v0.8.7 (2026-06-24) — punteggi percepibili + valutazione senza stalli
- **Heat scale** dei voti: `scoreHeat(s, soglia)` in App.tsx → grigio sotto soglia, pesca→ambra profonda sopra; applicato ai badge tabella+CRM (rimosse le fasce piatte e il CSS morto `.score-*`). Numeri bold tabulari.
- **Fix «valutazione si blocca quasi subito»**: (1) `enrich_client()` condiviso (OnceLock) con timeout corti (connect 6s/tot 10s) invece di ricostruire il client a ogni hotel; (2) tetto duro **16s/hotel** via `tokio::time::timeout` su `gather_pages`; (3) avanzamento incrementale in `enrichAll` (flush ogni ~8 hotel, blocco 80→60).
- Verificato: cargo+tsc ok, scala heat via screenshot. Comportamento rete da provare sull'app installata.

## Fatto v0.8.6 (2026-06-24) — VESTE BRAND Kidotel
Adottati logo/colori/font ufficiali (brand book). Riferimento permanente: `docs/BRAND.md` + memoria `kidotel-brand`.
- **Logo wordmark** «Kidotel»+scia radar (`Wordmark.tsx`, currentColor, unica fonte; `wordmarkSvg()` per HTML) in testata/infografica/report; favicon `public/kidotel.svg`; title corretto.
- **Colori**: ink #222223, bg #F5F5F5, peach #FFC27B, ambra #EF9F27, deep #A8650F. **Niente verde** nella veste (resta solo nei pallini stato CRM = codifica dati funzionale, e rosso errore semantico).
- **Font**: Sora (titoli) + Manrope (corpo), offline via `@fontsource-variable/*`.
- **Fix**: i blocchi tema ridefiniscono anche `--ink/--brand-strong/--brand-soft` (altrimenti wordmark invisibile su sistema-scuro+tema-chiaro).
- Verificato: tsc ok, screenshot (testata, infografica, dark), workflow avversariale (colori/contrasto/completezza). Restano roadmap **#12** Windows, **#13** presentazione.

## Fatto v0.8.5 (2026-06-24) — Infografica stampabile (#9)
- Nuovo **«Infografica»** (pannello Dati): cruscotto dai dati reali con **anteprima iframe** + **stampa**. Sezioni: KPI, distribuzione punteggi (istogramma 10 fasce), top 10 paesi family, copertura per continente, funnel CRM, valore atteso. Opzioni: orientamento + sezioni. «Stampa» → `open_report` (browser di sistema: PDF/A4/margini; in Tauri `window.print()` è no-op). «Salva HTML».
- Backend: `score_histogram` (10 fasce). Design on-brand verde/ambra, `@media print`, 100% dati reali.
- Verificato: `tsc` ok, `cargo test` 10/10, **resa infografica verificata via screenshot** in anteprima (hook DEV con dati di prova → `window.__infoHtml`), 0 errori console.
- Roadmap: restano **#12** Windows .exe (CI) e **#13** presentazione HTML.

## Fatto v0.8.4 (2026-06-24) — Esporta selezione (cowork) (#8)
- Nuovo dialog **«Esporta selezione»** (pannello Dati): compone il gruppo da condividere con **conteggio live** → Ambito (Tutti/Continente/Paese) + Fascia punteggio (es. 59–100) + «migliori N» + filtri (valutati/contattabili/email recapitabile). Esporta **CSV** (Excel) e **JSON** strutturato (con prove citate).
- Backend: `count_select` + `select_hotels` con query **parametrica** (`build_select_where`, parametri legati). Test unitari (3).
- Verificato: `tsc` ok, `cargo test` 10/10, anteprima 0 errori (conteggio/file su Tauri).
- La risposta di Giovanni ha riorientato #8: non i formati ma **i modi di raggruppare** (continente, top 1000, range 59–X, tutte) → fatto esattamente così.
- Roadmap: restano **#9** infografica stampabile, **#12** Windows .exe (CI), **#13** presentazione HTML.

## Fatto v0.8.3 (2026-06-24) — REVISIONE COMPLETA (audit #11)
Audit multi-agente di tutto il programma → fix per priorità (dettaglio in CHANGELOG).
- **BLOCKER**: `import_backup` rimuove i sidecar `-wal`/`-shm` dopo la copia (prima corrompeva ogni ripristino).
- **Bug**: `coverage_by_country` niente doppioni «(sconosciuto)» (GROUP BY = espressione etichetta); `find_email` strutturale (non scarta più `firstname@`/`superuser@`/`info@email-*`), allineati anche gli script JS + test; nota CRM si riallinea ai dati; `enrichAll` non stravolge più la vista (aggiorna voti sul posto, ricarica archivio solo se lo guardi); `release.mjs` non cancella più il dmg su Intel.
- **Armonizzazione soglia family = fonte di verità unica**: `score_stats`/`coverage_by_country` con parametro `threshold`; `tier()` e `MapView.colorFor()` relativi alla soglia; intestazione Copertura `(≥soglia)` dinamica; header CSV localizzato; `Türkiye`/`Viet Nam` nella mappa ER.
- **Rifiniture**: modali con Esc/`role=dialog`/autofocus; banner auto-chiusura 6s + clic; `email_checked` nello schema; `open_db` busy_timeout via API + verifica WAL; `backup-db.mjs` copia i sidecar se il checkpoint fallisce; vari nit (renderCap nel CRM, codice morto rimosso, report localizzato).
- **Verificato**: `tsc` pulito; `cargo test` 7/7 (+ nuovi casi find_email).
- Roadmap utente: restano **#8** più export Cowork, **#9** infografica stampabile, **#12** Windows .exe (CI), **#13** presentazione HTML.

## Fatto v0.8.2 (2026-06-24) — scan per continente + copyright
- **«Completa continente»**: pulsante per ogni intestazione continente in Copertura → completa tutti i paesi del continente in sequenza (core `runCompleteCountry` riusato), con avanzamento e Ferma.
- **© Giovanni Bucolo** nel footer, Guida, report di stampa.
- Roadmap 7 punti dell'utente (task #7-13): #7 continent-scan ✓, #10 copyright ✓. Restano: #8 più export Cowork, #9 infografica stampabile, #11 audit (workflow in corso), #12 Windows .exe (CI, serve repo remoto), #13 presentazione HTML.

## Fatto v0.8.1 (2026-06-24) — "Completa" universale + Copertura per continente
- **"no regions found" (Grecia/Giamaica/Aruba)**: `list_subareas` ora è una **cascata** — prova admin_level 4→6→5→3 (filtrati per ISO3166-2 del paese); **fallback: paese intero come unica area** scansionata a tasselli col ritaglio sul confine → ogni paese scansionabile. (Diagnosi Grecia: admin_level=4 = amm. decentralizzate senza ISO + "Muğla" turca per contaminazione → filtro le scartava → fallback.)
- **Copertura raggruppata per CONTINENTE**, paesi alfabetici nel continente. Mappa `CONTINENT` (~140 paesi) + `CONTINENT_ORDER` + i18n `cont.*`. Verificato in anteprima.

## Fatto v0.8.0 (2026-06-24) — Guida integrata + Impostazioni
- **Guida in-app** (icona ?): bilingue IT/EN, una sezione per funzione + versione + «Novità di questa versione». Contenuto in `src/guide.ts` → **aggiornare a ogni release** (sezioni + NEWS) come il changelog.
- **Impostazioni** (icona ⚙, persistite in localStorage `kidotel.settings`): Lingua, **Tema Auto/Chiaro/Scuro** (override `prefers-color-scheme` via `html[data-theme]`), **Soglia family (≥N)** (statistica), **Righe in tabella** (render cap della tabella principale), **Assunzioni ER** (valore/commissione/volume — ora vivono nelle impostazioni, non più stato volatile). Icone Heroicon nuove: cog/help/x.
- Verificato in anteprima: Guida resa, cambio tema applicato+salvato, 0 errori. Responsive.

## Fatto v0.7.5/0.7.6 (2026-06-24) — tono email + numeri "Completa" onesti
- **Email outreach** riscritta: sempre INGLESE, formale, plurale (The Kidotel Team), filosofia + selezione rigorosa + opportunità + prove verbatim. `EN_SIGNAL` per le etichette.
- **"I numeri Italia non cambiano" = non un bug**: Italia ~96% (21.336/22.107 hotel CON NOME su OSM; gli anonimi non usabili). Corretto: grado conta solo `["name"]` (denominatore onesto); la nota di "Completa" mostra i NUOVI (delta DB) non i trovati. `loadCoverage` ritorna l'array per calcolare il delta. Verificato: "+240 nuovi" dove c'è margine, "+0" se completo.
- Valore di "Completa" sui paesi SOTTO-coperti (USA…).

## Fatto v0.7.4 (2026-06-24) — "Completa 100%" alla radice (+0 e Stop)
- **+0**: "Completa" ri-geocodificava ogni regione su Nominatim → raffica → blocco IP → scansioni a vuoto. Ora si scansiona **PER AREA**: `list_subareas` restituisce osm_id+bbox (`out tags bb`), nuovo comando `discover_area(osm_type,osm_id,bbox,country)` riusa il motore tasselli/confine + timbra paese. ZERO Nominatim per regione. Verificato: +300/regione, Trovati cresce live.
- **Stop**: prima restava incastrato nei retry Nominatim; ora flag controllato prima/dopo ogni regione → interrompe subito (verificato "fermato 1/3"). Throttle 600ms tra regioni.
- Limite residuo noto: lo Stop ferma *dopo la regione in corso* (una regione è limitata da SCAN_BUDGET 240s; di norma pochi secondi).

## Fatto v0.7.3 (2026-06-24) — gate deliverability email
- `scripts/verify-emails.mjs`: classifica via DNS/MX (no API, no invii) → colonna `email_status` (ok/role/risky/no_mx/bad). Eseguito: **25.049 contattabili** (ok 9.035 + role 16.014), 293 no_mx, 216 risky, 35 bad.
- CRM: email colorata per stato + tooltip; "Scrivi email" NON apre il client verso indirizzi non recapitabili (copia bozza + avviso). `email_status` in `db.rs`/`list_hotels`. Pronto per filtrare l'outreach su ok/role.
- **Geo "(sconosciuto)" — chiuso anche l'ultimo buco**: `backfill-geo.py --new` ora copre `region IS NULL OR country IS NULL/''` (prima saltava le righe con regione ma senza paese). Ripulito a 0. world-scan auto-backfilla con questo `--new`; in-app `discover` timbra già il paese.

## Fatto v0.7.1/0.7.2 (2026-06-24) — "Completa" funzionante e visibile
- "Completa sembrava non girare". Cause: (1) lento/silenzioso → ora **aggiorna la tabella dopo OGNI regione** (Trovati cresce live) + **pulsante Ferma**; (2) **CAUSA REALE**: gli hotel scoperti entravano con codice paese OSM ("IT")/vuoto → bucket sbagliato in Copertura, il paese non cresceva. Ora `discover` **timbra il nome paese pieno** (geocodifica) su tutti gli hotel dell'area. Backend verificato live (Italia 22.923 OSM, 20 regioni). v0.7.2 installata.

## Fatto v0.7.0 (2026-06-24) — copertura per paese: grado reale + "Completa 100%"
- **Grado di copertura reale**: comando `osm_hotel_count` (Overpass count per CONFINE → ok anche paesi enormi/antimeridiano) → in Copertura il pulsante **"Misura"** mostra `trovati / totale OSM (%)`. Austria 6.257/6.371=98% verificato.
- **"Completa 100%"**: comando `list_subareas` (regioni admin_level=4, filtrate per `ISO3166-2` → no regioni estere) → la UI scansiona ogni regione (`discover` con "{regione}, {paese}"), avanzamento, poi ri-misura. **USA/Francia/Russia** ora copribili regione-per-regione (risolve il paradosso "paesi grandi sotto-rappresentati"). `Bbox` cattura `country_code` (Nominatim addressdetails).
- Verificato in anteprima: grado (Austria 98%, Italy 77%), Completa→list_subareas+discover per regione+ri-misura, 0 errori. `cargo check`/`tsc` ok.

## Fatto v0.6.2 (2026-06-24) — avvio piano "al massimo livello" (scope GLOBALE, no Alpi)
- **WAL + busy_timeout + indici** (`db.rs` open_db/migrate + applicato live): niente lock, query calde indicizzate.
- **Backup**: `export_backup` con `wal_checkpoint`; nuovo `scripts/backup-db.mjs` (versionato locale, primo backup 72MB in ~/kidotel-backups). Rischio "copia unica" mitigato (offsite vero = sync cloud, non fatto: dati sensibili).
- **Catene**: colonna `is_chain` + `scripts/flag-chains.mjs` (domini catena/OTA curati + brand; precisione: portali regionali salvi, family≥60 non marcati per nome). 18.012 marcati; **sito li esclude**. Sito rigenerato: 5 paesi · 6 regioni · 106 hotel ×2.
- **Verifica onesta**: "fix valutatore" del piano DECLASSATO — falsi positivi rarissimi sui dati reali (2 a ≥60, 1 legittimo); la leva è il recupero AI (Cowork), non le regole. Task chiuso.
- **Piano completo** salvato concettualmente: stella polare = partner verificati/mese; percorso critico = pubblica sito → allarga pool (AI) → pulisci → lavora i lead → sequenze+misura. (Sito e affiliazione dipendono dall'utente: hosting + account.)
- Roadmap residua: AI-rescore fascia 40-59 (Cowork), email deliverability+suppression, dedup vs 300 partner, CRM "target di oggi", privacy/ODbL sul sito, .exe+PMU (CI), un solo motore di scoring.

## Fatto v0.6.1 (2026-06-24) — scansione paesi grandi
- "United States"/Francia/Russia davano "area troppo grande": il bbox attraversa l'antimeridiano (span ~360°). Guard ora distingue: **span>90°** (paese sparso) → "scansiona per stato/regione/città"; **continente** → rifiutato; sopra 2000 deg² consente solo `addresstype=country` → **Canada/Cina/Brasile ora si scansionano a tasselli** (Africa/Asia/Europa no, perché Nominatim dà loro bbox ~2500 < Canada 3694). `addresstype` aggiunto a `Bbox`.
- world-scan: aggiunti **USA per stato** + **Canada per provincia** (copertura paesi enormi nel modo giusto), in corso.
- **"(sconosciuto)" ricorrente — risolto alla radice**: il world-scan inseriva hotel con sole coordinate → restavano senza paese finché non si lanciava il backfill a mano. Ora il world-scan **esegue il geo-backfill automatico alla fine di ogni giro** (`python3 backfill-geo.py --new`). Non si accumula più. (Nota: gli scan manuali in-app inseriscono con addr:country OSM; restano un caso minore — la fonte di massa, world-scan, ora si auto-sana.)

## Fatto (2026-06-24) — (a) Sito pubblico / motore di domanda SEO
- **`scripts/build-site.mjs`**: genera un SITO STATICO bilingue IT/EN dai dati (legge il SQLite) — il motore di DOMANDA per traffico organico → affiliazione. Progettato con un panel multi-agente (SEO programmatica, dati strutturati, monetizzazione, E-E-A-T).
- Tipi di pagina con **soglie anti-thin**: hub paese (≥8 eligibili), hub regione (≥8 @≥60), scheda hotel (gate rigido: score≥60 + sito + ≥3 segnali + ≥2 citazioni ≥40 char + ≥1 non-boilerplate). Oggi: **5 paesi · 5 regioni · 91 hotel ×2 lingue · 210 URL** (27 regioni sotto soglia saltate). Wedge alpino (Salzburg, Tyrol, Trentino-Alto Adige, Bavaria).
- **La prova guida, la CTA segue.** JSON-LD onesto (BreadcrumbList+LodgingBusiness+FAQPage, MAI aggregateRating). Affiliazione **swappabile** via `scripts/affiliate.config.json` (oggi provider="direct" = sito hotel; passare a "booking" + aid quando c'è l'account). `renderLink` applica rel=sponsored/nofollow; **disclosure** FTC su ogni pagina con CTA. sitemap.xml (solo indicizzabili), robots.txt, hreflang it/en/x-default.
- Anteprima statica via launch `kidotel-site` (porta 4321). Verificato: scheda hotel e hub regione resi, JSON-LD valido, 0 errori console.
- **2 bug dati corretti**: (1) `country` tornava al codice ISO ("AT") al ri-scan → `upsert_hotels` ora PRESERVA city/country (COALESCE, niente clobber dell'addr:country OSM) + rilanciato backfill totale (Austria 93, niente vuoti). *(richiede rebuild app per il fix upsert)*. (2) backfill `--new` saltava i ri-scan: usato backfill totale.
- **Prossimo**: (b) generatore email di outreach personalizzate dal CRM; poi le altre cose (vedi roadmap profitto).

## In corso (2026-06-24) — email di massa + scoring più veloce
- **`scripts/harvest-emails.mjs`** (nuovo): harvest email di massa per gli hotel con sito senza email (home + 1 pagina contatti, `findEmail` come nel Rust), concorrente (POOL 24) e **riprendibile** via colonna `email_checked`. Tocca solo la colonna `email` → gira INSIEME allo scorer. busy_timeout=60s su entrambi per non scontrarsi su SQLite.
- **`scripts/score-free.mjs`** aggiornato: estrae anche l'**email** durante il crawl di scoring + busy_timeout. Rilanciato a **POOL=20** (più veloce). Stato pre-rilancio: 21.426/29.477 valutati, 5 email.
- Entrambi lanciati in background **con rete** (l'ambiente Bash a volte non ha rete: usare `dangerouslyDisableSandbox`). Nota: i 65k erano stati raccolti senza email (OSM raramente la espone) → l'harvest le recupera dai siti. Hit-rate email ~49%.
- **BUG corretto**: `PRAGMA busy_timeout=N` STAMPA il valore e inquinava il parsing (count=0, rischio loop infinito a coda vuota). Sostituito col dot-command **`.timeout 60000`** (nessun output) in score-free, harvest-emails e world-scan.
- **`world-scan.mjs`** (breadth) RILANCIATO con rete (+~80 nuove zone, riprendibile, ora lock-safe con `.timeout`).
- Tutti e tre i crawler girano insieme su SQLite con busy_timeout 60s. Tre processi: scorer (score+email), harvest (email), world-scan (nuove aree).

## Fatto v0.5.1 (2026-06-24) — link che si aprono + scansione resiliente + email dal sito
- **Link esterni** (sito/email/telefono) ora aprono via comando `open_url` (plugin opener): in Tauri `<a target="_blank">` è no-op. Vale per colonna Sito, contatti CRM, fonti Prova. Verificato in anteprima (open_url con URL giusto).
- **Geocodifica resiliente**: Nominatim con **3 tentativi + backoff**; se irraggiungibile, **bbox dall'archivio** (hotel già salvati per quell'area → ri-scan di un paese noto funziona offline-da-Nominatim, a tasselli per bbox). Risolve l'errore "error sending request … nominatim".
- **Email estratta dal sito** in `enrich_hotel` (HTML grezzo: mailto/JSON-LD, scarta falsi positivi, preferisce info@/reception…); salvata se assente. Dato reale dal sito. NB: i 65k già in archivio non hanno email finché non li rivaluti dentro l'app; OSM raramente la espone.
- `cargo test` **7/7** (nuovo `find_email`). `tsc` pulito.

## Fatto v0.5.0 (2026-06-24) — CRM/Outreach + scansione a tasselli
- **CRM**: vista con hotel contattabili ordinati per valore atteso, **stato contatto** (da_contattare→contattato→risposto→trattativa→partner/rifiutato) + **nota** + contatti cliccabili (email/sito/tel), filtri+conteggi. Stato/nota nel DB, sopravvivono a scan e backup. Comandi `set_contact`/`contact_stats`. **Email** catturata da OSM (`email`/`contact:email`) e nel CSV (con stato+nota).
- **Scansione a TASSELLI** per aree grandi (paese/regione estesa): bbox diviso in riquadri ~1.5° intersecati col confine; ogni query piccola e veloce → niente timeout/sovraccarico. **Budget 240s** con risultati parziali. Cascata 1 giro + 1 ritentativo, no ritento su 400. Risolve il difetto trovato dalla **review avversariale** (v0.4.1 poteva restare appeso ~decine di min). `split_tiles` pura, **3 test** verdi.
- **Schema autosufficiente**: `open_db` migra le colonne opzionali (region/province/email/contact_*) — prima region/province le creava solo lo script Python (installazione nuova sarebbe stata rotta).
- Verificato: `cargo test` 6/6, `tsc` pulito, anteprima CRM (ordinamento valore atteso, set_contact con args giusti, filtri, IT+EN, niente errori console).

## Fatto v0.4.1 (2026-06-24) — fix scansioni paesi/regioni
- **Le scansioni andavano in errore** su aree grandi (es. "Germany"): il client HTTP uccideva ogni richiesta a 20s ma Overpass per un paese impiega >1 min. **Causa verificata** dal flusso: Nominatim passava (geocodifica ok), falliva solo lo step Overpass cadendo sul mirror instabile maps.mail.ru.
- Fix: **timeout per-richiesta Overpass 150s** + **connect_timeout 10s** (scarta in fretta gli endpoint morti); **endpoint rinnovati** (kumi → lz4 per query grandi → private.coffee → overpass-api.de → z; rimosso maps.mail.ru); **2 giri con backoff 3s**; errori più chiari. Aggiunta dep `tokio` (feature time). `cargo test` 3/3, `cargo check` ok.
- **release.mjs**: ora **stacca le immagini DMG montate orfane** (/Volumes/dmg.*) prima di buildare — era il motivo per cui il bundle DMG falliva (memo [[tauri-dmg-mount-orfani]]).
- Rete non testabile da qui (ambiente Bash senza rete in uscita): la scansione va verificata live nell'app.

## Fatto v0.4.0 (2026-06-24) — redditività + copertura
- **Motore di redditività (Valore atteso €/anno).** Colonna in tabella + ordinamento "Valore atteso ↓" + pannello **"Assunzioni del modello"** (3 manopole: valore medio prenotazione, commissione %, prenotazioni/anno) + totale vista. `ER = valore × indice_paese × commissione% × p_partner × volume`, con `p_partner` e `volume` crescenti col family-fit. Indice valore per ~45 paesi. In CSV. Etichettato come **stima per dare priorità** (i dati family restano con prova; footer aggiornato).
- **Vista "Copertura"** (grado di scansione per paese): trovati / valutati (%) / family (≥60), barra volume e % colorata; pulsante **"Scansiona"** per riga che concentra la scansione su quel paese. Comando Rust `coverage_by_country`.
- **Geo-backfill totale eseguito**: tutti i **65.250** hotel ora hanno paese (prima 17.640 "(sconosciuto)" → 0). Copertura ora accurata: Italy 12.487, Germany 7.656, Spain 5.754, Japan 4.115, Austria 3.582…
- **world-scan ampliato**: +~80 nuove zone family (Italia regioni, Alpi, Spagna/Portogallo, Balcani/Grecia, Nord Europa, Asia/ME, Africa, Americhe, Oceania). **Pronto ma non ancora girato**: in questa sessione l'ambiente Bash non aveva rete in uscita (verificato: host esterni → 000). Da rilanciare con `node scripts/world-scan.mjs` quando c'è rete (riprende dalle 57 fatte, restano 89).
- **score-free in corso**: valutazione gratuita a regole sull'archivio, 15.042 valutati e in crescita (processo avviato in sessione precedente, con rete).
- Verificato: `cargo check` ok, `tsc --noEmit` pulito, anteprima IT+EN senza errori; ER (Testerhof 94→€544, Familienhotel 66→€244, Albergo Rosa 14→€10) e copertura confrontata con `sqlite3`.

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

- v0.4.0: **connettore MCP live** `mcp-server/` (binario `kidotel-mcp`): Cowork interroga il DB e scrive i voti senza file. Tool: stats/get_unscored/query_hotels/set_score. Protocollo verificato (initialize/tools-list/lettura→scrittura). Collegamento Cowork da confermare insieme (`docs/MCP-COWORK.md`).

- v0.3.2: messaggio "area troppo grande" per i continenti; soglia family ≥60; **scansione mondiale incrementale** `scripts/world-scan.mjs` (a tappe, riprendibile, dedup).

## Prossimo passo
- Far girare/rilanciare `node scripts/world-scan.mjs` per incrementare l'archivio mondiale (aggiungere zone in PLACES).
- Valutazione AI a regime via MCP locale (`kidotel` tools) o script.
- Refactor Rust in moduli `discovery`/`crawl`/`scoring` con interfaccia `Scorer`.
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
