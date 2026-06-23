# Kidotel Radar — MASTER

> Documento unico di continuità. Se il contesto della chat si esaurisce, **ripartire da qui**.
> Leggere nell'ordine: questo file → `docs/STATO.md` (dove siamo) → `docs/ROADMAP.md` (dove andiamo) → `docs/DECISIONI.md` (perché così).

- **Versione corrente:** `0.2.0` (compilata e installata su macOS)
- **Percorso progetto:** `~/dev/kidotel-radar`
- **Ultimo aggiornamento:** 2026-06-23

---

## 1. Cos'è (in una frase)
App desktop che **scopre automaticamente hotel per famiglie in tutto il mondo**, ne legge i siti ufficiali in qualsiasi lingua, e assegna a ciascuno un **punteggio "family-fit" (0–100) con la prova citata** — così Kidotel può riempire il suo database di offerta senza ricerca manuale.

## 2. Perché esiste
Kidotel (kidotel.co) è una piattaforma pre-lancio di scoperta hotel per famiglie. Il collo di bottiglia è **l'offerta**: ha ~300 hotel verificati a mano. Questo strumento automatizza la fase Scopri → Arricchisci → Valuta, mantenendo **zero dati inventati** (vedi §5).

## 3. Requisiti fondanti (dal committente)
1. **Mondiale dal primo giorno**, puntabile su un continente / paese / regione / città; non limitato all'Alto Adige (quella è solo la zona di *taratura*).
2. **Bilingue IT/EN in ogni funzione** (ogni stringa passa da i18n).
3. **Doppio installabile autosufficiente:** `.dmg` (macOS) **e** `.exe` (Windows). Ogni installer contiene tutto il programma, nessuna dipendenza esterna da installare.
4. **Backup esportabili/importabili** dell'intero database.
5. **Master di continuità** sempre aggiornato (questo file + `docs/`).
6. **Versione sempre indicata** (in UI e nei file di progetto).
7. **Ad ogni release:** installa la nuova versione (per testarla) e cancella la precedente.
8. **Aggiornabile** dall'utente (updater in-app — *vedi domanda aperta §9 su "pmu"*).
9. **Massima verifica, zero dati inventati o "plausibili".**

## 4. Architettura
- **Guscio app:** Tauri v2 → un solo binario nativo, multipiattaforma, self-contained.
- **Frontend:** Vite + React + TypeScript (coerente con gli altri progetti: Officina, Studio di famiglia).
- **Motore:** Rust (dentro `src-tauri`), così l'installer è autosufficiente (niente Node/Python da installare a parte).
- **Database:** SQLite *bundled* in locale (file in app-data dir). Nessun server, nessun cloud di default.
- **i18n:** dizionari `it`/`en` lato frontend (`src/i18n/`).

Pipeline (stadi): `SCOPRI (OSM) → ARRICCHISCI (crawl sito) → VALUTA (Claude, con prova) → DEDUP → VERIFICA → ESPORTA`.

## 5. La regola d'oro: zero dati inventati
Per ogni informazione family (es. "miniclub: sì"):
1. Il modello la estrae **solo** se trova la frase sul sito ufficiale dell'hotel, restituendo la **citazione verbatim** + URL.
2. Il programma **ri-verifica da solo** che quella citazione esista *davvero* nel testo della pagina (confronto esatto, normalizzato). Se non c'è → il dato viene **scartato**, mai indovinato.
3. Se manca la prova → campo `non dichiarato` (null), **mai** stimato.
Risultato: l'utente non deve controllare nulla a mano, ma niente è inventato.

## 6. Punteggio family-fit (0–100, trasparente)
Somma pesata di segnali booleani/normalizzati; si salva sempre lo `score_breakdown`.

| Segnale | Peso |
|---|---|
| Kids club + ore sorveglianza | 22 |
| Strutture bimbi (piscina/splash/playground) | 18 |
| Camere familiari/comunicanti | 14 |
| Childcare/babysitting | 12 |
| Ristorazione bimbi (menù, seggioloni) | 10 |
| Attività per fascia d'età | 10 |
| Sicurezza (recinzioni, bagnino) | 8 |
| Sentiment recensioni genitori (futuro) | 6 |

Discriminante "veramente family-first": kids-club + childcare + attività per età (non il semplice "family room").

## 7. Fonti dati (per resa × legalità)
- **OSM/Overpass** (gratis, mondiale) → scoperta + sito ufficiale. Attenzione ODbL (attribuzione, separare il "produced work").
- **Sito ufficiale dell'hotel** → arricchimento family (è la base legalmente solida; i dati family li deriviamo noi).
- **Google Places (New)** → opzionale, solo dove serve più ricchezza; **salvare solo `place_id`**, il resto live.
- Club/directory family (Italy Family Hotels, Kinderhotels, Familotel…) → solo come *semi/validazione*, non ripubblicare la selezione.
- Dettaglio e vincoli legali in `docs/DECISIONI.md`.

## 8. Build, versioni, release
- **Versione** in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (devono coincidere) + mostrata in UI.
- **Dev:** `pnpm tauri dev`. **Build mac:** `pnpm tauri build` → `.dmg` in `src-tauri/target/release/bundle/`.
- **Windows `.exe`:** NON compilabile da macOS → serve macchina Windows o CI (GitHub Actions). Vedi `docs/ROADMAP.md`.
- **Workflow release** (script `scripts/release.mjs`, da completare): bump versione → build → installa nuova `.app` in `/Applications` → **cancella la precedente** e i `.dmg` vecchi → aggiorna `CHANGELOG.md` + `docs/STATO.md`.

## 9. Domande aperte (da confermare col committente)
- **Nome:** "Kidotel Radar" — confermare o cambiare.
- **Brand:** colori/logo reali di kidotel.co (l'icona ora usa un verde-acqua *provvisorio*, da allineare).
- **"pmu":** interpretato come *updater in-app con un clic* (Tauri Updater). Da confermare il significato e **dove ospitare il feed di aggiornamento** (serve un endpoint remoto: GitHub Releases o simile).
- **Chiave API Claude:** necessaria per la fase ARRICCHISCI/VALUTA; l'utente la inserirà nelle impostazioni (salvata in locale/keychain).

## 10. Come continuare (per una nuova sessione)
1. Leggi `docs/STATO.md` → trovi "fatto / in corso / prossimo passo".
2. Allinea le versioni se hai rilasciato.
3. Lavora **additivo e per incrementi** (un milestone per volta, vedi ROADMAP).
4. **Aggiorna sempre** `docs/STATO.md` + `CHANGELOG.md` prima di dire "fatto".
