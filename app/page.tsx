"use client";

import Link from "next/link";
import { useRef, useState } from "react";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUploadAndNext() {
    if (!file) return;
    setError(null);
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setError(json?.message ?? "アップロードに失敗しました。");
        return;
      }
      const video = json.video;
      if (video?.id != null) {
        window.location.href = `/videos/${video.id}/sync`;
        return;
      }
      setError("レスポンスに video.id がありません。");
    } catch (e) {
      setError(e instanceof Error ? e.message : "アップロード中にエラーが発生しました");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div style={{ padding: 40, maxWidth: 560 }}>
      <h1 style={{ marginBottom: 24 }}>広告動画アップロード MVP</h1>

      <input
        ref={inputRef}
        type="file"
        accept="video/*,.mp4"
        onChange={(e) => {
          setFile(e.target.files?.[0] ?? null);
          setError(null);
        }}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}
        aria-label="動画ファイルを選択"
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        style={{
          display: "inline-block",
          padding: "12px 24px",
          fontSize: 16,
          cursor: "pointer",
          border: "2px solid #333",
          borderRadius: 8,
          background: "#fff",
        }}
      >
        {file ? "別のファイルを選択" : "ファイルを選択"}
      </button>

      {file && (
        <div style={{ marginTop: 24, padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
          <p style={{ margin: "0 0 8px 0", fontSize: 14, color: "#666" }}>選択中:</p>
          <strong>{file.name}</strong>
          <div style={{ marginTop: 12 }}>
            <video width={320} controls src={URL.createObjectURL(file)} />
          </div>
          <div style={{ marginTop: 20, display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={handleUploadAndNext}
              disabled={isUploading}
              style={{
                padding: "12px 24px",
                fontSize: 16,
                fontWeight: 600,
                cursor: isUploading ? "not-allowed" : "pointer",
                border: "none",
                borderRadius: 8,
                background: "#333",
                color: "#fff",
              }}
            >
              {isUploading ? "アップロード中..." : "次へ（アップロードして編集画面へ）"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 16, padding: 12, color: "#c00", background: "#fff0f0", borderRadius: 8 }}>
          {error}
        </div>
      )}

      <nav style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid #eee" }}>
        <p style={{ margin: "0 0 12px 0", fontSize: 14, color: "#666" }}>その他</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Link
            href="/materials"
            style={{
              display: "inline-block",
              padding: "10px 16px",
              background: "#333",
              borderRadius: 6,
              color: "#fff",
              textDecoration: "none",
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            素材検索へ（Pixabay）
          </Link>
          <Link
            href="/videos"
            style={{
              display: "inline-block",
              padding: "10px 16px",
              background: "#f5f5f5",
              borderRadius: 6,
              color: "#333",
              textDecoration: "none",
              fontSize: 15,
            }}
          >
            動画一覧
          </Link>
        </div>
        <p style={{ margin: "12px 0 0 0", fontSize: 13, color: "#888" }}>
          素材検索＝画像検索 / 動画一覧＝歌詞同期・編集
        </p>
      </nav>
    </div>
  );
}
