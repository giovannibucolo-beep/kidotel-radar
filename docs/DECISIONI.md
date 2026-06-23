# DECISIONI — Kidotel Radar

> Perché le cose sono come sono. Append-only: nuove decisioni in fondo con data.

## 2026-06-23 — Fondazione
- **Tauri v2 + React/TS + motore Rust.** Motivo: un solo binario self-contained (requisito installer autosufficiente), multipiattaforma (.dmg + .exe), coerente con gli altri progetti del committente. Il motore in Rust evita di dover installare Node/Python accanto all'app.
- **SQLite locale bundled.** Motivo: zero server, dati in locale, backup = un file. Coerente con la riservatezza dei dati.
- **i18n IT/EN dal giorno 1.** Ogni stringa passa dal dizionario; default IT, switch EN.
- **Scoperta via OSM/Overpass + Nominatim per il bbox.** Motivo: copertura **mondiale e gratuita**; il sito ufficiale dell'hotel (preso da OSM) è la base legalmente solida da cui derivare i dati family.
- **Estrazione family solo con citazione verbatim + ri-verifica nel testo.** Motivo: requisito "zero dati inventati, massima verifica, zero controllo manuale". Niente prova → niente dato.
- **Google Places opzionale e solo `place_id` salvato.** Motivo: i ToS vietano di immagazzinare il resto; i campi family li deriviamo dal nostro crawl.
- **Niente scraping di OTA (Booking/Expedia/TripAdvisor) né ripubblicazione delle selezioni dei club family.** Motivo: ToS + diritto sui generis UE sui database. Le directory family si usano solo come semi/validazione (nome → ri-deriva dal sito), o via partnership.
- **Outreach email rimandato e da blindare GDPR/ePrivacy** (IT/DE severi): cold email B2B in UE in genere richiede consenso; usare solo indirizzi pubblicati + informativa Art.14 + opt-out. Decisione: NON includere outreach nei primi rilasci.

## 2026-06-23 — Chiarimenti committente + direzione Revenue & Cowork
- **"PMU" = il pacchetto/manifest di aggiornamento** che generiamo a ogni release (Tauri Updater): bundle firmato + `latest.json`; l'app si auto-aggiorna. Da decidere in v0.4 se l'origine è un file locale consegnato o un link.
- **Nessuna chiave API obbligatoria.** Il committente non ha API e la scoperta (OSM) è gratis. Decisione: il **family-fit si calcola con un matcher multilingue a regole** (gratis), con citazione verbatim verificata → rispetta "zero dati inventati". Claude API resta **opzionale** (potenziamento). L'intelligenza pesante (email, report) si sposta su **Cowork** via MCP, usando il piano Claude dell'utente → niente costi API nell'app.
- **Adottata la roadmap "Revenue & Cowork" (moduli A–E)** dal prompt-specifica del committente. Vedi ROADMAP v0.2→v0.7.
- **Affiliazioni = vero collo di bottiglia** (approvazione partner, volumi minimi): partire da rete a bassa barriera (Travelpayouts/Awin→Booking), poi Expedia EPS/Google/TripAdvisor. Tassi mai hard-coded.
- **Cold email UE:** ribadito che legittimo interesse copre il trattamento ma non bypassa la regola di canale ePrivacy/Garante (IT/DE severi). Tutele necessarie ma non sufficienti → verdetto paese-per-paese prima di scalare.

## Vincoli noti
- **`.exe` non si compila da macOS.** Serve Windows o CI (GitHub Actions con runner windows). Deciso: predisporre la CI quando si arriva alla distribuzione Windows (v0.4).
