/**
 * 正規URL・OGP・sitemap 用のサイトオリジン。
 * 本番では Vercel の `VERCEL_URL` か、任意で `NEXT_PUBLIC_SITE_URL` を設定してください。
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return "http://localhost:3000";
}
