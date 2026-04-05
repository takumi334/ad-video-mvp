/**
 * プレビュー（メイン・流れ・区間）と書き出しで共通のアスペクト比・配置ルール
 */

import type { CSSProperties } from "react";

export type PreviewAspectRatio = "landscape" | "portrait" | "square";

/** 書き出し互換エイリアス */
export type ExportAspectRatio = PreviewAspectRatio;

export const PREVIEW_ASPECT_OPTIONS: {
  value: PreviewAspectRatio;
  label: string;
  width: number;
  height: number;
}[] = [
  { value: "landscape", label: "横 16:9（1920×1080）", width: 1920, height: 1080 },
  { value: "portrait", label: "縦 9:16（1080×1920）", width: 1080, height: 1920 },
  { value: "square", label: "正方形 1:1（1080×1080）", width: 1080, height: 1080 },
];

export function parsePreviewAspectRatio(v: unknown): PreviewAspectRatio {
  if (v === "portrait" || v === "square" || v === "landscape") return v;
  return "landscape";
}

export function getAspectCanvasSize(ar: PreviewAspectRatio): { width: number; height: number } {
  const row = PREVIEW_ASPECT_OPTIONS.find((o) => o.value === ar) ?? PREVIEW_ASPECT_OPTIONS[0]!;
  return { width: row.width, height: row.height };
}

/** 書き出し側の既存関数名と互換 */
export const exportDimensionsForAspect = getAspectCanvasSize;

/** contain: ソースを target 内に収め中央配置した描画矩形（px） */
export function getVideoPlacementRect(
  srcW: number,
  srcH: number,
  targetW: number,
  targetH: number
): { x: number; y: number; w: number; h: number } {
  if (!srcW || !srcH || !targetW || !targetH) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.min(targetW / srcW, targetH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  const x = (targetW - w) / 2;
  const y = (targetH - h) / 2;
  return { x, y, w, h };
}

function readIntrinsicSize(source: CanvasImageSource): { w: number; h: number } {
  if (typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement) {
    return { w: source.videoWidth, h: source.videoHeight };
  }
  if (typeof HTMLImageElement !== "undefined" && source instanceof HTMLImageElement) {
    return { w: source.naturalWidth, h: source.naturalHeight };
  }
  if (typeof HTMLCanvasElement !== "undefined" && source instanceof HTMLCanvasElement) {
    return { w: source.width, h: source.height };
  }
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    return { w: source.width, h: source.height };
  }
  return { w: 0, h: 0 };
}

/** canvas 上にメディアを contain・中央で描画（書き出しと同一幾何） */
export function drawContainMediaOnCanvas(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  cw: number,
  ch: number
): void {
  const { w: sw, h: sh } = readIntrinsicSize(source);
  if (!sw || !sh) return;
  const r = getVideoPlacementRect(sw, sh, cw, ch);
  ctx.drawImage(source, 0, 0, sw, sh, r.x, r.y, r.w, r.h);
}

/**
 * 横書き字幕の baseline 相当: canvas 上端からの比率（lyricsCaptionLayout と一致）
 * CSS `bottom: X%` は (1 - fractionFromTop) * 100
 */
export function horizontalLyricsBottomFractionFromTop(ar: PreviewAspectRatio): number {
  switch (ar) {
    case "portrait":
      return 0.7;
    case "square":
      return 0.78;
    default:
      return 0.82;
  }
}

export function horizontalCaptionBottomCssPercent(ar: PreviewAspectRatio): number {
  const fromTop = horizontalLyricsBottomFractionFromTop(ar);
  return Math.round((1 - fromTop) * 100);
}

/** 縦書きの左右インセット %（canvas の vLeft/vRight と一致） */
export function verticalCaptionSideInsetPercent(ar: PreviewAspectRatio): number {
  return ar === "portrait" ? 14 : 20;
}

export function verticalCaptionTopPercent(ar: PreviewAspectRatio): number {
  return ar === "portrait" ? 48 : 50;
}

/** プレビュー CSS と書き出し canvas で共通の字幕ジオメトリ（1 か所の定義から導出） */
export type CaptionLayoutForPreviewAndExport = {
  /** 横書き baseline 相当（canvas 上端からの比率 0〜1） */
  horizontalBaselineFractionFromTop: number;
  horizontalBottomCssPercent: number;
  verticalSideInsetPercent: number;
  verticalTopPercent: number;
  verticalInsetFraction: number;
  verticalCenterFractionFromTop: number;
};

