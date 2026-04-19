import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { VideoListClient } from "./VideoListClient";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "動画一覧",
  description:
    "アップロードした動画の一覧です。各動画から歌詞同期・編集、歌詞動画づくりやMV下準備に進めます。",
  alternates: { canonical: "/videos" },
  openGraph: {
    title: "動画一覧｜歌ってみた動画編集（無料）",
    description: "保存した動画を選び、歌詞タイミング編集へ進みます。",
    url: "/videos",
  },
  twitter: {
    card: "summary",
    title: "動画一覧｜歌ってみた動画編集（無料）",
    description: "動画一覧から歌詞同期・編集を再開できます。",
  },
};

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

