"use client";
import { useEffect, useRef, useState } from "react";
import type { Place } from "@/lib/types";
import { mapsUrl } from "@/lib/domain";
import "leaflet/dist/leaflet.css";
export default function PlaceMap({
  places,
  onSelect,
}: {
  places: Place[];
  onSelect: (p: Place) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tileFailed, setTileFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    import("leaflet").then((L) => {
      if (disposed || !ref.current) return;
      const map = L.map(ref.current, { scrollWheelZoom: false });
      L.tileLayer(
        process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          attribution:
            process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ||
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
        },
      )
        .on("tileerror", () => {
          if (!disposed) setTileFailed(true);
        })
        .addTo(map);
      const located = places.filter((p) => p.latitude !== null && p.longitude !== null);
      const points: L.LatLngExpression[] = [];
      for (const p of located) {
        const point: L.LatLngExpression = [p.latitude!, p.longitude!];
        points.push(point);
        const color = p.categories.includes("咖啡廳")
          ? "#a56d43"
          : p.categories.includes("景點")
            ? "#59827a"
            : "#b06550";
        const popup = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = p.name;
        popup.appendChild(name);
        const button = document.createElement("button");
        button.textContent = "查看店家";
        button.onclick = () => onSelect(p);
        popup.appendChild(button);
        const link = document.createElement("a");
        link.textContent = "Google Maps ↗";
        link.href = mapsUrl(p);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        popup.appendChild(link);
        L.circleMarker(point, {
          radius: 10,
          color: "#fff",
          weight: 3,
          fillColor: color,
          fillOpacity: 1,
        })
          .addTo(map)
          .bindPopup(popup);
      }
      if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [45, 45], maxZoom: 15 });
      else map.setView([20, 10], 2);
      const resize = new ResizeObserver(() => map.invalidateSize());
      resize.observe(ref.current);
      cleanup = () => {
        resize.disconnect();
        map.remove();
      };
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [places, onSelect]);
  return (
    <>
      {tileFailed && (
        <p className="muted" role="status">
          部分底圖無法載入，請檢查網路或稍後重試。店家仍保留在清單，也可使用 Google Maps 開啟位置。
        </p>
      )}
      <div className="map-canvas" ref={ref} aria-label="收藏店家位置地圖" />
    </>
  );
}
