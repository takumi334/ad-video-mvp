import Link from "next/link";
import { notFound } from "next/navigation";
import { LyricsSyncClient } from "./sync/LyricsSyncClient";
import { SyncPageNav } from "./sync/SyncPageNav";

export default async function VideoEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const videoId = Number(id);

  if (!Number.isInteger(videoId) || videoId <= 0) notFound();

  return (
    <div style={{ padding: 24 }}>
      <p>
        <Link href={`/videos/${videoId}/sync`}>歌詞同期ページへ戻る: /videos/{videoId}/sync</Link>
      </p>
      <SyncPageNav />
      <LyricsSyncClient videoId={videoId} />
    </div>
  );
}
