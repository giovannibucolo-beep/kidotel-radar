# Connettore MCP live — Cowork ↔ database Kidotel (v0.4)

Cowork/Claude interroga il database e **scrive i voti direttamente**, senza passare file a mano.
Il server MCP (`mcp-server/`, binario `kidotel-mcp`) legge lo stesso SQLite dell'app.

## Collegamento (una volta)
```bash
# 1) compila il binario
cargo build --release --manifest-path ~/dev/kidotel-radar/mcp-server/Cargo.toml

# 2) aggiungilo a Claude Code (scope utente = disponibile ovunque)
claude mcp add kidotel -s user -- ~/dev/kidotel-radar/mcp-server/target/release/kidotel-mcp
```
Il server trova il DB dell'app da solo (`~/Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite`); per puntare a un altro file: aggiungi `-e KIDOTEL_DB=/percorso.sqlite`.

## Strumenti esposti
- `kidotel_stats` — totali, con sito, valutati, family hotel (≥70).
- `kidotel_get_unscored {limit}` — hotel con sito e **senza voto** (da valutare).
- `kidotel_query_hotels {min_score, limit}` — hotel già valutati, per family-fit ↓.
- `kidotel_set_score {id, family_fit_score, breakdown[]}` — scrive il voto (id = `osm_type/osm_id`).

## Uso in Cowork
Dopo aver scansionato un'area nell'app, in Cowork:
> Usa gli strumenti `kidotel`. Prendi i prossimi 20 hotel da `kidotel_get_unscored`. Per ciascuno apri il sito (`website`), leggi le pagine in qualsiasi lingua, valuta family-fit 0–100 e scrivi il voto con `kidotel_set_score` (breakdown con key/present/quote/url, niente punti senza prova). Ripeti finché restano hotel non valutati.

Poi nell'app → **"Mostra archivio salvato"** (o riscansiona) per vedere i voti scritti via MCP, in tabella e sulla mappa.

## Verificato / da confermare
- **Verificato** col protocollo reale (stdio JSON-RPC): `initialize`, `tools/list`, e giro **lettura→scrittura** (`get_unscored` → `set_score` → `query_hotels`/`stats`) su DB di prova. ✓
- **Da confermare insieme**: il collegamento effettivo del tuo Cowork al server (config `claude mcp add` + accettazione del client). Se l'app è aperta mentre Cowork scrive, premi "Mostra archivio salvato" per ricaricare.

## Stato
Binario `kidotel-mcp` v0.1.0; app desktop invariata (0.3.1). Alternativa offline: ponte a lotti + `scripts/score-batch.mjs` (v0.3).
