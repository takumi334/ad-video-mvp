/**
 * fetch の Response を安全に JSON として解釈する。
 * - 本文は必ず text() で一度だけ読む（413 などで HTML/プレーンが返る場合に res.json() が落ちないようにする）
 * - HTTP エラー時は message に本文または JSON の message を入れる
 */
export async function readFetchJson<T = Record<string, unknown>>(
  res: Response
): Promise<
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string }
> {
  const status = res.status;
  const raw = await res.text();

  let data: T | undefined;
  if (raw.trim()) {
    try {
      data = JSON.parse(raw) as T;
    } catch {
      const hint =
        status === 413 ||
        /413|payload too large|body exceeded|request entity too large|FUNCTION_PAYLOAD_TOO_LARGE/i.test(
          raw
        )
          ? " ファイルサイズがサーバー上限を超えている可能性があります。"
          : "";
      return {
        ok: false,
        status,
        message: (raw.slice(0, 500) || `HTTP ${status}`) + hint,
      };
    }
  } else {
    data = {} as T;
  }

  if (!res.ok) {
    const fromJson = (data as { message?: string })?.message?.trim();
    const msg = fromJson || `HTTP ${status}`;
    const hint =
      status === 413 ? " ファイルサイズ超過の可能性があります。" : "";
    return { ok: false, status, message: msg + hint };
  }

  return { ok: true, status, data: data as T };
}
