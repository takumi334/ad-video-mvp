/**
 * End-of-export “Created with …” card (separate from lyrics layer).
 * Toggle for future settings UI.
 */
export const EXPORT_BRAND_END_CARD_ENABLED = true;

/** Visible window at the end of the timeline (seconds). */
export const BRAND_END_CARD_DURATION_SEC = 1.75;

/** Fade-in and fade-out length (seconds each). */
export const BRAND_END_CARD_FADE_SEC = 0.4;

/** Peak opacity of the text (0–1), before fade envelope. */
export const BRAND_END_CARD_PEAK_OPACITY = 0.72;

/** Vertical position: fraction of canvas height (0.5 = center; slightly below). */
export const BRAND_END_CARD_Y_FRACTION = 0.57;

/**
 * @param u Seconds since the card window started (0 … BRAND_END_CARD_DURATION_SEC).
 * @returns Fade envelope 0…1.
 */
export function brandEndCardFade01(u: number): number {
  const T = BRAND_END_CARD_DURATION_SEC;
  const F = BRAND_END_CARD_FADE_SEC;
  if (u < 0 || u > T) return 0;
  const fin = Math.min(1, u / F);
  const uOutStart = T - F;
  const fout = u >= uOutStart ? Math.max(0, 1 - (u - uOutStart) / F) : 1;
  return fin * fout;
}

function drawTrackedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  letterExtraPx: number
) {
  let total = 0;
  const widths: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const w = ctx.measureText(ch).width;
    widths.push(w);
    total += w + letterExtraPx;
  }
  if (text.length > 0) total -= letterExtraPx;
  let x = centerX - total / 2;
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i]!, x, y);
    x += widths[i]! + letterExtraPx;
  }
}

/**
 * Draws brand line on top of the frame (call after lyrics / overlays).
 */
export function drawBrandEndCard(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  creditText: string,
  isLastSegment: boolean,
  secondsUntilSegmentEnd: number
): void {
  if (!EXPORT_BRAND_END_CARD_ENABLED || !isLastSegment) return;
  if (secondsUntilSegmentEnd > BRAND_END_CARD_DURATION_SEC || secondsUntilSegmentEnd < 0) return;

  const u = BRAND_END_CARD_DURATION_SEC - secondsUntilSegmentEnd;
  const envelope = brandEndCardFade01(u);
  if (envelope <= 0) return;

  const alpha = BRAND_END_CARD_PEAK_OPACITY * envelope;
  const cx = width / 2;
  const cy = height * BRAND_END_CARD_Y_FRACTION;

  ctx.save();
  ctx.font =
    '500 19px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.shadowColor = "rgba(0,0,0,0.42)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  drawTrackedText(ctx, creditText, cx, cy, 1.25);
  ctx.restore();
}
