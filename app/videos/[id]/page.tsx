import type { Metadata } from "next";
import { getServerUiLocale } from "@/lib/i18n/serverUiLocale";
import { notFound } from "next/navigation";
import { VideoEditPageClient } from "./VideoEditPageClient";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const videoId = Number(id);
  if (!Number.isInteger(videoId) || videoId <= 0) {
    return { title: "Video not found" };
  }
  const locale = await getServerUiLocale();
  const titlePrefix: Record<string, string> = {
    ja: "動画",
    en: "Video",
    es: "Video",
    pt: "Vídeo",
    id: "Video",
    th: "วิดีโอ",
    ko: "동영상",
  };
  const descByLocale: Record<string, string> = {
    ja: `動画（ID: ${videoId}）の歌詞同期・編集画面です。`,
    en: `Lyrics sync and edit screen for video ID ${videoId}.`,
    es: `Pantalla de sincronización y edición para el video ID ${videoId}.`,
    pt: `Tela de sincronização e edição para o vídeo ID ${videoId}.`,
    id: `Layar sinkronisasi lirik dan edit untuk video ID ${videoId}.`,
    th: `หน้าซิงก์เนื้อเพลงและแก้ไขสำหรับวิดีโอ ID ${videoId}`,
    ko: `동영상 ID ${videoId}의 가사 싱크 및 편집 화면입니다.`,
  };
  const prefix = titlePrefix[locale] ?? titlePrefix.en;
  const description = descByLocale[locale] ?? descByLocale.en;
  return {
    title: `${prefix} #${videoId}`,
    description,
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
      title: `${prefix} #${videoId} | Gegenpress`,
      description,
      url: `/videos/${videoId}`,
    },
    twitter: {
      card: "summary",
      title: `${prefix} #${videoId} | Gegenpress`,
      description,
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
    <VideoEditPageClient videoId={videoId} />
  );
}
