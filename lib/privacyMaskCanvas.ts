/**
 * 区間プレビュー／書き出し共通: モザイク（ピクセル化）と黒塗り＋ブランド文言
 */

import { drawContainMediaOnCanvas } from "@/lib/previewAspectLayout";

export type PrivacyMosaicRegionInput = {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  /** ピクセルブロックの一辺（px 相当、5〜40） */
  pixelSize: number;
  /** 0–1 上乗せの暗幕（任意） */
  opacity: number;
};

export type PrivacyBrandMaskRegionInput = {
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  /** 0–1 で黒の不透明度（ベース 0.85 に乗算） */
  opacity: number;
};

const BRAND_LABEL = "gegenpress app";

/** ImageData の矩形をブロック平均でピクセル化（先頭画素を代表色とする版） */
export function pixelateImageDataTopLeft(
  data: ImageData,
  cw: number,
  ch: number,
  size: number
): void {
  const d = data.data;
  const s = Math.max(2, Math.min(64, Math.round(size)));
  for (let y = 0; y < ch; y += s) {
    for (let x = 0; x < cw; x += s) {
      const i = (y * cw + x) * 4;
      const r = d[i]!;
      const g = d[i + 1]!;
      const b = d[i + 2]!;
      const a = d[i + 3]!;
      const bx = Math.min(x + s, cw);
      const by = Math.min(y + s, ch);
      for (let yy = y; yy < by; yy++) {
        for (let xx = x; xx < bx; xx++) {
          const j = (yy * cw + xx) * 4;
          d[j] = r;
          d[j + 1] = g;
          d[j + 2] = b;
          d[j + 3] = a;
        }
      }
    }
  }
}

/** 背景が既に描かれた canvas 上でモザイク矩形を適用 */
export function drawPrivacyMosaicRegionsOnCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  regions: PrivacyMosaicRegionInput[]
): void {
  for (const r of regions) {
    const rx = Math.round((r.xPct / 100) * width);
    const ry = Math.round((r.yPct / 100) * height);
    const rw = Math.max(1, Math.round((r.wPct / 100) * width));
    const rh = Math.max(1, Math.round((r.hPct / 100) * height));
    if (rx >= width || ry >= height || rx + rw <= 0 || ry + rh <= 0) continue;
    const x0 = Math.max(0, rx);
    const y0 = Math.max(0, ry);
    const x1 = Math.min(width, rx + rw);
    const y1 = Math.min(height, ry + rh);
    const cw = Math.max(1, x1 - x0);
    const ch = Math.max(1, y1 - y0);
    const size = Math.max(5, Math.min(40, Math.round(r.pixelSize)));
    let imgData: ImageData;
    try {
      imgData = ctx.getImageData(x0, y0, cw, ch);
    } catch {
      continue;
    }
    pixelateImageDataTopLeft(imgData, cw, ch, size);
    ctx.putImageData(imgData, x0, y0);
    const veil = Math.max(0, Math.min(1, r.opacity));
    if (veil > 0.001) {
      ctx.fillStyle = `rgba(0,0,0,${veil * 0.45})`;
      ctx.fillRect(x0, y0, cw, ch);
    }
  }
}

export function drawPrivacyBrandMaskRegionsOnCanvas(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  regions: PrivacyBrandMaskRegionInput[]
): void {
  for (const r of regions) {
    const rx = Math.round((r.xPct / 100) * width);
    const ry = Math.round((r.yPct / 100) * height);
    const rw = Math.max(1, Math.round((r.wPct / 100) * width));
    const rh = Math.max(1, Math.round((r.hPct / 100) * height));
    if (rx >= width || ry >= height || rx + rw <= 0 || ry + rh <= 0) continue;
    const x0 = Math.max(0, rx);
    const y0 = Math.max(0, ry);
    const x1 = Math.min(width, rx + rw);
    const y1 = Math.min(height, ry + rh);
    const cw = Math.max(1, x1 - x0);
    const ch = Math.max(1, y1 - y0);
    const alpha = 0.85 * Math.max(0, Math.min(1, r.opacity));
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fillRect(x0, y0, cw, ch);
    const fontPx = Math.max(16, Math.min(48, Math.round(Math.min(cw, ch) * 0.14)));
    ctx.save();
    ctx.font = `bold ${fontPx}px sans-serif`;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(BRAND_LABEL, x0 + cw / 2, y0 + ch / 2);
    ctx.restore();
  }
}

/**
 * プレビュー用: ステージ内のメディアを描画し、指定矩形だけ切り出してピクセル化して dst に描く
 */
export function renderMosaicRegionToCanvas(options: {
  dstCtx: CanvasRenderingContext2D;
  dstW: number;
  dstH: number;
  media: CanvasImageSource;
  stageW: number;
  stageH: number;
  region: PrivacyMosaicRegionInput;
}): boolean {
  const { dstCtx, dstW, dstH, media, stageW, stageH, region } = options;
  if (stageW < 2 || stageH < 2 || dstW < 2 || dstH < 2) return false;
  const full = document.createElement("canvas");
  full.width = Math.round(stageW);
  full.height = Math.round(stageH);
  const fctx = full.getContext("2d");
  if (!fctx) return false;
  drawContainMediaOnCanvas(fctx, media, full.width, full.height);
  const rx = Math.round((region.xPct / 100) * full.width);
  const ry = Math.round((region.yPct / 100) * full.height);
  const rw = Math.max(2, Math.round((region.wPct / 100) * full.width));
  const rh = Math.max(2, Math.round((region.hPct / 100) * full.height));
  const x0 = Math.max(0, Math.min(rx, full.width - 1));
  const y0 = Math.max(0, Math.min(ry, full.height - 1));
  const cw = Math.max(1, Math.min(rw, full.width - x0));
  const ch = Math.max(1, Math.min(rh, full.height - y0));
  const size = Math.max(5, Math.min(40, Math.round(region.pixelSize)));
  let imgData: ImageData;
  try {
    imgData = fctx.getImageData(x0, y0, cw, ch);
  } catch {
    return false;
  }
  pixelateImageDataTopLeft(imgData, cw, ch, size);
  const patch = document.createElement("canvas");
  patch.width = cw;
  patch.height = ch;
  const pctx = patch.getContext("2d");
  if (!pctx) return false;
  pctx.putImageData(imgData, 0, 0);
  const veil = Math.max(0, Math.min(1, region.opacity));
  if (veil > 0.001) {
    pctx.fillStyle = `rgba(0,0,0,${veil * 0.45})`;
    pctx.fillRect(0, 0, cw, ch);
  }
  dstCtx.clearRect(0, 0, dstW, dstH);
  dstCtx.imageSmoothingEnabled = false;
  dstCtx.drawImage(patch, 0, 0, cw, ch, 0, 0, dstW, dstH);
  return true;
}
