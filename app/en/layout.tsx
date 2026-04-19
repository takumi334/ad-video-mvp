import type { Metadata } from "next";

const titleEn = "Free karaoke cover video editor";

export const metadata: Metadata = {
  title: {
    default: titleEn,
    template: `%s | ${titleEn}`,
  },
  description:
    "Free browser-based video editor for karaoke covers (utattemita): lyrics timing, lyric video prep, and MV-style image workflow. Upload a video and start editing.",
  openGraph: {
    locale: "en_US",
    siteName: titleEn,
    title: titleEn,
    description:
      "Free lyrics video timing and MV prep in your browser. Upload a video to try the editor.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: titleEn,
    description: "Free browser editor for karaoke covers and lyric videos.",
  },
};

export default function EnLayout({ children }: { children: React.ReactNode }) {
  return <div lang="en">{children}</div>;
}
