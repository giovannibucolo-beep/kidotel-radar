# Riempie città · provincia · regione · paese per ogni hotel, OFFLINE, dalla posizione (lat/lon).
# Usa reverse_geocoder (dataset offline) + pycountry (nomi paese). Nessuna chiamata online.
#   python3 scripts/backfill-geo.py            # tutti
#   python3 scripts/backfill-geo.py --new      # solo quelli senza regione
# Single-thread (RGeocoder mode=2): niente multiprocessing -> risultati allineati e corretti.

import os
import sqlite3
import sys

import pycountry
import reverse_geocoder as rg


def country_name(cc):
    if not cc:
        return None
    c = pycountry.countries.get(alpha_2=cc)
    return c.name if c else cc


def main():
    db = os.environ.get("KIDOTEL_DB", os.path.expanduser(
        "~/Library/Application Support/co.kidotel.radar/kidotel-radar.sqlite"))
    only_new = "--new" in sys.argv
    con = sqlite3.connect(db)
    cur = con.cursor()
    for col in ("region", "province"):
        try:
            cur.execute(f"ALTER TABLE hotels ADD COLUMN {col} TEXT")
        except sqlite3.OperationalError:
            pass
    con.commit()

    where = "WHERE region IS NULL" if only_new else ""
    rows = cur.execute(
        f"SELECT osm_type, osm_id, lat, lon, city FROM hotels {where}").fetchall()
    valid = [r for r in rows if r[2] and r[3] and not (r[2] == 0 and r[3] == 0)]
    print(f"Hotel da geolocalizzare: {len(valid)} (su {len(rows)})")
    if not valid:
        return

    coords = [(r[2], r[3]) for r in valid]
    geo = rg.RGeocoder(mode=2, verbose=False)  # single-thread, niente pool
    res = geo.query(coords)

    updates = []
    for r, g in zip(valid, res):
        city = g.get("name") or (r[4] if (r[4] and r[4].strip()) else None)
        region = g.get("admin1") or None
        province = g.get("admin2") or None
        country = country_name(g.get("cc"))
        updates.append((city, region, province, country, r[0], r[1]))

    cur.executemany(
        "UPDATE hotels SET city=?, region=?, province=?, country=? WHERE osm_type=? AND osm_id=?",
        updates)
    con.commit()
    print(f"Aggiornati {len(updates)} hotel con città/provincia/regione/paese.")


if __name__ == "__main__":
    main()
