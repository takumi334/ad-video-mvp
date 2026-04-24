"use client";

import { readFetchJson } from "@/lib/http/readFetchJson";
import { useUiLocale } from "@/lib/i18n/UiLocaleProvider";
import { getVideoOwnerSecret, ownerAuthHeaders } from "@/lib/videoOwnerToken";
import Link from "next/link";
import { useState } from "react";

type Video = {
  id: number;
  originalName: string;
  url: string;
  size: number;
  mime: string;
  createdAt: string | Date;
};

export function VideoListClient({ videos }: { videos: Video[] }) {
  const { t } = useUiLocale();
  const [items, setItems] = useState(videos);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function handleDelete(id: number) {
    setError(null);
    if (!getVideoOwnerSecret(id)) {
      setError(t("videosDeleteMissingKey"));
      return;
    }
    setDeletingId(id);
    try {
      const res = await fetch(`/api/videos/${id}`, {
        method: "DELETE",
        headers: { ...ownerAuthHeaders(id) },
      });
      const parsed = await readFetchJson<{
        ok?: boolean;
        message?: string;
        status?: number;
      }>(res);

      if (!parsed.ok) {
        setError(`(${parsed.status}) ${parsed.message}`);
        return;
      }

      const json = parsed.data;
      if (!json?.ok) {
        const status = json?.status ?? res.status;
        const message =
          json?.message ?? t("videosDeleteFailed");
        setError(`(${status}) ${message}`);
        return;
      }

      setItems((prev) => prev.filter((v) => v.id !== id));
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : t("videosDeleteUnexpected");
      setError(`(500) ${message}`);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <nav style={{ marginBottom: 16 }}>
        <Link href="/" style={{ marginRight: 12 }}>
          {t("navTop")}
        </Link>
        <Link href="/materials">{t("navMaterials")}</Link>
      </nav>
      <h1>{t("videosPageTitle")}</h1>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>{t("videosPageDescription")}</p>
      {error && (
        <div style={{ marginBottom: 12, color: "red" }}>{t("errorPrefix")} {error}</div>
      )}

      {items.length === 0 ? (
        <div>{t("videosEmpty")}</div>
      ) : (
        <table
          style={{
            borderCollapse: "collapse",
            width: "100%",
            maxWidth: 900,
          }}
        >
          <thead>
            <tr>
              <th style={{ borderBottom: "1px solid #ccc", padding: 8 }}>ID</th>
              <th style={{ borderBottom: "1px solid #ccc", padding: 8 }}>
                {t("videosTableFileName")}
              </th>
              <th style={{ borderBottom: "1px solid #ccc", padding: 8 }}>
                {t("videosTableCreatedAt")}
              </th>
              <th style={{ borderBottom: "1px solid #ccc", padding: 8 }}>
                {t("videosTableActions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((video) => (
              <tr key={video.id}>
                <td
                  style={{
                    borderBottom: "1px solid #eee",
                    padding: 8,
                    textAlign: "right",
                  }}
                >
                  {video.id}
                </td>
                <td style={{ borderBottom: "1px solid #eee", padding: 8 }}>
                  {video.originalName}
                </td>
                <td style={{ borderBottom: "1px solid #eee", padding: 8 }}>
                  {new Date(video.createdAt).toLocaleString()}
                </td>
                <td style={{ borderBottom: "1px solid #eee", padding: 8 }}>
                  <a
                    href={video.url}
                    target="_blank"
                    rel="noreferrer"
                    style={{ marginRight: 8 }}
                  >
                    {t("videosActionOpen")}
                  </a>
                  <a
                    href={`/videos/${video.id}/sync`}
                    style={{ marginRight: 8 }}
                  >
                    {t("videosActionSync")}
                  </a>
                  <button
                    type="button"
                    onClick={() => handleDelete(video.id)}
                    disabled={deletingId === video.id || !getVideoOwnerSecret(video.id)}
                    title={
                      getVideoOwnerSecret(video.id)
                        ? undefined
                        : t("videosDeleteDeviceOnly")
                    }
                  >
                    {deletingId === video.id ? t("videosDeleting") : t("videosActionDelete")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

