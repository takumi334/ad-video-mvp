"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState<boolean>(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;

    setIsUploading(true);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/upload", { method: "POST", body: fd });
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        const message =
          json?.message ?? "アップロードに失敗しました。もう一度お試しください。";
        setError(message);
        return;
      }

      const video = json.video;
      if (video?.id != null) {
        router.push(`/videos/${video.id}/sync`);
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
    <div style={{ padding: 24 }}>
      <nav style={{ marginBottom: 16 }}>
        <Link href="/" style={{ marginRight: 12 }}>トップ</Link>
        <Link href="/videos">動画一覧・素材検索</Link>
      </nav>
      <h1>Video Upload</h1>

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

      {error && (
        <div style={{ marginTop: 16, color: "red" }}>
          エラー: {error}
        </div>
      )}
    </div>
  );
}

