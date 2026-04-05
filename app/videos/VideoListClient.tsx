"use client";

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
  const [items, setItems] = useState(videos);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function handleDelete(id: number) {
    setError(null);
    setDeletingId(id);
    try {
      const res = await fetch(`/api/videos/${id}`, {
        method: "DELETE",
      });
      const json = await res.json();

      if (!res.ok || !json?.ok) {
        const status = json?.status ?? res.status;
        const message =
          json?.message ?? "削除に失敗しました。もう一度お試しください。";
        setError(`(${status}) ${message}`);
        return;
      }

      setItems((prev) => prev.filter((v) => v.id !== id));
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : "削除中にエラーが発生しました。もう一度お試しください。";
      setError(`(500) ${message}`);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      {error && (
        <div style={{ marginBottom: 12, color: "red" }}>エラー: {error}</div>
      )}

      {items.length === 0 ? (
        <div>データがありません。</div>
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
                ファイル名
              </th>
              <th style={{ borderBottom: "1px solid #ccc", padding: 8 }}>
                作成日時
              </th>
              <th style={{ borderBottom: "1px solid #ccc", padding: 8 }}>
                操作
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
                    開く
                  </a>
                  <a
                    href={`/videos/${video.id}/sync`}
                    style={{ marginRight: 8 }}
                  >
                    歌詞同期
                  </a>
                  <button
                    type="button"
                    onClick={() => handleDelete(video.id)}
                    disabled={deletingId === video.id}
                  >
                    {deletingId === video.id ? "削除中..." : "削除"}
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

