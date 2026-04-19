type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * 同一キーについて windowMs 内に max 回まで。超えたら false。
 * サーバーレスではプロセス間で共有されない点に注意（最低限のブルートフォース緩和）。
 */
export function checkSimpleRateLimit(
  key: string,
  max: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count += 1;
  return true;
}

export function getClientIp(req: { headers: Headers }): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) {
    const first = xf.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() ?? "unknown";
}
