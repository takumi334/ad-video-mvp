import { notFound } from "next/navigation";
import { LyricsSyncClient } from "./LyricsSyncClient";
import { SyncPageNav } from "./SyncPageNav";

export default async function VideoLyricsSyncPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const videoId = Number(id);

  if (!Number.isInteger(videoId) || videoId <= 0) notFound();

  return (
    <div style={{ padding: 24 }}>
      <SyncPageNav />
      <LyricsSyncClient videoId={videoId} />
    </div>
  );
}
