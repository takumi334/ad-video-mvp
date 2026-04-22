import type { Metadata } from "next";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/site";
import HomePageClient from "./HomePageClient";

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
  },
  twitter: {
    card: "summary_large_image",
    title: "Free Video Editor | Gegenpress",
    description: "Upload your video and create lyric videos online for free.",
  },
};

export default function Home() {
  return <HomePageClient />;
}
