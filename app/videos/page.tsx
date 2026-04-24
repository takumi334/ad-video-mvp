import type { Metadata } from "next";
import { getServerUiLocale } from "@/lib/i18n/serverUiLocale";
import { prisma } from "@/lib/prisma";
import { VideoListClient } from "./VideoListClient";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerUiLocale();
  const titleByLocale: Record<string, string> = {
    ja: "動画一覧",
    en: "Videos",
    es: "Videos",
    pt: "Vídeos",
    id: "Video",
    th: "วิดีโอ",
    ko: "동영상",
  };
  const descByLocale: Record<string, string> = {
    ja: "アップロードした動画の一覧です。歌詞同期編集へ進めます。",
    en: "List of uploaded videos and links to the lyrics sync editor.",
    es: "Lista de videos subidos con acceso al editor de sincronización.",
    pt: "Lista de vídeos enviados com acesso ao editor de sincronização.",
    id: "Daftar video yang diunggah dengan tautan ke editor sinkronisasi lirik.",
    th: "รายการวิดีโอที่อัปโหลดพร้อมลิงก์ไปยังหน้าซิงก์เนื้อเพลง",
    ko: "업로드한 동영상 목록과 가사 싱크 편집 링크입니다.",
  };
  const title = titleByLocale[locale] ?? titleByLocale.en;
  const description = descByLocale[locale] ?? descByLocale.en;
  return {
    title,
    description,
    alternates: { canonical: "/videos" },
    openGraph: {
      title: `${title} | Gegenpress`,
      description,
      url: "/videos",
    },
    twitter: {
      card: "summary",
      title: `${title} | Gegenpress`,
      description,
    },
  };
}

export default async function VideosPage() {
  const videos = await prisma.video.findMany({
    orderBy: { createdAt: "desc" },
  });

  return <VideoListClient videos={videos} />;
}

