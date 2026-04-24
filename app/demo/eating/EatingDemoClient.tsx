"use client";

import CharacterEatingLoop from "@/components/animation/CharacterEatingLoop";
import { takePendingHomeImage } from "@/lib/homePendingImageIdb";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";

const ACCEPT_ATTR = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";
const ACCEPT_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

function isAllowedImageFile(file: File): boolean {
  if (file.type && ACCEPT_MIME.has(file.type)) return true;
  return /\.(png|jpe?g|webp)$/i.test(file.name);
}

function pickFirstImage(files: FileList | File[] | null): File | null {
  if (!files || files.length === 0) return null;
  const list = Array.from(files);
  return list.find(isAllowedImageFile) ?? null;
}

export default function EatingDemoClient() {
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileLabel, setFileLabel] = useState<string | null>(null);
  const [mode, setMode] = useState<"eat" | "sing">("eat");
  const [dragActive, setDragActive] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const revokeAndClear = useCallback(() => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setPreviewUrl(null);
    setFileLabel(null);
    setHint(null);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const applyFile = useCallback((file: File | null) => {
    if (!file) {
      revokeAndClear();
      return;
    }
    if (!isAllowedImageFile(file)) {
      setHint("PNG / JPG / WebP のみ対応です。");
      return;
    }
    setHint(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setPreviewUrl(url);
    setFileLabel(file.name);
  }, [revokeAndClear]);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const pending = await takePendingHomeImage();
        if (cancelled || !pending) return;
        applyFile(pending);
      } catch {
        // 無視（手動アップロードで継続）
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyFile]);

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = pickFirstImage(e.target.files);
    applyFile(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = pickFirstImage(e.dataTransfer.files);
    if (file) applyFile(file);
    else if (e.dataTransfer.files.length > 0) {
      setHint("PNG / JPG / WebP のみ対応です。");
    }
  };

  return (
    <>
      <section className="mb-10 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <h2 className="mb-1 text-lg font-semibold text-slate-800">自分の画像でプレビュー</h2>
        <p className="mb-4 text-sm text-slate-600">
          端末内のみ（サーバーに送りません）。PNG / JPG / WebP。タップで選択、またはここにドロップ。
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          className="sr-only"
          aria-label="画像を選択"
          onChange={onInputChange}
        />

        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onClick={() => inputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={[
            "mb-4 cursor-pointer rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2",
            dragActive
              ? "border-slate-500 bg-slate-50"
              : "border-slate-300 bg-slate-50/80 hover:border-slate-400 hover:bg-slate-50",
          ].join(" ")}
        >
          <p className="text-sm font-medium text-slate-800">画像をドロップ / タップして選択</p>
          <p className="mt-1 text-xs text-slate-500">最大サイズは端末・ブラウザの制限に依存します</p>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-700">モード</span>
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
            <button
              type="button"
              onClick={() => setMode("eat")}
              className={[
                "min-h-[44px] min-w-[88px] rounded-md px-4 text-sm font-semibold transition-colors",
                mode === "eat" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100",
              ].join(" ")}
            >
              eat
            </button>
            <button
              type="button"
              onClick={() => setMode("sing")}
              className={[
                "min-h-[44px] min-w-[88px] rounded-md px-4 text-sm font-semibold transition-colors",
                mode === "sing" ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100",
              ].join(" ")}
            >
              sing
            </button>
          </div>
          {fileLabel && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                revokeAndClear();
              }}
              className="ml-auto min-h-[44px] rounded-lg border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50"
            >
              画像をクリア
            </button>
          )}
        </div>

        {fileLabel && (
          <p className="mb-2 truncate text-xs text-slate-500" title={fileLabel}>
            選択中: {fileLabel}
          </p>
        )}

        {hint && <p className="mb-2 text-sm text-amber-800">{hint}</p>}

        <div className="mx-auto max-w-[320px]">
          <CharacterEatingLoop mode={mode} quality="improved" imageUrl={previewUrl ?? undefined} />
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold text-slate-800">最低限動く版（minimal）</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-sm font-medium text-slate-700">eat</p>
            <CharacterEatingLoop mode="eat" quality="minimal" />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-sm font-medium text-slate-700">sing</p>
            <CharacterEatingLoop mode="sing" quality="minimal" />
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-800">見た目改善版（improved）</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-sm font-medium text-slate-700">eat</p>
            <CharacterEatingLoop mode="eat" quality="improved" />
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-3 text-sm font-medium text-slate-700">sing</p>
            <CharacterEatingLoop mode="sing" quality="improved" />
          </div>
        </div>
      </section>
    </>
  );
}
