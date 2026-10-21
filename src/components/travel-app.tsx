"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  MapPin,
  Bookmark,
  Inbox,
  Download,
  Tag,
  Plus,
  Search,
  ArrowUpRight,
  ArrowRight,
  LayoutGrid,
  Map,
  LogOut,
  ShieldCheck,
  Link2,
  Coffee,
  Compass,
  Pencil,
  Trash2,
  CalendarDays,
  Heart,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { Library, Place, Source, Visit } from "@/lib/types";
import { categories, statusLabels } from "@/lib/types";
import { emptyFilters, filterPlaces, mapsUrl, stars, type Filters } from "@/lib/domain";
import { api } from "@/lib/client-api";
import { Brand, Empty, Field, MapDrawing, Modal } from "./ui";
import { PlaceForm, SourceEditor, VisitForm } from "./forms";
import { ImagePicker } from "./image-picker";
import { uploadImage } from "@/lib/upload-images";
import ExportPanel from "./export-panel";
const PlaceMap = dynamic(() => import("./map"), {
  ssr: false,
  loading: () => <div className="map-canvas loading">地圖載入中…</div>,
});
type Tab = "places" | "inbox" | "export" | "labels";
type Editor =
  | { kind: "place"; place?: Partial<Place>; sourceId?: string }
  | { kind: "visit"; place: Place; visit?: Visit }
  | { kind: "source"; sourceId: string };
const nav = [
  { id: "places", label: "我的收藏", icon: Bookmark },
  { id: "inbox", label: "待整理", icon: Inbox },
  { id: "export", label: "匯出分享", icon: Download },
  { id: "labels", label: "標籤管理", icon: Tag },
] as const;

