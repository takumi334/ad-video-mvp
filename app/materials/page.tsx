"use client";

import type { SearchImageResult } from "@/app/api/search-images/route";
import Link from "next/link";
import { useState } from "react";

export default function MaterialsPage() {
  const [query, setQuery] = useState("");
  const [images, setImages] = useState<SearchImageResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    setImages([]);
    try {
      const res = await fetch(`/api/search-images?q=${encodeURIComponent(q)}`);
      const json = (await res.json()) as { ok?: boolean; message?: string; images?: SearchImageResult[] };
      if (json?.ok && Array.isArray(json.images)) {
        setImages(json.images);
      } else {
        setError(json?.message ?? "画像の取得に失敗しました。");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "画像検索に失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 960 }}>
      <nav style={{ marginBottom: 16 }}>
        <Link href="/" style={{ marginRight: 12 }}>トップ</Link>
        <Link href="/videos" style={{ marginRight: 12 }}>動画一覧</Link>
      </nav>
      <h1 style={{ marginBottom: 8 }}>素材検索（Pixabay）</h1>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>
        テーマやキーワードでPixabayから画像を検索できます。動画編集で使う場合は動画の「歌詞同期」画面からも利用可能です。
      </p>

      <form onSubmit={handleSearch} style={{ marginBottom: 24 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="例: stadium, office, flower"
          style={{ padding: "10px 14px", width: 280, marginRight: 8, fontSize: 15 }}
        />
        <button type="submit" disabled={loading}>
          {loading ? "検索中..." : "検索"}
        </button>
      </form>

      {error && (
        <div style={{ marginBottom: 16, padding: 12, color: "#c00", background: "#fff0f0", borderRadius: 8 }}>
          {error}
        </div>
      )}

      {images.length > 0 && (
        <div>
          <p style={{ marginBottom: 12, fontSize: 14, color: "#666" }}>{images.length}件の画像</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {images.map((img) => (
              <div
                key={img.id}
                style={{
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  overflow: "hidden",
                  width: 160,
                }}
              >
                <img
                  src={img.previewUrl}
                  alt={img.title}
                  style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }}
                />
                <div style={{ padding: 8, fontSize: 12 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{img.title}</div>
                  <div style={{ color: "#666" }}>by {img.author}</div>
                  <a
                    href={img.imageUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: "block", marginTop: 6, fontSize: 11 }}
                  >
                    原寸を開く
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
