// Contenuto della GUIDA in-app (bilingue IT/EN). Si aggiorna a ogni release: aggiornare le sezioni
// quando cambiano le funzioni e aggiungere in NEWS le novità della versione corrente.

type Loc = { t: string; b: string };
export type GuideSection = {
  icon: string; // nome icona Heroicon (vedi components/Icon.tsx)
  it: Loc;
  en: Loc;
  ru?: Loc; // russo opzionale: finché manca, l'app ripiega sull'inglese
};

export const GUIDE: GuideSection[] = [
  {
    icon: "list",
    it: { t: "Hotel — sfoglia e cerca", b: "La vista «Hotel» mostra l'archivio. «Per paese»: apri un paese (es. Austria) e vedi i suoi hotel, caricati su richiesta dall'intero database. «Elenco»: lista piatta ordinata per voto o valore atteso, con ricerca per nome/città/regione. Il colore del voto è una scala continua: più caldo = più adatto alle famiglie. «Valuta family-fit» avvia la valutazione di tutti i non valutati." },
    en: { t: "Hotels — browse and search", b: "The «Hotels» view shows the archive. «By country»: open a country (e.g. Austria) to see its hotels, loaded on demand from the whole database. «List»: a flat list sorted by score or expected value, with name/city/region search. The score color is a continuous scale: warmer = more family-friendly. «Score family-fit» runs scoring on everything unscored." },
  },
  {
    icon: "signal",
    it: { t: "Scansiona (in Copertura)", b: "In «Copertura», il pannello «Scansiona» trova hotel NUOVI da OpenStreetMap e li aggiunge all'archivio. Funziona ovunque: città, provincia, regione o paese. I paesi enormi (USA, Francia) vanno scansionati per stato/regione o con «Completa 100%». I risultati si guardano poi nella vista «Hotel»." },
    en: { t: "Scan (in Coverage)", b: "In «Coverage», the «Scan» panel finds NEW hotels from OpenStreetMap and adds them. Works anywhere: city, province, region or country. Huge countries (US, France) should be scanned by state/region or via “Complete 100%”. Results are then viewed in «Hotels»." },
  },
  {
    icon: "sparkles",
    it: { t: "Valutazione family-fit", b: "Assegna a ogni hotel un punteggio 0–100 leggendo il suo sito ufficiale in qualsiasi lingua, con un riconoscitore multilingue a regole — gratis, senza alcuna chiave API. Ogni servizio per famiglie vale solo se accompagnato dalla FRASE citata dal sito e verificata parola per parola. Zero dati inventati. La barra in alto mostra l'avanzamento; «Prova» mostra le citazioni." },
    en: { t: "Family-fit scoring", b: "Gives each hotel a 0–100 score by reading its official website in any language, with a multilingual rule-based recognizer — free, no API key. A family service counts only if backed by the SENTENCE quoted from the site and verified word for word. Nothing invented. The top bar shows progress; “Proof” shows the quotes." },
  },
  {
    icon: "sparkles",
    it: { t: "Stelle (classificazione internazionale)", b: "Accanto al nome compare la classificazione ufficiale a stelle (★1–5) presa da OpenStreetMap, con il bollino «Lusso» per i 5 stelle Superior. È un dato REALE (non inventato): dove OSM non lo riporta, non viene mostrato nulla. È diverso dal voto family-fit: le stelle dicono la categoria dell'hotel, il family-fit dice quanto è adatto alle famiglie. Per riempirle sugli hotel già censiti lancia una volta «node scripts/backfill-stars.mjs»; le nuove scansioni le prendono in automatico." },
    en: { t: "Stars (international classification)", b: "Next to the name you see the official star rating (★1–5) from OpenStreetMap, with a “Luxury” badge for 5-star Superior. It is REAL data (not invented): where OSM doesn't report it, nothing is shown. It differs from the family-fit score: stars tell the hotel category, family-fit tells how family-friendly it is. To fill it for already-scanned hotels run once “node scripts/backfill-stars.mjs”; new scans capture it automatically." },
  },
  {
    icon: "pin",
    it: { t: "Copertura per paese", b: "Mostra, per ogni paese, quanti hotel hai (Trovati), quanti valutati e quanti family (≥ soglia). «Misura» calcola quanti hotel con nome esistono davvero su OpenStreetMap → il GRADO di copertura reale. «Completa 100%» scansiona il paese regione per regione per riempirlo (anche USA/Francia); puoi fermarlo con «Ferma»." },
    en: { t: "Coverage by country", b: "Shows, per country, how many hotels you have (Found), how many scored and how many family (≥ threshold). “Measure” computes how many named hotels actually exist on OpenStreetMap → the real coverage GRADE. “Complete 100%” scans the country region by region to fill it (even US/France); you can stop it with “Stop”." },
  },
  {
    icon: "list",
    it: { t: "CRM · acquisizione partner", b: "Gli hotel contattabili ordinati per VALORE ATTESO, con stato del contatto (da contattare → contattato → ha risposto → in trattativa → partner / rifiutato) e nota. «Scrivi email» genera un'email professionale in inglese, personalizzata con le prove dal sito. L'email è colorata per RECAPITABILITÀ (verde = valida, barrata = non recapitabile): non scrive verso indirizzi che rimbalzerebbero. Stato e note restano nel database e sopravvivono a scansioni e backup." },
    en: { t: "CRM · partner acquisition", b: "Contactable hotels ranked by EXPECTED VALUE, with contact status (to contact → contacted → replied → negotiating → partner / declined) and a note. “Write email” generates a professional English email, personalized with the proof from the site. The email is colored by DELIVERABILITY (green = valid, struck-through = undeliverable): it won't write to addresses that would bounce. Status and notes live in the database and survive scans and backups." },
  },
  {
    icon: "sparkles",
    it: { t: "Valore atteso (redditività)", b: "Stima quanto vale ogni hotel come partner: valore prenotazione × indice paese × commissione% × probabilità-partner × volume, dove probabilità e volume crescono col family-fit. È una STIMA per dare priorità, non un dato verificato. Regola le tre manopole in «Assunzioni del modello» o nelle Impostazioni." },
    en: { t: "Expected value (revenue)", b: "Estimates each hotel's worth as a partner: booking value × country index × commission% × partner-probability × volume, where probability and volume grow with family-fit. It is an ESTIMATE for prioritizing, not verified data. Tune the three knobs in “Model assumptions” or in Settings." },
  },
  {
    icon: "chart",
    it: { t: "Infografica stampabile", b: "Genera un cruscotto visivo dai tuoi dati reali: numeri chiave (hotel, valutati, family, contattabili), distribuzione dei punteggi, top paesi per family hotel, copertura per continente, funnel di acquisizione (CRM) e valore atteso totale. Scegli orientamento e quali sezioni includere; «Stampa» la apre nel browser di sistema, dove hai tutte le opzioni (PDF, A4/Lettera, margini). Nessun dato inventato." },
    en: { t: "Printable infographic", b: "Generate a visual dashboard from your real data: key figures (hotels, scored, family, contactable), score distribution, top countries by family hotel, coverage by continent, acquisition funnel (CRM) and total expected value. Choose orientation and which sections to include; “Print” opens it in the system browser, with every option (PDF, A4/Letter, margins). Nothing invented." },
  },
  {
    icon: "download",
    it: { t: "Dati, backup ed esportazione", b: "Esporta/importa l'intero archivio come un singolo file .sqlite (l'unica copia dei tuoi dati: fai backup spesso). «Esporta selezione» compone il gruppo da condividere coi collaboratori scegliendo l'ambito (tutti / un continente / un paese), una fascia di punteggio (es. 59–100) o «le migliori N», più filtri (solo valutati / contattabili / email recapitabile): salvi in CSV (apre in Excel) o in JSON strutturato con le prove citate." },
    en: { t: "Data, backup and export", b: "Export/import the whole archive as a single .sqlite file (the only copy of your data: back up often). “Export selection” composes the group to share with collaborators by choosing the scope (all / a continent / a country), a score range (e.g. 59–100) or “top N”, plus filters (scored / contactable / deliverable email): save to CSV (opens in Excel) or structured JSON with the cited proof." },
  },
  {
    icon: "sparkles",
    it: { t: "AI · Cowork", b: "Per superare il tetto delle regole, esporta un lotto di hotel da valutare, falli leggere all'AI (Cowork, col tuo piano Claude — nessuna chiave API) e reimporta i voti con la prova. L'AI legge i siti in ogni lingua e coglie sfumature che le regole non vedono." },
    en: { t: "AI · Cowork", b: "To go beyond the rules' ceiling, export a batch of hotels to score, have the AI read them (Cowork, on your Claude plan — no API key) and re-import the scores with the proof. The AI reads sites in any language and catches nuances the rules miss." },
  },
];

