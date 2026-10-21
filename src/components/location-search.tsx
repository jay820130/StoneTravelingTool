"use client";
import { useState } from "react";
import { api } from "@/lib/client-api";
import type { LocationCandidate } from "@/lib/types";
export function LocationSearch({
  initialQuery,
  onSelect,
}: {
  initialQuery: string;
  onSelect: (candidate: LocationCandidate) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [items, setItems] = useState<LocationCandidate[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="location-search">
      <label>
        以店名／地址查詢位置
        <input value={query} maxLength={300} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <p className="muted">
        只送出這個查詢欄位，不會傳送私人筆記。請加上城市或地址並確認正確分店。
      </p>
      <button
        type="button"
        className="secondary"
        disabled={busy || query.trim().length < 2}
        onClick={async () => {
          setBusy(true);
          setMessage("");
          setItems([]);
          try {
            const r = await api<{ candidates: LocationCandidate[] }>("geocode", { query });
            setItems(r.candidates);
            if (!r.candidates.length) setMessage("查不到可確認的店址，請補充地址或保留待補位置。");
          } catch (e) {
            setMessage((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "查詢中…" : "查詢候選位置"}
      </button>
      {message && (
        <p className="alert" role="status">
          {message}
        </p>
      )}
      {items.map((c) => (
        <div className="location-candidate" key={c.id}>
          <strong>{c.name}</strong>
          <p>{c.address}</p>
          <small>
            {c.latitude}, {c.longitude}
          </small>
          <button className="secondary" type="button" onClick={() => onSelect(c)}>
            確認使用此位置
          </button>
        </div>
      ))}
      <small>
        地點資料：
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap contributors · ODbL
        </a>
        （Nominatim）；查詢後仍須人工確認。
      </small>
    </section>
  );
}
