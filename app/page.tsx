import type { Metadata } from "next";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/site";
import HomePageClient from "./HomePageClient";

const homeThumbnailUrl = `${PRODUCTION_SITE_ORIGIN}/vercel.svg`;

export const metadata: Metadata = {
  title: "Free Video Editor | Gegenpress",
  description: "Upload your video and create lyric videos online for free.",
  alternates: {
    canonical: `${PRODUCTION_SITE_ORIGIN}/`,
    languages: {
      ja: "/",
      en: "/en",
    },
  },
  openGraph: {
    title: "Free Video Editor | Gegenpress",
    description: "Upload your video and create lyric videos online for free.",
    url: `${PRODUCTION_SITE_ORIGIN}/`,
    siteName: "Gegenpress",
    locale: "ja_JP",
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
    title: "Free Video Editor | Gegenpress",
    description: "Upload your video and create lyric videos online for free.",
    images: [homeThumbnailUrl],
  },
};

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
