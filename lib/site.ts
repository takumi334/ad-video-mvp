/**
 * 本番の正規ホスト（SEO・canonical・OG の既定）。
 * 環境変数未設定の本番ビルドでも sitemap / robots がこのオリジンを指すようにする。
 */
export const PRODUCTION_SITE_ORIGIN = "https://mv.gegenpress.app";

/**
 * 正規URL・OGP・sitemap 用のサイトオリジン。
 * 優先: `NEXT_PUBLIC_SITE_URL` → Vercel プレビュー (`VERCEL_URL`) → 本番は `PRODUCTION_SITE_ORIGIN` → 開発は localhost。
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  if (process.env.NODE_ENV === "production") return PRODUCTION_SITE_ORIGIN;
  return "http://localhost:3000";
}
