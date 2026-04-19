/** Vercel Blob の公開 URL のみ許可（自社 Blob） */
export function isAllowedVercelBlobVideoUrl(urlStr: string): boolean {
  const t = urlStr.trim();
  if (!t.startsWith("https://")) return false;
  try {
    const u = new URL(t);
    if (u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return (
      h === "public.blob.vercel-storage.com" ||
      h.endsWith(".public.blob.vercel-storage.com")
    );
  } catch {
    return false;
  }
}
