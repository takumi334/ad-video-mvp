const SITE_NAME_JA = "歌ってみた動画編集（無料）";

/** Google 向け SoftwareApplication 構造化データ */
export function buildSoftwareApplicationJsonLd(siteUrl: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME_JA,
    alternateName: "Free karaoke cover & lyrics video editor",
    description:
      "ブラウザ上で歌ってみた向けの動画編集、歌詞動画のタイミング同期、MV作成の下準備まで無料で試せるウェブアプリです。",
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Web",
    url: siteUrl,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "JPY",
    },
    inLanguage: ["ja", "en"],
  };
}
