import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "./providers";
import { SoftwareApplicationJsonLd } from "./SoftwareApplicationJsonLd";
import { getSiteUrl, PRODUCTION_SITE_ORIGIN } from "@/lib/site";
import { GlobalLocaleSelect } from "@/components/i18n/GlobalLocaleSelect";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteName = "Free Video Editor for Karaoke Covers & Lyric Videos";
const defaultDescription =
  "Create karaoke cover videos, lyric videos, MV-style music videos, and short clips online for free. No install required.";

const seoKeywords = [
  "free video editor",
  "karaoke cover editor",
  "lyric video maker",
  "music video editor",
  "mv maker",
  "online video editor",
  "free mv maker",
];

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: {
    default: siteName,
    template: "%s | Free Video Editor",
  },
  description: defaultDescription,
  applicationName: "MV Editor — gegenpress",
  keywords: seoKeywords,
  authors: [{ name: "gegenpress" }],
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
    locale: "en_US",
    siteName,
    title: siteName,
    description: defaultDescription,
    url: PRODUCTION_SITE_ORIGIN,
  },
  twitter: {
    card: "summary_large_image",
    title: siteName,
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
        <AppProviders>
          <GlobalLocaleSelect />
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
