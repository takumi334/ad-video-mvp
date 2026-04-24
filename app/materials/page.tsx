"use client";

import type { SearchImageResult } from "@/app/api/search-images/route";
import { useUiLocale } from "@/lib/i18n/UiLocaleProvider";
import Link from "next/link";
import { useState } from "react";

export default function MaterialsPage() {
  const { t } = useUiLocale();
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
        setError(json?.message ?? t("materialsFetchFailed"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("materialsSearchFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 960 }}>
      <nav style={{ marginBottom: 16 }}>
        <Link href="/" style={{ marginRight: 12 }}>{t("navTop")}</Link>
        <Link href="/videos" style={{ marginRight: 12 }}>{t("navVideos")}</Link>
      </nav>
      <h1 style={{ marginBottom: 8 }}>{t("materialsTitle")}</h1>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 16 }}>
        {t("materialsDescription")}
      </p>

      <form onSubmit={handleSearch} style={{ marginBottom: 24 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("materialsSearchPlaceholder")}
          style={{ padding: "10px 14px", width: 280, marginRight: 8, fontSize: 15 }}
        />
        <button type="submit" disabled={loading}>
          {loading ? t("materialsSearching") : t("searchButton")}
        </button>
      </form>

      {error && (
        <div style={{ marginBottom: 16, padding: 12, color: "#c00", background: "#fff0f0", borderRadius: 8 }}>
          {error}
        </div>
      )}

      {images.length > 0 && (
        <div>
          <p style={{ marginBottom: 12, fontSize: 14, color: "#666" }}>
            {t("materialsResultCount").replace("{count}", String(images.length))}
          </p>
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
                    {t("materialsOpenOriginal")}
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
