"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NextImage from "next/image";
import type { SegmentMaterialEditSettings } from "@/lib/segmentMaterialHistory";
import { getLyricsDisplayLines, type LyricsCaptionLayoutMode } from "@/lib/lyricsCaptionLayout";
import {
  getCaptionLayoutForPreviewAndExport,
  type PreviewAspectRatio,
} from "@/lib/previewAspectLayout";
import { PreviewLyricsCaptionAutoFit } from "@/lib/previewLyricsCaptionAutoFit";

export type ImageCropAspectPreset = "1:1" | "9:16" | "16:9" | "free";
export type ImageCropFitMode = "cover" | "contain";
export type ImageCropFrameBackground = "white" | "black" | "checker";

type CropRect = { x: number; y: number; w: number; h: number };
type CropHandle = "nw" | "ne" | "sw" | "se";

type ImageCropEditorProps = {
  imageUrl: string;
  maxFrameWidth?: number;
  onApplyBackground: (file: File, settings: SegmentMaterialEditSettings) => void;
  onApplyOverlay: (file: File, settings: SegmentMaterialEditSettings) => void;
  previewLyricsText?: string;
  previewLyricsFontSize?: number;
  previewLyricsColor?: string;
  previewLyricsTextShadow?: string;
  previewLyricsLayoutMode?: LyricsCaptionLayoutMode;
  previewLyricsLineBreakAt?: number;
  previewLyricsOffsetX?: number;
  previewLyricsOffsetY?: number;
};
type FinalPreviewAspect = "1:1" | "9:16" | "16:9";
type FinalPreviewMode = "background" | "overlay";

type FaceDetectorLike = {
  detect: (input: CanvasImageSource) => Promise<Array<{ boundingBox?: { x: number; y: number; width: number; height: number } }>>;
};

declare global {
  interface Window {
    FaceDetector?: new (opts?: Record<string, unknown>) => FaceDetectorLike;
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function aspectDimensions(preset: ImageCropAspectPreset, freeRatio: number): { aw: number; ah: number } {
  switch (preset) {
    case "1:1":
      return { aw: 1, ah: 1 };
    case "9:16":
      return { aw: 9, ah: 16 };
    case "16:9":
      return { aw: 16, ah: 9 };
    case "free": {
      const r = clamp(freeRatio, 0.45, 2.2);
      return r >= 1 ? { aw: r, ah: 1 } : { aw: 1, ah: 1 / r };
    }
    default:
      return { aw: 1, ah: 1 };
  }
}

function rotatedImageAabb(imgW: number, imgH: number, rotationRad: number): { rw: number; rh: number } {
  const c = Math.abs(Math.cos(rotationRad));
  const s = Math.abs(Math.sin(rotationRad));
  const rw = imgW * c + imgH * s;
  const rh = imgW * s + imgH * c;
  return { rw: Math.max(rw, 1e-6), rh: Math.max(rh, 1e-6) };
}

function baseScaleForFit(
  fitMode: ImageCropFitMode,
  imgW: number,
  imgH: number,
  rotationRad: number,
  frameW: number,
  frameH: number
): number {
  const { rw, rh } = rotatedImageAabb(imgW, imgH, rotationRad);
  return fitMode === "cover" ? Math.max(frameW / rw, frameH / rh) : Math.min(frameW / rw, frameH / rh);
}

function fillFrameBackground(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  dpr: number,
  frameBg: ImageCropFrameBackground,
  exportTransparentChecker: boolean
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (frameBg === "checker" && exportTransparentChecker) {
    ctx.clearRect(0, 0, W, H);
    return;
  }
  if (frameBg === "white") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    return;
  }
  if (frameBg === "black") {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    return;
  }

  const cell = Math.max(4, Math.round(7 * dpr));
  const p = document.createElement("canvas");
  p.width = cell * 2;
  p.height = cell * 2;
  const pctx = p.getContext("2d");
  if (!pctx) {
    ctx.fillStyle = "#dbe1e8";
    ctx.fillRect(0, 0, W, H);
    return;
  }
  pctx.fillStyle = "#f8fafc";
  pctx.fillRect(0, 0, p.width, p.height);
  pctx.fillStyle = "#cbd5e1";
  pctx.fillRect(0, 0, cell, cell);
  pctx.fillRect(cell, cell, cell, cell);
  const pattern = ctx.createPattern(p, "repeat");
  if (!pattern) {
    ctx.fillStyle = "#dbe1e8";
    ctx.fillRect(0, 0, W, H);
    return;
  }
  ctx.fillStyle = pattern;
  ctx.fillRect(0, 0, W, H);
}

function drawImageToFrame(
  ctx: CanvasRenderingContext2D,
  cssW: number,
  cssH: number,
  dpr: number,
  img: HTMLImageElement,
  rotationDeg: number,
  zoom: number,
  panX: number,
  panY: number,
  fitMode: ImageCropFitMode,
  frameBg: ImageCropFrameBackground,
  exportTransparentChecker: boolean
): void {
  const W = Math.max(1, Math.round(cssW * dpr));
  const H = Math.max(1, Math.round(cssH * dpr));
  if (ctx.canvas.width !== W || ctx.canvas.height !== H) {
    ctx.canvas.width = W;
    ctx.canvas.height = H;
  }
  fillFrameBackground(ctx, W, H, dpr, frameBg, exportTransparentChecker);

  const rad = (rotationDeg * Math.PI) / 180;
  const base = baseScaleForFit(fitMode, img.naturalWidth, img.naturalHeight, rad, cssW, cssH);
  const sc = base * zoom;

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.translate(cssW / 2 + panX, cssH / 2 + panY);
  ctx.rotate(rad);
  ctx.scale(sc, sc);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  ctx.restore();
}

function exportDimensions(crop: CropRect, maxEdge = 960): { outW: number; outH: number } {
  const ar = crop.w / Math.max(1e-6, crop.h);
  if (ar >= 1) {
    const outW = maxEdge;
    return { outW, outH: Math.max(1, Math.round(maxEdge / ar)) };
  }
  const outH = maxEdge;
  return { outW: Math.max(1, Math.round(maxEdge * ar)), outH };
}

function normalizedAspectRatio(aw: number, ah: number): number {
  return aw / Math.max(1e-6, ah);
}

function frameHeightFromAspect(frameW: number, aw: number, ah: number): number {
  return frameW * (ah / aw);
}

function finalPreviewAspectDimensions(aspect: FinalPreviewAspect): { aw: number; ah: number } {
  if (aspect === "1:1") return { aw: 1, ah: 1 };
  if (aspect === "16:9") return { aw: 16, ah: 9 };
  return { aw: 9, ah: 16 };
}

async function exportAdjustedFromApplied(
  appliedUrl: string,
  aspect: FinalPreviewAspect,
  mode: FinalPreviewMode,
  scale: number,
  offsetXPct: number,
  offsetYPct: number
): Promise<File | null> {
  const img = new window.Image();
  img.crossOrigin = "anonymous";
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("failed to load applied image"));
    img.src = appliedUrl;
  });
  const { aw, ah } = finalPreviewAspectDimensions(aspect);
  const base = 960;
  const outW = aw >= ah ? base : Math.round((base * aw) / ah);
  const outH = aw >= ah ? Math.round((base * ah) / aw) : base;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, outW);
  canvas.height = Math.max(1, outH);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, outW, outH);
  const fitBase =
    mode === "background"
      ? Math.max(outW / img.naturalWidth, outH / img.naturalHeight)
      : Math.min(outW / img.naturalWidth, outH / img.naturalHeight);
  const drawW = img.naturalWidth * fitBase * scale;
  const drawH = img.naturalHeight * fitBase * scale;
  const dx = (outW - drawW) / 2 + offsetXPct * outW;
  const dy = (outH - drawH) / 2 + offsetYPct * outH;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, dx, dy, drawW, drawH);
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ? new File([b], "edited-final.png", { type: "image/png" }) : null), "image/png", 0.92);
  });
}

