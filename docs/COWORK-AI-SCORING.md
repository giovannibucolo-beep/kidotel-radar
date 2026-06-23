# Valutazione family-fit con l'AI (Cowork) — v0.3

Supera il tetto del metodo a regole: l'AI **legge e capisce** il sito di ogni hotel, in qualsiasi lingua, e assegna il voto **con citazione**. Nessuna chiave API: usa il tuo Claude in Cowork.

## Flusso (3 passi)
1. **Nell'app** scansiona un'area (e/o filtra). Sidebar → **AI · Cowork → "Esporta lotto per AI"**. Salvi un file `kidotel-ai-batch.json` (fino a 300 hotel senza voto, con sito).
2. **In Cowork** apri il file e dai a Claude questa istruzione:
   > Per ogni hotel in questo file apri il sito (`website`), leggi le pagine rilevanti in qualsiasi lingua e valuta quanto è adatto alle famiglie (family_fit_score 0–100). Per ogni servizio family trovato aggiungi a `breakdown` un elemento con `key` (kids_club | kids_facilities | family_rooms | childcare | kids_dining | activities_age | safety), `present: true`, `quote` (frase citata dal sito) e `url`. **Non inventare**: se non c'è prova sul sito, niente punto. Restituisci un JSON con chiave `results`, mantenendo lo stesso `id` di ogni hotel. Salvalo come `results.json`.
3. **Nell'app** → **"Importa valutazioni AI"** → selezioni `results.json`. I voti entrano nel database (sorgente "ai-cowork") e compaiono in tabella/mappa.

## Formato
**Export (app → Cowork):** `{ app, task, istruzioni, schema_risultati, hotels: [{ id, name, website, city, country }] }`
**Import (Cowork → app):** `{ "results": [ { "id": "node/123", "family_fit_score": 0-100, "breakdown": [ { "key", "present", "quote", "url" } ] } ] }`

## Pesi di riferimento (coerenti col RuleScorer)
kids_club 22 · kids_facilities 18 · family_rooms 14 · childcare 12 · kids_dining 10 · activities_age 10 · safety 8 (reviews 6 futuro). L'AI può seguirli o dare un voto olistico 0–100 motivato dalle citazioni.

## Perché meglio del solo RuleScorer (verificato)
Cavallino Bianco: a regole **26**; l'AI leggendo la sola homepage **62** (riconosce "family suite", "vasca di palline", "Linoland per neonati"). Con le pagine interne sale ancora. La prova resta sempre citata (zero dati inventati).

## Prossimo (v0.4): connettore MCP live
Server MCP nell'app così Cowork interroga il DB e scrive i voti **senza** passare i file a mano. È il passo successivo, una volta consolidato questo contratto.
