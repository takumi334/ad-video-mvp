import type { Metadata } from "next";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/site";

const titleEn = "Free Video Editor for Karaoke Covers & Lyric Videos";
const descriptionEn =
  "Create karaoke cover videos, lyric videos, MV-style music videos, and short clips online for free. No install required.";

const keywordsEn = [
  "free video editor",
  "karaoke cover editor",
  "lyric video maker",
  "music video editor",
  "mv maker",
  "online video editor",
  "free mv maker",
];

export const metadata: Metadata = {
  title: {
    default: titleEn,
    template: "%s | Free Video Editor",
  },
  description: descriptionEn,
  keywords: keywordsEn,
  openGraph: {
    locale: "en_US",
    siteName: titleEn,
    title: titleEn,
    description: descriptionEn,
    type: "website",
    url: `${PRODUCTION_SITE_ORIGIN}/en`,
  },
  twitter: {
    card: "summary_large_image",
    title: titleEn,
    description: descriptionEn,
  },
};

export default function EnLayout({ children }: { children: React.ReactNode }) {
  return <div lang="en">{children}</div>;
}
