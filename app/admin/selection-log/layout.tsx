import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "選択ログ（管理）",
  description: "管理者向けの画像選択ログ閲覧ページです。",
  robots: { index: false, follow: false },
};

export default function SelectionLogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
