import type { Metadata } from "next";
import { getServerUiLocale } from "@/lib/i18n/serverUiLocale";
import type { UiLocale } from "@/lib/i18n/uiLocale";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/site";
import HomePageClient from "./HomePageClient";

const homeThumbnailUrl = `${PRODUCTION_SITE_ORIGIN}/vercel.svg`;

const SEO_BY_LOCALE: Record<UiLocale, { title: string; description: string; ogLocale: string }> = {
  en: {
    title: "Free Video Editor | Gegenpress",
    description: "Upload your video and create lyric videos online for free.",
    ogLocale: "en_US",
  },
  es: {
    title: "Editor de video gratis | Gegenpress",
    description: "Sube tu video y crea lyric videos online gratis.",
    ogLocale: "es_ES",
  },
  pt: {
    title: "Editor de video grátis | Gegenpress",
    description: "Envie seu vídeo e crie lyric videos online grátis.",
    ogLocale: "pt_BR",
  },
  id: {
    title: "Editor video gratis | Gegenpress",
    description: "Unggah video Anda dan buat video lirik online gratis.",
    ogLocale: "id_ID",
  },
  th: {
    title: "โปรแกรมตัดต่อวิดีโอฟรี | Gegenpress",
    description: "อัปโหลดวิดีโอและสร้างวิดีโอเนื้อเพลงออนไลน์ได้ฟรี",
    ogLocale: "th_TH",
  },
  ko: {
    title: "무료 동영상 편집기 | Gegenpress",
    description: "동영상을 업로드하고 무료로 가사 영상을 만드세요.",
    ogLocale: "ko_KR",
  },
  ja: {
    title: "Free Video Editor | Gegenpress",
    description: "Upload your video and create lyric videos online for free.",
    ogLocale: "ja_JP",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerUiLocale();
  const seo = SEO_BY_LOCALE[locale] ?? SEO_BY_LOCALE.en;
  return {
    title: seo.title,
    description: seo.description,
    alternates: {
      canonical: `${PRODUCTION_SITE_ORIGIN}/`,
      languages: {
        ja: "/",
        en: "/en",
      },
    },
    openGraph: {
      title: seo.title,
      description: seo.description,
      url: `${PRODUCTION_SITE_ORIGIN}/`,
      siteName: "Gegenpress",
      locale: seo.ogLocale,
      type: "website",
      images: [
        {
          url: homeThumbnailUrl,
          width: 1200,
          height: 630,
          alt: "Gegenpress free video editor",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: seo.title,
      description: seo.description,
      images: [homeThumbnailUrl],
    },
  };
}

export default function Home() {
  const videoObjectJsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: "Free Video Editor | Gegenpress",
    description: "Upload your video and create lyric videos online for free.",
    url: `${PRODUCTION_SITE_ORIGIN}/`,
    thumbnailUrl: [homeThumbnailUrl],
    publisher: {
      "@type": "Organization",
      name: "Gegenpress",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(videoObjectJsonLd) }}
      />
      <HomePageClient />
    </>
  );
}
