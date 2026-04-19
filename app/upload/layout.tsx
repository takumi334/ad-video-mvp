import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Video upload",
  description:
    "Upload a performance video (MP4, WebM, MOV) and continue to lyric timing in the browser. Free to try.",
  alternates: { canonical: "/upload" },
  openGraph: {
    title: "Video upload — lyric video maker",
    description:
      "Upload MP4, WebM, or MOV and open the lyric sync editor next.",
    url: "/upload",
  },
  twitter: {
    card: "summary",
    title: "Video upload — lyric video maker",
    description:
      "Upload a video and continue to lyric timing in the browser.",
  },
};

export default function UploadLayout({ children }: { children: React.ReactNode }) {
  return children;
}
