import Link from "next/link";
import { notFound } from "next/navigation";

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
