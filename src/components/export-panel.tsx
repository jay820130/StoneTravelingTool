"use client";
import { useState } from "react";
import { Download, FileSpreadsheet, FileText, ShieldCheck } from "lucide-react";
import type { Library, Place } from "@/lib/types";
import type { Filters } from "@/lib/domain";
import { mapsUrl, stars } from "@/lib/domain";
import { Field } from "./ui";

export default function ExportPanel({
  data,
  places,
  filters,
}: {
  data: Library;
  places: Place[];
  filters: Filters;
}) {
  const [excluded, setExcluded] = useState<string[]>([]);
  const [visits, setVisits] = useState("all");
  const [fields, setFields] = useState({
    visitNotes: true,
    dishes: true,
    dishNotes: true,
    privateNotes: false,
    sources: false,
    summaries: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = places.filter((p) => !excluded.includes(p.id));
  const options = [
    ["visitNotes", "到訪心得"],
    ["dishes", "餐點／品項紀錄"],
    ["dishNotes", "餐點／品項評論"],
    ["privateNotes", "額外私人備註"],
    ["sources", "原始收藏連結"],
    ["summaries", "文章摘要與推薦內容"],
  ] as const;
  async function download(format: "xlsx" | "pdf") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          ids: selected.map((p) => p.id),
          filters,
          visits,
          ...fields,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `旅藏-口袋名單.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="export-layout">
      <aside className="export-options">
        <span className="eyebrow">MADE TO SHARE</span>
        <h2>
          讓喜歡的地方
          <br />
          繼續旅行。
        </h2>
        <p className="muted">匯出當前篩選結果，分享一份剛剛好的口袋名單。</p>
        <Field label="到訪紀錄範圍">
          <select value={visits} onChange={(e) => setVisits(e.target.value)}>
            <option value="all">全部到訪紀錄</option>
            <option value="latest">每店最近一次</option>
            <option value="none">不包含到訪紀錄</option>
          </select>
        </Field>
        <fieldset>
          <legend>選擇分享的內容</legend>
          {options.map(([key, label]) => (
            <label className="check-row" key={key}>
              <input
                type="checkbox"
                checked={fields[key]}
                onChange={(e) => setFields({ ...fields, [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <p className="privacy-note">
          <ShieldCheck size={17} />
          額外私人備註預設不分享，請確認分享預覽中的心得與評論。
        </p>
        <button
          className="primary"
          disabled={busy || !selected.length}
          onClick={() => void download("xlsx")}
        >
          <FileSpreadsheet size={18} />
          {busy ? "正在製作…" : "下載 XLSX"}
        </button>
        <button
          className="secondary"
          disabled={busy || !selected.length}
          onClick={() => void download("pdf")}
        >
          <FileText size={18} />
          下載 PDF
        </button>
        {error && (
          <p role="alert" className="alert error">
            {error}
          </p>
        )}
      </aside>
      <section className="export-preview">
        <div className="section-line">
          <h3>
            <Download size={18} /> 分享預覽
          </h3>
          <span className="muted">
            已選 {selected.length} / {places.length} 家
          </span>
        </div>
        {!places.length && <p className="muted">目前篩選結果沒有店家，請先收藏或調整篩選。</p>}
        {places.map((p) => {
          let vs = visits === "none" ? [] : data.visits.filter((v) => v.place_id === p.id);
          if (visits === "latest") vs = vs.slice(0, 1);
          const ss = data.sources.filter((s) =>
            data.place_sources.some((l) => l.place_id === p.id && l.source_id === s.id),
          );
          return (
            <article
              className={excluded.includes(p.id) ? "preview-place excluded" : "preview-place"}
              key={p.id}
            >
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={!excluded.includes(p.id)}
                  onChange={(e) =>
                    setExcluded(
                      e.target.checked ? excluded.filter((id) => id !== p.id) : [...excluded, p.id],
                    )
                  }
                />
                <strong>{p.name}</strong>
              </label>
              <div className="preview-content">
                <p>{[p.country, p.city, ...p.categories, ...p.tags].filter(Boolean).join(" · ")}</p>
                {p.address && <p>{p.address}</p>}
                <p>
                  {data.visits.some((v) => v.place_id === p.id) ? "去過" : "想去"} · 店家總評{" "}
                  {stars(p.rating)}
                </p>
                <a href={mapsUrl(p)} target="_blank" rel="noopener noreferrer">
                  Google Maps ↗
                </a>
                {fields.privateNotes && p.notes && <p className="pre-wrap">私人備註：{p.notes}</p>}
                {vs.map((v) => (
                  <div className="preview-visit" key={v.id}>
                    <strong>
                      {v.visited_on} · {stars(v.rating)}
                    </strong>
                    {fields.visitNotes && <p className="pre-wrap">{v.notes}</p>}
                    {fields.dishes &&
                      data.dishes
                        .filter((d) => d.visit_id === v.id)
                        .map((d) => (
                          <p key={d.id}>
                            {d.name} · {stars(d.rating)}
                            {fields.dishNotes && d.notes && (
                              <span className="pre-wrap"> — {d.notes}</span>
                            )}
                          </p>
                        ))}
                  </div>
                ))}
                {ss.map((s) => (
                  <div key={s.id}>
                    {fields.sources && <p className="url-display">{s.original_url}</p>}
                    {fields.summaries && (
                      <div className="pre-wrap">
                        來源 {s.id}：{s.summary || "尚未解析"}
                        {s.candidates.map((c, i) => (
                          <p key={i}>
                            {c.name} · 文章推薦：{c.dishes.join("、") || "未提供"}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
