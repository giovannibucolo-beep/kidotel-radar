# Kidotel Radar

App desktop che scopre automaticamente hotel per famiglie in tutto il mondo, ne legge i siti ufficiali in qualsiasi lingua e assegna un punteggio **family-fit (0–100) con la prova citata**. Bilingue IT/EN. macOS (`.dmg`) e Windows (`.exe`).

> **Inizia da [`MASTER.md`](MASTER.md)** — è il documento di continuità del progetto.

## Sviluppo
```bash
pnpm install
pnpm tauri dev        # avvia l'app in sviluppo
pnpm tauri build      # build di produzione (.dmg su macOS)
```

## Stato
Versione `0.1.0` (in sviluppo). Vedi [`docs/STATO.md`](docs/STATO.md) e [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Principio non negoziabile
Zero dati inventati: ogni informazione family esiste solo se accompagnata dalla citazione verbatim trovata sul sito ufficiale dell'hotel e ri-verificata dal programma. Vedi `MASTER.md` §5.
