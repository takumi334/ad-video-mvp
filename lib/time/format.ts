/**
 * 秒 ⇔ 分:秒 表示の共通フォーマット・パース。
 * - 表示: 1分未満は 0:05.000、1分以上は 1:40.000
 * - 入力: "1:40.000" または "100" / "100.000"（秒のみ）の両方を受け付ける
 */

/**
 * 秒数を「分:秒.ミリ」表記にする。
 * - 1分未満: 0:05.000
 * - 1分以上: 1:40.000
 */
export function formatSecToMinSec(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "0:00.000";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  const ms = (s - Math.floor(s)).toFixed(3).slice(1);
  const ss = Math.floor(s).toString().padStart(2, "0");
  return `${m}:${ss}${ms}`;
}

/**
 * 文字列を秒数にパースする。
 * - "1:40.000" → 100
 * - "1:40" → 100
 * - "100" / "100.000" → 100
 * 無効な場合は null。
 */
export function parseTimeToSec(input: string): number | null {
  const t = input.trim();
  if (t === "") return null;
  const colon = t.indexOf(":");
  if (colon >= 0) {
    const m = parseInt(t.slice(0, colon), 10);
    const rest = t.slice(colon + 1).replace(",", ".");
    const s = parseFloat(rest);
    if (!Number.isFinite(m) || m < 0 || !Number.isFinite(s) || s < 0) return null;
    return m * 60 + s;
  }
  const s = parseFloat(t.replace(",", "."));
  if (!Number.isFinite(s) || s < 0) return null;
  return s;
}
