import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "歌詞動画メーカー（無料）",
  description:
    "ブラウザで歌詞動画を作るための無料ツール。歌ってみた動画に歌詞の表示タイミングを合わせ、プレビューしながら編集できます。",
  alternates: {
    canonical: "/lyrics-video-maker",
    languages: {
      ja: "/lyrics-video-maker",
      en: "/en/lyrics-video-maker",
    },
  },
  openGraph: {
    title: "歌詞動画メーカー（無料）｜歌ってみた動画編集（無料）",
    description: "歌詞動画の作成・タイミング同期をブラウザで。動画をアップロードして始められます。",
    url: "/lyrics-video-maker",
    type: "article",
    locale: "ja_JP",
  },
  twitter: {
    card: "summary",
    title: "歌詞動画メーカー（無料）",
    description: "無料で歌詞動画のタイミング編集。ブラウザで歌ってみた向けに。",
  },
};

export default function LyricsVideoMakerPage() {
  return (
    <main style={{ padding: "32px 24px", maxWidth: 720, margin: "0 auto", lineHeight: 1.8 }}>
      <nav style={{ marginBottom: 20, fontSize: 14 }}>
        <Link href="/" style={{ color: "#2563eb" }}>
          トップ
        </Link>
        {" · "}
        <Link href="/en/lyrics-video-maker" style={{ color: "#2563eb" }}>
          English
        </Link>
      </nav>

      <h1 style={{ fontSize: 26, color: "#0f172a", marginBottom: 16 }}>歌詞動画メーカー（無料）</h1>
      <p style={{ color: "#475569", marginBottom: 20 }}>
        <strong>歌詞動画</strong>とは、楽曲に合わせて歌詞テキストを画面に表示する動画のことです。歌ってみたでは視聴者が歌いやすいよう、
        <strong>歌詞動画の作成</strong>や<strong>タイミングの調整</strong>が重要になります。このサイトでは動画をアップロードし、区間ごとに歌詞を割り当てながら
        <strong>無料</strong>で試せます。
      </p>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 19, color: "#0f172a", marginBottom: 10 }}>できること</h2>
        <ul style={{ color: "#334155", paddingLeft: 22 }}>
          <li style={{ marginBottom: 8 }}>動画に合わせて歌詞の開始・終了タイミングを記録</li>
          <li style={{ marginBottom: 8 }}>プレビューで表示位置や流れを確認</li>
          <li>必要に応じて素材画像の検索（別画面）と組み合わせ可能</li>
        </ul>
      </section>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <Link
          href="/upload"
          style={{
            display: "inline-block",
            padding: "12px 20px",
            background: "#0f172a",
            color: "#fff",
            borderRadius: 8,
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          動画をアップロードして始める
        </Link>
        <Link
          href="/utattemita-edit"
          style={{
            display: "inline-block",
            padding: "12px 20px",
            background: "#eff6ff",
            color: "#1d4ed8",
            borderRadius: 8,
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          歌ってみた編集の流れ
        </Link>
      </div>
    </main>
  );
}
