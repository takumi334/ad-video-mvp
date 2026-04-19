import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "./providers";
import { SoftwareApplicationJsonLd } from "./SoftwareApplicationJsonLd";
import { getSiteUrl } from "@/lib/site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteName = "歌ってみた動画編集（無料）";
const defaultDescription =
  "歌ってみた向けの無料動画編集ツール。歌詞動画の作成・タイミング同期・MV作成の下準備をブラウザで。動画をアップロードしてすぐ試せます。";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: `${siteName}｜歌詞動画・MV作成`,
    template: `%s｜${siteName}`,
  },
  description: defaultDescription,
  applicationName: siteName,
  keywords: [
    "無料 動画編集",
    "歌ってみた 動画編集",
    "歌詞動画 作成",
    "MV作成 無料",
    "歌ってみた",
    "歌詞同期",
  ],
  authors: [{ name: siteName }],
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    languages: {
      ja: "/",
      en: "/en",
    },
  },
  openGraph: {
    type: "website",
    locale: "ja_JP",
    siteName,
    title: `${siteName}｜歌詞動画・MV作成`,
    description: defaultDescription,
    url: "/",
  },
  twitter: {
    card: "summary",
    title: `${siteName}｜歌詞動画・MV作成`,
    description: defaultDescription,
  },
  other: {
    google: "notranslate",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" translate="no" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <SoftwareApplicationJsonLd />
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
