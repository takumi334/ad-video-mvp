import type { Metadata } from "next";
import Link from "next/link";

const title = "歌ってみた編集のご案内";

export const metadata: Metadata = {
  title,
  description:
    "歌ってみたの動画編集を無料で試すための案内ページです。歌詞動画の作成、タイミング同期、MV作成のイメージづくりまで、ブラウザ上で進められます。",
  alternates: {
    canonical: "/utattemita-edit",
  },
  openGraph: {
    title: "歌ってみた動画編集（無料）｜歌詞動画・MV作成の流れ",
    description:
      "歌ってみた向けの無料動画編集・歌詞動画作成の流れと、このサイトでできることをわかりやすくまとめました。",
    url: "/utattemita-edit",
    siteName: "歌ってみた動画編集（無料）",
    locale: "ja_JP",
    type: "article",
  },
  twitter: {
    card: "summary",
    title: "歌ってみた動画編集（無料）｜歌詞動画・MV作成の流れ",
    description:
      "歌ってみたの無料動画編集・歌詞動画作成の流れ。ブラウザでタイミング同期まで。",
  },
};

export default function UtattemitaEditPage() {
  return (
    <main style={{ padding: "32px 24px", maxWidth: 720, margin: "0 auto", lineHeight: 1.8 }}>
      <nav style={{ marginBottom: 24, fontSize: 14 }}>
        <Link href="/" style={{ color: "#2563eb" }}>
          トップへ
        </Link>
        {" · "}
        <Link href="/videos" style={{ color: "#2563eb" }}>
          動画一覧
        </Link>
      </nav>

      <h1 style={{ fontSize: 26, marginBottom: 16, color: "#0f172a", lineHeight: 1.35 }}>
        歌ってみた動画編集を無料で始める
      </h1>
      <p style={{ fontSize: 16, color: "#475569", marginBottom: 28 }}>
        「無料 動画編集」「歌ってみた 動画編集」「歌詞動画 作成」「MV作成
        無料」で検索されている方に向けて、このサイトでできることと進め方を整理しました。
      </p>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, marginBottom: 12, color: "#0f172a" }}>このサイトでできること</h2>
        <ul style={{ paddingLeft: 22, color: "#334155", margin: 0 }}>
          <li style={{ marginBottom: 8 }}>
            動画をアップロードし、<strong>歌詞の表示タイミングを区間ごとに合わせる</strong>（歌詞動画の作成に近い作業）
          </li>
          <li style={{ marginBottom: 8 }}>
            素材画像の検索・割り当てなど、<strong>MV作成</strong>のイメージを固める補助
          </li>
          <li>
            ブラウザ完結のため、<strong>無料で動画編集の下準備</strong>から試せます（利用規約・上限は各画面の案内に従ってください）
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 19, marginBottom: 12, color: "#0f172a" }}>おすすめの流れ</h2>
        <ol style={{ paddingLeft: 22, color: "#334155", margin: 0 }}>
          <li style={{ marginBottom: 10 }}>
            <Link href="/" style={{ color: "#2563eb", fontWeight: 600 }}>
              トップ
            </Link>
            から動画ファイルを選び、アップロードして編集画面へ
          </li>
          <li style={{ marginBottom: 10 }}>歌詞を取り込み、フレーズや行ごとにタイミングを記録</li>
          <li style={{ marginBottom: 10 }}>
            必要なら{" "}
            <Link href="/materials" style={{ color: "#2563eb" }}>
              素材検索
            </Link>
            で画像を探して区間に合わせる
          </li>
          <li>
            <Link href="/videos" style={{ color: "#2563eb" }}>
              動画一覧
            </Link>
            から、途中までの作業を再開することもできます
          </li>
        </ol>
      </section>

      <section
        style={{
          padding: 20,
          background: "#f8fafc",
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          color: "#334155",
        }}
      >
        <h2 style={{ fontSize: 17, marginTop: 0, marginBottom: 10, color: "#0f172a" }}>
          まずは無料で動画編集を試す
        </h2>
        <p style={{ margin: "0 0 16px 0", fontSize: 15 }}>
          歌ってみたの本番クオリティまで一気にとは限りませんが、<strong>歌詞動画</strong>や<strong>区間ごとの同期</strong>という、配信前の地味で大切な作業を短時間で進めやすくすることを目指しています。
        </p>
        <Link
          href="/"
          style={{
            display: "inline-block",
            padding: "12px 20px",
            background: "#0f172a",
            color: "#fff",
            borderRadius: 8,
            textDecoration: "none",
            fontWeight: 600,
            fontSize: 15,
          }}
        >
          トップで動画をアップロードする
        </Link>
      </section>
    </main>
  );
}
