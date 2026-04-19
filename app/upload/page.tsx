"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { upload } from "@vercel/blob/client";
import { readFetchJson } from "@/lib/http/readFetchJson";
import {
  formatBytes,
  MAX_VIDEO_UPLOAD_BYTES,
} from "@/lib/upload/videoUpload";
import { generateOwnerSecret, setVideoOwnerSecret } from "@/lib/videoOwnerToken";

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    if (file.size > MAX_VIDEO_UPLOAD_BYTES) {
      setError(
        `ファイルサイズが大きすぎます（最大 ${formatBytes(MAX_VIDEO_UPLOAD_BYTES)}）。`
      );
      return;
    }

    setIsUploading(true);
    setError(null);
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
        setError(
          json?.message ??
            "アップロードに失敗しました。もう一度お試しください。"
        );
        return;
      }

      const video = json.video;
      if (video?.id != null) {
        setVideoOwnerSecret(video.id, ownerSecret);
        router.push(`/videos/${video.id}/sync`);
        return;
      }
      setError("レスポンスに video.id がありません。");
    } catch (e) {
      if (e instanceof Error && e.message.includes("FUNCTION_PAYLOAD_TOO_LARGE")) {
        setError(
          `動画が大きすぎるためアップロードできません（最大 ${formatBytes(
            MAX_VIDEO_UPLOAD_BYTES
          )}）。`
        );
      } else {
        setError(e instanceof Error ? e.message : "アップロード中にエラーが発生しました");
      }
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <nav style={{ marginBottom: 16 }}>
        <Link href="/" style={{ marginRight: 12 }}>トップ</Link>
        <Link href="/videos">動画一覧・素材検索</Link>
      </nav>
      <h1>Video Upload</h1>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 12 }}>
        アップロード上限: {formatBytes(MAX_VIDEO_UPLOAD_BYTES)}
      </p>

      <form onSubmit={onSubmit}>
        <input
          type="file"
          accept=".mp4,video/mp4"
          disabled={isUploading}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="submit"
          style={{ marginLeft: 8 }}
          disabled={isUploading || !file}
        >
          {isUploading ? "Uploading..." : "Upload"}
        </button>
      </form>
      {file && (
        <p style={{ marginTop: 10, fontSize: 13, color: "#666" }}>
          選択ファイルサイズ: {formatBytes(file.size)}
        </p>
      )}

      {error && (
        <div style={{ marginTop: 16, color: "red" }}>
          エラー: {error}
        </div>
      )}
    </div>
  );
}

