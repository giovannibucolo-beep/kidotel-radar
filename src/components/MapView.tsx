import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapPoint = {
  lat: number;
  lon: number;
  name: string;
  score: number | null;
  website: string | null;
};

function colorFor(score: number | null): string {
  if (score === null) return "#9a9a93";
  if (score >= 60) return "#1d9e75";
  if (score >= 40) return "#ef9f27";
  return "#9a9a93";
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));
}

export default function MapView({ points }: { points: MapPoint[] }) {
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

  // aggiorna i marker quando cambiano i punti
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const canvas = L.canvas({ padding: 0.5 });
    const valid = points.filter((p) => !(p.lat === 0 && p.lon === 0) && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    const latlngs: L.LatLngExpression[] = [];
    for (const p of valid) {
      const host = p.website ? p.website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] : "";
      const popup =
        `<strong>${esc(p.name)}</strong>` +
        (p.score !== null ? ` — <b>${p.score}</b>` : "") +
        (host ? `<br><span style="color:#0f6e56">${esc(host)}</span>` : "");
      L.circleMarker([p.lat, p.lon], {
        renderer: canvas,
        radius: 6,
        weight: 1,
        color: "#ffffff",
        fillColor: colorFor(p.score),
        fillOpacity: 0.9,
      })
        .bindPopup(popup)
        .addTo(layer);
      latlngs.push([p.lat, p.lon]);
    }
    if (latlngs.length > 0) {
      map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30], maxZoom: 12 });
    }
    setTimeout(() => map.invalidateSize(), 80);
  }, [points]);

  return <div ref={elRef} className="map-canvas" />;
}