function makeDefaultCropRect(frameW: number, frameH: number, ratio: number): CropRect {
  const pad = Math.min(frameW, frameH) * 0.09;
  let w = frameW - pad * 2;
  let h = w / ratio;
  if (h > frameH - pad * 2) {
    h = frameH - pad * 2;
    w = h * ratio;
  }
  w = clamp(w, 64, frameW);
  h = clamp(h, 64, frameH);
  return { x: (frameW - w) / 2, y: (frameH - h) / 2, w, h };
}

function fitCropToAspect(prev: CropRect, frameW: number, frameH: number, ratio: number): CropRect {
  const cx = prev.x + prev.w / 2;
  const cy = prev.y + prev.h / 2;
  let w = prev.w;
  let h = w / ratio;
  if (h > frameH) {
    h = frameH;
    w = h * ratio;
  }
  if (w > frameW) {
    w = frameW;
    h = w / ratio;
  }
  w = clamp(w, 64, frameW);
  h = clamp(h, 64, frameH);
  const x = clamp(cx - w / 2, 0, frameW - w);
  const y = clamp(cy - h / 2, 0, frameH - h);
  return { x, y, w, h };
}

function exportFromFrame(
  img: HTMLImageElement,
  frameW: number,
  frameH: number,
  cropRect: CropRect,
  rotationDeg: number,
  zoom: number,
  panX: number,
  panY: number,
  fitMode: ImageCropFitMode,
  frameBg: ImageCropFrameBackground
): Promise<File | null> {
  const { outW, outH } = exportDimensions(cropRect);
  const sx = outW / cropRect.w;
  const sy = outH / cropRect.h;
  const scale = Math.max(1, Math.max(sx, sy));

  const full = document.createElement("canvas");
  full.width = Math.max(1, Math.round(frameW * scale));
  full.height = Math.max(1, Math.round(frameH * scale));
  const fctx = full.getContext("2d");
  if (!fctx) return Promise.resolve(null);

  const exportTransparentChecker = frameBg === "checker";
  drawImageToFrame(
    fctx,
    frameW,
    frameH,
    scale,
    img,
    rotationDeg,
    zoom,
    panX,
    panY,
    fitMode,
    frameBg,
    exportTransparentChecker
  );

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const octx = out.getContext("2d");
  if (!octx) return Promise.resolve(null);

  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(
    full,
    cropRect.x * scale,
    cropRect.y * scale,
    cropRect.w * scale,
    cropRect.h * scale,
    0,
    0,
    outW,
    outH
  );

  return new Promise((resolve) => {
    out.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        resolve(new File([blob], "edited.png", { type: "image/png" }));
      },
      "image/png",
      0.92
    );
  });
}

