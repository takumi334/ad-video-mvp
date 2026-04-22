"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { readFetchJson } from "@/lib/http/readFetchJson";
import {
  formatBytes,
  MAX_VIDEO_UPLOAD_BYTES,
} from "@/lib/upload/videoUpload";
import { generateOwnerSecret, setVideoOwnerSecret } from "@/lib/videoOwnerToken";

export default function HomePageClient() {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUploadAndNext() {
    if (!file) return;
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      setError(
        `ファイルサイズが大きすぎます（最大 ${formatBytes(MAX_VIDEO_UPLOAD_BYTES)}）。`
      );
      return;
    }
    setError(null);
    setIsUploading(true);
    const ownerSecret = generateOwnerSecret();
    try {
      const configRes = await fetch("/api/blob-upload", { method: "GET" });
      const configParsed = await readFetchJson<{ ok?: boolean; message?: string }>(
        configRes
      );
      if (!configParsed.ok) {
        setError(configParsed.message);
        return;
      }
      if (!configParsed.data?.ok) {
        setError(configParsed.data?.message ?? "アップロード設定エラーが発生しました。");
        return;
      }

      const blob = await upload(file.name, file, {
        access: "public",
        handleUploadUrl: "/api/blob-upload",
      });

      const res = await fetch("/api/videos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          originalName: file.name,
          url: blob.url,
          size: file.size,
          mime: file.type || "video/mp4",
          ownerSecret,
        }),
      });
      const parsed = await readFetchJson<{
        ok?: boolean;
        message?: string;
        video?: { id?: number };
      }>(res);
      if (!parsed.ok) {
        setError(parsed.message);
        return;
      }
      const json = parsed.data;
      if (!json?.ok) {
        setError(json?.message ?? "アップロードに失敗しました。");
        return;
      }
      const video = json.video;
      if (video?.id != null) {
        setVideoOwnerSecret(video.id, ownerSecret);
        window.location.href = `/videos/${video.id}/sync`;
        return;
      }
      setError("レスポンスに video.id がありません。");
    } catch (e) {
      const fallback = "アップロード中にエラーが発生しました";
      if (e instanceof Error && e.message.includes("FUNCTION_PAYLOAD_TOO_LARGE")) {
        setError(
          `動画が大きすぎるためアップロードできません（最大 ${formatBytes(
            MAX_VIDEO_UPLOAD_BYTES
          )}）。`
        );
      } else {
        setError(e instanceof Error ? e.message : fallback);
      }
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div style={{ padding: 40, maxWidth: 640 }}>
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
          <p style={{ margin: "8px 0 0 0", fontSize: 13, color: "#666" }}>
            サイズ: {formatBytes(file.size)} / 上限:{" "}
            {formatBytes(MAX_VIDEO_UPLOAD_BYTES)}
          </p>
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

      <article
        style={{
          marginTop: 32,
          marginBottom: 32,
          padding: "20px 24px",
          background: "#f8fafc",
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          lineHeight: 1.75,
          fontSize: 15,
          color: "#334155",
        }}
      >
        <h2 style={{ margin: "0 0 12px 0", fontSize: 18, color: "#0f172a" }}>
          無料で使える歌ってみた向け動画編集・歌詞動画づくり
        </h2>
        <p style={{ margin: "0 0 12px 0" }}>
          このサイトは、<strong>歌ってみたの動画編集</strong>や<strong>歌詞動画の作成</strong>をブラウザ上で進められるサービスです。アップロードした動画に合わせて歌詞のタイミングを合わせ、画像素材を組み合わせて<strong>MV作成</strong>の下準備まで<strong>無料</strong>で試せます。
        </p>
        <p style={{ margin: "0 0 12px 0" }}>
          「無料 動画編集」「歌ってみた 動画編集」「歌詞動画 作成」「MV作成
          無料」でお探しの方は、まず動画をアップロードして編集画面へ進んでください。
        </p>
        <p style={{ margin: "0 0 12px 0" }}>
          歌ってみた編集の流れや用語の整理は{" "}
          <Link href="/utattemita-edit" style={{ color: "#2563eb", fontWeight: 600 }}>
            歌ってみた動画編集（無料）のご案内
          </Link>
          、<Link href="/lyrics-video-maker" style={{ color: "#2563eb", fontWeight: 600 }}>
            歌詞動画メーカー（無料）
          </Link>
          、<Link href="/free-mv-maker" style={{ color: "#2563eb", fontWeight: 600 }}>
            無料MVメーカー
          </Link>
          もご覧ください。
        </p>
        <p style={{ margin: 0 }}>
          English speakers:{" "}
          <Link href="/en" style={{ color: "#2563eb", fontWeight: 600 }}>
            English site (/en)
          </Link>
        </p>
      </article>

      <nav style={{ marginTop: 32, paddingTop: 24, borderTop: "1px solid #eee" }}>
        <p style={{ margin: "0 0 12px 0", fontSize: 14, color: "#666" }}>その他</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <Link
            href="/en"
            style={{
              display: "inline-block",
              padding: "10px 16px",
              background: "#ecfdf5",
              borderRadius: 6,
              color: "#047857",
              textDecoration: "none",
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            English (/en)
          </Link>
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
          <Link
            href="/utattemita-edit"
            style={{
              display: "inline-block",
              padding: "10px 16px",
              background: "#eff6ff",
              borderRadius: 6,
              color: "#1d4ed8",
              textDecoration: "none",
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            歌ってみた編集のご案内
          </Link>
          <Link
            href="/lyrics-video-maker"
            style={{
              display: "inline-block",
              padding: "10px 16px",
              background: "#fef3c7",
              borderRadius: 6,
              color: "#92400e",
              textDecoration: "none",
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            歌詞動画メーカー
          </Link>
          <Link
            href="/free-mv-maker"
            style={{
              display: "inline-block",
              padding: "10px 16px",
              background: "#fce7f3",
              borderRadius: 6,
              color: "#9d174d",
              textDecoration: "none",
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            無料MVメーカー
          </Link>
        </div>
        <p style={{ margin: "12px 0 0 0", fontSize: 13, color: "#888" }}>
          素材検索＝画像検索 / 動画一覧＝歌詞同期・編集
        </p>
      </nav>
    </div>
  );
}
