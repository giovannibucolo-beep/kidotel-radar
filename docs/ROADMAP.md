# ROADMAP — Kidotel Radar

> Incrementi additivi: ogni versione fa una cosa in più, sempre funzionante. Un milestone per volta.
> Direzione v0.2→v1.0 = "Revenue & Cowork" (recepita dal prompt-specifica del committente, 2026-06-23).

## v0.1 — Scoperta ✅ (fatto, compila e gira)
- Guscio app Tauri + UI bilingue IT/EN + versione mostrata + temi chiaro/scuro.
- Selettore aree (mondiale, ricerca libera) + esempi.
- Motore SCOPRI: Nominatim (bbox) → Overpass (`tourism=hotel`) → SQLite.
- Tabella risultati + backup export/import.

## v0.2 — Family-fit score (gratis, niente API)
- Crawl del sito ufficiale (robots-aware, rate-limit, cache).
- Estrazione family **a regole, multilingue** (IT/EN/DE/ES/FR…): cerca le frasi-chiave dei segnali.
- **Prova verbatim**: salva la frase trovata + URL e la **ri-verifica carattere per carattere** (scarta se assente).
- `family_fit_score` (0–100) + `score_breakdown` salvati e mostrati (badge + riquadro "Prova").
- Nota: Claude API resta **opzionale** (potenziamento per casi sfumati), non richiesta.

## v0.3 — Ponte MCP con Cowork (Modulo A)
- Server MCP locale dentro l'app (start/stop da Impostazioni, porta + token locale).
- Strumenti: `query_hotels`, `get_hotel`, `get_revenue_ranking`, `list_outreach_queue`, `draft_outreach`, `export_dataset`, `get_stats`.
- L'AID "pesante" (bozze, report) la fa Cowork col Claude dell'utente → niente costi API nell'app.

## v0.4 — Motore redditività (ER) + distribuzione (Modulo B)
- `ER = family_fit_norm × valore_prenotazione × commissione × p_conversione × volume`, ogni fattore ispezionabile e tracciato alla fonte; pannello "Assunzioni del modello".
- Colonna ER + ranking + filtri combinati (alto family-fit & alto ER, ecc.).
- **Distribuzione:** script release (build → installa nuova → cancella vecchia → aggiorna STATO/CHANGELOG); **CI GitHub Actions** per `.dmg` + `.exe`/`.msi`; **updater PMU** (bundle firmato + manifest).

## v0.5 — Piattaforme leader (Modulo C)
- Connettori opzionali, credenziali cifrate in locale (inserite dall'utente, mai dall'assistente).
- Prima affiliazione a bassa barriera (Travelpayouts/Awin → Booking), poi Expedia EPS, Google Hotel Ads, TripAdvisor.
- Deep link affiliati + tracciamento click/conversioni dove l'API lo consente. Tassi mai hard-coded; campi "non disponibile" finché non collegati.

## v0.6 — Mini-CRM outreach con approvazione umana (Modulo D)
- Pipeline a stati: scoperto → arricchito → bozza pronta → in attesa → inviato → risposta → negoziazione → partner attivo → opt-out.
- Email personalizzate bilingue (lingua del destinatario quando rilevabile); template multipli.
- Guardrail vincolanti: nessun invio automatico, suppression list/opt-out permanente, rate limit, base giuridica documentata, log per audit, solo contatti pubblici.

## v0.7 — Cruscotto redditività e report (Modulo E)
- Dashboard: copertura per area, hotel verificati, valore pipeline, reddito attivo, top opportunità per ER.
- Report on-demand via Cowork: Excel pipeline, PPT per soci, CSV per commercialista — bilingui, nessun numero non verificato.

## Vincoli onesti (sempre in UI, mai nascosti)
- `.exe` non si compila da macOS → CI/Windows.
- "Tutto il mondo" = a coda e in continuo (milioni di hotel = tempo/costi); si punta dove l'ER è più alto.
- API piattaforme e affiliazioni richiedono approvazione e chiavi; finché non collegate → "non disponibile", mai stimato.
- Outreach mai pienamente automatico: approvazione umana per design.
