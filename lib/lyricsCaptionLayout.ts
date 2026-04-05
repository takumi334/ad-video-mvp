/**
 * プレビューと書き出しで共通の歌詞「論理行」分割 + 書き出し canvas 用の折り返し・フォント調整描画
 */

import { getCaptionLayoutForPreviewAndExport, type PreviewAspectRatio } from "@/lib/previewAspectLayout";
import {
  LYRICS_CAPTION_PAD,
  lyricsCaptionInitialFontPx,
  lyricsCaptionNarrowViewportMatchesPreview,
  lyricsCaptionUsableDimensions,
} from "@/lib/lyricsCaptionFrameMetrics";
import { clampLyricsFontSize, normalizeLyricsColorHex } from "@/lib/segmentVisualStyle";

export type LyricsCaptionLayoutMode = 1 | 2 | "vRight" | "vLeft";

/** @deprecated プレビューと同じ LYRICS_CAPTION_PAD を使う（後方互換のため残す） */
export const LYRICS_EXPORT_CANVAS_SIDE_MARGIN = LYRICS_CAPTION_PAD;

const MIN_EXPORT_FONT = 14;
const MAX_EXPORT_FONT = 160;

function hexToRgbaFill(hex: string, alpha: number): string {
  const n = normalizeLyricsColorHex(hex).replace("#", "");
  const v = parseInt(n, 16);
  if (!Number.isFinite(v)) return `rgba(255,255,255,${alpha})`;
  const r = (v >> 16) & 255;
  const g = (v >> 8) & 255;
  const b = v & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/**
 * 区間モーダル / 流れプレビューと同じ規則で歌詞を 1〜2 ブロックに分割（縦書きは全文 1 ブロック）
 */
export function getLyricsDisplayLines(
  text: string,
  layout: LyricsCaptionLayoutMode,
  lineBreakAt: number
): string[] {
  const t = (text ?? "").trim();
  if (!t) return [];
  if (layout === "vRight" || layout === "vLeft") return [t];
  if (layout === 1) return [t];
  if (lineBreakAt > 0 && lineBreakAt < t.length) {
    return [t.slice(0, lineBreakAt).trim(), t.slice(lineBreakAt).trim()].filter(Boolean);
  }
  const mid = Math.floor(t.length / 2);
  const spaceNear = t.slice(0, mid + 1).lastIndexOf(" ") + 1 || t.slice(0, mid + 1).lastIndexOf("\n") + 1;
  const splitAt = spaceNear > 0 ? spaceNear : mid;
  return [t.slice(0, splitAt).trim(), t.slice(splitAt).trim()].filter(Boolean);
}

/**
 * measureText 基準で maxWidth に収まるよう折り返し（空白があれば単語優先、なければ文字単位）
 */
export function wrapCanvasTextLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const t = text.trim();
  if (!t) return [];
  if (ctx.measureText(t).width <= maxWidth) return [t];

  const lines: string[] = [];
  const pushCharWrapped = (chunk: string) => {
    let cur = "";
    for (const ch of Array.from(chunk)) {
      const next = cur + ch;
      if (!cur || ctx.measureText(next).width <= maxWidth) {
        cur = next;
      } else {
        lines.push(cur);
        cur = ch;
      }
    }
    if (cur) lines.push(cur);
  };

  if (/[\s\u3000]/.test(t)) {
    const words = t.split(/(\s+)/);
    let cur = "";
    for (const w of words) {
      if (!w) continue;
      if (/^\s+$/.test(w)) {
        cur += w;
        continue;
      }
      const test = cur + w;
      if (ctx.measureText(test.trim()).width <= maxWidth) {
        cur = test;
      } else {
        const trimmed = cur.trim();
        if (trimmed) {
          if (ctx.measureText(trimmed).width <= maxWidth) lines.push(trimmed);
          else pushCharWrapped(trimmed);
        }
        cur = w;
      }
    }
    const tail = cur.trim();
    if (tail) {
      if (ctx.measureText(tail).width <= maxWidth) lines.push(tail);
      else pushCharWrapped(tail);
    }
    return lines.length > 0 ? lines : [t];
  }

  pushCharWrapped(t);
  return lines.length > 0 ? lines : [t];
}

export type DrawLyricsOnExportCanvasOptions = {
  canvasWidth: number;
  canvasHeight: number;
  layoutMode: LyricsCaptionLayoutMode;
  /** getLyricsDisplayLines の結果 */
  displayLines: string[];
  textOffsetX: number;
  textOffsetY: number;
  /** 区間設定の歌詞フォントサイズ（px）— プレビューと同系のスケールに使う */
  uiBaseFontPx: number;
  lyricsColorHex: string;
  /** 横書き時のベースライン位置（縦動画は中央よりやや下・セーフマージン内） */
  exportAspect?: PreviewAspectRatio;
};

