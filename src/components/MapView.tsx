import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapPoint = {
  lat: number;
  lon: number;
  name: string;
  score: number | null;
  website: string | null;
  loc?: string;
};

// Verde = sopra la soglia "family" scelta dall'utente; ambra = vicino (soglia-20); grigio = sotto.
// Con la soglia di default (60) torna 60/40 come prima.
function colorFor(score: number | null, threshold: number): string {
  if (score === null) return "#9a9a93";
  if (score >= threshold) return "#ef9f27";        // family: ambra del brand
  if (score >= threshold - 20) return "#ffc27b";   // vicino: pesca
  return "#9a9a93";                                 // sotto: grigio
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

export default function MapView({ points, threshold = 60 }: { points: MapPoint[]; threshold?: number }) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);

  // init una sola volta
  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { worldCopyJump: true, preferCanvas: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);
    map.setView([25, 10], 2);
    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  // Firme per evitare il "rimbalzo": ridisegniamo SOLO quando cambia qualcosa di visibile, e
  // facciamo il fitBounds SOLO quando cambia l'area geografica — mai a ogni re-render (es. il
  // refresh statistiche ogni 4s), così lo zoom/spostamento dell'utente resta dov'è.
  const geoSigRef = useRef("");
  const colorSigRef = useRef("");

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    const valid = points.filter((p) => !(p.lat === 0 && p.lon === 0) && Number.isFinite(p.lat) && Number.isFinite(p.lon));

    // geoSig = insieme delle coordinate (cambia quando si cambia area); colorSig aggiunge voti+soglia.
    let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180, scoreSum = 0, scored = 0;
    for (const p of valid) {
      if (p.lat < minLa) minLa = p.lat;
      if (p.lat > maxLa) maxLa = p.lat;
      if (p.lon < minLo) minLo = p.lon;
      if (p.lon > maxLo) maxLo = p.lon;
      if (p.score !== null) { scoreSum += p.score; scored++; }
    }
    const geoSig = `${valid.length}|${minLa.toFixed(3)},${maxLa.toFixed(3)},${minLo.toFixed(3)},${maxLo.toFixed(3)}`;
    const colorSig = `${geoSig}|${scored}|${scoreSum}|${threshold}`;
    if (colorSig === colorSigRef.current) return; // nulla di visibile è cambiato → non toccare la mappa
    const geoChanged = geoSig !== geoSigRef.current;
    colorSigRef.current = colorSig;
    geoSigRef.current = geoSig;

    layer.clearLayers();
    const canvas = L.canvas({ padding: 0.5 });
    const latlngs: L.LatLngExpression[] = [];
    for (const p of valid) {
      const host = p.website ? p.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] : "";
      const popup =
        `<strong>${esc(p.name)}</strong>` +
        (p.score !== null ? ` — <b>${p.score}</b>` : "") +
        (p.loc ? `<br><span style="color:#666">${esc(p.loc)}</span>` : "") +
        (host ? `<br><span style="color:#a8650f">${esc(host)}</span>` : "");
      L.circleMarker([p.lat, p.lon], {
        renderer: canvas,
        radius: 6,
        weight: 1,
        color: "#ffffff",
        fillColor: colorFor(p.score, threshold),
        fillOpacity: 0.9,
      })
        .bindPopup(popup)
        .addTo(layer);
      latlngs.push([p.lat, p.lon]);
    }
    // fitBounds SOLO quando cambia l'area (nuova scansione/paese), non quando cambiano solo i voti.
    if (latlngs.length > 0 && geoChanged) {
      map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30], maxZoom: 12 });
    }
    setTimeout(() => map.invalidateSize(), 80);
  }, [points, threshold]);

  return <div ref={elRef} className="map-canvas" />;
}
