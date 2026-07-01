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

## Harvest dell'intero catalogo
`node scripts/harvest-site.mjs` cammina in BFS tutto l'albero `family-destinations/…` (ripartibile:
checkpoint delle pagine visitate + append incrementale) e produce `scripts/out/site-catalog.json`.
Run del 2026-07-01: **12.193 pagine → 22.589 hotel unici** (coerente col «25.000+» di Vova).

## Match globale (2026-07-01)
`node scripts/match-all.mjs [--write-db]` collega il catalogo ai 280.470 hotel del DB Radar.
Risultato: **11.045/22.589 collegate (49%)** → **6.434 automatiche** + 4.611 da rivedere.
Le **11.544 non collegate**: 1.801 per **paese non coperto da Radar** (Radar non ha ancora scansionato
Turchia 976, Taiwan, Fiji e vari piccoli stati) + 9.743 per **nome** (hotel assente in OSM, o nome
troppo divergente: OSM usa nomi brevi/locali, il sito nomi OTA lunghi con brand «by Marriott/Hilton»).

### Tier calibrate su audit avversariale (40 giudici in parallelo, con ricerca web)
| tier | regola | precisione (campione 8) |
|---|---|---|
| **AUTO** stessa città | `match=citta ∧ conf ≥ 0.90` | **100%** (8/8) |
| **AUTO** stesso paese | `match=paese ∧ conf ≥ 0.85` | **100%** (8/8) |
| review | città 0.7–0.9 | 63% |
| review | città 0.5–0.7 | 38% |
| review | paese 0.75–0.85 | 38% |

I falsi positivi stanno tutti nel tier review e sono confusioni **ramo-di-catena / stessa-città-hotel-diverso**
(es. Embassy Suites Denver *Airport* vs *Downtown*; Mercure Hannover *City* vs *Mitte*; Vilnius *Grand
Resort* vs *City Hotel*). Perciò l'AUTO è tenuto stretto e il resto va confermato a mano. Dettaglio in
`scripts/out/audit-result.json`. Nel tier AUTO è imposta l'**integrità 1:1** (un osm_id non è collegato
automaticamente a due schede: le collisioni sono retrocesse a review).

## Persistenza
`--write-db` scrive la tabella **`site_map(site_id PK, osm_id, confidence, review, match)`** dentro il DB
Radar (`~/Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite`) — 11.045 righe. Così il feed/app
può fare `JOIN hotels ON hotels.osm_id = site_map.osm_id` e passare al sito `description` + `facilities`
(v0.8.42) per ogni scheda. Portabile: anche `scripts/out/site-radar-map.csv` (`site_id,osm_id,confidence,review,match`).

## Come alzare ancora la copertura
- **Coprire i paesi mancanti in Radar** (Turchia ecc.): è una scansione OSM da fare, non un limite del match.
- **Geo**: se le schede del sito esporranno lat/lon (oggi assenti), aggiungere un match per prossimità
  (<300 m) come rete ulteriore per i nomi molto divergenti.
- **Alias di città** EN↔locale (Florence/Firenze, Munich/München) per far scattare più spesso il bucket città.
