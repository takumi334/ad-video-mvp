/**
 * プレビュー（PreviewLyricsCaptionAutoFit）と書き出し canvas の歌詞で同じ
 * 「表示枠サイズ → 初期フォント・余白」の計算を使う。
 */

export const LYRICS_CAPTION_REF_INNER_W = 360;
export const LYRICS_CAPTION_REF_INNER_H = 220;
/** プレビュー同期・モーダルと同じ左右パディング（px） */
export const LYRICS_CAPTION_PAD = 10;
export const LYRICS_CAPTION_MIN_FIT_PX = 12;

export function lyricsCaptionUsableDimensions(
  frameClientWidth: number,
  frameClientHeight: number
): { usableW: number; usableH: number } {
  const cw = frameClientWidth;
  const ch = frameClientHeight;
  const usableW = Math.max(48, cw - 2 * LYRICS_CAPTION_PAD);
  const usableH = Math.max(48, ch - 2 * LYRICS_CAPTION_PAD);
  return { usableW, usableH };
}

export function lyricsCaptionScaleFactors(
  frameClientWidth: number,
  frameClientHeight: number,
  narrowViewport: boolean
): { wScale: number; hScale: number; narrowFactor: number } {
  const { usableW, usableH } = lyricsCaptionUsableDimensions(frameClientWidth, frameClientHeight);
  const wScale = Math.min(1, usableW / LYRICS_CAPTION_REF_INNER_W);
  const hScale = Math.min(1, usableH / LYRICS_CAPTION_REF_INNER_H);
  const narrowFactor = narrowViewport ? 0.88 : 1;
  return { wScale, hScale, narrowFactor };
}

/**
 * プレビューと書き出しで同じ「初期フォント px」（プレビュー側はこの後 DOM 実測でさらに縮小しうる）
 */
export function lyricsCaptionInitialFontPx(
  baseFontSize: number,
  frameInnerWidth: number,
  frameInnerHeight: number,
  narrowViewport: boolean
): number {
  const b = Math.round(baseFontSize);
  if (!Number.isFinite(b) || b < 1) {
    return LYRICS_CAPTION_MIN_FIT_PX;
  }
  const { wScale, hScale, narrowFactor } = lyricsCaptionScaleFactors(
    frameInnerWidth,
    frameInnerHeight,
    narrowViewport
  );
  let size = Math.round(b * wScale * hScale * narrowFactor);
  size = Math.min(size, b);
  return Math.max(LYRICS_CAPTION_MIN_FIT_PX, size);
}

export function lyricsCaptionNarrowViewportMatchesPreview(): boolean {
  return (
    typeof window !== "undefined" && window.matchMedia("(max-width: 520px)").matches
  );
}
