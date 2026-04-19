import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "無料MVメーカー",
  description:
    "歌ってみたやカバー動画向けに、ブラウザでMV風の下準備ができる無料ツール。歌詞同期と画像素材の検索で、MV作成のイメージを固められます。",
  alternates: {
    canonical: "/free-mv-maker",
    languages: {
      ja: "/free-mv-maker",
      en: "/en/free-mv-maker",
    },
  },
  openGraph: {
    title: "無料MVメーカー｜歌ってみた動画編集（無料）",
    description: "MV作成を無料で試す第一歩。歌詞タイミングとビジュアル案をブラウザで。",
    url: "/free-mv-maker",
    type: "article",
    locale: "ja_JP",
  },
  twitter: {
    card: "summary",
    title: "無料MVメーカー",
    description: "ブラウザでMV風の準備。歌詞同期と素材検索。",
  },
};

export default function FreeMvMakerPage() {
  return (
    <main style={{ padding: "32px 24px", maxWidth: 720, margin: "0 auto", lineHeight: 1.8 }}>
      <nav style={{ marginBottom: 20, fontSize: 14 }}>
        <Link href="/" style={{ color: "#2563eb" }}>
          トップ
        </Link>
        {" · "}
        <Link href="/en/free-mv-maker" style={{ color: "#2563eb" }}>
          English
        </Link>
      </nav>

      <h1 style={{ fontSize: 26, color: "#0f172a", marginBottom: 16 }}>無料MVメーカー（ブラウザ）</h1>
      <p style={{ color: "#475569", marginBottom: 20 }}>
        本格的な<strong>MV作成</strong>には専用ソフトも必要になることがありますが、ここでは<strong>無料</strong>で「歌詞と映像の素案」を素早く固められます。{" "}
        <strong>歌ってみた 動画編集</strong>の一環として、タイミングを取りながら画像素材を当てはめ、配信前のイメージ確認に使えます。
      </p>

      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 19, color: "#0f172a", marginBottom: 10 }}>おすすめの進め方</h2>
        <ol style={{ color: "#334155", paddingLeft: 22 }}>
          <li style={{ marginBottom: 8 }}>トップまたはアップロードから動画を登録</li>
          <li style={{ marginBottom: 8 }}>歌詞を取り込み、区間ごとに表示タイミングを調整</li>
          <li>素材検索で画像を探し、区間に合わせて配置</li>
        </ol>
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
          アップロードして始める
        </Link>
        <Link
          href="/lyrics-video-maker"
          style={{
            display: "inline-block",
            padding: "12px 20px",
            background: "#f1f5f9",
            color: "#0f172a",
            borderRadius: 8,
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          歌詞動画メーカー
        </Link>
      </div>
    </main>
  );
}