export function getCaptionLayoutForPreviewAndExport(ar: PreviewAspectRatio): CaptionLayoutForPreviewAndExport {
  const horizontalBaselineFractionFromTop = horizontalLyricsBottomFractionFromTop(ar);
  const verticalSideInsetPercent = verticalCaptionSideInsetPercent(ar);
  const verticalTopPercent = verticalCaptionTopPercent(ar);
  return {
    horizontalBaselineFractionFromTop,
    horizontalBottomCssPercent: horizontalCaptionBottomCssPercent(ar),
    verticalSideInsetPercent,
    verticalTopPercent,
    verticalInsetFraction: verticalSideInsetPercent / 100,
    verticalCenterFractionFromTop: verticalTopPercent / 100,
  };
}

export type PreviewAspectLayoutSnapshot = {
  aspectRatio: PreviewAspectRatio;
  exportCanvas: { width: number; height: number };
  caption: CaptionLayoutForPreviewAndExport;
  stage: (variant: PreviewStageVariant) => CSSProperties;
  timelineThumbFrame: (widthPx?: number) => CSSProperties;
};

/**
 * アスペクト比ごとの派生値をまとめたスナップショット。
 * React では `useMemo(() => getPreviewAspectLayout(ar), [ar])` で使うと再計算を 1 回に抑えられる。
 */
export function getPreviewAspectLayout(ar: PreviewAspectRatio): PreviewAspectLayoutSnapshot {
  const { width, height } = getAspectCanvasSize(ar);
  const caption = getCaptionLayoutForPreviewAndExport(ar);
  return {
    aspectRatio: ar,
    exportCanvas: { width, height },
    caption,
    stage: (variant: PreviewStageVariant) => previewStageOuterStyle(ar, variant),
    timelineThumbFrame: (widthPx = 40) => timelineThumbFrameStyle(ar, widthPx),
  };
}

/** 区間編集モーダル内 `<style>` 用: アスペクト依存の字幕位置ルールのみ */
export function segmentModalPreviewCaptionCssRules(ar: PreviewAspectRatio): string {
  return segmentModalPreviewCaptionCssRulesFromCaption(ar, getCaptionLayoutForPreviewAndExport(ar));
}

function segmentModalPreviewCaptionCssRulesFromCaption(
  ar: PreviewAspectRatio,
  c: CaptionLayoutForPreviewAndExport
): string {
  return `
[data-preview-aspect="${ar}"] .preview-pv-caption--h { bottom: ${c.horizontalBottomCssPercent}%; }
[data-preview-aspect="${ar}"] .preview-pv-caption--vr { right: ${c.verticalSideInsetPercent}%; left: auto; }
[data-preview-aspect="${ar}"] .preview-pv-caption--vl { left: ${c.verticalSideInsetPercent}%; right: auto; }
[data-preview-aspect="${ar}"] .preview-pv-caption--v { top: ${c.verticalTopPercent}%; transform: translateY(-50%); }
`.trim();
}

/** モーダルプレビュー用 CSS 全文（`getPreviewAspectLayout` の結果から生成すると字幕メトリクス計算が 1 回で済む） */
export function segmentModalPreviewFullCssFromLayout(layout: PreviewAspectLayoutSnapshot): string {
  return `${segmentModalPreviewCaptionCssRulesFromCaption(layout.aspectRatio, layout.caption)}
${SEGMENT_MODAL_PREVIEW_STATIC_CSS}`;
}

/** アスペクトのみ渡す場合（内部で `getPreviewAspectLayout` を 1 回実行） */
export function segmentModalPreviewFullCss(ar: PreviewAspectRatio): string {
  return segmentModalPreviewFullCssFromLayout(getPreviewAspectLayout(ar));
}