export function ImageCropEditor({
  imageUrl,
  maxFrameWidth = 340,
  onApplyBackground,
  onApplyOverlay,
  previewLyricsText,
  previewLyricsFontSize,
  previewLyricsColor,
  previewLyricsTextShadow,
  previewLyricsLayoutMode,
  previewLyricsLineBreakAt,
  previewLyricsOffsetX,
  previewLyricsOffsetY,
}: ImageCropEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [aspectPreset, setAspectPreset] = useState<ImageCropAspectPreset>("1:1");
  const [freeRatio, setFreeRatio] = useState(1);
  const [fitMode, setFitMode] = useState<ImageCropFitMode>("cover");
  const [frameBg, setFrameBg] = useState<ImageCropFrameBackground>("white");
  const [rotationDeg, setRotationDeg] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [cropRect, setCropRect] = useState<CropRect>({ x: 20, y: 20, w: 220, h: 220 });
  const [editingImageUrl, setEditingImageUrl] = useState(imageUrl);
  const [appliedCropFile, setAppliedCropFile] = useState<File | null>(null);
  const [appliedCropUrl, setAppliedCropUrl] = useState<string | null>(null);
  const [appliedCropSig, setAppliedCropSig] = useState<string>("");
  const [finalPreviewAspect, setFinalPreviewAspect] = useState<FinalPreviewAspect>("9:16");
  const [finalPreviewMode, setFinalPreviewMode] = useState<FinalPreviewMode>("background");
  const [finalPreviewScale, setFinalPreviewScale] = useState(1);
  const [finalPreviewOffsetXPct, setFinalPreviewOffsetXPct] = useState(0);
  const [finalPreviewOffsetYPct, setFinalPreviewOffsetYPct] = useState(0);
  const [showLyricsOnFinalPreview, setShowLyricsOnFinalPreview] = useState(true);
  const [faceSupportState, setFaceSupportState] = useState<"checking" | "detected" | "none">("checking");
  const preservedBlobUrlsRef = useRef<Set<string>>(new Set());

  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<
    | null
    | { mode: "pan"; id: number; lx: number; ly: number }
    | {
        mode: "pinch";
        ids: [number, number];
        startDist: number;
        startZoom: number;
        startPanX: number;
        startPanY: number;
        startMidX: number;
        startMidY: number;
      }
  >(null);
  const cropActionRef = useRef<
    | null
    | {
        pointerId: number;
        mode: "move" | "resize";
        handle?: CropHandle;
        startX: number;
        startY: number;
        origin: CropRect;
      }
  >(null);
  const finalPreviewPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const finalPreviewGestureRef = useRef<
    | null
    | { mode: "pan"; id: number; lx: number; ly: number }
    | {
        mode: "pinch";
        ids: [number, number];
        startDist: number;
        startScale: number;
        startOffsetX: number;
        startOffsetY: number;
        startMidX: number;
        startMidY: number;
      }
  >(null);
  const finalPreviewStageRef = useRef<HTMLDivElement>(null);
  const faceTargetRef = useRef({
    cropRect,
    fitMode,
    frameW: 0,
    frameH: 0,
    rotationDeg,
    zoom,
  });

  const { aw, ah } = aspectDimensions(aspectPreset, freeRatio);
  const cropRatio = normalizedAspectRatio(aw, ah);
  const frameW = Math.min(maxFrameWidth, typeof window !== "undefined" ? Math.min(maxFrameWidth, window.innerWidth - 48) : maxFrameWidth);
  const frameH = frameHeightFromAspect(frameW, aw, ah);

  const resetCropRectByAspect = useCallback(
    (nextAw: number, nextAh: number) => {
      const nextRatio = normalizedAspectRatio(nextAw, nextAh);
      const nextFrameH = frameHeightFromAspect(frameW, nextAw, nextAh);
      setCropRect(makeDefaultCropRect(frameW, nextFrameH, nextRatio));
    },
    [frameW]
  );

  const applyAspectPreset = useCallback(
    (nextPreset: ImageCropAspectPreset) => {
      if (nextPreset === "free") {
        const { aw: naw, ah: nah } = aspectDimensions("free", freeRatio);
        setAspectPreset("free");
        resetCropRectByAspect(naw, nah);
        return;
      }
      const { aw: naw, ah: nah } = aspectDimensions(nextPreset, freeRatio);
      setAspectPreset(nextPreset);
      resetCropRectByAspect(naw, nah);
    },
    [freeRatio, resetCropRectByAspect]
  );

  const applyFreeRatioValue = useCallback(
    (nextFreeRatio: number) => {
      const safe = clamp(nextFreeRatio, 0.45, 2.2);
      setFreeRatio(safe);
      if (aspectPreset !== "free") return;
      const { aw: naw, ah: nah } = aspectDimensions("free", safe);
      resetCropRectByAspect(naw, nah);
    },
    [aspectPreset, resetCropRectByAspect]
  );

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img || !ready) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = typeof window !== "undefined" ? Math.min(1.5, window.devicePixelRatio || 1) : 1;
    drawImageToFrame(ctx, frameW, frameH, dpr, img, rotationDeg, zoom, panX, panY, fitMode, frameBg, false);
  }, [ready, frameW, frameH, rotationDeg, zoom, panX, panY, fitMode, frameBg]);

  useEffect(() => {
    faceTargetRef.current = {
      cropRect,
      fitMode,
      frameW,
      frameH,
      rotationDeg,
      zoom,
    };
  }, [cropRect, fitMode, frameW, frameH, rotationDeg, zoom]);

  useEffect(() => {
    setEditingImageUrl(imageUrl);
  }, [imageUrl]);

  useEffect(() => {
    // 再トリミング中に参照している blob URL は生かし、離れたら解放
    for (const u of [...preservedBlobUrlsRef.current]) {
      if (u !== editingImageUrl && u !== appliedCropUrl) {
        URL.revokeObjectURL(u);
        preservedBlobUrlsRef.current.delete(u);
      }
    }
  }, [editingImageUrl, appliedCropUrl]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setReady(false);
      setLoadError(null);
      setZoom(1);
      setPanX(0);
      setPanY(0);
      setRotationDeg(0);
      setFaceSupportState("checking");
    });

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      imgRef.current = img;
      setReady(true);
      queueMicrotask(() => {
        if (cancelled) return;
        setCropRect(makeDefaultCropRect(frameW, frameH, cropRatio));
      });
    };
    img.onerror = () => {
      if (cancelled) return;
      imgRef.current = null;
      setLoadError("画像を読み込めませんでした");
      setFaceSupportState("none");
    };
    img.src = editingImageUrl;
    return () => {
      cancelled = true;
      imgRef.current = null;
    };
  }, [editingImageUrl, frameW, frameH, cropRatio]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  useEffect(() => {
    // ビューポート等で frame サイズが変わった場合のみ、現在の中心を維持して再フィット
    queueMicrotask(() => {
      setCropRect((prev) => fitCropToAspect(prev, frameW, frameH, cropRatio));
    });
  }, [frameW, frameH, cropRatio]);

  useEffect(() => {
    if (!ready || !imgRef.current) return;
    if (typeof window === "undefined") {
      queueMicrotask(() => setFaceSupportState("none"));
      return;
    }
    const FaceDetectorCtor = window.FaceDetector;
    if (typeof FaceDetectorCtor !== "function") {
      queueMicrotask(() => setFaceSupportState("none"));
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const detector = new FaceDetectorCtor({ fastMode: true, maxDetectedFaces: 1 });
        const faces = await detector.detect(imgRef.current!);
        if (cancelled) return;
        const bb = faces?.[0]?.boundingBox;
        if (!bb || !(bb.width > 0) || !(bb.height > 0)) {
          setFaceSupportState("none");
          return;
        }
        setFaceSupportState("detected");
        const img = imgRef.current!;
        const target = faceTargetRef.current;
        const faceCx = bb.x + bb.width / 2;
        const faceCy = bb.y + bb.height / 2;
        const rad = (target.rotationDeg * Math.PI) / 180;
        const base = baseScaleForFit(
          target.fitMode,
          img.naturalWidth,
          img.naturalHeight,
          rad,
          target.frameW,
          target.frameH
        );
        const sc = base * target.zoom;
        const targetX = target.cropRect.x + target.cropRect.w / 2;
        const targetY = target.cropRect.y + target.cropRect.h / 2;
        const faceOffsetX = (faceCx - img.naturalWidth / 2) * sc;
        const faceOffsetY = (faceCy - img.naturalHeight / 2) * sc;
        setPanX(targetX - target.frameW / 2 - faceOffsetX);
        setPanY(targetY - target.frameH / 2 - faceOffsetY);
      } catch {
        if (!cancelled) setFaceSupportState("none");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [ready, editingImageUrl]);

  const getLocalPoint = useCallback((e: React.PointerEvent): { x: number; y: number } => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const startCropMove = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const p = getLocalPoint(e);
      cropActionRef.current = {
        pointerId: e.pointerId,
        mode: "move",
        startX: p.x,
        startY: p.y,
        origin: cropRect,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [cropRect, getLocalPoint]
  );

  const startCropResize = useCallback(
    (handle: CropHandle, e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const p = getLocalPoint(e);
      cropActionRef.current = {
        pointerId: e.pointerId,
        mode: "resize",
        handle,
        startX: p.x,
        startY: p.y,
        origin: cropRect,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [cropRect, getLocalPoint]
  );

  const updateCropByPointer = useCallback(
    (pointerId: number, x: number, y: number) => {
      const act = cropActionRef.current;
      if (!act || act.pointerId !== pointerId) return;
      if (act.mode === "move") {
        const dx = x - act.startX;
        const dy = y - act.startY;
        const nx = clamp(act.origin.x + dx, 0, frameW - act.origin.w);
        const ny = clamp(act.origin.y + dy, 0, frameH - act.origin.h);
        setCropRect({ ...act.origin, x: nx, y: ny });
        return;
      }

      const minW = 64;
      const minH = minW / cropRatio;
      const origin = act.origin;
      const handle = act.handle!;
      let ax = 0;
      let ay = 0;
      if (handle === "nw") {
        ax = origin.x + origin.w;
        ay = origin.y + origin.h;
      } else if (handle === "ne") {
        ax = origin.x;
        ay = origin.y + origin.h;
      } else if (handle === "sw") {
        ax = origin.x + origin.w;
        ay = origin.y;
      } else {
        ax = origin.x;
        ay = origin.y;
      }

      const px = clamp(x, 0, frameW);
      let maxW = frameW;
      let maxH = frameH;
      if (handle === "nw") {
        maxW = ax;
        maxH = ay;
      } else if (handle === "ne") {
        maxW = frameW - ax;
        maxH = ay;
      } else if (handle === "sw") {
        maxW = ax;
        maxH = frameH - ay;
      } else {
        maxW = frameW - ax;
        maxH = frameH - ay;
      }
      const maxWByAspect = Math.min(maxW, maxH * cropRatio);
      let desiredW = 0;
      if (handle === "nw") desiredW = ax - px;
      else if (handle === "ne") desiredW = px - ax;
      else if (handle === "sw") desiredW = ax - px;
      else desiredW = px - ax;
      desiredW = clamp(desiredW, minW, Math.max(minW, maxWByAspect));
      let w = desiredW;
      let h = w / cropRatio;
      if (h < minH) {
        h = minH;
        w = h * cropRatio;
      }

      let nx = ax;
      let ny = ay;
      if (handle === "nw") {
        nx = ax - w;
        ny = ay - h;
      } else if (handle === "ne") {
        nx = ax;
        ny = ay - h;
      } else if (handle === "sw") {
        nx = ax - w;
        ny = ay;
      } else {
        nx = ax;
        ny = ay;
      }
      nx = clamp(nx, 0, frameW - w);
      ny = clamp(ny, 0, frameH - h);
      setCropRect({ x: nx, y: ny, w, h });
    },
    [cropRatio, frameW, frameH]
  );

  const onStagePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!ready) return;
      const pt = getLocalPoint(e);
      pointersRef.current.set(e.pointerId, { x: pt.x, y: pt.y });
      const ids = [...pointersRef.current.keys()];
      if (ids.length >= 2) {
        const a = pointersRef.current.get(ids[0])!;
        const b = pointersRef.current.get(ids[1])!;
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        gestureRef.current = {
          mode: "pinch",
          ids: [ids[0], ids[1]],
          startDist: Math.max(1, dist),
          startZoom: zoom,
          startPanX: panX,
          startPanY: panY,
          startMidX: midX,
          startMidY: midY,
        };
        return;
      }
      gestureRef.current = { mode: "pan", id: e.pointerId, lx: pt.x, ly: pt.y };
    },
    [ready, getLocalPoint, zoom, panX, panY]
  );

  const onStagePointerMove = useCallback(
    (e: React.PointerEvent) => {
      const p = getLocalPoint(e);
      pointersRef.current.set(e.pointerId, p);
      if (cropActionRef.current) {
        updateCropByPointer(e.pointerId, p.x, p.y);
        return;
      }
      const g = gestureRef.current;
      if (!g) return;
      if (g.mode === "pan") {
        if (g.id !== e.pointerId) return;
        const dx = p.x - g.lx;
        const dy = p.y - g.ly;
        g.lx = p.x;
        g.ly = p.y;
        setPanX((v) => v + dx);
        setPanY((v) => v + dy);
        return;
      }
      const a = pointersRef.current.get(g.ids[0]);
      const b = pointersRef.current.get(g.ids[1]);
      if (!a || !b) return;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const ratio = dist / Math.max(1, g.startDist);
      const nz = clamp(g.startZoom * ratio, 0.5, 4);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      setZoom(nz);
      setPanX(g.startPanX + (midX - g.startMidX));
      setPanY(g.startPanY + (midY - g.startMidY));
    },
    [getLocalPoint, updateCropByPointer]
  );

  const onStagePointerUp = useCallback((e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    const act = cropActionRef.current;
    if (act && act.pointerId === e.pointerId) cropActionRef.current = null;
    const g = gestureRef.current;
    if (!g) return;
    if (g.mode === "pan" && g.id === e.pointerId) {
      gestureRef.current = null;
    } else if (g.mode === "pinch") {
      const ids = [...pointersRef.current.keys()];
      if (ids.length === 1) {
        const p = pointersRef.current.get(ids[0])!;
        gestureRef.current = { mode: "pan", id: ids[0], lx: p.x, ly: p.y };
      } else if (ids.length === 0) {
        gestureRef.current = null;
      }
    }
  }, []);

  const buildFile = useCallback(async (): Promise<File | null> => {
    const img = imgRef.current;
    if (!img || !ready) return null;
    return exportFromFrame(img, frameW, frameH, cropRect, rotationDeg, zoom, panX, panY, fitMode, frameBg);
  }, [ready, frameW, frameH, cropRect, rotationDeg, zoom, panX, panY, fitMode, frameBg]);

  useEffect(() => {
    const urls = preservedBlobUrlsRef.current;
    return () => {
      if (appliedCropUrl) URL.revokeObjectURL(appliedCropUrl);
      for (const u of urls) URL.revokeObjectURL(u);
      urls.clear();
    };
  }, [appliedCropUrl]);

  const pill = (active: boolean) => ({
    padding: "10px 14px",
    fontSize: 14,
    fontWeight: 500 as const,
    borderRadius: 10,
    border: "1px solid",
    borderColor: active ? "#93c5fd" : "#e2e8f0",
    background: active ? "#eff6ff" : "#fff",
    color: "#0f172a",
    cursor: "pointer" as const,
    touchAction: "manipulation" as const,
    minHeight: 44,
  });

  const handleSize = 18;
  const currentCropSig = [
    editingImageUrl,
    cropRect.x.toFixed(2),
    cropRect.y.toFixed(2),
    cropRect.w.toFixed(2),
    cropRect.h.toFixed(2),
    panX.toFixed(2),
    panY.toFixed(2),
    zoom.toFixed(3),
    rotationDeg.toFixed(2),
    fitMode,
    frameBg,
  ].join("|");
  const hasAppliedCrop = Boolean(appliedCropFile && appliedCropUrl && appliedCropSig === currentCropSig);
  const upperPreviewFrameW = Math.min(420, frameW);
  const upperPreviewFrameH = frameHeightFromAspect(
    upperPreviewFrameW,
    finalPreviewAspectDimensions(finalPreviewAspect).aw,
    finalPreviewAspectDimensions(finalPreviewAspect).ah
  );
  const finalPreviewFrameW = Math.min(300, frameW);
  const finalPreviewFrameH = frameHeightFromAspect(
    finalPreviewFrameW,
    finalPreviewAspectDimensions(finalPreviewAspect).aw,
    finalPreviewAspectDimensions(finalPreviewAspect).ah
  );
  const resetFinalPreviewAdjust = useCallback(() => {
    setFinalPreviewScale(1);
    setFinalPreviewOffsetXPct(0);
    setFinalPreviewOffsetYPct(0);
  }, []);
  const previewAspectRatio: PreviewAspectRatio =
    finalPreviewAspect === "16:9"
      ? "landscape"
      : finalPreviewAspect === "1:1"
        ? "square"
        : "portrait";
  const finalPreviewCaptionLayout = useMemo(
    () => getCaptionLayoutForPreviewAndExport(previewAspectRatio),
    [previewAspectRatio]
  );
  const finalPreviewLines = useMemo(
    () =>
      getLyricsDisplayLines(
        (previewLyricsText ?? "").trim(),
        previewLyricsLayoutMode ?? 1,
        previewLyricsLineBreakAt ?? 0
      ),
    [previewLyricsText, previewLyricsLayoutMode, previewLyricsLineBreakAt]
  );
  const showLyricsCaption = showLyricsOnFinalPreview && finalPreviewLines.length > 0;
  const captionBaseFont = clamp(previewLyricsFontSize ?? 28, 10, 120);
  const captionColor = previewLyricsColor ?? "#ffffff";
  const captionShadow =
    previewLyricsTextShadow ?? "0 0 10px black, 0 1px 3px rgba(0,0,0,0.8)";
  const captionOffsetX = previewLyricsOffsetX ?? 0;
  const captionOffsetY = previewLyricsOffsetY ?? 0;

  const onFinalPreviewPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      finalPreviewPointersRef.current.set(e.pointerId, p);
      const ids = [...finalPreviewPointersRef.current.keys()];
      if (ids.length >= 2) {
        const a = finalPreviewPointersRef.current.get(ids[0])!;
        const b = finalPreviewPointersRef.current.get(ids[1])!;
        finalPreviewGestureRef.current = {
          mode: "pinch",
          ids: [ids[0], ids[1]],
          startDist: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
          startScale: finalPreviewScale,
          startOffsetX: finalPreviewOffsetXPct,
          startOffsetY: finalPreviewOffsetYPct,
          startMidX: (a.x + b.x) / 2,
          startMidY: (a.y + b.y) / 2,
        };
        return;
      }
      finalPreviewGestureRef.current = { mode: "pan", id: e.pointerId, lx: p.x, ly: p.y };
    },
    [finalPreviewScale, finalPreviewOffsetXPct, finalPreviewOffsetYPct]
  );
  const onFinalPreviewPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    finalPreviewPointersRef.current.set(e.pointerId, p);
    const g = finalPreviewGestureRef.current;
    if (!g) return;
    if (g.mode === "pan") {
      if (g.id !== e.pointerId) return;
      const dx = p.x - g.lx;
      const dy = p.y - g.ly;
      g.lx = p.x;
      g.ly = p.y;
      setFinalPreviewOffsetXPct((v) => clamp(v + dx / Math.max(1, finalPreviewFrameW), -1, 1));
      setFinalPreviewOffsetYPct((v) => clamp(v + dy / Math.max(1, finalPreviewFrameH), -1, 1));
      return;
    }
    const a = finalPreviewPointersRef.current.get(g.ids[0]);
    const b = finalPreviewPointersRef.current.get(g.ids[1]);
    if (!a || !b) return;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const ratio = dist / Math.max(1, g.startDist);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    setFinalPreviewScale(clamp(g.startScale * ratio, 0.7, 2.2));
    setFinalPreviewOffsetXPct(clamp(g.startOffsetX + (midX - g.startMidX) / Math.max(1, finalPreviewFrameW), -1, 1));
    setFinalPreviewOffsetYPct(clamp(g.startOffsetY + (midY - g.startMidY) / Math.max(1, finalPreviewFrameH), -1, 1));
  }, [finalPreviewFrameW, finalPreviewFrameH]);
  const onFinalPreviewPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    finalPreviewPointersRef.current.delete(e.pointerId);
    const g = finalPreviewGestureRef.current;
    if (!g) return;
    if (g.mode === "pan" && g.id === e.pointerId) {
      finalPreviewGestureRef.current = null;
    } else if (g.mode === "pinch") {
      const ids = [...finalPreviewPointersRef.current.keys()];
      if (ids.length === 1) {
        const p = finalPreviewPointersRef.current.get(ids[0])!;
        finalPreviewGestureRef.current = { mode: "pan", id: ids[0], lx: p.x, ly: p.y };
      } else if (ids.length === 0) {
        finalPreviewGestureRef.current = null;
      }
    }
  }, []);
  const faceHint = useMemo(() => {
    if (!ready) return null;
    if (faceSupportState === "detected") return "顔を検出して中央寄せしました";
    if (faceSupportState === "none") return "顔検出は利用できないため通常配置です";
    return "";
  }, [ready, faceSupportState]);

  const currentEditSettings = useCallback(
    (applyMode: "background" | "overlay"): SegmentMaterialEditSettings => ({
      cropRect: { ...cropRect },
      ratio: aspectPreset,
      fitMode,
      zoom,
      rotation: rotationDeg,
      panX,
      panY,
      applyMode,
    }),
    [cropRect, aspectPreset, fitMode, zoom, rotationDeg, panX, panY]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%", maxWidth: maxFrameWidth + 40 }}>
      <div
        ref={stageRef}
        style={{
          position: "relative",
          alignSelf: "center",
          width: frameW,
          height: frameH,
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid #e2e8f0",
          touchAction: "none",
          background: frameBg === "black" ? "#000" : frameBg === "white" ? "#fff" : "#64748b",
        }}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onPointerCancel={onStagePointerUp}
      >
        <canvas ref={canvasRef} width={Math.round(frameW * 2)} height={Math.round(frameH * 2)} style={{ width: frameW, height: frameH, display: "block" }} />
        <div
          role="presentation"
          onPointerDown={startCropMove}
          style={{
            position: "absolute",
            left: cropRect.x,
            top: cropRect.y,
            width: cropRect.w,
            height: cropRect.h,
            border: "2px solid #38bdf8",
            boxShadow: "0 0 0 9999px rgba(15,23,42,0.45)",
            cursor: "move",
            touchAction: "none",
          }}
        >
          {(["nw", "ne", "sw", "se"] as const).map((handle) => {
            const pos: Record<CropHandle, { left?: number; right?: number; top?: number; bottom?: number; cursor: string }> = {
              nw: { left: -handleSize / 2, top: -handleSize / 2, cursor: "nwse-resize" },
              ne: { right: -handleSize / 2, top: -handleSize / 2, cursor: "nesw-resize" },
              sw: { left: -handleSize / 2, bottom: -handleSize / 2, cursor: "nesw-resize" },
              se: { right: -handleSize / 2, bottom: -handleSize / 2, cursor: "nwse-resize" },
            };
            return (
              <div
                key={handle}
                role="presentation"
                onPointerDown={(e) => startCropResize(handle, e)}
                style={{
                  position: "absolute",
                  width: handleSize,
                  height: handleSize,
                  borderRadius: 999,
                  border: "2px solid #fff",
                  background: "#0ea5e9",
                  boxSizing: "border-box",
                  touchAction: "none",
                  ...pos[handle],
                }}
              />
            );
          })}
        </div>
      </div>

      {loadError ? <div style={{ fontSize: 13, color: "#b91c1c" }}>{loadError}</div> : null}
      {faceHint ? <div style={{ fontSize: 11, color: "#64748b" }}>{faceHint}</div> : null}
      {editingImageUrl !== imageUrl ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 12, color: "#0369a1", fontWeight: 600 }}>再トリミングモード（切り抜き結果を編集中）</div>
          <button
            type="button"
            onClick={() => setEditingImageUrl(imageUrl)}
            style={{
              padding: "6px 10px",
              fontSize: 12,
              fontWeight: 600,
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#fff",
              color: "#0f172a",
              cursor: "pointer",
            }}
          >
            元画像に戻る
          </button>
        </div>
      ) : null}
      <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.45 }}>
        枠をドラッグで移動・四隅でリサイズ。画像側はドラッグ移動、スマホは2本指でピンチズーム対応。
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <span style={{ width: "100%", fontSize: 12, fontWeight: 600, color: "#334155" }}>比率（切り抜き枠と連動）</span>
        {(
          [
            ["1:1", "1:1" as const],
            ["9:16", "9:16" as const],
            ["16:9", "16:9" as const],
            ["自由", "free" as const],
          ] as const
        ).map(([label, key]) => (
          <button key={key} type="button" style={pill(aspectPreset === key)} onClick={() => applyAspectPreset(key)}>
            {label}
          </button>
        ))}
      </div>

      {aspectPreset === "free" ? (
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#475569" }}>
          縦横比（自由）
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.02}
            value={freeRatio}
            onChange={(e) => applyFreeRatioValue(parseFloat(e.target.value) || 1)}
            style={{ width: "100%", minHeight: 36 }}
          />
        </label>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>収め方</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" style={pill(fitMode === "contain")} onClick={() => setFitMode("contain")}>全体を収める</button>
          <button type="button" style={pill(fitMode === "cover")} onClick={() => setFitMode("cover")}>枠いっぱい</button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>余白の色</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <button type="button" style={pill(frameBg === "white")} onClick={() => setFrameBg("white")}>白</button>
          <button type="button" style={pill(frameBg === "black")} onClick={() => setFrameBg("black")}>黒</button>
          <button type="button" style={pill(frameBg === "checker")} onClick={() => setFrameBg("checker")}>チェック（透明風）</button>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>回転</span>
        <button type="button" style={pill(false)} onClick={() => setRotationDeg((d) => d - 90)}>−90°</button>
        <button type="button" style={pill(false)} onClick={() => setRotationDeg((d) => d + 90)}>＋90°</button>
        <button type="button" style={pill(false)} onClick={() => setRotationDeg(0)}>リセット</button>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#475569" }}>
        角度（細かく）
        <input type="range" min={0} max={359} step={1} value={((Math.round(rotationDeg) % 360) + 360) % 360} onChange={(e) => setRotationDeg(parseInt(e.target.value, 10) || 0)} style={{ width: "100%", minHeight: 36 }} />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "#475569" }}>
        拡大
        <input type="range" min={0.5} max={4} step={0.01} value={zoom} onChange={(e) => setZoom(clamp(parseFloat(e.target.value) || 1, 0.5, 4))} style={{ width: "100%", minHeight: 36 }} />
        <span style={{ fontSize: 11, color: "#94a3b8" }}>{zoom.toFixed(2)}×</span>
      </label>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
        <button
          type="button"
          disabled={!ready}
          onClick={async () => {
            const f = await buildFile();
            if (!f) return;
            setAppliedCropFile(f);
            setAppliedCropSig(currentCropSig);
            // 適用後プレビューの初期表示は毎回同じ条件に揃える
            setFinalPreviewScale(1);
            setFinalPreviewOffsetXPct(0);
            setFinalPreviewOffsetYPct(0);
            setAppliedCropUrl((prev) => {
              if (prev) {
                if (prev === editingImageUrl) preservedBlobUrlsRef.current.add(prev);
                else URL.revokeObjectURL(prev);
              }
              return URL.createObjectURL(f);
            });
          }}
          style={{
            width: "100%",
            padding: "12px 14px",
            fontSize: 14,
            fontWeight: 700,
            borderRadius: 10,
            border: "1px solid #0ea5e9",
            background: "#e0f2fe",
            color: "#0c4a6e",
            cursor: ready ? "pointer" : "not-allowed",
            minHeight: 48,
          }}
        >
          青枠を適用（この範囲で確定）
        </button>
        {hasAppliedCrop && appliedCropUrl ? (
          <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 12, color: "#475569", fontWeight: 600 }}>適用後プレビュー（切り抜き結果）</div>
            <div
              style={{
                position: "relative",
                width: upperPreviewFrameW,
                height: upperPreviewFrameH,
                maxWidth: "100%",
                alignSelf: "center",
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid #cbd5e1",
                background: finalPreviewMode === "background" ? "#0f172a" : "repeating-conic-gradient(#e2e8f0 0% 25%, #f8fafc 0% 50%) 50% / 14px 14px",
              }}
            >
              <NextImage
                src={appliedCropUrl}
                alt=""
                fill
                unoptimized
                style={{
                  objectFit: finalPreviewMode === "background" ? "cover" : "contain",
                  transform: `translate(${(finalPreviewOffsetXPct * 100).toFixed(2)}%, ${(finalPreviewOffsetYPct * 100).toFixed(2)}%) scale(${finalPreviewScale.toFixed(3)})`,
                }}
              />
            </div>
            <div style={{ marginTop: 6, padding: 10, border: "1px solid #e2e8f0", borderRadius: 10, background: "#f8fafc", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#334155" }}>仕上げ微調整（適用前）</div>
              <div
                ref={finalPreviewStageRef}
                style={{
                  position: "relative",
                  width: finalPreviewFrameW,
                  height: finalPreviewFrameH,
                  maxWidth: "100%",
                  alignSelf: "center",
                  borderRadius: 8,
                  overflow: "hidden",
                  border: "1px solid #cbd5e1",
                  background: finalPreviewMode === "background" ? "#0f172a" : "repeating-conic-gradient(#e2e8f0 0% 25%, #f8fafc 0% 50%) 50% / 14px 14px",
                  touchAction: "none",
                }}
                onPointerDown={onFinalPreviewPointerDown}
                onPointerMove={onFinalPreviewPointerMove}
                onPointerUp={onFinalPreviewPointerUp}
                onPointerCancel={onFinalPreviewPointerUp}
              >
                <NextImage
                  src={appliedCropUrl}
                  alt=""
                  fill
                  unoptimized
                  style={{
                    objectFit: finalPreviewMode === "background" ? "cover" : "contain",
                    transform: `translate(${(finalPreviewOffsetXPct * 100).toFixed(2)}%, ${(finalPreviewOffsetYPct * 100).toFixed(2)}%) scale(${finalPreviewScale.toFixed(3)})`,
                  }}
                />
                {showLyricsCaption && previewLyricsLayoutMode === "vRight" ? (
                  <PreviewLyricsCaptionAutoFit
                    measureFrameRef={finalPreviewStageRef}
                    baseFontSize={captionBaseFont}
                    color={captionColor}
                    textShadow={captionShadow}
                    className="preview-pv-caption preview-pv-caption--v preview-pv-caption--vr"
                    style={{
                      position: "absolute",
                      top: `${finalPreviewCaptionLayout.verticalTopPercent}%`,
                      right: `${finalPreviewCaptionLayout.verticalSideInsetPercent}%`,
                      writingMode: "vertical-rl",
                      textAlign: "start",
                      maxHeight: "88%",
                      overflow: "hidden",
                      lineHeight: 1.65,
                      padding: "8px 4px",
                      zIndex: 5,
                      transform: `translate(${captionOffsetX}px, calc(-50% + ${captionOffsetY}px))`,
                    }}
                    contentKey={`crop-vr-${previewLyricsText}-${finalPreviewAspect}-${captionOffsetX}-${captionOffsetY}`}
                  >
                    {finalPreviewLines[0]}
                  </PreviewLyricsCaptionAutoFit>
                ) : null}
                {showLyricsCaption && previewLyricsLayoutMode === "vLeft" ? (
                  <PreviewLyricsCaptionAutoFit
                    measureFrameRef={finalPreviewStageRef}
                    baseFontSize={captionBaseFont}
                    color={captionColor}
                    textShadow={captionShadow}
                    className="preview-pv-caption preview-pv-caption--v preview-pv-caption--vl"
                    style={{
                      position: "absolute",
                      top: `${finalPreviewCaptionLayout.verticalTopPercent}%`,
                      left: `${finalPreviewCaptionLayout.verticalSideInsetPercent}%`,
                      writingMode: "vertical-lr",
                      textAlign: "start",
                      maxHeight: "88%",
                      overflow: "hidden",
                      lineHeight: 1.65,
                      padding: "8px 4px",
                      zIndex: 5,
                      transform: `translate(${captionOffsetX}px, calc(-50% + ${captionOffsetY}px))`,
                    }}
                    contentKey={`crop-vl-${previewLyricsText}-${finalPreviewAspect}-${captionOffsetX}-${captionOffsetY}`}
                  >
                    {finalPreviewLines[0]}
                  </PreviewLyricsCaptionAutoFit>
                ) : null}
                {showLyricsCaption &&
                previewLyricsLayoutMode !== "vRight" &&
                previewLyricsLayoutMode !== "vLeft" ? (
                  <PreviewLyricsCaptionAutoFit
                    measureFrameRef={finalPreviewStageRef}
                    baseFontSize={captionBaseFont}
                    color={captionColor}
                    textShadow={captionShadow}
                    className="preview-pv-caption preview-pv-caption--h"
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: `${finalPreviewCaptionLayout.horizontalBottomCssPercent}%`,
                      textAlign: "center",
                      lineHeight: 1.4,
                      padding: "0 12px",
                      zIndex: 5,
                      transform: `translate(${captionOffsetX}px, ${captionOffsetY}px)`,
                    }}
                    contentKey={`crop-h-${previewLyricsText}-${finalPreviewAspect}-${captionOffsetX}-${captionOffsetY}-${previewLyricsLayoutMode ?? 1}`}
                  >
                    {finalPreviewLines.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </PreviewLyricsCaptionAutoFit>
                ) : null}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(["1:1", "9:16", "16:9"] as const).map((k) => (
                  <button key={k} type="button" style={pill(finalPreviewAspect === k)} onClick={() => setFinalPreviewAspect(k)}>
                    {k}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" style={pill(finalPreviewMode === "background")} onClick={() => setFinalPreviewMode("background")}>
                  背景適用の見え方
                </button>
                <button type="button" style={pill(finalPreviewMode === "overlay")} onClick={() => setFinalPreviewMode("overlay")}>
                  オーバーレイ適用の見え方
                </button>
                <button type="button" style={pill(false)} onClick={resetFinalPreviewAdjust}>
                  リセット
                </button>
                <button
                  type="button"
                  style={pill(showLyricsOnFinalPreview)}
                  onClick={() => setShowLyricsOnFinalPreview((v) => !v)}
                >
                  歌詞表示 {showLyricsOnFinalPreview ? "ON" : "OFF"}
                </button>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" style={pill(false)} onClick={() => setFinalPreviewOffsetYPct((v) => clamp(v - 0.03, -1, 1))}>↑</button>
                <button type="button" style={pill(false)} onClick={() => setFinalPreviewOffsetXPct((v) => clamp(v - 0.03, -1, 1))}>←</button>
                <button type="button" style={pill(false)} onClick={() => setFinalPreviewOffsetXPct((v) => clamp(v + 0.03, -1, 1))}>→</button>
                <button type="button" style={pill(false)} onClick={() => setFinalPreviewOffsetYPct((v) => clamp(v + 0.03, -1, 1))}>↓</button>
                <button type="button" style={pill(false)} onClick={() => setFinalPreviewScale((v) => clamp(v - 0.05, 0.7, 2.2))}>−</button>
                <button type="button" style={pill(false)} onClick={() => setFinalPreviewScale((v) => clamp(v + 0.05, 0.7, 2.2))}>＋</button>
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>スマホはこのプレビュー上でドラッグ移動・2本指ピンチで拡大縮小できます。</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => {
                  if (!appliedCropUrl) return;
                  setEditingImageUrl(appliedCropUrl);
                }}
                style={{
                  padding: "8px 12px",
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid #38bdf8",
                  background: "#e0f2fe",
                  color: "#0c4a6e",
                  cursor: "pointer",
                }}
              >
                再トリミング
              </button>
              <button
                type="button"
                onClick={() => setEditingImageUrl(imageUrl)}
                disabled={editingImageUrl === imageUrl}
                style={{
                  padding: "8px 12px",
                  fontSize: 13,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: "1px solid #cbd5e1",
                  background: "#fff",
                  color: editingImageUrl === imageUrl ? "#94a3b8" : "#0f172a",
                  cursor: editingImageUrl === imageUrl ? "not-allowed" : "pointer",
                }}
              >
                元画像に戻る
              </button>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          disabled={!hasAppliedCrop}
          onClick={async () => {
            if (!hasAppliedCrop || !appliedCropUrl) return;
            const f = await exportAdjustedFromApplied(
              appliedCropUrl,
              finalPreviewAspect,
              "background",
              finalPreviewScale,
              finalPreviewOffsetXPct,
              finalPreviewOffsetYPct
            );
            if (f) onApplyBackground(f, currentEditSettings("background"));
          }}
          style={{
            flex: "1 1 140px",
            padding: "12px 14px",
            fontSize: 14,
            fontWeight: 600,
            borderRadius: 10,
            border: "none",
            background: hasAppliedCrop ? "#2563eb" : "#94a3b8",
            color: "#fff",
            cursor: hasAppliedCrop ? "pointer" : "not-allowed",
            minHeight: 48,
          }}
        >
          枠内を背景に適用
        </button>
        <button
          type="button"
          disabled={!hasAppliedCrop}
          onClick={async () => {
            if (!hasAppliedCrop || !appliedCropUrl) return;
            const f = await exportAdjustedFromApplied(
              appliedCropUrl,
              finalPreviewAspect,
              "overlay",
              finalPreviewScale,
              finalPreviewOffsetXPct,
              finalPreviewOffsetYPct
            );
            if (f) onApplyOverlay(f, currentEditSettings("overlay"));
          }}
          style={{
            flex: "1 1 140px",
            padding: "12px 14px",
            fontSize: 14,
            fontWeight: 600,
            borderRadius: 10,
            border: "1px solid #cbd5e1",
            background: "#fff",
            color: hasAppliedCrop ? "#0f172a" : "#94a3b8",
            cursor: hasAppliedCrop ? "pointer" : "not-allowed",
            minHeight: 48,
          }}
        >
          枠内をオーバーレイに適用
        </button>
      </div>
    </div>
  );
}
