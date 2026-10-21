"use client";
import { useState } from "react";
import { IMAGE_ACCEPT, MAX_IMAGES, MAX_IMAGE_BYTES, MAX_SOURCE_IMAGE_BYTES } from "@/lib/images";
export function ImagePicker({
  files,
  onChange,
  disabled = false,
  existingCount = 0,
  existingBytes = 0,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  existingCount?: number;
  existingBytes?: number;
}) {
  const [error, setError] = useState("");
  const add = (list: FileList | null) => {
    if (!list) return;
    const selected = [...files, ...Array.from(list)];
    if (selected.length + existingCount > MAX_IMAGES) {
      setError("每份來源最多 6 張圖片。");
      return;
    }
    if (selected.some((f) => !f.size || f.size > MAX_IMAGE_BYTES)) {
      setError("每張圖片需為 5 MB 以內。");
      return;
    }
    if (selected.reduce((n, f) => n + f.size, existingBytes) > MAX_SOURCE_IMAGE_BYTES) {
      setError("每份來源的圖片合計需為 12 MB 以內。");
      return;
    }
    setError("");
    onChange(selected);
  };
  return (
    <div className="image-picker">
      <p className="muted">可選多張 JPEG、PNG、WebP、HEIC；每張 5 MB，最多 6 張、合計 12 MB。</p>
      <div className="button-row">
        <label className="upload-button">
          從相簿選圖
          <input
            aria-label="從相簿選圖"
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            disabled={disabled}
            onChange={(e) => {
              add(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <label className="upload-button">
          拍照
          <input
            aria-label="拍照"
            type="file"
            accept={IMAGE_ACCEPT}
            capture="environment"
            disabled={disabled}
            onChange={(e) => {
              add(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {files.map((f, i) => (
        <div className="attachment" key={`${f.name}-${i}`}>
          <span>
            {f.name} · {(f.size / 1024 / 1024).toFixed(1)} MB
          </span>
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            onClick={() => onChange(files.filter((_, n) => n !== i))}
            aria-label={`移除待上傳圖片 ${i + 1}`}
          >
            移除
          </button>
        </div>
      ))}
      {error && (
        <p className="alert error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
