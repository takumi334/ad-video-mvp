/**
 * 曲調の「約○秒で画面切替」に合わせて、フレーズを結合して表示チャンク数を自動提案する。
 * 自動生成後はユーザーが分割・結合で微調整できる。
 */

/**
 * フレーズ配列を、目標「画面数」（≈ duration / secondsPerScreen）に合わせて結合する。
 * - videoDuration が無効な場合は結合せずそのまま返す。
 * - targetChunks = max(1, round(duration / secondsPerScreen))
 * - フレーズを先頭から均等に targetChunks グループに分け、各グループを1文字列に結合する。
 */
export function autoGeneratePhraseChunks(
  phrases: string[],
  videoDurationSec: number | null,
  secondsPerScreen: number
): string[] {
  if (phrases.length === 0) return [];
  if (
    videoDurationSec == null ||
    !Number.isFinite(videoDurationSec) ||
    videoDurationSec <= 0 ||
    secondsPerScreen <= 0
  ) {
    return [...phrases];
  }
  const targetChunks = Math.max(1, Math.round(videoDurationSec / secondsPerScreen));
  if (targetChunks >= phrases.length) return [...phrases];

  const result: string[] = [];
  let from = 0;
  for (let i = 0; i < targetChunks; i++) {
    const count =
      i < targetChunks - 1
        ? Math.floor((phrases.length - from) / (targetChunks - i))
        : phrases.length - from;
    const slice = phrases.slice(from, from + count);
    result.push(slice.join("\n"));
    from += count;
  }
  return result.filter(Boolean);
}
