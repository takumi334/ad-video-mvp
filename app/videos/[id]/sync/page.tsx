import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const videoId = Number(id);
  if (!Number.isInteger(videoId) || videoId <= 0) {
    return { title: "動画が見つかりません" };
  }
  return {
    title: "歌詞同期へ移動",
    description: `動画（ID: ${videoId}）の編集画面へ移動します。歌ってみたの歌詞動画作成は編集画面で行います。`,
    robots: { index: false, follow: true },
  };
}

export default async function VideoSyncPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const videoId = Number(id);

  if (!Number.isInteger(videoId) || videoId <= 0) notFound();

  // Existing app routes currently use /videos/[id] as the edit destination.
  const editHref = `/videos/${videoId}`;

  return (
    <div style={{ padding: 24 }}>
      <meta httpEquiv="refresh" content={`0;url=${editHref}`} />
      <p>編集画面へ移動しています...</p>
      <p>
        自動で遷移しない場合は <Link href={editHref}>こちら</Link> をクリックしてください。
      </p>
    </div>
  );
}
