"use client";
import { useEffect, useRef } from "react";
import { X, MapPin, Compass } from "lucide-react";
export function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <MapPin size={24} />
      </span>
      <span>
        STONE<span className="brand-sub">旅藏 · 私人旅行手帖</span>
      </span>
    </div>
  );
}
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function RatingSelect({
  value,
  onChange,
  label = "評分",
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  label?: string;
}) {
  return (
    <Field label={label}>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">尚未評分</option>
        {[1, 2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            {"★".repeat(n)} · {n} 星
          </option>
        ))}
      </select>
    </Field>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      d?.close();
      document.body.style.overflow = old;
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "modal wide" : "modal"}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-inner">
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-button" aria-label="關閉" onClick={onClose}>
            <X />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function Empty({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Compass size={38} strokeWidth={1.3} />
      </span>
      <h3>{title}</h3>
      <p>{body}</p>
      {children}
    </div>
  );
}
export function MapDrawing() {
  return (
    <svg viewBox="0 0 500 350" className="map-drawing" role="img" aria-label="旅行地圖插畫">
      <path d="m20 100 145-50 155 45 155-40v235l-155 40-155-45-145 50Z" fill="#e8e8d7" />
      <path d="m165 50v235m155-190v235" stroke="#d0d4bb" />
      <path
        d="M30 245c70-150 70 20 160-100s145 140 270-40"
        fill="none"
        stroke="#fafbf4"
        strokeWidth="24"
      />
      <path
        d="m60 80 40 210m100-225 20 230m140-210 45 220M30 160l425 70"
        fill="none"
        stroke="#fafbf4"
        strokeWidth="9"
      />
      <path
        d="M50 290C125 170 190 310 230 200s120 0 190-120"
        fill="none"
        stroke="#b48263"
        strokeWidth="3"
        strokeDasharray="6 8"
      />
      <g fill="#24584c">
        <circle cx="115" cy="180" r="24" />
        <circle cx="345" cy="210" r="24" />
      </g>
      <g fill="#fff">
        <path d="M105 170h16v13a8 8 0 0 1-16 0zm17 1h6v7h-6Z" />
        <path d="m333 212 12-16 12 16h-4v14h-16v-14Z" />
      </g>
      <path
        d="M260 78c-20 0-30 14-30 30 0 23 30 45 30 45s30-22 30-45c0-16-10-30-30-30Z"
        fill="#bf795a"
      />
      <circle cx="260" cy="106" r="10" fill="#fff8ee" />
      <circle cx="420" cy="80" r="7" fill="#bf795a" />
    </svg>
  );
}
