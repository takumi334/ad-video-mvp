import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LyricsSyncClient } from "./sync/LyricsSyncClient";
import { SyncPageNav } from "./sync/SyncPageNav";

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
  const short = `動画 #${videoId}`;
  return {
    title: short,
    description: `動画（ID: ${videoId}）の歌詞同期・編集画面です。歌ってみた向けにタイミング調整や歌詞動画の作成を行えます。`,
    robots: {
      index: false,
      follow: true,
      googleBot: {
        index: false,
        follow: true,
      },
    },
    alternates: { canonical: `/videos/${videoId}` },
    openGraph: {
      title: `${short}の編集｜歌ってみた動画編集（無料）`,
      description: "歌詞のタイミング同期・区間編集ができます。",
      url: `/videos/${videoId}`,
    },
    twitter: {
      card: "summary",
      title: `${short}の編集｜歌ってみた動画編集（無料）`,
      description: "歌詞同期・動画編集をブラウザで続けられます。",
    },
  };
}

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
