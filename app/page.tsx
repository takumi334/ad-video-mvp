import type { Metadata } from "next";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/site";
import HomePageClient from "./HomePageClient";

const siteName = "歌ってみた動画編集（無料）";

export const metadata: Metadata = {
  title: "歌詞動画・MV作成",
  description:
    "無料で使える歌ってみた向け動画編集ツール。歌詞動画の作成やタイミング同期、MV作成の下準備までブラウザで。動画をアップロードしてすぐ試せます。",
  alternates: {
    canonical: `${PRODUCTION_SITE_ORIGIN}/`,
    languages: {
      ja: "/",
      en: "/en",
    },
  },
  openGraph: {
    title: `${siteName}｜歌詞動画・MV作成`,
    description:
      "無料で使える歌ってみた向け動画編集。歌詞動画の作成・タイミング同期・MV下準備までブラウザで。",
    url: `${PRODUCTION_SITE_ORIGIN}/`,
    siteName,
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${siteName}｜歌詞動画・MV作成`,
    description:
      "無料で使える歌ってみた向け動画編集。歌詞動画の作成・タイミング同期までブラウザで。",
  },
};

export default function Home() {
  return <HomePageClient />;
}