// Novità della versione corrente (aggiornare a ogni release). Mostrate in cima alla Guida.
export const NEWS: { it: string; en: string; ru?: string }[] = [
  { it: "Traduzione automatica delle prove: sotto ogni citazione c'è «Traduci» che la rende nella lingua dell'app (IT/EN/RU). L'originale verbatim resta sempre visibile.", en: "Automatic proof translation: under each quote a «Translate» button renders it in the app language (IT/EN/RU). The verbatim original stays visible.", ru: "Автоперевод доказательств: под каждой цитатой кнопка «Перевести» на язык приложения (IT/EN/RU). Оригинал всегда виден." },
  { it: "CRM più mirato: filtri per concentrarti sui prospect più redditizi (paese, stelle ★, family-fit, valore atteso minimo, solo email recapitabile) + il valore atteso totale del gruppo selezionato.", en: "Sharper CRM: filters to focus on the most profitable prospects (country, stars ★, family-fit, min expected value, deliverable email only) + the total expected value of the selected group.", ru: "Точнее CRM: фильтры по самым выгодным (страна, звёзды ★, family-fit, мин. ожидаемая ценность, только доставляемый email) + суммарная ожидаемая ценность выборки." },
  { it: "Paginazione: l'elenco dell'archivio ora si sfoglia a pagine (5000 per pagina, «pagina i di N»), non più solo i primi 5000.", en: "Pagination: the archive list is now paged (5000 per page, «page i of N»), no longer just the first 5000.", ru: "Постраничный просмотр архива (5000 на страницу, «страница i из N»)." },
  { it: "Scansione INCREMENTALE: «Completa» salta le regioni già scansionate negli ultimi 30 giorni → riprese rapide, non riparte da capo. Nuovo «Completa tutti i continenti».", en: "INCREMENTAL scan: «Complete» skips regions scanned in the last 30 days → fast resumes, no restart from scratch. New «Complete all continents».", ru: "ИНКРЕМЕНТНОЕ сканирование: «Завершить» пропускает регионы, просканированные за последние 30 дней → быстрые возобновления. Новое «Завершить все континенты»." },
  { it: "Nuovo: «Assegna stelle (da OSM)» in Copertura — ri-scansiona il database per la classificazione a stelle, direttamente dall'app. E la misura di copertura ora si SALVA (non si perde più chiudendo).", en: "New: «Assign stars (from OSM)» in Coverage — re-scan the database for the star rating, right from the app. And the coverage measurement is now SAVED (no longer lost on close).", ru: "Новое: «Присвоить звёзды (из OSM)» в «Покрытии». И измерение покрытия теперь СОХРАНЯЕТСЯ." },
  { it: "Nuova lingua: RUSSO. L'interfaccia è ora disponibile in italiano, inglese e russo (selettore in alto IT·EN·RU). Il manuale verrà tradotto a breve.", en: "New language: RUSSIAN. The interface is now available in Italian, English and Russian (IT·EN·RU switch at the top). The manual will be translated soon.", ru: "Новый язык: РУССКИЙ. Интерфейс теперь доступен на итальянском, английском и русском (переключатель IT·EN·RU вверху). Руководство будет переведено в ближайшее время." },
  { it: "Nuovo: classificazione internazionale a stelle (★1–5 + «Lusso») per ogni hotel, presa da OpenStreetMap dove disponibile. Per riempirla sugli hotel già in archivio: «node scripts/backfill-stars.mjs».", en: "New: international star rating (★1–5 + “Luxury”) per hotel, taken from OpenStreetMap where available. To fill it for hotels already in the archive: “node scripts/backfill-stars.mjs”." },
  { it: "Mappa: risolto il «rimbalzo» — ora resta dove la sposti/zoomi.", en: "Map: fixed the “snap-back” — it now stays where you pan/zoom it." },
  { it: "Risolto lo stallo della valutazione: era un errore di lettura di certe pagine (siti con caratteri speciali) che bloccava la coda. Ora la valutazione gira in blocchi paralleli, veloce e senza fermarsi (~14.000 hotel/ora).", en: "Fixed the scoring stall: a parsing error on some pages (sites with special characters) was freezing the queue. Scoring now runs in parallel batches, fast and without stopping (~14,000 hotels/hour)." },
  { it: "Interfaccia riorganizzata: barra dei menu in alto (Hotel · Mappa · Copertura · CRM · Infografica · Dati), niente più colonna laterale. La scansione vive in Copertura; Backup/Export/AI sotto il menu «Dati».", en: "Reorganized interface: top menu bar (Hotels · Map · Coverage · CRM · Infographic · Data), no more sidebar. Scanning lives in Coverage; Backup/Export/AI under the «Data» menu." },
  { it: "Nuovo: sfoglia gli hotel per paese — apri «Austria» e vedi la lista dei suoi hotel (caricata su richiesta dall'intero archivio). In alternativa, l'elenco piatto ordinato per voto/valore con la ricerca per nome.", en: "New: browse hotels by country — open «Austria» to see its hotels (loaded on demand from the whole archive). Or the flat list sorted by score/value with name search." },
  { it: "Punteggi più leggibili: il colore del voto ora è una scala continua (grigio sotto soglia → pesca → ambra profonda), così la differenza tra un 64 e un 88 si vede a colpo d'occhio.", en: "More readable scores: the badge color is now a continuous scale (grey below threshold → peach → deep amber), so the difference between a 64 and an 88 is visible at a glance." },
  { it: "Valutazione più fluida: niente più stalli su siti lenti — client web condiviso, timeout più corti, tetto di 16s per hotel e avanzamento aggiornato in continuo.", en: "Smoother scoring: no more stalls on slow sites — shared web client, shorter timeouts, a 16s per-hotel cap and continuously updated progress." },
  { it: "Nuova veste grafica: adottati logo, colori e caratteri ufficiali Kidotel (wordmark con la scia radar, palette pesca/ambra su grigio, font Sora + Manrope). Coerente in app, infografica e report.", en: "New look: official Kidotel logo, colors and fonts adopted (radar-sweep wordmark, peach/amber on grey, Sora + Manrope). Consistent across app, infographic and report." },
  { it: "Nuovo: «Infografica» — un cruscotto stampabile dai tuoi dati reali (numeri chiave, distribuzione dei punteggi, top paesi, copertura per continente, funnel CRM, valore atteso) con anteprima e stampa/PDF dal browser.", en: "New: “Infographic” — a printable dashboard from your real data (key figures, score distribution, top countries, coverage by continent, CRM funnel, expected value) with preview and print/PDF from the browser." },
  { it: "Nuovo: «Esporta selezione» — componi il gruppo di hotel da condividere (tutti / un continente / un paese, fascia di punteggio, le migliori N, solo contattabili) ed esporta in CSV o JSON.", en: "New: “Export selection” — compose the group of hotels to share (all / a continent / a country, score range, top N, contactable only) and export to CSV or JSON." },
  { it: "Revisione completa (qualità): la soglia «family hotel» delle Impostazioni ora vale ovunque — tabella, CRM, mappa e Copertura mostrano lo stesso criterio.", en: "Full audit (quality): the “family hotel” threshold in Settings now applies everywhere — table, CRM, map and Coverage all share the same cut-off." },
  { it: "Correzioni: importazione backup più sicura (niente dati vecchi residui), conteggi Copertura senza doppioni «(sconosciuto)», estrazione email più precisa, note CRM sempre allineate.", en: "Fixes: safer backup import (no leftover stale data), Coverage counts without duplicate “(unknown)” rows, more accurate email extraction, CRM notes always in sync." },
  { it: "Copertura per paese: «Misura» (grado reale vs OpenStreetMap) e «Completa 100%» (scansione regione per regione, anche per i paesi enormi).", en: "Coverage by country: “Measure” (real grade vs OpenStreetMap) and “Complete 100%” (region-by-region scan, even for huge countries)." },
  { it: "Email: verifica di recapitabilità (MX/DNS) e generazione di email di contatto professionali in inglese, personalizzate con le prove.", en: "Email: deliverability check (MX/DNS) and generation of professional English outreach emails, personalized with the proof." },
  { it: "Prestazioni e sicurezza: database più veloce (WAL + indici), backup versionato, pulizia delle catene.", en: "Performance & safety: faster database (WAL + indexes), versioned backup, chain cleanup." },
  { it: "Nuovo: Guida integrata e Impostazioni.", en: "New: in-app Guide and Settings." },
];