export default function TravelApp() {
  const [session, setSession] = useState<{
    configured: boolean;
    user: { email: string; id: string } | null;
  } | null>(null);
  const [data, setData] = useState<Library | null>(null);
  const [tab, setTab] = useState<Tab>("places");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [mode, setMode] = useState<"list" | "map">("list");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selected, setSelected] = useState<Place | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [quick, setQuick] = useState("");
  const [reason, setReason] = useState("");
  const [contentText, setContentText] = useState("");
  const [quickImages, setQuickImages] = useState<File[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const sessionGeneration = useRef(0);
  const refresh = useCallback(async () => {
    const generation = sessionGeneration.current;
    const result = await api<Library>("library");
    if (generation !== sessionGeneration.current) return;
    setData(result);
    setSelected((current) =>
      current ? (result.places.find((p) => p.id === current.id) ?? null) : null,
    );
  }, []);
  useEffect(() => {
    api<{ configured: boolean; user: { email: string; id: string } | null }>("session")
      .then((s) => {
        setSession(s);
        if (s.user) void refresh().catch((e) => setError(e.message));
        const url = new URLSearchParams(window.location.search).get("url");
        if (url) {
          setQuick(url);
          setAttachOpen(new URLSearchParams(window.location.search).get("attach") === "1");
          setTab("inbox");
        }
      })
      .catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    if (!session?.user) return;
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [session?.user, refresh]);
  const places = useMemo(() => (data ? filterPlaces(data, filters) : []), [data, filters]);
  const selectPlace = useCallback((p: Place) => setSelected(p), []);
  const afterSave = async () => {
    await refresh();
    setEditor(null);
    setNotice("已儲存，這份記憶留下來了。");
  };
  const run = async (fn: () => Promise<unknown>, message = "已完成") => {
    try {
      setError("");
      await fn();
      await refresh();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const logout = async () => {
    try {
      await api("logout", {});
      sessionGeneration.current += 1;
      setSession((current) => (current ? { ...current, user: null } : current));
      setData(null);
      setSelected(null);
      setEditor(null);
      setNotice("");
      setError("");
      setQuick("");
      setReason("");
      setContentText("");
      setQuickImages([]);
      setAttachOpen(false);
      setTab("places");
      setFilters(emptyFilters);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  if (!session)
    return (
      <main className="loading-screen">
        <Brand />
        <p role="status">{error || "正在打開你的旅行手帖…"}</p>
        {error && <button onClick={() => window.location.reload()}>重新載入</button>}
      </main>
    );
  if (!session.user)
    return (
      <Login
        configured={session.configured}
        onLogin={async () => {
          sessionGeneration.current += 1;
          setData(null);
          setSession(await api("session"));
          await refresh();
        }}
      />
    );
  const pending =
    data?.sources.filter(
      (s) =>
        !data.place_sources.some((l) => l.source_id === s.id) ||
        ["needs_input", "failed", "pending", "processing"].includes(s.status),
    ).length ?? 0;
  const countries = [...new Set(data?.places.map((p) => p.country).filter(Boolean))].sort();
  const cities = [
    ...new Set(
      data?.places
        .filter((p) => !filters.country || p.country === filters.country)
        .map((p) => p.city)
        .filter(Boolean),
    ),
  ].sort();
  const tags = [...new Set(data?.places.flatMap((p) => p.tags))].sort();
  const updateFilter = (key: keyof Filters, value: string) =>
    setFilters((f) => ({ ...f, [key]: value, ...(key === "country" ? { city: "" } : {}) }));
  const visitCount = new Set(data?.visits.map((v) => v.place_id)).size;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-label">YOUR LITTLE WORLD</div>
        <nav aria-label="主要導覽">
          {nav.map((n) => (
            <button
              key={n.id}
              className={tab === n.id ? "nav-item active" : "nav-item"}
              onClick={() => setTab(n.id)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.id === "inbox" && pending > 0 && <b>{pending}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <Compass size={26} strokeWidth={1.2} />
          <p>
            每一次心動，
            <br />
            都是下段旅程的起點。
          </p>
          <span>COLLECT MOMENTS, NOT THINGS.</span>
        </div>
        <div className="sidebar-footer">
          <ShieldCheck size={15} /> 你的收藏，只有你看得到
          <button
            className="icon-button"
            title="登出"
            aria-label="登出"
            onClick={() => void logout()}
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <span className="breadcrumb">
            我的旅行手帖 <span>/</span> {nav.find((n) => n.id === tab)?.label}
          </span>
          <div className="topbar-right">
            <span className="private-chip">
              <ShieldCheck size={14} /> 私人收藏
            </span>
            <span className="avatar" title={session.user.email}>
              {session.user.email.slice(0, 1).toUpperCase()}
            </span>
            <button
              className="icon-button mobile-logout"
              aria-label="手機登出"
              onClick={() => void logout()}
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>
        <div className="content">
          {notice && (
            <div className="toast" role="status">
              {notice}
              <button aria-label="關閉通知" className="icon-button" onClick={() => setNotice("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {error && (
            <div className="alert error" role="alert">
              {error}
              <button
                className="text-button"
                onClick={() =>
                  void refresh()
                    .then(() => setError(""))
                    .catch((e) => setError(e.message))
                }
              >
                重試
              </button>
            </div>
          )}
          <section className="hero">
            <div>
              <span className="eyebrow">A LITTLE COLLECTION OF WANDERLUST</span>
              <h1>
                {tab === "places" ? (
                  <>
                    把想去的地方，
                    <br />
                    <span>留給下一段旅程。</span>
                  </>
                ) : tab === "inbox" ? (
                  <>
                    先收藏，
                    <br />
                    <span>讓靈感慢慢成形。</span>
                  </>
                ) : tab === "export" ? (
                  <>
                    喜歡的地方，
                    <br />
                    <span>也想讓你知道。</span>
                  </>
                ) : (
                  <>
                    為每份喜歡，
                    <br />
                    <span>找到自己的分類。</span>
                  </>
                )}
              </h1>
              <p>一家巷弄咖啡、一場偶然相遇，收好每個值得出發的理由。</p>
              <div className="hero-stats">
                <span>
                  <strong>{data?.places.length ?? 0}</strong> 個口袋名單
                </span>
                <i />
                <span>
                  <strong>
                    {
                      [
                        ...new Set(
                          data?.places.filter((p) => p.city).map((p) => `${p.country}/${p.city}`),
                        ),
                      ].length
                    }
                  </strong>{" "}
                  座城市
                </span>
                <i />
                <span>
                  <strong>{visitCount}</strong> 段到訪回憶
                </span>
              </div>
            </div>
            <div className="hero-art">
              <MapDrawing />
              <span className="art-note">下一站，去哪裡？</span>
            </div>
          </section>
          <form
            className="quick-save"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                setError("");
                const supplement = !!contentText.trim() || quickImages.length > 0;
                const result = await api<{ duplicate: boolean; source: Source }>("sources", {
                  url: quick,
                  reason,
                  content_text: contentText,
                  defer_parse: supplement,
                });
                setNotice(result.duplicate ? "這份連結已收藏，沒有重複建立。" : "連結已保存。");
                if (supplement) {
                  const text =
                    result.duplicate && result.source.content_text.trim() !== contentText.trim()
                      ? [result.source.content_text, contentText].filter(Boolean).join("\n\n")
                      : contentText;
                  const why = result.duplicate ? result.source.reason : reason;
                  await api("sources/intake", {
                    id: result.source.id,
                    content_text: text,
                    reason: why,
                  });
                  for (const file of quickImages) {
                    await uploadImage(result.source.id, file);
                    setQuickImages((current) => current.filter((f) => f !== file));
                    setNotice("連結與圖片已保存，正在完成剩餘步驟…");
                  }
                  await api("sources/retry", {
                    id: result.source.id,
                    content_text: text,
                    reason: why,
                  });
                }
                setNotice(
                  result.duplicate && !supplement
                    ? "這份連結已收藏，沒有重複建立。"
                    : "收藏與補充內容已保存，解析會另外進行。",
                );
                setQuick("");
                setReason("");
                setContentText("");
                setQuickImages([]);
                setAttachOpen(false);
                await refresh();
                setTab("inbox");
              } catch (e) {
                setError((e as Error).message);
                await refresh().catch(() => {});
              } finally {
                setBusy(false);
              }
            }}
          >
            <div className="quick-icon">
              <Link2 size={22} />
            </div>
            <div className="quick-fields">
              <label className="sr-only" htmlFor="quick-url">
                收藏連結
              </label>
              <input
                id="quick-url"
                required
                type="url"
                value={quick}
                onChange={(e) => setQuick(e.target.value)}
                placeholder="貼上 IG、Threads 或 Google Maps 連結…"
              />
              {quick && (
                <input
                  aria-label="收藏原因"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="為什麼想去？（選填）"
                />
              )}
              {quick && (
                <details
                  className="quick-content"
                  open={attachOpen}
                  onToggle={(e) => setAttachOpen(e.currentTarget.open)}
                >
                  <summary>附上文字或截圖（選填）</summary>
                  <Field label="文章文字">
                    <textarea
                      rows={4}
                      value={contentText}
                      disabled={busy}
                      maxLength={30000}
                      onChange={(e) => setContentText(e.target.value)}
                      placeholder="貼上文案，或選擇下面的截圖"
                    />
                  </Field>
                  <ImagePicker files={quickImages} onChange={setQuickImages} disabled={busy} />
                </details>
              )}
            </div>
            <button className="primary" disabled={busy}>
              {busy ? (
                "儲存中…"
              ) : (
                <>
                  收進口袋 <Plus size={17} />
                </>
              )}
            </button>
          </form>
          {!data ? (
            <div className="loading" role="status">
              正在讀取收藏…
            </div>
          ) : (
            <>
              {(tab === "places" || tab === "export") && (
                <>
                  <div className="section-line collection-title">
                    <h2>
                      {tab === "places" ? "我的收藏" : "分享口袋名單"}
                      <small>{places.length} 個地方</small>
                    </h2>
                    <div className="button-row">
                      <button
                        className="secondary small filter-toggle"
                        onClick={() => setShowFilters(!showFilters)}
                      >
                        <SlidersHorizontal size={16} />
                        篩選
                      </button>
                      <button
                        className="secondary small"
                        onClick={() => setEditor({ kind: "place" })}
                      >
                        <Plus size={16} />
                        手動新增
                      </button>
                    </div>
                  </div>
                  <div className={`filters ${showFilters ? "expanded" : ""}`}>
                    <label className="search-field">
                      <Search size={18} />
                      <input
                        aria-label="搜尋店名"
                        placeholder="搜尋店名…"
                        value={filters.q}
                        onChange={(e) => updateFilter("q", e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="國家篩選"
                      value={filters.country}
                      onChange={(e) => updateFilter("country", e.target.value)}
                    >
                      <option value="">所有國家／地區</option>
                      {countries.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <select
                      aria-label="城市篩選"
                      value={filters.city}
                      onChange={(e) => updateFilter("city", e.target.value)}
                    >
                      <option value="">所有城市</option>
                      {cities.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <select
                      aria-label="到訪狀態篩選"
                      value={filters.visited}
                      onChange={(e) => updateFilter("visited", e.target.value)}
                    >
                      <option value="">想去與去過</option>
                      <option value="no">還沒去過</option>
                      <option value="yes">已經去過</option>
                    </select>
                    <select
                      aria-label="標籤篩選"
                      value={filters.tag}
                      onChange={(e) => updateFilter("tag", e.target.value)}
                    >
                      <option value="">所有標籤</option>
                      {tags.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    {Object.values(filters).some(Boolean) && (
                      <button className="text-button" onClick={() => setFilters(emptyFilters)}>
                        清除篩選
                      </button>
                    )}
                  </div>
                  <div className="category-line">
                    <div className="category-tabs">
                      {["", ...categories].map((c) => (
                        <button
                          key={c}
                          className={filters.category === c ? "category active" : "category"}
                          onClick={() => updateFilter("category", c)}
                        >
                          {c || "全部收藏"}
                        </button>
                      ))}
                    </div>
                    {tab === "places" && (
                      <div className="view-toggle">
                        <button
                          aria-label="清單模式"
                          className={mode === "list" ? "active" : ""}
                          onClick={() => setMode("list")}
                        >
                          <LayoutGrid size={17} />
                        </button>
                        <button
                          aria-label="位置模式"
                          className={mode === "map" ? "active" : ""}
                          onClick={() => setMode("map")}
                        >
                          <Map size={17} />
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
              {tab === "places" && (
                <>
                  {!data.places.length ? (
                    <Empty
                      title="第一個想去的地方，從這裡開始"
                      body="貼上一份心動的連結，或手動記下一家喜歡的店。你的旅行手帖，等你慢慢填滿。"
                    >
                      <button className="primary" onClick={() => setEditor({ kind: "place" })}>
                        <Plus size={17} />
                        新增第一家店
                      </button>
                    </Empty>
                  ) : !places.length ? (
                    <Empty title="這次還沒有找到店家" body="試著減少篩選條件，或換個店名搜尋。">
                      <button className="secondary" onClick={() => setFilters(emptyFilters)}>
                        清除篩選
                      </button>
                    </Empty>
                  ) : mode === "map" ? (
                    <>
                      <PlaceMap places={places} onSelect={selectPlace} />
                      <p className="muted map-note">
                        顯示 {places.filter((p) => p.latitude !== null).length}{" "}
                        個已確認位置。底圖由外部服務提供，需要網路連線。
                      </p>
                      <div className="unlocated">
                        <h3>待補位置</h3>
                        {places
                          .filter((p) => p.latitude === null)
                          .map((p) => (
                            <button
                              className="secondary small"
                              key={p.id}
                              onClick={() => setSelected(p)}
                            >
                              <MapPin size={15} />
                              {p.name}
                            </button>
                          ))}
                      </div>
                    </>
                  ) : (
                    <div className="place-grid">
                      {places.map((p, i) => (
                        <PlaceCard
                          key={p.id}
                          place={p}
                          index={i}
                          visited={data.visits.some((v) => v.place_id === p.id)}
                          onSelect={() => setSelected(p)}
                        />
                      ))}
                    </div>
                  )}
                  {!!cities.length && (
                    <section className="cities-section">
                      <div className="section-line">
                        <h2>跟著城市出發</h2>
                        <span className="eyebrow">YOUR NEXT CHAPTER</span>
                      </div>
                      <div className="city-grid">
                        {[
                          ...new Set(
                            data.places.filter((p) => p.city).map((p) => `${p.country}|${p.city}`),
                          ),
                        ].map((key, i) => {
                          const [country, city] = key.split("|");
                          return (
                            <button
                              key={key}
                              className={`city-card tone-${i % 4}`}
                              onClick={() => setFilters({ ...emptyFilters, country, city })}
                            >
                              <MapPin size={25} />
                              <span>
                                <small>{country || "地區待補"}</small>
                                <strong>{city}</strong>
                                <small>
                                  {
                                    data.places.filter(
                                      (p) => p.city === city && p.country === country,
                                    ).length
                                  }{" "}
                                  個值得出發的理由
                                </small>
                              </span>
                              <ArrowUpRight size={20} />
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </>
              )}
              {tab === "inbox" && (
                <section>
                  <div className="section-line">
                    <h2>
                      收藏來源 <small>{data.sources.length} 份</small>
                    </h2>
                    <button
                      className="secondary small"
                      onClick={() => setEditor({ kind: "place" })}
                    >
                      <Plus size={16} />
                      手動新增店家
                    </button>
                  </div>
                  <p className="muted">
                    原始連結會一直保留。未辨識店家或缺少地點時，可補上文字、截圖或直接連結店家。
                  </p>
                  {!data.sources.length ? (
                    <Empty
                      title="有一點喜歡，就先留下來"
                      body="把看到的文章或地圖連結貼在上方，之後再慢慢整理。"
                    />
                  ) : (
                    <div className="source-list">
                      {data.sources.map((s) => (
                        <button
                          key={s.id}
                          className="source-card"
                          onClick={() => setEditor({ kind: "source", sourceId: s.id })}
                        >
                          <span className="source-icon">
                            <Link2 />
                          </span>
                          <span className="source-content">
                            <span className="source-site">
                              {new URL(s.original_url).hostname}
                              <span className={`status ${s.status}`}>{statusLabels[s.status]}</span>
                            </span>
                            <strong>
                              {s.reason || s.candidates[0]?.name || "一份等待探索的收藏"}
                            </strong>
                            <span className="truncate">{s.original_url}</span>
                            <small>
                              {data.place_sources.filter((l) => l.source_id === s.id).length}{" "}
                              家關聯店家 · {new Date(s.created_at).toLocaleDateString("zh-TW")}
                            </small>
                          </span>
                          <ArrowRight size={19} />
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}
              {tab === "export" && <ExportPanel data={data} places={places} filters={filters} />}
              {tab === "labels" && <Labels data={data} onChange={refresh} />}
            </>
          )}
          <footer className="main-footer">
            <span>STONE · 把喜歡的地方，好好收藏。</span>
            <span>
              <Heart size={12} /> Made for your next journey
            </span>
          </footer>
        </div>
      </main>
      {selected && data && (
        <Modal title={selected.name} onClose={() => setSelected(null)} wide>
          <PlaceDetail
            place={selected}
            data={data}
            onEdit={() => {
              setEditor({ kind: "place", place: selected });
              setSelected(null);
            }}
            onVisit={(visit) => {
              setEditor({ kind: "visit", place: selected, visit });
              setSelected(null);
            }}
            onSource={(sourceId) => {
              setEditor({ kind: "source", sourceId });
              setSelected(null);
            }}
            onDeleteVisit={(id) =>
              void run(
                () => api("delete", { table: "visits", id }),
                "已刪除到訪紀錄；最後一次到訪刪除後，店家會回到想去清單。",
              )
            }
            onDelete={() =>
              void run(async () => {
                await api("delete", { table: "places", id: selected.id });
                setSelected(null);
              }, "店家已刪除，原始收藏來源仍保留。")
            }
            onMerge={(id) =>
              void run(async () => {
                await api("places/merge", { from_id: selected.id, into_id: id });
                setSelected(null);
              }, "已合併店家，來源與歷史到訪已保留。")
            }
          />
        </Modal>
      )}
      {editor && data && (
        <Modal
          title={
            editor.kind === "place"
              ? editor.place?.id
                ? "編輯店家"
                : "新增口袋名單"
              : editor.kind === "visit"
                ? "留下一次到訪"
                : "整理這份收藏"
          }
          onClose={() => setEditor(null)}
          wide={editor.kind === "source"}
        >
          {editor.kind === "place" && (
            <PlaceForm place={editor.place} sourceId={editor.sourceId} onSaved={afterSave} />
          )}
          {editor.kind === "visit" && (
            <VisitForm place={editor.place} visit={editor.visit} data={data} onSaved={afterSave} />
          )}
          {editor.kind === "source" && data.sources.find((s) => s.id === editor.sourceId) && (
            <SourceEditor
              key={editor.sourceId}
              source={data.sources.find((s) => s.id === editor.sourceId)!}
              data={data}
              onChanged={refresh}
              onNewPlace={(place) => setEditor({ kind: "place", place, sourceId: editor.sourceId })}
            />
          )}
        </Modal>
      )}
    </div>
  );
}

function Login({ configured, onLogin }: { configured: boolean; onLogin: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <main className="login-shell">
      <section className="login-story">
        <Brand />
        <div>
          <span className="eyebrow">A PLACE FOR EVERY LITTLE DISCOVERY</span>
          <h1>
            收藏每次心動，
            <br />
            慢慢走成一段旅程。
          </h1>
          <p>
            那些還沒走進去的咖啡店，
            <br />
            和想要再去一次的街角，都放在這裡。
          </p>
          <MapDrawing />
        </div>
        <span className="login-footnote">你的私人旅行手帖 · STONE 旅藏</span>
      </section>
      <section className="login-form">
        <div>
          <span className="eyebrow">WELCOME TO YOUR LITTLE WORLD</span>
          <h2>打開你的旅藏</h2>
          <p className="muted">那些想去的地方，正在等你。</p>
          {configured ? (
            <form
              className="form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                try {
                  await api("login", { email, password });
                  await onLogin();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="電子郵件">
                <input
                  type="email"
                  required
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </Field>
              <Field label="密碼">
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="輸入你的密碼"
                />
              </Field>
              {error && (
                <p className="alert error" role="alert">
                  {error}
                </p>
              )}
              <button className="primary" disabled={busy}>
                {busy ? "登入中…" : "登入我的收藏"}
                <ArrowRight size={18} />
              </button>
              <p className="privacy-note">
                <ShieldCheck size={17} />
                僅供受邀帳號登入，所有收藏預設私人。
              </p>
            </form>
          ) : (
            <div className="setup-notice">
              <h3>準備好，就能開始收藏</h3>
              <p>
                這個網站尚未連接資料庫。請依 README 完成本機 Supabase
                啟動，或填入正式專案的連線設定。
              </p>
              <p>設定完成前不會儲存資料，也不會以示範內容代替你的收藏。</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
function PlaceCard({
  place: p,
  index,
  visited,
  onSelect,
}: {
  place: Place;
  index: number;
  visited: boolean;
  onSelect: () => void;
}) {
  return (
    <button className="place-card" onClick={onSelect}>
      <div className={`place-cover tone-${index % 4}`}>
        <span className="cover-grid" />
        {p.categories.includes("咖啡廳") || p.categories.includes("甜點") ? (
          <Coffee className="cover-symbol" size={76} strokeWidth={0.8} />
        ) : (
          <Compass className="cover-symbol" size={76} strokeWidth={0.8} />
        )}
        <span className="place-city">
          <MapPin size={12} />
          {p.city || "地點待補"}
        </span>
        <span className="bookmark-symbol">
          <Bookmark size={17} />
        </span>
      </div>
      <div className="place-body">
        <div className="place-heading">
          <h3>{p.name}</h3>
          <ArrowUpRight size={18} />
        </div>
        <p>{[p.country, p.city].filter(Boolean).join(" · ") || "留待下次慢慢探索"}</p>
        <div className="card-tags">
          {p.categories.slice(0, 3).map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
        <div className="card-bottom">
          <span className={visited ? "visited" : "wanted"}>
            <i />
            {visited ? "已經去過" : "想去清單"}
          </span>
          <span className={p.rating === null ? "unrated" : "rating"}>{stars(p.rating)}</span>
        </div>
      </div>
    </button>
  );
}
function PlaceDetail({
  place: p,
  data,
  onEdit,
  onVisit,
  onSource,
  onDeleteVisit,
  onDelete,
  onMerge,
}: {
  place: Place;
  data: Library;
  onEdit: () => void;
  onVisit: (v?: Visit) => void;
  onSource: (id: string) => void;
  onDeleteVisit: (id: string) => void;
  onDelete: () => void;
  onMerge: (id: string) => void;
}) {
  const visits = data.visits.filter((v) => v.place_id === p.id);
  const sources = data.sources.filter((s) =>
    data.place_sources.some((l) => l.place_id === p.id && l.source_id === s.id),
  );
  const [merge, setMerge] = useState("");
  return (
    <div className="detail">
      <div className="detail-summary">
        <div>
          <p className="eyebrow">{[p.country, p.city].filter(Boolean).join(" / ") || "位置待補"}</p>
          <p>{p.address || "尚未填寫地址"}</p>
          <div className="card-tags">
            {[...p.categories, ...p.tags].map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <p className="detail-rating">
            我的總評 <span className="rating">{stars(p.rating)}</span>
          </p>
          <p className="muted">
            {visits.length ? `已去過 · ${visits.length} 次到訪` : "想去 · 還沒留下到訪紀錄"}
          </p>
        </div>
        <div className="button-stack">
          <a className="primary" href={mapsUrl(p)} target="_blank" rel="noopener noreferrer">
            <MapPin size={17} />在 Google Maps 開啟
          </a>
          <button className="secondary" onClick={onEdit}>
            <Pencil size={16} />
            編輯店家
          </button>
        </div>
      </div>
      {p.notes && (
        <div className="private-note">
          <h3>
            <ShieldCheck size={16} />
            我的私人備註
          </h3>
          <p className="pre-wrap">{p.notes}</p>
        </div>
      )}
      <div className="section-line">
        <h3>
          到訪回憶 <small>{visits.length}</small>
        </h3>
        <button className="primary small" onClick={() => onVisit()}>
          <Plus size={16} />
          新增到訪
        </button>
      </div>
      {!visits.length && <p className="muted">真正走進這個地方時，別忘了留下一點回憶。</p>}
      {visits.map((v) => (
        <article className="visit-card" key={v.id}>
          <div className="section-line">
            <strong>
              <CalendarDays size={16} />
              {v.visited_on}
            </strong>
            <span className="rating">{stars(v.rating)}</span>
          </div>
          <p className="pre-wrap">{v.notes}</p>
          {data.dishes
            .filter((d) => d.visit_id === v.id)
            .map((d) => (
              <div className="dish-row" key={d.id}>
                <div>
                  <strong>{d.name}</strong>
                  <span className="rating">{stars(d.rating)}</span>
                </div>
                {d.notes && <p className="pre-wrap">{d.notes}</p>}
              </div>
            ))}
          <div className="button-row">
            <button className="text-button" onClick={() => onVisit(v)}>
              編輯到訪
            </button>
            <button
              className="text-button danger"
              onClick={() => {
                if (confirm("確定刪除這次到訪與其餐點？刪除最後一次到訪後，此店家會回到想去清單。"))
                  onDeleteVisit(v.id);
              }}
            >
              刪除到訪
            </button>
          </div>
        </article>
      ))}
      <details className="sources-details">
        <summary>收藏來源 · {sources.length} 份</summary>
        {!sources.length && <p className="muted">這家店是手動新增的，還沒有連結收藏來源。</p>}
        {sources.map((s) => (
          <div key={s.id} className="detail-source">
            <span className={`status ${s.status}`}>{statusLabels[s.status]}</span>
            <p className="pre-wrap">{s.reason || "未填寫收藏原因"}</p>
            <a
              href={s.original_url}
              target="_blank"
              rel="noopener noreferrer"
              className="url-display"
            >
              {s.original_url}
            </a>
            {s.summary && <p className="pre-wrap">文章摘要：{s.summary}</p>}
            {s.candidates.map((c, i) => (
              <p key={i} className="muted">
                文章推薦 · {c.name}：{c.dishes.join("、") || "未提供餐點"}
              </p>
            ))}
            <button className="text-button" onClick={() => onSource(s.id)}>
              整理這份來源 →
            </button>
          </div>
        ))}
      </details>
      <details className="advanced">
        <summary>合併或刪除店家</summary>
        <p className="muted">
          合併會保留目標店家的基本資料與總評，搬移所有來源和到訪紀錄；此店家的私人備註及原評分會附加到目標備註。不同分店請勿合併。
        </p>
        <div className="inline-form">
          <select
            aria-label="合併目標店家"
            value={merge}
            onChange={(e) => setMerge(e.target.value)}
          >
            <option value="">選擇保留的目標店家</option>
            {data.places
              .filter((t) => t.id !== p.id)
              .map((t) => (
                <option value={t.id} key={t.id}>
                  {t.name} · {t.address || t.city}
                </option>
              ))}
          </select>
          <button
            className="secondary"
            disabled={!merge}
            onClick={() => {
              if (
                confirm(
                  `將「${p.name}」合併到「${data.places.find((t) => t.id === merge)?.name}」？會搬移 ${visits.length} 次到訪、${sources.length} 份來源並保留原私人備註；基本資料以目標店家為準。`,
                )
              )
                onMerge(merge);
            }}
          >
            確認合併
          </button>
        </div>
        <button
          className="text-button danger"
          onClick={() => {
            if (
              confirm(`刪除「${p.name}」及 ${visits.length} 次到訪與餐點紀錄？原始收藏來源會保留。`)
            )
              onDelete();
          }}
        >
          <Trash2 size={15} />
          刪除店家
        </button>
      </details>
    </div>
  );
}
function Labels({ data, onChange }: { data: Library; onChange: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function change(old_name: string, new_name: string) {
    setBusy(true);
    setError("");
    try {
      await api("labels", { old_name, new_name });
      await onChange();
      setName("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const names = [
    ...new Set([...data.labels.map((l) => l.name), ...data.places.flatMap((p) => p.tags)]),
  ].sort();
  return (
    <section className="labels-panel">
      <h2>自己的分類，自己命名</h2>
      <p className="muted">重新命名或刪除標籤會同步更新所有店家，不影響收藏與到訪。</p>
      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          void change("", name.trim());
        }}
      >
        <input
          aria-label="新標籤"
          required
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例如：下雨天也想去"
        />
        <button className="primary" disabled={busy || !name.trim()}>
          <Plus size={16} />
          新增標籤
        </button>
      </form>
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
      <div className="label-list">
        {names.map((n) => (
          <div className="section-line" key={n}>
            <span>
              <Tag size={16} />
              {n}
              <small>{data.places.filter((p) => p.tags.includes(n)).length} 家店</small>
            </span>
            <div className="button-row">
              <button
                className="text-button"
                disabled={busy}
                onClick={() => {
                  const v = prompt("標籤的新名稱", n);
                  if (v?.trim()) void change(n, v.trim());
                }}
              >
                重新命名
              </button>
              <button
                className="icon-button"
                disabled={busy}
                aria-label={`刪除標籤 ${n}`}
                onClick={() => {
                  if (confirm(`將「${n}」從所有店家移除？`)) void change(n, "");
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {!names.length && (
        <Empty
          title="幫喜歡的地方取個分類"
          body="像是「雨天備案」、「一個人也自在」或「下次一定要去」。"
        />
      )}
    </section>
  );
}
