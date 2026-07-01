# Chiave di join Radar ↔ kidotel.co

Collega le schede pubbliche del sito (`kidotel.co/family-hotels/<slug>-<id>/`, id tipo Expedia) ai record
della banca dati Radar (`osm_id`). Serve perché i due lati usano **id diversi**: il sito prende i contenuti
dal feed OTA (id Expedia), Radar scopre da OpenStreetMap (`osm_id`). Senza una chiave comune non si possono
unire descrizione/facilities di Radar con le schede del sito.

## La chiave
Nessun id condiviso → si usa una **chiave derivata**: `nome normalizzato + città`, con due reti di sicurezza.
1. **Normalizzazione nome** identica sui due lati: minuscolo, senza accenti, senza punteggiatura, tolte le
   parole-rumore (`hotel, residence, resort, aparthotel, spa, village, the, …`).
2. **Somiglianza**: uguaglianza normalizzata = 1; altrimenti `max(Jaccard sui token, Dice sui bigrammi)`.
   Il Dice sui bigrammi recupera gli artefatti da slug (apostrofi persi: «jannae sole» ↔ «Janna 'e Sole» = 1.0).
3. **Città**: prima si cercano i candidati nella stessa città; se la città del sito è una frazione (non il
   comune in Radar) si ripiega su **tutta la regione** con soglia più severa (0.72) per evitare omonimie.

Ogni coppia riceve una **confidenza** e un flag `review`:
- `conf ≥ 0.7` → collegamento automatico affidabile.
- `0.5 – 0.7` → da rivedere a mano (possibile omonimia).

## Uso
```
node scripts/match-site.mjs [regionSlug] [radarRegion] [radarCountryLike]
# es. Sardegna:
node scripts/match-site.mjs europe/italy/sardinia Sardinia %Ital%
```
Legge il sito dalle pagine pubbliche (curl con UA; il sito risponde 403 a fetch «nudo») e Radar dal suo
SQLite (`~/Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite`). Scrive
`scripts/out/match-<region>.json` con `pairs` (site_id ↔ osm_id + confidenza + review) e `unmatched`.

## Risultato sul campione reale (Sardegna, 2026-07-01)
24 schede sito · 705 hotel Radar in regione → **18/24 collegate (75%)**: 15 automatiche (conf ≥ 0.7,
tutte corrette all'ispezione) + 3 da rivedere. Es.: Cormoran `22402 → osm 3582806450` (1.0). I 6 non
collegati sono hotel non presenti con quel nome nel set Radar della regione (o nome troppo divergente).

## Estensione
- **Intero catalogo (25k)**: ciclare `harvestSite` su tutte le regioni dell'albero
  `family-destinations/<continente>/<paese>/<regione>/` (job batch, migliaia di pagine → throttling).
- **Geo**: se le schede del sito esporranno lat/lon (oggi assenti nelle pagine pubbliche), aggiungere un
  match per prossimità (<300 m) come terza rete, utile per gli hotel con nome molto diverso.
- Una volta stabile, la mappatura `site_id ↔ osm_id` va salvata (tabella/colonna) così il sito può tirare
  da Radar `description` + `facilities` (già presenti nel feed di export) per ogni scheda.
