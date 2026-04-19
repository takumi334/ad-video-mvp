import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "動画アップロード",
  description:
    "歌ってみた用の動画ファイルをアップロードし、歌詞同期・編集画面へ進みます。無料でブラウザから利用できます。",
  alternates: { canonical: "/upload" },
  openGraph: {
    title: "動画アップロード｜歌ってみた動画編集（無料）",
    description: "MP4 等の動画をアップロードして、歌詞タイミング編集へ。",
    url: "/upload",
  },
  twitter: {
    card: "summary",
    title: "動画アップロード｜歌ってみた動画編集（無料）",
    description: "動画をアップロードして歌詞同期・編集へ進みます。",
  },
};

export default function UploadLayout({ children }: { children: React.ReactNode }) {
  return children;
}
