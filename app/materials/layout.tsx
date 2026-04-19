import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "素材検索（画像）",
  description:
    "歌ってみた・MV向けに Pixabay から画像を検索します。無料素材の候補を動画の区間に合わせて選びやすくします。",
  alternates: { canonical: "/materials" },
  openGraph: {
    title: "素材検索（画像）｜歌ってみた動画編集（無料）",
    description: "MV作成の参考になる画像素材を検索・閲覧できます。",
    url: "/materials",
  },
  twitter: {
    card: "summary",
    title: "素材検索（画像）｜歌ってみた動画編集（無料）",
    description: "Pixabay 連携で画像素材を検索します。",
  },
};

export default function MaterialsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
