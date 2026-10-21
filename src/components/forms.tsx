"use client";
import { useState } from "react";
import { Plus, Trash2, ExternalLink, Link2, Check } from "lucide-react";
import type { Place, Visit, Library, Source } from "@/lib/types";
import { categories, statusLabels } from "@/lib/types";
import { api } from "@/lib/client-api";
import { Field, RatingSelect } from "./ui";

import { ImagePicker } from "./image-picker";
import { LocationSearch } from "./location-search";
import { uploadImage } from "@/lib/upload-images";

function ErrorMessage({ error }: { error: string }) {
  return error ? (
    <p className="alert error" role="alert">
      {error}
    </p>
  ) : null;
}
export function PlaceForm({
  place,
  onSaved,
  sourceId,
}: {
  place?: Partial<Place>;
  onSaved: () => Promise<void>;
  sourceId?: string;
}) {
  const [p, setP] = useState({
    name: place?.name ?? "",
    country: place?.country ?? "",
    city: place?.city ?? "",
    address: place?.address ?? "",
    latitude: place?.latitude?.toString() ?? "",
    longitude: place?.longitude?.toString() ?? "",
    location_source: place?.location_source ?? "",
    categories: place?.categories ?? [],
    tags: place?.tags?.join("、") ?? "",
    rating: place?.rating ?? null,
    notes: place?.notes ?? "",
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const text = (
    key: "name" | "country" | "city" | "address" | "latitude" | "longitude" | "tags" | "notes",
    value: string,
  ) => setP({ ...p, [key]: value });
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const { place: saved } = await api<{ place: Place }>("places", {
            ...p,
            id: place?.id,
            latitude: p.latitude.trim() ? Number(p.latitude) : null,
            longitude: p.longitude.trim() ? Number(p.longitude) : null,
            tags: [
              ...new Set(
                p.tags
                  .split(/[、,，]/)
                  .map((v) => v.trim())
                  .filter(Boolean),
              ),
            ],
          });
          if (sourceId) await api("links", { source_id: sourceId, place_id: saved.id });
          await onSaved();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="muted">留下確定的資訊就好，其他可以下次補齊。</p>
      <Field label="店名 *">
        <input
          required
          maxLength={200}
          value={p.name}
          onChange={(e) => text("name", e.target.value)}
          placeholder="這個地方叫什麼名字？"
          autoFocus
        />
      </Field>
      <div className="form-row">
        <Field label="國家／地區">
          <input
            value={p.country}
            onChange={(e) => text("country", e.target.value)}
            placeholder="例如：日本"
          />
        </Field>
        <Field label="城市">
          <input
            value={p.city}
            onChange={(e) => text("city", e.target.value)}
            placeholder="例如：大阪"
          />
        </Field>
      </div>
      <Field label="地址">
        <input
          value={p.address}
          onChange={(e) => text("address", e.target.value)}
          placeholder="知道完整地址時再填寫"
        />
      </Field>
      <fieldset>
        <legend>店家類型，可複選</legend>
        <div className="chip-group">
          {categories.map((c) => (
            <label
              key={c}
              className={p.categories.includes(c) ? "check-chip active" : "check-chip"}
            >
              <input
                type="checkbox"
                checked={p.categories.includes(c)}
                onChange={(e) =>
                  setP({
                    ...p,
                    categories: e.target.checked
                      ? [...p.categories, c]
                      : p.categories.filter((x) => x !== c),
                  })
                }
              />
              {c}
            </label>
          ))}
        </div>
      </fieldset>
      <Field label="自訂標籤">
        <input
          value={p.tags}
          onChange={(e) => text("tags", e.target.value)}
          placeholder="例如：雨天備案、必吃清單（以逗號分隔）"
        />
      </Field>
      <RatingSelect
        label="我的店家總評"
        value={p.rating}
        onChange={(rating) => setP({ ...p, rating })}
      />
      <Field label="額外私人備註">
        <textarea
          rows={3}
          value={p.notes}
          onChange={(e) => text("notes", e.target.value)}
          placeholder="只留給自己看的小提醒"
        />
      </Field>
      <details className="advanced">
        <summary>精確位置（選填）</summary>
        <p className="muted">
          僅填入你確認的店址座標。沒有座標的店家仍會保留在清單，請勿用城市中心代替。
        </p>
        <LocationSearch
          initialQuery={[p.name, p.city, p.address].filter(Boolean).join(" ")}
          onSelect={(c) =>
            setP({
              ...p,
              latitude: String(c.latitude),
              longitude: String(c.longitude),
              address: c.address,
              country: c.country,
              city: c.city,
              location_source: c.provider + " · " + c.attribution,
            })
          }
        />
        {p.location_source && <small>位置來源：{p.location_source}</small>}
        <div className="form-row">
          <Field label="緯度">
            <input
              type="number"
              step="any"
              min={-90}
              max={90}
              value={p.latitude}
              onChange={(e) => text("latitude", e.target.value)}
            />
          </Field>
          <Field label="經度">
            <input
              type="number"
              step="any"
              min={-180}
              max={180}
              value={p.longitude}
              onChange={(e) => text("longitude", e.target.value)}
            />
          </Field>
        </div>
      </details>
      <ErrorMessage error={error} />
      <button className="primary" disabled={busy}>
        {busy ? "儲存中…" : "儲存店家"}
      </button>
    </form>
  );
}
export function VisitForm({
  place,
  visit,
  data,
  onSaved,
}: {
  place: Place;
  visit?: Visit;
  data: Library;
  onSaved: () => Promise<void>;
}) {
  const [id] = useState(visit?.id ?? crypto.randomUUID());
  const [date, setDate] = useState(visit?.visited_on ?? new Date().toLocaleDateString("en-CA"));
  const [rating, setRating] = useState<number | null>(visit?.rating ?? null);
  const [notes, setNotes] = useState(visit?.notes ?? "");
  const [dishes, setDishes] = useState(
    data.dishes
      .filter((d) => d.visit_id === visit?.id)
      .map((d) => ({ name: d.name, rating: d.rating, notes: d.notes, key: d.id })),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api("visits", {
            id,
            place_id: place.id,
            visited_on: date,
            rating,
            notes,
            dishes: dishes.map(({ name, rating, notes }) => ({ name, rating, notes })),
          });
          await onSaved();
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="muted">{place.name} · 把今天的體驗留下來。</p>
      <div className="form-row">
        <Field label="到訪日期 *">
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <RatingSelect label="這次到訪評分" value={rating} onChange={setRating} />
      </div>
      <Field label="到訪心得">
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="這次的氣氛、服務或值得記住的事…"
        />
      </Field>
      <div className="section-line">
        <h3>吃了什麼、體驗了什麼</h3>
        <button
          className="secondary small"
          type="button"
          onClick={() =>
            setDishes([...dishes, { name: "", rating: null, notes: "", key: crypto.randomUUID() }])
          }
        >
          <Plus size={16} />
          加入品項
        </button>
      </div>
      {!dishes.length && <p className="muted">餐點與品項都是選填，也可以只記錄來過。</p>}
      {dishes.map((d, i) => (
        <div className="dish-form" key={d.key}>
          <div className="section-line">
            <strong>品項 {i + 1}</strong>
            <button
              type="button"
              className="icon-button"
              aria-label={`移除品項 ${i + 1}`}
              onClick={() => setDishes(dishes.filter((_, n) => n !== i))}
            >
              <Trash2 size={17} />
            </button>
          </div>
          <div className="form-row">
            <Field label={`品項 ${i + 1} 名稱`}>
              <input
                required
                value={d.name}
                onChange={(e) =>
                  setDishes(dishes.map((v, n) => (n === i ? { ...v, name: e.target.value } : v)))
                }
              />
            </Field>
            <RatingSelect
              label={`品項 ${i + 1} 評分`}
              value={d.rating}
              onChange={(rating) =>
                setDishes(dishes.map((v, n) => (n === i ? { ...v, rating } : v)))
              }
            />
          </div>
          <Field label={`品項 ${i + 1} 評論`}>
            <textarea
              rows={2}
              value={d.notes}
              onChange={(e) =>
                setDishes(dishes.map((v, n) => (n === i ? { ...v, notes: e.target.value } : v)))
              }
            />
          </Field>
        </div>
      ))}
      <ErrorMessage error={error} />
      <button className="primary" disabled={busy}>
        {busy ? "儲存中…" : "儲存到訪紀錄"}
      </button>
    </form>
  );
}
export function SourceEditor({
  source,
  data,
  onChanged,
  onNewPlace,
}: {
  source: Source;
  data: Library;
  onChanged: () => Promise<void>;
  onNewPlace: (p: Partial<Place>) => void;
}) {
  const [text, setText] = useState(source.content_text);
  const [reason, setReason] = useState(source.reason);
  const [selected, setSelected] = useState("");
  const [chosen, setChosen] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [notice, setNotice] = useState("");
  const attachments = data.attachments.filter((a) => a.source_id === source.id);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const linked = data.place_sources.filter((l) => l.source_id === source.id);
  return (
    <div className="form">
      <div className="source-heading">
        <span className={`status ${source.status}`}>{statusLabels[source.status]}</span>
        <a href={source.original_url} target="_blank" rel="noopener noreferrer">
          開啟原始連結 <ExternalLink size={14} />
        </a>
      </div>
      <p className="url-display">{source.original_url}</p>
      <div className="alert">
        連結已保存在你的收藏。
        {source.error || "解析結果需確認後才會建立店家，不會改寫你的既有筆記與評分。"}
      </div>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await api("sources/intake", { id: source.id, content_text: text, reason });
            setNotice("補充文字已保存，正在保存圖片…");
            try {
              for (const file of files) {
                await uploadImage(source.id, file);
                setFiles((current) => current.filter((f) => f !== file));
                setNotice("圖片已保存，正在完成剩餘步驟…");
              }
              await api("sources/retry", { id: source.id, content_text: text, reason });
              setNotice("內容與圖片已保存，已排入解析。解析失敗仍可重試。");
            } catch (error) {
              await onChanged();
              throw error;
            }
          });
        }}
      >
        <Field label="我收藏的原因">
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} />
        </Field>
        <Field label="補上文章內容或店家資訊">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="貼上你有權使用的文章文字；讀不到的社群貼文也可以用截圖補充。"
          />
        </Field>
        <ImagePicker
          files={files}
          onChange={setFiles}
          disabled={busy}
          existingCount={attachments.filter((a) => a.state !== "pending").length}
          existingBytes={attachments
            .filter((a) => a.state !== "pending")
            .reduce((n, a) => n + (a.size_bytes || 0), 0)}
        />
        <button className="secondary" disabled={busy}>
          儲存補充內容並重新解析
        </button>
      </form>
      <div className="attachment-area">
        {data.attachments
          .filter((a) => a.source_id === source.id)
          .map((a) => (
            <div className="attachment" key={a.id}>
              {a.state === "pending" ? (
                <span>
                  圖片尚未確認{" "}
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => void act(() => api("attachments/complete", { id: a.id }))}
                  >
                    重試確認
                  </button>
                </span>
              ) : (
                <a href={`/api/attachments/${a.id}`} target="_blank" rel="noopener noreferrer">
                  查看私人截圖 ↗
                </a>
              )}
              <button
                className="icon-button"
                aria-label="刪除截圖"
                disabled={busy}
                onClick={() => void act(() => api("delete", { table: "attachments", id: a.id }))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
      </div>
      {notice && (
        <p className="alert" role="status">
          {notice}
        </p>
      )}
      {source.summary && (
        <section className="source-summary">
          <h3>文章摘要</h3>
          <p className="pre-wrap">{source.summary}</p>
          <small>來自這份收藏來源，可能需要人工確認。</small>
        </section>
      )}
      {!!source.candidates.length && (
        <section>
          <h3>辨識到的候選店家</h3>
          <p className="muted">勾選要新增的店家；若已收藏，請在下方連結到既有店家。</p>
          {source.candidates.map((c, i) => (
            <label className="candidate" key={i}>
              <input
                type="checkbox"
                checked={chosen.includes(i)}
                onChange={(e) =>
                  setChosen(e.target.checked ? [...chosen, i] : chosen.filter((n) => n !== i))
                }
              />
              <span>
                <strong>
                  {c.name}
                  {c.branch ? ` · ${c.branch}` : ""}
                </strong>
                {c.location_clues && <small>{c.location_clues}</small>}
                <small>
                  {[c.country, c.city, c.address].filter(Boolean).join(" · ") || "地點待確認"}
                </small>
                <small>文章推薦：{c.dishes.join("、") || "未提供"}</small>
              </span>
            </label>
          ))}
          <button
            className="primary"
            disabled={busy || !chosen.length}
            onClick={() =>
              void act(async () => {
                await api("candidates", { source_id: source.id, indices: chosen });
                setChosen([]);
              })
            }
          >
            <Check size={16} />
            確認新增所選店家
          </button>
        </section>
      )}
      <section className="link-section">
        <h3>這份收藏對應的店家</h3>
        {linked.map((l) => (
          <div className="section-line" key={l.place_id}>
            <span>{data.places.find((p) => p.id === l.place_id)?.name}</span>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void act(() => api("links/remove", { source_id: source.id, place_id: l.place_id }))
              }
            >
              解除關聯
            </button>
          </div>
        ))}
        <div className="inline-form">
          <select
            aria-label="選擇既有店家"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">選擇既有店家</option>
            {data.places
              .filter((p) => !linked.some((l) => l.place_id === p.id))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.city || "地點待補"}
                </option>
              ))}
          </select>
          <button
            className="secondary"
            disabled={!selected || busy}
            onClick={() =>
              void act(() => api("links", { source_id: source.id, place_id: selected }))
            }
          >
            <Link2 size={16} />
            連結
          </button>
        </div>
        <button className="text-button" onClick={() => onNewPlace({})}>
          ＋ 手動新增店家並連結此來源
        </button>
      </section>
      <ErrorMessage error={error} />
    </div>
  );
}
