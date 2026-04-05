import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { VideoListClient } from "./VideoListClient";

export const dynamic = "force-dynamic";

export default async function VideosPage() {
  const videos = await prisma.video.findMany({
    orderBy: { createdAt: "desc" },
  });

  return (
    <div style={{ padding: 24 }}>
      <nav style={{ marginBottom: 16 }}>
        <Link href="/" style={{ marginRight: 12 }}>トップ</Link>
        <Link href="/materials">素材検索</Link>
      </nav>
      <h1>Videos</h1>
      <p style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>
        動画をクリックして「歌詞同期」から編集・画像検索（Pixabay）ができます。
      </p>
      <VideoListClient videos={videos} />
    </div>
  );
}