const SEGMENT_MODAL_PREVIEW_STATIC_CSS = `
.preview-pv-wrap { position: absolute; inset: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
.preview-pv-wrap.anim-fade { animation: preview-fade 0.5s ease-out forwards; }
.preview-pv-wrap.anim-slideR2L { animation: preview-slideR2L 0.5s ease-out forwards; }
.preview-pv-wrap.anim-slideL2R { animation: preview-slideL2R 0.5s ease-out forwards; }
.preview-pv-wrap.anim-zoomIn { animation: preview-zoomIn 0.5s ease-out forwards; }
@keyframes preview-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes preview-slideR2L { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes preview-slideL2R { from { transform: translateX(-100%); } to { transform: translateX(0); } }
@keyframes preview-zoomIn { from { transform: scale(0.85); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.preview-pv-img { position: relative; z-index: 1; max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; margin: 0 auto; display: block; }
.preview-pv-caption { position: absolute; color: white; text-shadow: 0 0 10px black, 0 1px 3px rgba(0,0,0,0.8); pointer-events: auto; z-index: 5; }
.preview-pv-caption--h { bottom: 18%; left: 0; right: 0; text-align: center; font-size: clamp(18px, 4vw, 28px); line-height: 1.4; padding: 0 12px; }
.preview-pv-caption--v { max-height: 88%; overflow: hidden; font-size: clamp(14px, 3vw, 22px); line-height: 1.65; text-orientation: mixed; padding: 8px 4px; }
.preview-pv-caption--vr { writing-mode: vertical-rl; text-align: start; }
.preview-pv-caption--vl { writing-mode: vertical-lr; text-align: start; }
.preview-img-clickable:hover .preview-change-overlay,
.preview-img-clickable:focus-visible .preview-change-overlay { opacity: 1; }
.modal-suggest-image-scroll {
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: #b0b0b0 #f0f0f0;
}
.modal-suggest-image-scroll::-webkit-scrollbar { width: 8px; }
.modal-suggest-image-scroll::-webkit-scrollbar-track { background: #f0f0f0; border-radius: 4px; }
.modal-suggest-image-scroll::-webkit-scrollbar-thumb { background: #c0c0c0; border-radius: 4px; }
.modal-suggest-image-scroll::-webkit-scrollbar-thumb:hover { background: #a8a8a8; }
`.trim();

export type PreviewStageVariant = "flow" | "modal" | "sync" | "main";

export function previewStageOuterStyle(
  ar: PreviewAspectRatio,
  variant: PreviewStageVariant = "flow"
): CSSProperties {
  const aspect = ar === "landscape" ? "16 / 9" : ar === "portrait" ? "9 / 16" : "1 / 1";
  const bg =
    variant === "modal" ? "#111" : variant === "sync" || variant === "main" ? "#000" : "#020617";
  const maxW = ar === "landscape" ? 900 : ar === "portrait" ? 400 : 520;
  const radius = variant === "sync" || variant === "main" ? 8 : 6;
  return {
    position: "relative",
    width: "100%",
    maxWidth: maxW,
    marginLeft: "auto",
    marginRight: "auto",
    aspectRatio: aspect,
    maxHeight: "min(80vh, 920px)",
    background: bg,
    borderRadius: radius,
    overflow: "hidden",
    boxSizing: "border-box",
  };
}

/** タイムライン行サムネ用の小さな枠（contain・比率共通） */
export function timelineThumbFrameStyle(ar: PreviewAspectRatio, widthPx = 40): CSSProperties {
  return {
    width: widthPx,
    maxHeight: 56,
    aspectRatio: ar === "landscape" ? "16 / 9" : ar === "portrait" ? "9 / 16" : "1 / 1",
    background: "#1a1a1a",
    borderRadius: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flexShrink: 0,
    boxSizing: "border-box",
  };
}

/**
 * アスペクト枠いっぱいに重ね、レターボックス付き contain。
 * メイン / 同期プレビューの video、オーバーレイの video|img で共通（export の drawContain と同じ見え方）。
 */
export const PREVIEW_MEDIA_LAYER_CONTAIN_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "contain",
  display: "block",
};

/**
 * 小さな枠や flex 中央の子向け contain（タイムラインサムネ内、合成オーバーレイ画像など）。
 */
export const PREVIEW_MEDIA_BOX_CONTAIN_STYLE: CSSProperties = {
  maxWidth: "100%",
  maxHeight: "100%",
  width: "auto",
  height: "auto",
  objectFit: "contain",
  display: "block",
};

/** 同期プレビュー上の横書き歌詞（色・フォントは呼び出し側で上書き） */
export function syncPreviewHorizontalCaptionStyle(
  caption: CaptionLayoutForPreviewAndExport
): CSSProperties {
  return {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: `${caption.horizontalBottomCssPercent}%`,
    textAlign: "center",
    lineHeight: 1.4,
    padding: "0 10px",
    pointerEvents: "none",
    zIndex: 4,
  };
}