/**
 * 書き出し canvas 上に歌詞を描画。左右 LYRICS_CAPTION_PAD（プレビューと同じ）、measureText で折り返し、
 * 収まらない場合はフォントを段階的に縮小。
 */
export function drawLyricsCaptionOnExportCanvas(
  ctx: CanvasRenderingContext2D,
  opts: DrawLyricsOnExportCanvasOptions
): void {
  const {
    canvasWidth: W,
    canvasHeight: H,
    layoutMode: mode,
    displayLines,
    textOffsetX,
    textOffsetY,
    uiBaseFontPx,
    lyricsColorHex,
    exportAspect,
  } = opts;
  const cap = getCaptionLayoutForPreviewAndExport(exportAspect ?? "landscape");
  const horizontalBottomFrac = cap.horizontalBaselineFractionFromTop;
  if (displayLines.length === 0) return;

  const margin = LYRICS_CAPTION_PAD;
  const { usableW, usableH } = lyricsCaptionUsableDimensions(W, H);
  const baseClamped = clampLyricsFontSize(uiBaseFontPx);
  let fontSize = lyricsCaptionInitialFontPx(
    baseClamped,
    W,
    H,
    lyricsCaptionNarrowViewportMatchesPreview()
  );
  fontSize = Math.min(MAX_EXPORT_FONT, Math.max(MIN_EXPORT_FONT, fontSize));

  const fill = hexToRgbaFill(lyricsColorHex, 0.98);
  const stroke = "rgba(0,0,0,0.75)";

  const tryLayout = (fs: number) => {
    ctx.font = `700 ${fs}px sans-serif`;
    if (mode === "vLeft" || mode === "vRight") {
      const block = displayLines[0] ?? "";
      const chars = Array.from(block);
      const step = fs * 1.15;
      const totalH = chars.length * step;
      const inset = cap.verticalInsetFraction;
      const x = mode === "vLeft" ? W * inset + textOffsetX : W * (1 - inset) + textOffsetX;
      const yCenterFrac = cap.verticalCenterFractionFromTop;
      const y0 = H * yCenterFrac + textOffsetY - totalH / 2;
      const top = y0;
      const bottom = y0 + totalH;
      const fitsV = top >= margin - 1 && bottom <= H - margin + 1;
      const maxCharW = chars.reduce((m, ch) => Math.max(m, ctx.measureText(ch).width), 0);
      const fitsH =
        x - maxCharW / 2 >= margin - 1 && x + maxCharW / 2 <= W - margin + 1;
      return { ok: fitsV && fitsH && chars.length > 0, fs, chars, step, x, y0, blockType: "vertical" as const };
    }

    const physical: string[] = [];
    for (const logical of displayLines) {
      physical.push(...wrapCanvasTextLine(ctx, logical, usableW));
    }
    const lineHeight = fs * 1.28;
    const strokeW = Math.max(4, Math.round(fs * 0.15));
    const totalBlockH = physical.length * lineHeight;
    const bottomY = H * horizontalBottomFrac + textOffsetY;
    const topY = bottomY - totalBlockH;
    const fitsV = topY >= margin - 1 && bottomY <= H - margin + 1;
    const maxLineW = physical.reduce((m, line) => Math.max(m, ctx.measureText(line).width), 0);
    const fitsW = maxLineW <= usableW + 0.5;
    return {
      ok: fitsV && fitsW && physical.length > 0,
      fs,
      physical,
      lineHeight,
      strokeW,
      bottomY,
      blockType: "horizontal" as const,
    };
  };

  let layout = tryLayout(fontSize);
  while (!layout.ok && fontSize > MIN_EXPORT_FONT) {
    fontSize = Math.max(MIN_EXPORT_FONT, Math.floor(fontSize * 0.92));
    layout = tryLayout(fontSize);
  }
  if (!layout.ok) {
    layout = tryLayout(MIN_EXPORT_FONT);
  }

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;

  if (layout.blockType === "vertical") {
    ctx.lineWidth = Math.max(4, Math.round(layout.fs * 0.14));
    const { chars, step, x, y0 } = layout;
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]!;
      const y = y0 + i * step + step / 2;
      ctx.strokeText(ch, x, y);
      ctx.fillText(ch, x, y);
    }
  } else {
    const { physical, lineHeight, strokeW, bottomY } = layout;
    ctx.lineWidth = strokeW;
    const cx = W * 0.5 + textOffsetX;
    for (let i = 0; i < physical.length; i++) {
      const line = physical[i]!;
      const y = bottomY - (physical.length - 1 - i) * lineHeight + lineHeight / 2;
      ctx.strokeText(line, cx, y);
      ctx.fillText(line, cx, y);
    }
  }
  ctx.restore();
}
