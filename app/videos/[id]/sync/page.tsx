import type { Metadata } from "next";
import { getServerUiLocale } from "@/lib/i18n/serverUiLocale";
import { notFound } from "next/navigation";
import { VideoSyncRedirectClient } from "./VideoSyncRedirectClient";

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
  const titleByLocale: Record<string, string> = {
    ja: "歌詞同期へ移動",
    en: "Move to editor",
    es: "Ir al editor",
    pt: "Ir para o editor",
    id: "Pindah ke editor",
    th: "ไปยังตัวแก้ไข",
    ko: "편집 화면으로 이동",
  };
  const descByLocale: Record<string, string> = {
    ja: `動画（ID: ${videoId}）の編集画面へ移動します。`,
    en: `Redirecting to the editor for video ID ${videoId}.`,
    es: `Redirigiendo al editor para el video ID ${videoId}.`,
    pt: `Redirecionando para o editor do vídeo ID ${videoId}.`,
    id: `Mengalihkan ke editor untuk video ID ${videoId}.`,
    th: `กำลังย้ายไปยังหน้าตัวแก้ไขของวิดีโอ ID ${videoId}`,
    ko: `동영상 ID ${videoId} 편집 화면으로 이동합니다.`,
  };
  return {
    title: titleByLocale[locale] ?? titleByLocale.en,
    description: descByLocale[locale] ?? descByLocale.en,
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
    <VideoSyncRedirectClient editHref={editHref} />
  );
}
