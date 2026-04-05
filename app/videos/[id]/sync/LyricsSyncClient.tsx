"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useUiLocale } from "@/lib/i18n/UiLocaleProvider";
import { isUiLocale } from "@/lib/i18n/uiLocale";

/** クライアント初回マウント完了まで描画を遅延し、preview/editor の同時表示を防ぐ */
function useIsHydrated() {
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => {
    setIsHydrated(true);
  }, []);
  return isHydrated;
}
import { makeUniformSegments } from "@/lib/segments/makeUniformSegments";
import { formatSecToMinSec } from "@/lib/time/format";
import {
  DEFAULT_LYRICS_FONT_SIZE,
  clampLyricsFontSize,
  lyricsTextShadowForColor,
  normalizeLyricsColorHex,
  segmentScreenFilterCss,
} from "@/lib/segmentVisualStyle";
import {
  buildSourceVideoKey,
  buildSourceVideoMetaForDraft,
  finalizeSourceVideoMeta,
  findBestCrossVideoResumeCandidate,
  sessionDismissCrossResumeKey,
  type SourceVideoMeta,
} from "@/lib/sourceVideoKey";
import { drawLyricsCaptionOnExportCanvas, getLyricsDisplayLines } from "@/lib/lyricsCaptionLayout";
import { drawBrandEndCard } from "@/lib/export/exportBrandEndCard";
import { PreviewLyricsCaptionAutoFit } from "@/lib/previewLyricsCaptionAutoFit";
import {
  PREVIEW_ASPECT_OPTIONS,
  PREVIEW_MEDIA_LAYER_CONTAIN_STYLE,
  type PreviewAspectRatio,
  drawContainMediaOnCanvas,
  getPreviewAspectLayout,
  parsePreviewAspectRatio,
  syncPreviewHorizontalCaptionStyle,
} from "@/lib/previewAspectLayout";
import {
  VoiceSegmentPanel,
  MIN_LYRICS_FOR_AUTO_PIPELINE,
  type SegmentCompositeMode,
  type SegmentMosaicRegion,
  type SegmentBrandMaskRegion,
  type SegmentOverlayPosition,
  type SegmentMediaType,
  type SegmentModalLyricsLayout,
  type TimelineSegment,
  type VoiceSegmentPanelProjectState,
  type NameMaskPreset,
  type OverlayData,
  type VoiceSegmentPanelHandle,
} from "./VoiceSegmentPanel";
import {
  drawPrivacyBrandMaskRegionsOnCanvas,
  drawPrivacyMosaicRegionsOnCanvas,
} from "@/lib/privacyMaskCanvas";
import type { VoiceSegment } from "@/lib/vad/sileroVad";

/** 音声区間 + 歌詞割当用。start/end は秒。 */
export type Segment = {
  start: number;
  end: number;
  text: string;
};

const MD_BREAKPOINT = 768;

/** 歌詞全文の自動パイプライン開始までの入力待ち（安定性優先でやや長め） */
const AUTO_LYRICS_PIPELINE_DEBOUNCE_MS = 1200;
/** autosave 復元と同様、ref が付くまで待ってから自動パイプラインを起動する */
const AUTO_PIPELINE_PANEL_WAIT_ATTEMPTS = 50;
const AUTO_PIPELINE_PANEL_WAIT_MS = 100;
const TOOL_CREDIT_TEXT = "Created with gegenpress.app";

const SYNC_PREVIEW_ANIM_CSS = `
.sync-preview-img { max-width: 100%; max-height: 100%; width: auto; height: auto; object-fit: contain; display: block; margin: 0 auto; }
.sync-preview-img.anim-fade { animation: sync-fade 0.4s ease-out forwards; }
.sync-preview-img.anim-slideR2L { animation: sync-slideR2L 0.4s ease-out forwards; }
.sync-preview-img.anim-slideL2R { animation: sync-slideL2R 0.4s ease-out forwards; }
.sync-preview-img.anim-zoomIn { animation: sync-zoomIn 0.4s ease-out forwards; }
@keyframes sync-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes sync-slideR2L { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes sync-slideL2R { from { transform: translateX(-100%); } to { transform: translateX(0); } }
@keyframes sync-zoomIn { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
`.trim();

const LYRICS_FULL_TEXTAREA_CSS = `
  .lyrics-full-textarea {
    box-sizing: border-box;
    border: 2px solid #2563eb;
    background: #f0f6ff;
    border-radius: 12px;
    padding: 16px;
    outline: none;
    transition: border-color 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease;
  }
  .lyrics-full-textarea:hover:not(:disabled) {
    border-color: #1d4ed8;
    background: #e8f0fe;
  }
  .lyrics-full-textarea:focus {
    border: 2px solid #1d4ed8;
    background: #ffffff;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.22);
  }
  .lyrics-full-textarea:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }
`;

type Video = {
  id: number;
  url: string;
  originalName: string;
  /** アップロード時のバイト数（API 拡張前のキャッシュでは欠ける場合あり） */
  size?: number;
  createdAt?: string;
};

type LyricLine = {
  id: number;
  index: number;
  text: string;
  startSec: number | null;
  endSec: number | null;
};

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`API ${url} failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    const t = await res.text();
    throw new Error(`Non-JSON response: ${ct} ${t.slice(0, 200)}`);
  }
  return res.json();
}

function clampNonNegative(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n);
}

/**
 * 音声を含めるときは WebM+Opus を優先（環境によって mp4 録画が映像のみになることがある）
 */
function pickMediaRecorderMimeType(wantsAudio: boolean): { mimeType: string; ext: "mp4" | "webm" } {
  const withAudio: Array<{ mimeType: string; ext: "mp4" | "webm" }> = [
    { mimeType: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mimeType: "video/webm;codecs=vp8,opus", ext: "webm" },
    { mimeType: "video/webm", ext: "webm" },
    { mimeType: "video/mp4;codecs=h264,aac", ext: "mp4" },
    { mimeType: "video/mp4", ext: "mp4" },
  ];
  const videoOnly: Array<{ mimeType: string; ext: "mp4" | "webm" }> = [
    { mimeType: "video/mp4;codecs=h264,aac", ext: "mp4" },
    { mimeType: "video/mp4", ext: "mp4" },
    { mimeType: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mimeType: "video/webm;codecs=vp8,opus", ext: "webm" },
    { mimeType: "video/webm", ext: "webm" },
  ];
  const candidates = wantsAudio ? withAudio : videoOnly;
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return { mimeType: "", ext: "webm" };
}

function sleepMs(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

/** 素材動画の音声をタイムライン区間どおりにつなぎ、書き出し長さの AudioBuffer を作る（サンプルレートは outSr に合わせて補間） */
async function buildExportTimelineAudioBuffer(
  materialUrl: string,
  segments: TimelineSegment[],
  audioCtx: AudioContext
): Promise<AudioBuffer | null> {
  try {
    const res = await fetch(materialUrl, { mode: "cors", credentials: "same-origin" });
    if (!res.ok) throw new Error(`fetch ${res.status}`);
    const raw = await res.arrayBuffer();
    const decoded = await audioCtx.decodeAudioData(raw.slice(0));
    const srcSr = decoded.sampleRate;
    const nCh = decoded.numberOfChannels;
    const outSr = audioCtx.sampleRate;
    const durs = segments.map((seg) => Math.max(0.05, seg.endSec - seg.startSec));
    const totalSec = durs.reduce((a, b) => a + b, 0);
    const outLen = Math.max(1, Math.ceil(totalSec * outSr));
    const out = audioCtx.createBuffer(nCh, outLen, outSr);
    let dstAt = 0;
    for (let si = 0; si < segments.length; si++) {
      const seg = segments[si]!;
      const durationSec = durs[si]!;
      const srcStartSec = seg.startSec;
      const segmentOutSamples = Math.floor(durationSec * outSr);
      for (let ch = 0; ch < nCh; ch++) {
        const srcData = decoded.getChannelData(ch);
        const dstData = out.getChannelData(ch);
        const srcStartSample = Math.max(0, Math.floor(srcStartSec * srcSr));
        for (let i = 0; i < segmentOutSamples && dstAt + i < dstData.length; i++) {
          const srcPos = srcStartSample + (i * srcSr) / outSr;
          const i0 = Math.floor(srcPos);
          const frac = srcPos - i0;
          const i1 = Math.min(i0 + 1, srcData.length - 1);
          const v =
            i0 >= 0 && i0 < srcData.length
              ? srcData[i0]! * (1 - frac) + (i1 > i0 ? srcData[i1]! * frac : 0)
              : 0;
          dstData[dstAt + i] = Number.isFinite(v) ? v : 0;
        }
      }
      dstAt += segmentOutSamples;
    }
    return out;
  } catch (e) {
    console.warn("[export] buildExportTimelineAudioBuffer failed", e);
    return null;
  }
}

function resolveExportSegmentAtTime(
  t: number,
  segments: TimelineSegment[],
  durs: number[]
): { index: number; secInSeg: number } {
  const total = durs.reduce((a, b) => a + b, 0);
  const td = Math.min(Math.max(0, t), Math.max(0, total - 1e-6));
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const d = durs[i]!;
    if (td < acc + d || i === segments.length - 1) {
      return { index: i, secInSeg: Math.min(Math.max(0, td - acc), Math.max(0, d - 1e-4)) };
    }
    acc += d;
  }
  return { index: Math.max(0, segments.length - 1), secInSeg: 0 };
}

function clampExportMosaicScalar(n: unknown, lo: number, hi: number, fallback: number): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(hi, Math.max(lo, x));
}

/** 書き出し用: プロジェクト JSON のモザイク行を正規化 */
function normalizeExportMosaicRegions(raw: unknown): SegmentMosaicRegion[] {
  if (!Array.isArray(raw)) return [];
  const out: SegmentMosaicRegion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const legacyBlur = clampExportMosaicScalar(o.blurPx, 0, 48, 12);
    const pixelFromLegacy = Math.round(5 + (legacyBlur / 48) * 35);
    const pixelSize =
      o.pixelSize !== undefined
        ? clampExportMosaicScalar(o.pixelSize, 5, 40, 14)
        : pixelFromLegacy;
    out.push({
      id: typeof o.id === "string" && o.id.trim() !== "" ? o.id : `m${out.length}`,
      xPct: clampExportMosaicScalar(o.xPct, 0, 100, 42),
      yPct: clampExportMosaicScalar(o.yPct, 0, 100, 45),
      wPct: clampExportMosaicScalar(o.wPct, 5, 100, 16),
      hPct: clampExportMosaicScalar(o.hPct, 5, 100, 10),
      opacity: clampExportMosaicScalar(o.opacity, 0, 1, 0.25),
      pixelSize,
    });
  }
  return out;
}

function normalizeExportBrandMaskRegions(raw: unknown): SegmentBrandMaskRegion[] {
  if (!Array.isArray(raw)) return [];
  const out: SegmentBrandMaskRegion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    out.push({
      id: typeof o.id === "string" && o.id.trim() !== "" ? o.id : `b${out.length}`,
      xPct: clampExportMosaicScalar(o.xPct, 0, 100, 22),
      yPct: clampExportMosaicScalar(o.yPct, 0, 100, 41),
      wPct: clampExportMosaicScalar(o.wPct, 5, 100, 56),
      hPct: clampExportMosaicScalar(o.hPct, 5, 100, 18),
      opacity: clampExportMosaicScalar(o.opacity, 0, 1, 1),
    });
  }
  return out;
}

type ExportSegmentFrameCache = {
  segIndex: number;
  durationSec: number;
  seg: TimelineSegment;
  mediaType: SegmentMediaType;
  objectFit: "cover" | "contain";
  mode: SegmentModalLyricsLayout;
  displayLines: string[];
  lyricsFontPx: number;
  lyricsColorHex: string;
  overlayEnabled: boolean;
  overlayMode: SegmentCompositeMode;
  overlayOpacity: number;
  overlayScaleX: number;
  overlayScaleY: number;
  overlayPos: SegmentOverlayPosition;
  overlayX: number;
  overlayY: number;
  textX: number;
  textY: number;
  bgImage: HTMLImageElement | null;
  bgSegmentVideo: HTMLVideoElement | null;
  mosaicRegions?: SegmentMosaicRegion[];
  brandMaskRegions?: SegmentBrandMaskRegion[];
  /** 名前欄プリセット（手動ミニ合成とは独立） */
  nameMaskAuto?: {
    xPct: number;
    yPct: number;
    wPct: number;
    hPct: number;
    mode: NameMaskPreset["defaultMode"];
    mosaicPixelSize: number;
    mosaicOpacity: number;
    brandOpacity: number;
  };
}

function exportNameMaskAppliesToSegment(
  segIndex: number,
  nmp: NameMaskPreset | undefined,
  timelineLen: number
): boolean {
  if (!nmp?.enabled) return false;
  if (nmp.applyScope === "all") return true;
  const maxIdx = Math.max(0, timelineLen - 1);
  const target = Math.min(Math.max(0, nmp.applySegmentIndex), maxIdx);
  return segIndex === target;
}

async function drawExportVideoFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cache: ExportSegmentFrameCache,
  secInSeg: number,
  isLastTimelineSegment: boolean,
  videoEl: HTMLVideoElement,
  aspectRatio: PreviewAspectRatio
): Promise<void> {
  const seg = cache.seg;
  const durationSec = cache.durationSec;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  if (cache.mediaType === "video" && cache.bgSegmentVideo && cache.bgSegmentVideo.videoWidth > 0) {
    const v = cache.bgSegmentVideo;
    const t = Math.min(Math.max(0, secInSeg), Math.max(0, v.duration - 0.05));
    if (Math.abs(v.currentTime - t) > 0.03) {
      v.currentTime = t;
      await new Promise<void>((resolve) => {
        v.onseeked = () => resolve();
        setTimeout(resolve, 80);
      });
    }
    drawContainMediaOnCanvas(ctx, v, width, height);
  } else if (cache.mediaType === "image" && cache.bgImage) {
    drawContainMediaOnCanvas(ctx, cache.bgImage, width, height);
  } else if (videoEl.videoWidth > 0) {
    const t = Math.min(
      Math.max(0, seg.startSec + secInSeg),
      Math.max(0, (videoEl.duration || seg.endSec) - 0.05)
    );
    if (Math.abs(videoEl.currentTime - t) > 0.03) {
      videoEl.currentTime = t;
      await new Promise<void>((resolve) => {
        videoEl.onseeked = () => resolve();
        setTimeout(resolve, 80);
      });
    }
    drawContainMediaOnCanvas(ctx, videoEl, width, height);
  }

  if (cache.overlayEnabled && cache.overlayMode === "mosaic" && cache.mosaicRegions && cache.mosaicRegions.length > 0) {
    drawPrivacyMosaicRegionsOnCanvas(ctx, width, height, cache.mosaicRegions);
  }

  if (
    cache.overlayEnabled &&
    cache.overlayMode === "blackMaskWithBrand" &&
    cache.brandMaskRegions &&
    cache.brandMaskRegions.length > 0
  ) {
    drawPrivacyBrandMaskRegionsOnCanvas(ctx, width, height, cache.brandMaskRegions);
  }

  if (cache.nameMaskAuto) {
    const a = cache.nameMaskAuto;
    if (a.mode === "mosaic") {
      drawPrivacyMosaicRegionsOnCanvas(ctx, width, height, [
        {
          xPct: a.xPct,
          yPct: a.yPct,
          wPct: a.wPct,
          hPct: a.hPct,
          pixelSize: a.mosaicPixelSize,
          opacity: a.mosaicOpacity,
        },
      ]);
    } else {
      drawPrivacyBrandMaskRegionsOnCanvas(ctx, width, height, [
        {
          xPct: a.xPct,
          yPct: a.yPct,
          wPct: a.wPct,
          hPct: a.hPct,
          opacity: a.brandOpacity,
        },
      ]);
    }
  }

  if (cache.displayLines.length > 0) {
    drawLyricsCaptionOnExportCanvas(ctx, {
      canvasWidth: width,
      canvasHeight: height,
      layoutMode: cache.mode,
      displayLines: cache.displayLines,
      textOffsetX: cache.textX,
      textOffsetY: cache.textY,
      uiBaseFontPx: cache.lyricsFontPx,
      lyricsColorHex: cache.lyricsColorHex,
      exportAspect: aspectRatio,
    });
  }

  const secondsUntilSegmentEnd = durationSec - secInSeg;
  drawBrandEndCard(
    ctx,
    width,
    height,
    TOOL_CREDIT_TEXT,
    isLastTimelineSegment,
    secondsUntilSegmentEnd
  );
}

function ToolCreditCaption() {
  return (
    <div
      style={{
        marginTop: 8,
        textAlign: "center",
        fontSize: 12,
        lineHeight: 1.4,
        color: "#777",
        wordBreak: "break-word",
      }}
    >
      {TOOL_CREDIT_TEXT}
    </div>
  );
}

/** 歌詞同期ツールバー: 青の主ボタン＋下に補助文（一般ユーザー向け） */
const SYNC_TOOLBAR_PRIMARY_BTN_CSS = `
  .sync-toolbar-primary-btn {
    padding: 10px 14px;
    font-size: 14px;
    font-weight: 600;
    line-height: 1.25;
    background: #2563eb;
    color: #fff;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    text-align: center;
    width: 100%;
    box-sizing: border-box;
  }
  .sync-toolbar-primary-btn:hover:not(:disabled) {
    background: #1d4ed8;
  }
  .sync-toolbar-primary-btn:focus-visible {
    outline: 2px solid #93c5fd;
    outline-offset: 2px;
  }
  .sync-toolbar-primary-btn:disabled {
    background: #94a3b8;
    color: #f1f5f9;
    cursor: not-allowed;
  }
  .sync-toolbar-primary-btn--compact {
    padding: 8px 12px;
    font-size: 14px;
    width: auto;
    min-width: 72px;
  }
`;

function ToolbarPrimaryAction({
  buttonText,
  buttonTextBusy,
  busy,
  helperText,
  onClick,
  disabled,
  title,
}: {
  buttonText: string;
  helperText: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  busy?: boolean;
  buttonTextBusy?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        alignItems: "stretch",
        flex: "1 1 160px",
        maxWidth: 300,
        minWidth: 148,
      }}
    >
      <button
        type="button"
        className="sync-toolbar-primary-btn"
        onClick={onClick}
        disabled={disabled}
        title={title}
      >
        {busy && buttonTextBusy ? buttonTextBusy : buttonText}
      </button>
      <span style={{ fontSize: 11, color: "#64748b", lineHeight: 1.45 }}>{helperText}</span>
    </div>
  );
}

/** play() の Promise を扱い、AbortError（pause 等で割り込まれた場合）は握りつぶして UI を落とさない */
function safePlay(el: HTMLVideoElement | null | undefined): void {
  el?.play()?.catch((err: unknown) => {
    if (err instanceof Error && err.name === "AbortError") return;
    console.error("video play error", err);
  });
}

/** デコーダ状態を捨て、必要なら同じ URL を載せ直す（書き出し開始時・素材切替の取りこぼし対策） */
function hardResetVideoSrc(el: HTMLVideoElement | null | undefined, nextUrl: string) {
  if (!el) return;
  try {
    el.pause();
    el.removeAttribute("src");
    el.load();
    if (nextUrl) {
      el.src = nextUrl;
      el.load();
    }
  } catch {
    /* ignore */
  }
}

function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function useVideoAndLyrics(videoId: number) {
  const [video, setVideo] = useState<Video | null>(null);
  const [lines, setLines] = useState<LyricLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [vJson, lJson] = (await Promise.all([
        fetchJson(`/api/videos/${videoId}`),
        fetchJson(`/api/videos/${videoId}/lyrics`),
      ])) as [{ ok?: boolean; video?: Video; message?: string }, { ok?: boolean; lines?: LyricLine[]; message?: string }];
      if (!vJson?.ok) {
        setError(vJson?.message ?? "動画の取得に失敗しました");
        return;
      }
      if (!lJson?.ok) {
        setError(lJson?.message ?? "歌詞の取得に失敗しました");
        return;
      }
      setVideo(vJson.video ?? null);
      setLines(lJson.lines ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込み中にエラーが発生しました");
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  useEffect(() => {
    load();
  }, [load]);

  return { video, lines, setLines, loading, error, reload: load };
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MD_BREAKPOINT - 1}px)`);
    setIsMobile(mq.matches);
    const handler = () => setIsMobile(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

type LyricsSyncClientProps = {
  videoId?: number;
  initialLines?: LyricLine[];
};

type LocalProjectFile = {
  version: 1;
  savedAt: string;
  updatedAt?: number;
  videoId?: number;
  /** 表示・書き出し共通のアスペクト比 */
  previewAspectRatio?: PreviewAspectRatio;
  baseVideoRef?: {
    source: "server" | "local-mp4";
    url?: string;
    name?: string;
    size?: number;
    lastModified?: number;
  };
  lyricsText: string;
  panelState: VoiceSegmentPanelProjectState;
};

type AutosaveFile = {
  version: 1;
  updatedAt: number;
  videoId?: number;
  lyricsText: string;
  panelState: VoiceSegmentPanelProjectState;
  previewAspectRatio?: PreviewAspectRatio;
  /** 同一素材の再アップロード検出用（filename + size + duration） */
  sourceVideoKey?: string;
  sourceVideoMeta?: SourceVideoMeta;
};

function resolveUpdatedAtFromProjectJson(json: Partial<LocalProjectFile>): number {
  if (typeof json.updatedAt === "number" && Number.isFinite(json.updatedAt)) {
    return json.updatedAt;
  }
  if (typeof json.savedAt === "string") {
    const parsed = Date.parse(json.savedAt);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function buildClientSourceVideoExtras(
  video: Video | null,
  localMaterial: { name: string; size: number } | null,
  durationSec: number | null
): { sourceVideoKey: string; sourceVideoMeta: SourceVideoMeta } | undefined {
  const draft = localMaterial
    ? buildSourceVideoMetaForDraft({
        originalName: localMaterial.name,
        size: localMaterial.size,
        durationSec,
      })
    : video != null && typeof video.size === "number"
      ? buildSourceVideoMetaForDraft({
          originalName: video.originalName,
          size: video.size,
          durationSec,
        })
      : null;
  if (!draft) return undefined;
  const sourceVideoMeta = finalizeSourceVideoMeta(draft);
  return {
    sourceVideoKey: buildSourceVideoKey(sourceVideoMeta),
    sourceVideoMeta,
  };
}

type CrossResumeCandidate = {
  raw: string;
  updatedAt: number;
  displayOriginalName: string;
  fromVideoId: number;
};

export function LyricsSyncClient({ videoId = 0, initialLines = [] }: LyricsSyncClientProps) {
  const { t, locale, setLocale, localeOptions } = useUiLocale();
  const lyricsFullPlaceholder = useMemo(() => t("lyricsPlaceholder"), [t]);
  const { video, lines: fetchedLines, setLines, loading, error, reload } = useVideoAndLyrics(videoId);
  const safeLines = Array.isArray(fetchedLines) ? fetchedLines : (Array.isArray(initialLines) ? initialLines : []);
  const isMobile = useIsMobile();
  // ----- フル再生用 refs・state -----
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const syncPreviewVideoRef = useRef<HTMLVideoElement | null>(null);
  const syncPreviewStageRef = useRef<HTMLDivElement | null>(null);
  const videoTimeSyncLockRef = useRef(false);
  const lastActivePlayerRef = useRef<"main" | "sync">("main");
  const [nowSec, setNowSec] = useState<number>(0);
  const [lyricsText, setLyricsText] = useState("");
  const [activeLineId, setActiveLineId] = useState<number | null>(safeLines[0]?.id ?? null);
  /** 旧「歌詞取り込み」UI用（importLyrics） */
  const [isImporting, setIsImporting] = useState(false);
  const [savingLineIds, setSavingLineIds] = useState<Set<number>>(new Set());
  const [apiError, setApiError] = useState<string | null>(null);
  const [overlays, setOverlays] = useState<OverlayData[]>([]);
  /** タイムラインあり時の同期プレビュー歌詞。VoiceSegmentPanel の localSegmentText のみを反映（activeOverlay テキストと混在しない） */
  const [panelSyncCaptionText, setPanelSyncCaptionText] = useState("");
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [mobileAdjustTarget, setMobileAdjustTarget] = useState<"start" | "end">("start");
  const [listOpen, setListOpen] = useState(false);
  const [voiceSegments, setVoiceSegments] = useState<VoiceSegment[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  /** サーバ歌詞行を、パネルから onVoiceSegmentsChange が来る前の初期表示・保存用に同期 */
  useEffect(() => {
    if (safeLines.length === 0) return;
    setSegments((prev) => {
      if (prev.length > 0) return prev;
      return safeLines.map((l) => ({
        start: clampNonNegative(toNumberOrNull(l.startSec) ?? 0),
        end: clampNonNegative(toNumberOrNull(l.endSec) ?? 0),
        text: l.text ?? "",
      }));
    });
  }, [safeLines]);
  const [isSavingSegments, setIsSavingSegments] = useState(false);
  /** 区間再生開始時にインクリメントし overlay の演出アニメーションを再発火 */
  const [segmentPlayTrigger, setSegmentPlayTrigger] = useState(0);
  /**
   * 「全文から一括生成」手動ボタンのみ VoiceSegmentPanel に渡す（歌詞入力のたびに id:0 のオブジェクトを渡さない）。
   * id は 1 始まり。autosave の依存にも使う。
   */
  const manualApplyFullTextSeqRef = useRef(0);
  const [applyManualFullTextSource, setApplyManualFullTextSource] = useState<
    { text: string; id: number } | undefined
  >(undefined);
  /** 一括生成完了時のフィードバック表示 */
  const [applyFeedback, setApplyFeedback] = useState<string | null>(null);
  const [isAutosaving, setIsAutosaving] = useState(false);
  const [lastAutosavedAt, setLastAutosavedAt] = useState<number | null>(null);
  const [forceJsonLoaded, setForceJsonLoaded] = useState(false);
  /** 別 videoId に保存された同一素材 autosave（ユーザーが「続きから再開」したときだけ復元） */
  const [crossResumeCandidate, setCrossResumeCandidate] = useState<CrossResumeCandidate | null>(null);
  /** 歌詞全文の自動パイプライン実行中（UI表示用） */
  const [isAutoGenerating, setIsAutoGenerating] = useState(false);
  /** 自動パイプラインのエラー表示 */
  const [autoGenerationError, setAutoGenerationError] = useState<string | null>(null);
  /** VoiceSegmentPanel の単一 async パイプライン呼び出し用 */
  const segmentPanelRef = useRef<VoiceSegmentPanelHandle>(null);
  const projectFileInputRef = useRef<HTMLInputElement | null>(null);
  const materialMp4InputRef = useRef<HTMLInputElement | null>(null);
  const [localMaterialVideo, setLocalMaterialVideo] = useState<{
    url: string;
    name: string;
    size: number;
    lastModified: number;
  } | null>(null);
  const [isExportingVideo, setIsExportingVideo] = useState(false);
  const [exportVideoMessage, setExportVideoMessage] = useState<string | null>(null);
  const [previewAspectRatio, setPreviewAspectRatio] = useState<PreviewAspectRatio>("landscape");
  /** VoiceSegmentPanel 内のみの変更でも autosave useEffect を起こす */
  const [panelAutosaveTick, setPanelAutosaveTick] = useState(0);
  const autosaveTimerRef = useRef<number | null>(null);
  const autosaveRestoredRef = useRef<number | null>(null);
  const autosaveAppliedRef = useRef<string>("");
  /** 書き出し二重起動防止（setState は非同期のため ref で同期ガード） */
  const exportVideoInProgressRef = useRef(false);
  /** 入力デバウンス世代（新しい入力で直前の待ちを無効化） */
  const autoPipelineScheduleSeqRef = useRef(0);
  /** 自動パイプラインで最後に成功した歌詞全文（同一文で再実行しない） */
  const lastAutoGeneratedLyricsRef = useRef<string | null>(null);
  /** debounce タイマー内で最新の歌詞を読む */
  const lyricsTextRef = useRef(lyricsText);
  lyricsTextRef.current = lyricsText;
  /** 行プレビューモーダル表示中（親で保持し、プレビュー中は編集UIを一切マウントしない） */
  const [previewRowIndex, setPreviewRowIndex] = useState<number | null>(null);
  const previewOpen = previewRowIndex != null;
  const previewOpenRef = useRef(previewOpen);
  previewOpenRef.current = previewOpen;
  /** 同期ページ: 「動画（フル再生）」セクションの開閉（モーダル用 previewOpen とは別） */
  const [isFullPlayerOpen, setIsFullPlayerOpen] = useState(true);
  /** 同期ページ: 「プレビュー（同期表示）」セクションの開閉（既定で開き、左カラムと併用しやすくする） */
  const [isPreviewOpen, setIsPreviewOpen] = useState(true);
  /** 同期ページ: 「音声区間」セクションの開閉 */
  const [isAudioSectionsOpen, setIsAudioSectionsOpen] = useState(false);
  /** 初回マウント完了まで true にならない。これにより初回フレームで editor/preview が同時に出るのを防ぐ */
  const isHydrated = useIsHydrated();
  const currentVideoUrl = localMaterialVideo?.url ?? video?.url ?? "";
  const aspectLayout = useMemo(() => getPreviewAspectLayout(previewAspectRatio), [previewAspectRatio]);
  const bumpPanelAutosaveTick = useCallback(() => {
    setPanelAutosaveTick((t) => t + 1);
  }, []);

  const activeIndex = useMemo(() => {
    if (activeLineId == null) return -1;
    return safeLines.findIndex((l) => l.id === activeLineId);
  }, [activeLineId, safeLines]);

  const activeLine = activeIndex >= 0 ? safeLines[activeIndex] ?? null : null;

  // ----- フル再生用: 2つの video 要素の currentTime を同期して nowSec を更新 -----
  const setBothVideosTime = useCallback(
    (sec: number) => {
      const main = videoRef.current;
      const syncEl = syncPreviewVideoRef.current;
      const dur =
        videoDuration ??
        (main?.duration && Number.isFinite(main.duration) ? main.duration : null);
      const s = dur != null && dur > 0 ? Math.max(0, Math.min(sec, dur)) : Math.max(0, sec);
      videoTimeSyncLockRef.current = true;
      try {
        if (main) main.currentTime = s;
        if (syncEl) syncEl.currentTime = s;
      } finally {
        requestAnimationFrame(() => {
          videoTimeSyncLockRef.current = false;
        });
      }
      setNowSec(s);
    },
    [videoDuration]
  );

  /** フル再生: 再生バー・VoiceSegmentPanel から呼ばれる。メイン再生、sync は停止 */
  const handlePanelVideoPlay = useCallback(() => {
    lastActivePlayerRef.current = "main";
    syncPreviewVideoRef.current?.pause();
    safePlay(videoRef.current);
  }, []);

  /** フル再生: 両方の video を停止 */
  const handlePanelVideoPause = useCallback(() => {
    videoRef.current?.pause();
  }, []);

  /** フル再生: 相対シーク（±delta 秒） */
  const handlePanelVideoSeekDelta = useCallback(
    (delta: number) => {
      const main = videoRef.current;
      const syncEl = syncPreviewVideoRef.current;
      const base =
        lastActivePlayerRef.current === "sync" && syncEl
          ? syncEl.currentTime ?? 0
          : main?.currentTime ?? 0;
      setBothVideosTime(base + delta);
    },
    [setBothVideosTime]
  );

  /** フル再生: 指定秒へ絶対シーク */
  const handlePanelSeekToSec = useCallback(
    (sec: number) => {
      setBothVideosTime(sec);
    },
    [setBothVideosTime]
  );

  /** 区間再生: 演出アニメーション再発火用トリガー。VoiceSegmentPanel の区間再生開始時に呼ばれる */
  const handleSegmentPlayStartStable = useCallback(() => {
    setSegmentPlayTrigger((t) => t + 1);
  }, []);

  /** フル再生: メイン video の onPlay。sync を止めてメインを再生元に */
  const handleMainVideoPlay = useCallback(() => {
    lastActivePlayerRef.current = "main";
    syncPreviewVideoRef.current?.pause();
  }, []);

  /** フル再生: メイン video の onSeeked。nowSec と sync の currentTime を同期 */
  const handleMainVideoSeeked = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    lastActivePlayerRef.current = "main";
    const t = el.currentTime || 0;
    setNowSec(t);
    if (videoTimeSyncLockRef.current) return;
    const syn = syncPreviewVideoRef.current;
    if (syn && Math.abs(syn.currentTime - t) > 0.05) {
      videoTimeSyncLockRef.current = true;
      syn.currentTime = t;
      requestAnimationFrame(() => {
        videoTimeSyncLockRef.current = false;
      });
    }
  }, []);

  /** フル再生: sync preview video の onPlay。メインを止めて sync を再生元に */
  const handleSyncVideoPlay = useCallback(() => {
    lastActivePlayerRef.current = "sync";
    videoRef.current?.pause();
  }, []);

  /** フル再生: sync preview video の onSeeked。nowSec とメインの currentTime を同期 */
  const handleSyncVideoSeeked = useCallback(() => {
    const el = syncPreviewVideoRef.current;
    if (!el) return;
    lastActivePlayerRef.current = "sync";
    const t = el.currentTime || 0;
    setNowSec(t);
    if (videoTimeSyncLockRef.current) return;
    const main = videoRef.current;
    if (main && Math.abs(main.currentTime - t) > 0.05) {
      videoTimeSyncLockRef.current = true;
      main.currentTime = t;
      requestAnimationFrame(() => {
        videoTimeSyncLockRef.current = false;
      });
    }
  }, []);

  /** 歌詞行: nowSec が含まれる行のインデックス（再生中ハイライト用） */
  const playbackLineIndex = useMemo(() => {
    const start = (l: LyricLine) => toNumberOrNull(l.startSec) ?? 0;
    const end = (l: LyricLine) => toNumberOrNull(l.endSec) ?? Infinity;
    return safeLines.findIndex((l) => nowSec >= start(l) && nowSec < end(l));
  }, [safeLines, nowSec]);

  /** 歌詞行: 行クリック時にその開始位置へシークしてフル再生 */
  const seekToLineAndPlay = useCallback(
    (line: LyricLine) => {
      const el = videoRef.current;
      if (!el) return;
      const sec = toNumberOrNull(line.startSec) ?? 0;
      setBothVideosTime(clampNonNegative(sec));
      lastActivePlayerRef.current = "main";
      syncPreviewVideoRef.current?.pause();
      safePlay(el);
      setActiveLineId(line.id);
    },
    [setBothVideosTime]
  );

  useEffect(() => {
    if (safeLines.length > 0 && activeLineId == null) setActiveLineId(safeLines[0]?.id ?? null);
  }, [safeLines.length, activeLineId]);

  const localMaterialBlobUrl = localMaterialVideo?.url ?? null;
  useEffect(() => {
    return () => {
      if (localMaterialBlobUrl?.startsWith("blob:")) {
        URL.revokeObjectURL(localMaterialBlobUrl);
      }
    };
  }, [localMaterialBlobUrl]);

  /**
   * 歌詞全文が有効になったら、デバウンス後に VoiceSegmentPanel の
   * runAutoLyricPipeline（1本の async）を1回だけ起動する。
   * state の連鎖 useEffect は使わない。
   */
  useEffect(() => {
    if (!isHydrated || previewOpen) return;

    const trimmed = lyricsText.trim();
    if (!trimmed || trimmed.length < MIN_LYRICS_FOR_AUTO_PIPELINE) {
      setAutoGenerationError(null);
      setIsAutoGenerating(false);
      return;
    }
    if (trimmed === lastAutoGeneratedLyricsRef.current) return;

    const mySeq = ++autoPipelineScheduleSeqRef.current;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (mySeq !== autoPipelineScheduleSeqRef.current) return;

        const text = lyricsTextRef.current.trim();
        if (text.length < MIN_LYRICS_FOR_AUTO_PIPELINE) return;
        if (text === lastAutoGeneratedLyricsRef.current) return;
        if (previewOpenRef.current) return;

        setAutoGenerationError(null);
        setIsAutoGenerating(true);
        try {
          let panel: VoiceSegmentPanelHandle | null = null;
          for (let attempt = 0; attempt < AUTO_PIPELINE_PANEL_WAIT_ATTEMPTS; attempt++) {
            if (mySeq !== autoPipelineScheduleSeqRef.current) return;
            if (previewOpenRef.current) return;
            panel = segmentPanelRef.current;
            if (panel) break;
            await new Promise((r) => window.setTimeout(r, AUTO_PIPELINE_PANEL_WAIT_MS));
          }
          if (!panel) {
            setAutoGenerationError(t("autoGenerationFailed"));
            return;
          }
          if (mySeq !== autoPipelineScheduleSeqRef.current) return;
          if (previewOpenRef.current) return;
          const r = await panel.runAutoLyricPipeline(text);
          if (mySeq !== autoPipelineScheduleSeqRef.current) return;
          if (r.ok) {
            lastAutoGeneratedLyricsRef.current = text;
            const parts: string[] = [];
            if ((r.phraseCount ?? 0) > 0) parts.push(`${t("phraseQueue")} ${r.phraseCount}`);
            if ((r.imageCount ?? 0) > 0) parts.push(`${t("imageCandidatesHeading")} ${r.imageCount}`);
            setApplyFeedback(
              parts.length > 0
                ? t("feedbackAutoDone").replace("{parts}", parts.join(" / "))
                : t("feedbackAutoPipelineComplete")
            );
            setTimeout(() => setApplyFeedback(null), 4000);
          } else {
            setAutoGenerationError(t("autoGenerationFailed"));
          }
        } catch {
          if (mySeq === autoPipelineScheduleSeqRef.current) {
            setAutoGenerationError(t("autoGenerationFailed"));
          }
        } finally {
          if (mySeq === autoPipelineScheduleSeqRef.current) {
            setIsAutoGenerating(false);
          }
        }
      })();
    }, AUTO_LYRICS_PIPELINE_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [lyricsText, isHydrated, previewOpen, t]);

  const triggerManualFullTextApply = useCallback(() => {
    const t = lyricsText.trim();
    if (!t) return;
    setApplyFeedback(null);
    setAutoGenerationError(null);
    manualApplyFullTextSeqRef.current += 1;
    const id = manualApplyFullTextSeqRef.current;
    setApplyManualFullTextSource({ text: t, id });
  }, [lyricsText]);

  const serverVideoUrl = video?.url ?? null;
  const serverVideoOriginalName = video?.originalName ?? null;

  const handleSaveProjectToLocal = useCallback(() => {
    const panel = segmentPanelRef.current;
    if (!panel) {
      window.alert("編集パネルの準備中です。少し待ってから再実行してください。");
      return;
    }
    const payload: LocalProjectFile = {
      version: 1,
      savedAt: new Date().toISOString(),
      updatedAt: Date.now(),
      videoId,
      baseVideoRef: localMaterialVideo
        ? {
            source: "local-mp4",
            name: localMaterialVideo.name,
            size: localMaterialVideo.size,
            lastModified: localMaterialVideo.lastModified,
          }
        : {
            source: "server",
            url: serverVideoUrl ?? undefined,
            name: serverVideoOriginalName ?? undefined,
          },
      lyricsText,
      previewAspectRatio,
      panelState: panel.exportProjectState(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const d = new Date();
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    a.download = `続き編集用JSON-gegenpress-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [lyricsText, videoId, serverVideoUrl, serverVideoOriginalName, localMaterialVideo, previewAspectRatio]);

  const handleProjectFileSelected = useCallback(async (file: File) => {
    const panel = segmentPanelRef.current;
    if (!panel) {
      window.alert("編集パネルの準備中です。少し待ってから再実行してください。");
      return;
    }
    const raw = await file.text();
    const json = JSON.parse(raw) as Partial<LocalProjectFile>;
    if (!json || json.version !== 1 || typeof json.lyricsText !== "string" || !json.panelState) {
      throw new Error("project.json の形式が正しくありません。");
    }
    /** 復元直後に等分割の自動パイプラインが走ると区間 start/end が上書きされるのを防ぐ */
    autoPipelineScheduleSeqRef.current += 1;
    lastAutoGeneratedLyricsRef.current = json.lyricsText.trim();
    setForceJsonLoaded(true);
    autosaveRestoredRef.current = videoId;
    const autosaveKey = `videoEditorAutosave:${videoId}`;
    const jsonUpdatedAt = resolveUpdatedAtFromProjectJson(json) || Date.now();
    setLyricsText(json.lyricsText);
    setPreviewAspectRatio(parsePreviewAspectRatio(json.previewAspectRatio));
    panel.importProjectState(json.panelState as VoiceSegmentPanelProjectState);
    const jsonSourceExtras = buildClientSourceVideoExtras(video, localMaterialVideo, videoDuration);
    const mergedAutosave: AutosaveFile = {
      version: 1,
      updatedAt: jsonUpdatedAt,
      videoId,
      lyricsText: json.lyricsText,
      previewAspectRatio: parsePreviewAspectRatio(json.previewAspectRatio),
      panelState: json.panelState as VoiceSegmentPanelProjectState,
      ...(jsonSourceExtras ?? {}),
    };
    const mergedRaw = JSON.stringify(mergedAutosave);
    localStorage.setItem(autosaveKey, mergedRaw);
    localStorage.setItem(`videoSyncAutosave:${videoId}`, mergedRaw);
    autosaveAppliedRef.current = mergedRaw;
    setLastAutosavedAt(mergedAutosave.updatedAt);
    setApplyFeedback(t("feedbackProjectLoaded"));
    setTimeout(() => setApplyFeedback(null), 3000);
  }, [videoId, video, localMaterialVideo, videoDuration, t]);

  const handleLoadProjectFromLocal = useCallback(() => {
    projectFileInputRef.current?.click();
  }, []);

  const handleLoadMp4AsMaterial = useCallback(() => {
    materialMp4InputRef.current?.click();
  }, []);

  const loadedServerVideoUrl = video?.url ?? null;

  /** 同じ videoId で再入場時: パネルがマウントされたあと localStorage の autosave を 1 回だけ復元（JSON 手動読込直後はスキップ） */
  useEffect(() => {
    if (!videoId) return;
    if (!isHydrated) return;
    if (loading) return;
    if (error || !video) return;
    if (forceJsonLoaded) return;
    if (autosaveRestoredRef.current === videoId) return;

    const key = `videoEditorAutosave:${videoId}`;
    const raw = localStorage.getItem(key);
    if (!raw) {
      autosaveRestoredRef.current = videoId;
      return;
    }

    let cancelled = false;
    const maxAttempts = 50;

    const attemptRestore = (attempt: number) => {
      if (cancelled) return;
      const panel = segmentPanelRef.current;
      if (!panel && attempt < maxAttempts) {
        window.setTimeout(() => attemptRestore(attempt + 1), 100);
        return;
      }
      if (!panel) {
        autosaveRestoredRef.current = videoId;
        return;
      }
      try {
        const data = JSON.parse(raw) as Partial<AutosaveFile>;
        if (typeof data.lyricsText === "string") {
          autoPipelineScheduleSeqRef.current += 1;
          lastAutoGeneratedLyricsRef.current = data.lyricsText.trim();
          setLyricsText(data.lyricsText);
        }
        setPreviewAspectRatio(parsePreviewAspectRatio(data.previewAspectRatio));
        if (data.panelState && typeof data.panelState === "object") {
          panel.importProjectState(data.panelState as VoiceSegmentPanelProjectState);
        }
        autosaveAppliedRef.current = raw;
        if (typeof data.updatedAt === "number" && Number.isFinite(data.updatedAt)) {
          setLastAutosavedAt(data.updatedAt);
        }
        setApplyFeedback(t("feedbackAutosaveRestored"));
        setTimeout(() => setApplyFeedback(null), 2500);
      } catch {
        console.warn("autosave restore failed");
      } finally {
        autosaveRestoredRef.current = videoId;
      }
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!cancelled) attemptRestore(0);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [videoId, forceJsonLoaded, isHydrated, loading, error, loadedServerVideoUrl, t]);

  useEffect(() => {
    setForceJsonLoaded(false);
  }, [videoId]);

  /** 別動画へ切り替えたら自動パイプラインの「同一全文はスキップ」状態をリセット */
  useEffect(() => {
    lastAutoGeneratedLyricsRef.current = null;
  }, [videoId]);

  useEffect(() => {
    manualApplyFullTextSeqRef.current = 0;
    setApplyManualFullTextSource(undefined);
  }, [videoId]);

  useEffect(() => {
    setCrossResumeCandidate(null);
  }, [videoId]);

  /**
   * 同一 videoId の autosave が無いときだけ、素材キーが一致する別動画の autosave を候補表示（自動復元はしない）。
   */
  useEffect(() => {
    if (forceJsonLoaded) {
      setCrossResumeCandidate(null);
      return;
    }
    if (!videoId || !isHydrated || loading || error || !video) {
      return;
    }
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(sessionDismissCrossResumeKey(videoId)) === "1") {
        return;
      }
    } catch {
      return;
    }
    if (videoDuration == null || videoDuration <= 0) return;

    let existing: string | null = null;
    try {
      existing = localStorage.getItem(`videoEditorAutosave:${videoId}`);
    } catch {
      return;
    }
    if (existing && existing.trim()) {
      setCrossResumeCandidate(null);
      return;
    }

    const extras = buildClientSourceVideoExtras(video, localMaterialVideo, videoDuration);
    if (!extras) return;

    const best = findBestCrossVideoResumeCandidate(
      videoId,
      extras.sourceVideoKey,
      extras.sourceVideoMeta
    );
    if (!best) {
      setCrossResumeCandidate(null);
      return;
    }

    const displayOriginalName =
      best.data.sourceVideoMeta?.originalName?.trim() || `動画 #${best.fromVideoId}`;

    setCrossResumeCandidate({
      raw: best.raw,
      updatedAt: best.updatedAt,
      displayOriginalName,
      fromVideoId: best.fromVideoId,
    });
  }, [
    videoId,
    isHydrated,
    loading,
    error,
    video,
    forceJsonLoaded,
    videoDuration,
    localMaterialVideo,
  ]);

  useEffect(() => {
    if (!videoId) return;
    const panel = segmentPanelRef.current;
    if (!panel) return;
    if (autosaveTimerRef.current != null) window.clearTimeout(autosaveTimerRef.current);
    setIsAutosaving(true);
    autosaveTimerRef.current = window.setTimeout(() => {
      const latestPanel = segmentPanelRef.current;
      if (!latestPanel) {
        setIsAutosaving(false);
        return;
      }
      const sourceExtras = buildClientSourceVideoExtras(video, localMaterialVideo, videoDuration);
      const payload: AutosaveFile = {
        version: 1,
        updatedAt: Date.now(),
        videoId,
        lyricsText,
        previewAspectRatio,
        panelState: latestPanel.exportProjectState(),
        ...(sourceExtras ?? {}),
      };
      const raw = JSON.stringify(payload);
      if (raw !== autosaveAppliedRef.current) {
        const key = `videoEditorAutosave:${videoId}`;
        localStorage.setItem(key, raw);
        // 管理ログ集計側との互換キー（既存運用向け）
        localStorage.setItem(`videoSyncAutosave:${videoId}`, raw);
        autosaveAppliedRef.current = raw;
        setLastAutosavedAt(payload.updatedAt);
      }
      setIsAutosaving(false);
    }, 1000);
    return () => {
      if (autosaveTimerRef.current != null) {
        window.clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [
    videoId,
    lyricsText,
    overlays,
    segments,
    voiceSegments,
    applyManualFullTextSource?.id ?? 0,
    previewAspectRatio,
    panelAutosaveTick,
    video,
    localMaterialVideo,
    videoDuration,
  ]);

  const handleCrossResumeDismiss = useCallback(() => {
    setCrossResumeCandidate(null);
    try {
      sessionStorage.setItem(sessionDismissCrossResumeKey(videoId), "1");
    } catch {
      /* ignore */
    }
  }, [videoId]);

  const handleCrossResumeRestore = useCallback(() => {
    const panel = segmentPanelRef.current;
    if (!panel || !crossResumeCandidate) return;
    const extras = buildClientSourceVideoExtras(video, localMaterialVideo, videoDuration);
    if (!extras) {
      window.alert("動画の長さがまだ確定していません。少し待ってから再度お試しください。");
      return;
    }
    try {
      const data = JSON.parse(crossResumeCandidate.raw) as Partial<AutosaveFile>;
      if (typeof data.lyricsText !== "string" || !data.panelState || typeof data.panelState !== "object") {
        window.alert("保存データの形式が正しくありません。");
        return;
      }
      autoPipelineScheduleSeqRef.current += 1;
      lastAutoGeneratedLyricsRef.current = data.lyricsText.trim();
      setLyricsText(data.lyricsText);
      setPreviewAspectRatio(parsePreviewAspectRatio(data.previewAspectRatio));
      panel.importProjectState(data.panelState as VoiceSegmentPanelProjectState);

      const payload: AutosaveFile = {
        version: 1,
        updatedAt: Date.now(),
        videoId,
        lyricsText: data.lyricsText,
        previewAspectRatio: parsePreviewAspectRatio(data.previewAspectRatio),
        panelState: data.panelState as VoiceSegmentPanelProjectState,
        sourceVideoKey: extras.sourceVideoKey,
        sourceVideoMeta: extras.sourceVideoMeta,
      };
      const rawOut = JSON.stringify(payload);
      const k = `videoEditorAutosave:${videoId}`;
      localStorage.setItem(k, rawOut);
      localStorage.setItem(`videoSyncAutosave:${videoId}`, rawOut);
      autosaveAppliedRef.current = rawOut;
      setLastAutosavedAt(payload.updatedAt);
      setCrossResumeCandidate(null);
      try {
        sessionStorage.setItem(sessionDismissCrossResumeKey(videoId), "1");
      } catch {
        /* ignore */
      }
      setApplyFeedback(t("feedbackResumeRestored"));
      setTimeout(() => setApplyFeedback(null), 3000);
    } catch {
      window.alert("復元に失敗しました。");
    }
  }, [crossResumeCandidate, video, localMaterialVideo, videoDuration, videoId, t]);

  const handleProjectInputChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.currentTarget.value = "";
      if (!file) return;
      try {
        await handleProjectFileSelected(file);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        window.alert(`プロジェクト読込に失敗しました: ${msg}`);
      }
    },
    [handleProjectFileSelected]
  );

  const handleMaterialMp4InputChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    if (!file.type.includes("mp4") && !file.name.toLowerCase().endsWith(".mp4")) {
      window.alert("mp4ファイルを選択してください。");
      return;
    }
    const nextUrl = URL.createObjectURL(file);
    setLocalMaterialVideo((prev) => {
      if (prev?.url?.startsWith("blob:")) URL.revokeObjectURL(prev.url);
      return {
        url: nextUrl,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
      };
    });
    setApplyFeedback(t("feedbackMp4Loaded").replace("{name}", file.name));
    setTimeout(() => setApplyFeedback(null), 3000);
  }, [t]);

  const handleExportVideoAsMp4 = useCallback(async () => {
    if (exportVideoInProgressRef.current) return;
    const panel = segmentPanelRef.current;
    if (!panel) {
      window.alert("編集パネルの準備中です。少し待ってから再実行してください。");
      return;
    }
    const project = panel.exportProjectState();
    if (!project.timelineSegments.length) {
      window.alert("書き出す区間がありません。");
      return;
    }
    if (!currentVideoUrl) {
      window.alert("素材動画が見つかりません。");
      return;
    }
    const hasRecorder = typeof window !== "undefined" && typeof MediaRecorder !== "undefined";
    if (!hasRecorder) {
      window.alert("このブラウザでは動画書き出しに対応していません。");
      return;
    }

    exportVideoInProgressRef.current = true;
    setIsExportingVideo(true);
    setExportVideoMessage("動画を書き出し中…");
    const materialUrl = currentVideoUrl;
    hardResetVideoSrc(videoRef.current, materialUrl);
    hardResetVideoSrc(syncPreviewVideoRef.current, materialUrl);
    try {
      const fps = 30;
      const { width, height } = aspectLayout.exportCanvas;
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setExportVideoMessage(null);
        window.alert("canvas 初期化に失敗しました。");
        return;
      }

    const imageCache = new Map<string, HTMLImageElement>();
    const getImage = async (url: string): Promise<HTMLImageElement | null> => {
      if (!url) return null;
      const cached = imageCache.get(url);
      if (cached) return cached;
      return await new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
          imageCache.set(url, img);
          resolve(img);
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
    };

    const videoEl = document.createElement("video");
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.preload = "auto";
    videoEl.src = "";
    videoEl.load();
    videoEl.src = materialUrl;
    videoEl.load();
    await new Promise<void>((resolve, reject) => {
      const onOk = () => resolve();
      const onErr = () => reject(new Error("動画素材を読み込めませんでした。"));
      videoEl.addEventListener("loadedmetadata", onOk, { once: true });
      videoEl.addEventListener("error", onErr, { once: true });
    });

    const segmentVideoEls = new Map<string, HTMLVideoElement>();
    const getSegmentVideo = async (index: number, url: string): Promise<HTMLVideoElement | null> => {
      const cacheKey = `${index}\0${url}`;
      const prev = segmentVideoEls.get(cacheKey);
      if (prev) return prev;
      if (!url) return null;
      const v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.src = "";
      v.load();
      v.src = url;
      v.load();
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        v.addEventListener("loadedmetadata", done, { once: true });
        v.addEventListener("error", done, { once: true });
      });
      segmentVideoEls.set(cacheKey, v);
      return v;
    };

    const segments = project.timelineSegments as TimelineSegment[];
    const durs = segments.map((seg) => Math.max(0.05, seg.endSec - seg.startSec));
    const totalExportSec = durs.reduce((a, b) => a + b, 0);

    const frameCaches: ExportSegmentFrameCache[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!;
      const durationSec = durs[i]!;
      const mediaType = (project.segmentMediaTypes[i] ?? "none") as SegmentMediaType;
      const imageUrl = project.segmentImageUrls[i] ?? "";
      const segmentVideoUrl = project.segmentVideoUrls[i] ?? "";
      const objectFit = project.segmentMediaObjectFit[i] ?? "cover";
      const mode = (project.segmentDisplayModes[i] ?? 1) as SegmentModalLyricsLayout;
      const breakAt = project.segmentLineBreakAt[i] ?? 0;
      const captionRaw =
        (project.segmentTexts[i] ?? "").trim() || (seg.isBranding ? "created with gegenpress app" : "");
      const overlayEnabled = project.segmentCompositeEnabled[i] ?? false;
      const overlayMode = (project.segmentCompositeModes[i] ?? "none") as SegmentCompositeMode;
      const overlayImageUrl = project.segmentOverlayImageUrls[i] ?? "";
      const overlayText = (project.segmentOverlayTexts[i] ?? "").trim();
      const overlayOpacity = Math.min(1, Math.max(0, project.segmentOverlayOpacity[i] ?? 0.85));
      const overlayScaleX = project.segmentOverlayScaleX[i] ?? 1;
      const overlayScaleY = project.segmentOverlayScaleY[i] ?? 1;
      const overlayPos = (project.segmentOverlayPosition[i] ?? "center") as SegmentOverlayPosition;
      const overlayX = project.segmentOverlayX[i] ?? 0;
      const overlayY = project.segmentOverlayY[i] ?? 0;
      const textX = project.segmentTextX[i] ?? 0;
      const textY = project.segmentTextY[i] ?? 0;
      const displayLines = getLyricsDisplayLines(captionRaw, mode, breakAt);
      const lyricsFontPx = clampLyricsFontSize(project.segmentLyricsFontSize?.[i] ?? DEFAULT_LYRICS_FONT_SIZE);
      const lyricsColorHex = normalizeLyricsColorHex(project.segmentLyricsColor?.[i] ?? "#ffffff");

      const bgImage = mediaType === "image" ? await getImage(imageUrl) : null;
      const bgSegmentVideo = mediaType === "video" ? await getSegmentVideo(i, segmentVideoUrl) : null;
      const mosaicRegions =
        overlayEnabled && overlayMode === "mosaic"
          ? normalizeExportMosaicRegions(project.segmentMosaicRegions?.[i])
          : undefined;
      const brandMaskRegions =
        overlayEnabled && overlayMode === "blackMaskWithBrand"
          ? normalizeExportBrandMaskRegions(project.segmentBrandMaskRegions?.[i])
          : undefined;

      const nmp = project.nameMaskPreset;
      const nameMaskAuto =
        exportNameMaskAppliesToSegment(i, nmp, segments.length) && nmp
          ? {
              xPct: nmp.nameArea.xPct,
              yPct: nmp.nameArea.yPct,
              wPct: nmp.nameArea.wPct,
              hPct: nmp.nameArea.hPct,
              mode: nmp.defaultMode,
              mosaicPixelSize: nmp.mosaicPixelSize,
              mosaicOpacity: nmp.mosaicOpacity,
              brandOpacity: nmp.brandOpacity,
            }
          : undefined;

      frameCaches.push({
        segIndex: i,
        durationSec,
        seg,
        mediaType,
        objectFit,
        mode,
        displayLines,
        lyricsFontPx,
        lyricsColorHex,
        overlayEnabled,
        overlayMode,
        overlayOpacity,
        overlayScaleX,
        overlayScaleY,
        overlayPos,
        overlayX,
        overlayY,
        textX,
        textY,
        bgImage,
        bgSegmentVideo,
        mosaicRegions,
        brandMaskRegions,
        nameMaskAuto,
      });
      setExportVideoMessage(`動画を書き出し中… 準備 (${i + 1}/${segments.length})`);
    }

    const audioCtx = new AudioContext();
    await audioCtx.resume();
    const exportAudio = await buildExportTimelineAudioBuffer(materialUrl, segments, audioCtx);

    const recConfig = pickMediaRecorderMimeType(!!exportAudio);
    const canvasStream = canvas.captureStream(fps);
    const canvasVideoTrack = canvasStream.getVideoTracks()[0];
    const exportStream = new MediaStream();
    if (canvasVideoTrack) exportStream.addTrack(canvasVideoTrack);

    const destNode = exportAudio ? audioCtx.createMediaStreamDestination() : null;
    let audioSource: AudioBufferSourceNode | null = null;
    if (exportAudio && destNode) {
      audioSource = audioCtx.createBufferSource();
      audioSource.buffer = exportAudio;
      audioSource.connect(destNode);
      const audioTrack = destNode.stream.getAudioTracks()[0];
      if (audioTrack) exportStream.addTrack(audioTrack);
    }

    const videoTrackCount = exportStream.getVideoTracks().length;
    const audioTrackCount = exportStream.getAudioTracks().length;
    console.log("[export] MediaStream tracks:", {
      videoTrackCount,
      audioTrackCount,
      audioTrackLabels: exportStream.getAudioTracks().map((tr) => tr.label),
      audioTrackIds: exportStream.getAudioTracks().map((tr) => tr.id),
      audioTrackEnabled: exportStream.getAudioTracks().map((tr) => tr.enabled),
    });
    if (audioTrackCount === 0) {
      console.error(
        "[export] 書き出し用 MediaStream に音声トラックがありません（素材のデコード失敗・CORS・またはブラウザ制限の可能性）"
      );
    }

    const chunks: BlobPart[] = [];
    const basePixels = 1280 * 720;
    const outPixels = width * height;
    const recorderOpts: MediaRecorderOptions = {
      videoBitsPerSecond: Math.min(16_000_000, Math.round((8_000_000 * outPixels) / basePixels)),
    };
    if (recConfig.mimeType) recorderOpts.mimeType = recConfig.mimeType;
    if (audioTrackCount > 0) recorderOpts.audioBitsPerSecond = 192_000;
    const recorder = new MediaRecorder(exportStream, recorderOpts);

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    const stopPromise = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });

    try {
      if (exportAudio && audioSource) {
        await drawExportVideoFrame(
          ctx,
          width,
          height,
          frameCaches[0]!,
          0,
          segments.length <= 1,
          videoEl,
          aspectLayout.aspectRatio
        );
        recorder.start();
        let rafId = 0;
        let running = true;
        audioSource.onended = () => {
          running = false;
          cancelAnimationFrame(rafId);
          const last = frameCaches.length - 1;
          const lastCache = frameCaches[last]!;
          void drawExportVideoFrame(
            ctx,
            width,
            height,
            lastCache,
            Math.max(0, lastCache.durationSec - 0.04),
            true,
            videoEl,
            aspectLayout.aspectRatio
          ).then(() => {
            recorder.stop();
          });
        };
        const step = () => {
          rafId = requestAnimationFrame(() => {
            void (async () => {
              if (!running) return;
              const t = Math.min(audioCtx.currentTime, exportAudio.duration - 1e-6);
              const { index, secInSeg } = resolveExportSegmentAtTime(t, segments, durs);
              await drawExportVideoFrame(
                ctx,
                width,
                height,
                frameCaches[index]!,
                secInSeg,
                index === segments.length - 1,
                videoEl,
                aspectLayout.aspectRatio
              );
              const pct = Math.min(100, Math.round((t / Math.max(exportAudio.duration, 1e-6)) * 100));
              setExportVideoMessage(`動画を書き出し中… ${pct}%`);
              if (running && audioCtx.currentTime < exportAudio.duration - 0.02) {
                step();
              }
            })();
          });
        };
        audioSource.start(0);
        step();
        await stopPromise;
      } else {
        recorder.start();
        const frameDt = 1 / fps;
        let t = 0;
        let frameIdx = 0;
        const totalFrames = Math.max(1, Math.floor(totalExportSec * fps));
        while (t < totalExportSec - 1e-6) {
          const { index, secInSeg } = resolveExportSegmentAtTime(t, segments, durs);
          await drawExportVideoFrame(
            ctx,
            width,
            height,
            frameCaches[index]!,
            secInSeg,
            index === segments.length - 1,
            videoEl,
            aspectLayout.aspectRatio
          );
          frameIdx += 1;
          if (frameIdx % Math.max(1, Math.floor(fps)) === 0) {
            setExportVideoMessage(
              `動画を書き出し中… ${Math.min(100, Math.round((frameIdx / totalFrames) * 100))}%（音声なし）`
            );
          }
          t += frameDt;
          await sleepMs(1000 / fps);
        }
        recorder.stop();
        await stopPromise;
      }
    } finally {
      try {
        recorder.ondataavailable = null;
      } catch {
        /* ignore */
      }
      canvasStream.getTracks().forEach((tr) => tr.stop());
      exportStream.getTracks().forEach((tr) => tr.stop());
      try {
        audioSource?.stop();
      } catch {
        /* ignore */
      }
      try {
        audioSource?.disconnect();
      } catch {
        /* ignore */
      }
      try {
        destNode?.disconnect();
      } catch {
        /* ignore */
      }
      void audioCtx.close();
      segmentVideoEls.forEach((v) => {
        v.pause();
        v.removeAttribute("src");
        v.load();
      });
      segmentVideoEls.clear();
      videoEl.pause();
      videoEl.removeAttribute("src");
      videoEl.load();
    }

      const blob = new Blob(chunks, { type: recConfig.mimeType || "video/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.download = `preview-export-${stamp}.${recConfig.ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportVideoMessage(recConfig.ext === "mp4" ? "書き出し完了（mp4）" : "書き出し完了（webm）");
      setTimeout(() => setExportVideoMessage(null), 3500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.alert(`動画書き出しに失敗しました: ${msg}`);
      setExportVideoMessage(null);
    } finally {
      exportVideoInProgressRef.current = false;
      setIsExportingVideo(false);
    }
  }, [currentVideoUrl, aspectLayout]);

  /** フル再生: video の loadedmetadata で duration 取得、50ms ポーリングで nowSec を更新 */
  useEffect(() => {
    const main = videoRef.current;
    if (!main || !currentVideoUrl) return;

    const onLoadedMetadata = () => {
      setVideoDuration(main.duration);
      const syn = syncPreviewVideoRef.current;
      const t = main.currentTime || 0;
      if (syn && Math.abs(syn.currentTime - t) > 0.05) {
        videoTimeSyncLockRef.current = true;
        syn.currentTime = t;
        requestAnimationFrame(() => {
          videoTimeSyncLockRef.current = false;
        });
      }
    };
    main.addEventListener("loadedmetadata", onLoadedMetadata);
    if (main.duration && Number.isFinite(main.duration)) setVideoDuration(main.duration);
    setNowSec(main.currentTime || 0);

    const intervalMs = 50;
    const iv = setInterval(() => {
      const m = videoRef.current;
      const s = syncPreviewVideoRef.current;
      let t = 0;
      if (lastActivePlayerRef.current === "sync" && s) t = s.currentTime || 0;
      else if (m) t = m.currentTime || 0;
      else if (s) t = s.currentTime || 0;
      setNowSec(t);
    }, intervalMs);

    return () => {
      clearInterval(iv);
      main.removeEventListener("loadedmetadata", onLoadedMetadata);
    };
  }, [currentVideoUrl]);

  /** 歌詞行: 選択行の開始秒を現在時刻に設定（Set start） */
  const setStartToNow = useCallback((lineId: number) => {
    setLines((prev) =>
      prev.map((l) =>
        l.id === lineId ? { ...l, startSec: clampNonNegative(nowSec) } : l
      )
    );
    setActiveLineId(lineId);
  }, [nowSec, setLines]);

  /** 歌詞行: 選択行の終了秒を現在時刻に設定（Set end） */
  const setEndToNow = useCallback((lineId: number) => {
    setLines((prev) =>
      prev.map((l) =>
        l.id === lineId ? { ...l, endSec: clampNonNegative(nowSec) } : l
      )
    );
    setActiveLineId(lineId);
  }, [nowSec, setLines]);

  /** 歌詞行: VoiceSegmentPanel の Set start ボタン用。選択行の startSec を指定値に */
  const setStartToSec = useCallback((sec: number) => {
    if (activeLineId == null) return;
    const s = clampNonNegative(sec);
    setLines((prev) =>
      prev.map((l) => (l.id === activeLineId ? { ...l, startSec: s } : l))
    );
  }, [activeLineId, setLines]);

  /** 歌詞行: VoiceSegmentPanel の Set end ボタン用。選択行の endSec を指定値に */
  const setEndToSec = useCallback((sec: number) => {
    if (activeLineId == null) return;
    const s = clampNonNegative(sec);
    setLines((prev) =>
      prev.map((l) => (l.id === activeLineId ? { ...l, endSec: s } : l))
    );
  }, [activeLineId, setLines]);

  /** 歌詞行: モバイル用。開始/終了を ±delta 秒で調整（mobileAdjustTarget に従う） */
  const adjustCurrentLine = useCallback((delta: number) => {
    if (activeLine == null) return;
    if (mobileAdjustTarget === "start") {
      const v = toNumberOrNull(activeLine.startSec) ?? 0;
      setLines((prev) =>
        prev.map((l) =>
          l.id === activeLine.id ? { ...l, startSec: clampNonNegative(v + delta) } : l
        )
      );
    } else {
      const v = toNumberOrNull(activeLine.endSec) ?? 0;
      setLines((prev) =>
        prev.map((l) =>
          l.id === activeLine.id ? { ...l, endSec: clampNonNegative(v + delta) } : l
        )
      );
    }
  }, [activeLine, mobileAdjustTarget, setLines]);

  const handleVoiceSegmentsChange = useCallback((vSegs: VoiceSegment[]) => {
    setVoiceSegments(vSegs);
    setSegments((prev) =>
      vSegs.map((s, i) => ({
        start: s.startSec,
        end: s.endSec,
        text: prev[i]?.text ?? "",
      }))
    );
  }, []);

  /** タイムライン枠の歌詞（複数行可）がパネル側で更新されたら親の segments に反映 */
  const handleSegmentTextsChange = useCallback((texts: string[]) => {
    setSegments((prev) =>
      prev.map((s, i) => ({ ...s, text: texts[i] ?? s.text }))
    );
  }, []);

  const handleBulkAssignLyricsToSegments = useCallback(() => {
    const lyricsLines = lyricsText
      .split(/\r?\n/g)
      .map((s) => s.trim());
    const segs = voiceSegments;
    if (segs.length === 0) return;
    const newLines: LyricLine[] = segs.map((seg, i) => ({
      id: -(i + 1),
      index: i,
      text: lyricsLines[i] ?? "",
      startSec: clampNonNegative(seg.startSec),
      endSec: clampNonNegative(seg.endSec),
    }));
    setLines(newLines);
    setActiveLineId(newLines[0]?.id ?? null);
  }, [lyricsText, voiceSegments, setLines]);

  /** 歌詞全文を1行ずつ segments[].text に割り当て（ブラウザ側のみ） */
  const handleAssignLyricsToSegments = useCallback(() => {
    const lines = lyricsText.split("\n");
    setSegments((prev) =>
      prev.map((seg, i) => ({ ...seg, text: lines[i] ?? "" }))
    );
  }, [lyricsText]);

  /** 区間＋歌詞を API に保存 */
  const handleSaveSegments = useCallback(async () => {
    setApiError(null);
    if (!video || segments.length === 0) return;
    setIsSavingSegments(true);
    try {
      const lyrics = segments.map((s) => ({
        startSec: clampNonNegative(s.start),
        endSec: clampNonNegative(s.end),
        text: s.text,
      }));
      const json = (await fetchJson(`/api/videos/${video.id}/lyrics`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId: video.id, lyrics }),
      })) as { ok?: boolean; lines?: LyricLine[]; message?: string };
      if (!json?.ok) {
        setApiError(json?.message ?? "保存に失敗しました");
        return;
      }
      if (Array.isArray(json.lines)) {
        const sorted = [...json.lines].sort((a, b) => a.index - b.index);
        setLines(sorted);
        setSegments(
          sorted.map((l) => ({
            start: clampNonNegative(toNumberOrNull(l.startSec) ?? 0),
            end: clampNonNegative(toNumberOrNull(l.endSec) ?? 0),
            text: l.text ?? "",
          }))
        );
      }
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "保存中にエラーが発生しました");
    } finally {
      setIsSavingSegments(false);
    }
  }, [video, segments, setLines]);

  const handleBulkAssignToLyrics = useCallback((segments: VoiceSegment[]) => {
    const M = segments.length;
    const N = safeLines.length;
    if (N === 0) return;
    let assignSegments: { startSec: number; endSec: number }[];
    if (M >= N) {
      assignSegments = segments.slice(0, N).map((s) => ({
        startSec: clampNonNegative(s.startSec),
        endSec: clampNonNegative(s.endSec),
      }));
    } else {
      const startSec = Math.min(...segments.map((s) => s.startSec));
      const endSec = Math.max(...segments.map((s) => s.endSec));
      assignSegments = makeUniformSegments(startSec, endSec, N).map((s) => ({
        startSec: clampNonNegative(s.startSec),
        endSec: clampNonNegative(s.endSec),
      }));
    }
    setLines((prev) =>
      prev.map((l, i) => ({
        ...l,
        startSec: assignSegments[i]?.startSec ?? l.startSec,
        endSec: assignSegments[i]?.endSec ?? l.endSec,
      }))
    );
  }, [safeLines.length, setLines]);

  /** 歌詞行: 前の行を選択 */
  const setActivePrev = useCallback(() => {
    if (activeIndex <= 0) return;
    setActiveLineId(safeLines[activeIndex - 1]?.id ?? null);
  }, [activeIndex, safeLines]);

  /** 歌詞行: 次の行を選択 */
  const setActiveNext = useCallback(() => {
    if (activeIndex < 0 || activeIndex >= safeLines.length - 1) return;
    setActiveLineId(safeLines[activeIndex + 1]?.id ?? null);
  }, [activeIndex, safeLines]);

  const activeLineStartSec = activeLine?.startSec ?? null;

  /** 歌詞行: 選択行の開始位置からフル再生 */
  const playFromStart = useCallback(() => {
    if (activeLineStartSec == null || !videoRef.current) return;
    setBothVideosTime(clampNonNegative(activeLineStartSec));
    lastActivePlayerRef.current = "main";
    syncPreviewVideoRef.current?.pause();
    safePlay(videoRef.current);
  }, [activeLineStartSec, setBothVideosTime]);

  async function saveLine(line: LyricLine) {
    setApiError(null);
    const startSec = toNumberOrNull(line.startSec);
    const endSec = toNumberOrNull(line.endSec);
    if (startSec != null && endSec != null && startSec > endSec) {
      setApiError("開始秒が終了秒を超えています。");
      return;
    }
    setSavingLineIds((prev) => new Set(prev).add(line.id));
    try {
      const json = (await fetchJson(`/api/lyrics-lines/${line.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startSec, endSec, text: line.text }),
      })) as { ok?: boolean; line?: LyricLine; message?: string };
      if (!json?.ok) {
        setApiError(json?.message ?? "保存に失敗しました");
        return;
      }
      const updated: LyricLine = json.line!;
      setLines((prev) =>
        prev.map((l) => (l.id === updated.id ? updated : l)).sort((a, b) => a.index - b.index)
      );
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "保存中にエラーが発生しました");
    } finally {
      setSavingLineIds((prev) => { const n = new Set(prev); n.delete(line.id); return n; });
    }
  }

  async function importLyrics() {
    setApiError(null);
    if (!video) return;
    setIsImporting(true);
    try {
      const json = (await fetchJson(`/api/videos/${video.id}/lyrics/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: lyricsText }),
      })) as { ok?: boolean; lines?: LyricLine[]; message?: string };
      if (!json?.ok) {
        setApiError(json?.message ?? "歌詞の取り込みに失敗しました");
        return;
      }
      const newLines: LyricLine[] = json.lines ?? [];
      setLines(newLines);
      setActiveLineId(newLines[0]?.id ?? null);
      setLyricsText("");
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "取り込み中にエラーが発生しました");
    } finally {
      setIsImporting(false);
    }
  }

  /** 小数点誤差吸収用（境界判定） */
  const TIME_EPS = 0.002;

  const activeOverlay = useMemo(
    () =>
      overlays.find(
        (o) =>
          nowSec >= o.startSec - TIME_EPS &&
          nowSec < o.endSec + TIME_EPS
      ),
    [overlays, nowSec]
  );

  /**
   * 左プレビューの歌詞は常に1系統だけ参照する。
   * - タイムラインあり時は VoiceSegmentPanel が送る panelSyncCaptionText のみ（編集中 localSegmentText と同一経路）。
   * - タイムライン未生成時のみ safeLines を nowSec で検索。
   */
  const captionText = useMemo(() => {
    if (overlays.length > 0) {
      return panelSyncCaptionText;
    }
    const start = (l: LyricLine) => toNumberOrNull(l.startSec) ?? 0;
    const end = (l: LyricLine) => toNumberOrNull(l.endSec) ?? Infinity;
    const line = safeLines.find(
      (l) => nowSec >= start(l) - TIME_EPS && nowSec < end(l) + TIME_EPS
    );
    return line?.text ?? "";
  }, [overlays.length, panelSyncCaptionText, safeLines, nowSec]);

  const useSegmentLyricStyle =
    overlays.length > 0
      ? Boolean(panelSyncCaptionText.trim())
      : Boolean(activeOverlay?.text?.trim());
  const syncCaptionFontSize = useSegmentLyricStyle
    ? clampLyricsFontSize(activeOverlay?.lyricsFontSize ?? DEFAULT_LYRICS_FONT_SIZE)
    : 22;
  const syncCaptionColor = useSegmentLyricStyle
    ? normalizeLyricsColorHex(activeOverlay?.lyricsColor ?? "#222222")
    : "#222";
  const syncCaptionShadow = useSegmentLyricStyle ? lyricsTextShadowForColor(syncCaptionColor) : undefined;
  const syncMediaFilterCss = segmentScreenFilterCss(activeOverlay?.screenFilter);
  const syncRetroHeisei = activeOverlay?.screenFilter === "retroHeisei";

  if (loading) {
    return <div style={{ padding: 16 }}>{t("loadingPage")}</div>;
  }
  if (error || !video) {
    return (
      <div style={{ padding: 16, color: "red" }}>
        {t("errorPrefix")} {error ?? t("videoNotFound")}
        <button type="button" onClick={reload} style={{ marginLeft: 8 }}>
          {t("retry")}
        </button>
      </div>
    );
  }

  /* 初回マウント完了までメイン描画を遅延し、preview/editor の同時表示・描画ズレを防ぐ */
  if (!isHydrated) {
    return <div style={{ padding: 16 }}>{t("loadingPage")}</div>;
  }

  // ----- 描画: フル再生用のメイン動画プレイヤー -----
  const mainVideoPlayer = (
    <div style={{ position: "relative", width: "100%", maxWidth: 900, margin: "0 auto" }}>
      <div style={aspectLayout.stage("main")}>
        <video
          key={currentVideoUrl || "no-video-src"}
          ref={videoRef}
          src={currentVideoUrl || undefined}
          controls
          preload="metadata"
          style={PREVIEW_MEDIA_LAYER_CONTAIN_STYLE}
          onPlay={handleMainVideoPlay}
          onSeeked={handleMainVideoSeeked}
        />
      </div>
      <ToolCreditCaption />
    </div>
  );

  /** 描画: 動画（フル再生）セクション（折りたたみ可能） */
  const fullPlayerSection = (
    <div
      style={{
        marginBottom: isMobile ? 0 : 12,
        border: "1px solid #ddd",
        borderRadius: 8,
        overflow: "hidden",
        background: "#fff",
        maxWidth: 900,
        width: "100%",
        boxSizing: "border-box" as const,
      }}
    >
      <button
        type="button"
        aria-expanded={isFullPlayerOpen}
        aria-controls="sync-full-player-content"
        id="sync-full-player-heading"
        onClick={() => setIsFullPlayerOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: isMobile ? "10px 12px" : "12px 14px",
          border: "none",
          background: "#f3f4f6",
          cursor: "pointer",
          textAlign: "left",
          fontFamily: "inherit",
          fontSize: isMobile ? 13 : 15,
          fontWeight: 600,
          color: "#111",
        }}
      >
        <span>{t("fullVideoPlayer")}</span>
        <span aria-hidden style={{ flexShrink: 0, fontSize: 12, color: "#555" }}>
          {isFullPlayerOpen ? "▼" : "▶"}
        </span>
      </button>
      {isFullPlayerOpen ? (
        <div
          id="sync-full-player-content"
          role="region"
          aria-labelledby="sync-full-player-heading"
          style={{
            padding: isMobile ? "8px 10px 10px" : "12px 14px 14px",
            borderTop: "1px solid #e8e8e8",
          }}
        >
          {mainVideoPlayer}
          {isMobile ? (
            <div style={{ fontSize: 12, marginTop: 8, color: "#444" }}>
              {t("currentTimeShort")} {formatSecToMinSec(nowSec)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  /** 描画: プレビュー（同期表示）セクション。歌詞・画像は nowSec に連動、第2プレイヤーはフル再生可 */
  const syncPreviewPanel = (
    <>
      <style>{SYNC_PREVIEW_ANIM_CSS}</style>
      <div
        style={{
          border: "1px solid #e0e0e0",
          borderRadius: 8,
          maxWidth: "100%",
          width: "100%",
          background: "#fafafa",
          overflow: "hidden",
          boxSizing: "border-box" as const,
        }}
      >
        <button
          type="button"
          aria-expanded={isPreviewOpen}
          aria-controls="sync-preview-panel-content"
          id="sync-preview-panel-heading"
          onClick={() => setIsPreviewOpen((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: isMobile ? "10px 12px" : "12px 14px",
            border: "none",
            background: "#eceef2",
            cursor: "pointer",
            textAlign: "left",
            fontFamily: "inherit",
            fontSize: isMobile ? 13 : 14,
            fontWeight: 600,
            color: "#111",
          }}
        >
          <span>{t("syncPreviewTitle")}</span>
          <span aria-hidden style={{ flexShrink: 0, fontSize: 12, color: "#555" }}>
            {isPreviewOpen ? "▼" : "▶"}
          </span>
        </button>
        {isPreviewOpen ? (
          <div
            id="sync-preview-panel-content"
            role="region"
            aria-labelledby="sync-preview-panel-heading"
            style={{ padding: 12, borderTop: "1px solid #e0e0e0" }}
          >
            <p style={{ fontSize: 12, color: "#666", margin: "0 0 12px", lineHeight: 1.5 }}>
              {t("syncPreviewDescription")}
            </p>
            <div style={{ marginBottom: 12 }}>
              <div ref={syncPreviewStageRef} style={{ ...aspectLayout.stage("sync"), marginBottom: 8 }}>
                <video
                  key={`sync-${currentVideoUrl || "no-video-src"}`}
                  ref={syncPreviewVideoRef}
                  src={currentVideoUrl || undefined}
                  controls
                  preload="metadata"
                  style={PREVIEW_MEDIA_LAYER_CONTAIN_STYLE}
                  onPlay={handleSyncVideoPlay}
                  onSeeked={handleSyncVideoSeeked}
                  onLoadedMetadata={() => {
                    const main = videoRef.current;
                    const syn = syncPreviewVideoRef.current;
                    if (!main || !syn || videoTimeSyncLockRef.current) return;
                    const t = main.currentTime || 0;
                    if (Math.abs(syn.currentTime - t) > 0.05) {
                      videoTimeSyncLockRef.current = true;
                      syn.currentTime = t;
                      requestAnimationFrame(() => {
                        videoTimeSyncLockRef.current = false;
                      });
                    }
                  }}
                />
                {captionText && useSegmentLyricStyle ? (
                  <PreviewLyricsCaptionAutoFit
                    measureFrameRef={syncPreviewStageRef}
                    baseFontSize={syncCaptionFontSize}
                    color={syncCaptionColor}
                    textShadow={syncCaptionShadow ?? ""}
                    contentKey={`${captionText}\0${syncCaptionFontSize}\0${aspectLayout.aspectRatio}`}
                    style={syncPreviewHorizontalCaptionStyle(aspectLayout.caption)}
                  >
                    {captionText}
                  </PreviewLyricsCaptionAutoFit>
                ) : captionText ? (
                  <div
                    style={{
                      ...syncPreviewHorizontalCaptionStyle(aspectLayout.caption),
                      fontSize: syncCaptionFontSize,
                      color: syncCaptionColor,
                      textShadow: syncCaptionShadow,
                    }}
                  >
                    {captionText}
                  </div>
                ) : null}
              </div>
              <ToolCreditCaption />
            </div>
            {!captionText ? (
              <div style={{ fontSize: 13, color: "#888", textAlign: "center", padding: "8px 0" }}>
                （{t("noLyricLineAtTime")}）
              </div>
            ) : null}
            {activeOverlay?.mediaType === "video" && activeOverlay.videoUrl ? (
              <div
                style={{
                  ...aspectLayout.stage("sync"),
                  marginTop: 12,
                  position: "relative",
                }}
              >
                <div style={{ filter: syncMediaFilterCss, position: "absolute", inset: 0 }}>
                  <video
                    key={`${activeOverlay.startSec}-${activeOverlay.endSec}-v-${segmentPlayTrigger}`}
                    src={activeOverlay.videoUrl}
                    poster={activeOverlay.posterUrl}
                    muted={activeOverlay.videoMuted === true}
                    playsInline
                    controls
                    preload="none"
                    className={
                      activeOverlay.anim && activeOverlay.anim !== "none"
                        ? `sync-preview-img anim-${activeOverlay.anim}`
                        : "sync-preview-img"
                    }
                    style={PREVIEW_MEDIA_LAYER_CONTAIN_STYLE}
                  />
                </div>
                {syncRetroHeisei ? (
                  <div
                    aria-hidden
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 2,
                      pointerEvents: "none",
                      opacity: 0.38,
                      mixBlendMode: "multiply",
                      backgroundImage:
                        "repeating-linear-gradient(180deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 2px)",
                    }}
                  />
                ) : null}
              </div>
            ) : activeOverlay?.imageUrl ? (
              <div
                style={{
                  ...aspectLayout.stage("sync"),
                  marginTop: 12,
                  position: "relative",
                }}
              >
                <div style={{ filter: syncMediaFilterCss, position: "absolute", inset: 0 }}>
                  <img
                    key={`${activeOverlay.startSec}-${activeOverlay.endSec}-${segmentPlayTrigger}`}
                    src={activeOverlay.imageUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className={
                      activeOverlay.anim && activeOverlay.anim !== "none"
                        ? `sync-preview-img anim-${activeOverlay.anim}`
                        : "sync-preview-img"
                    }
                    style={PREVIEW_MEDIA_LAYER_CONTAIN_STYLE}
                    onError={() => {
                      const o = activeOverlay;
                      if (
                        o?.mediaType === "image" &&
                        o.imageUrl &&
                        typeof o.segmentIndex === "number"
                      ) {
                        segmentPanelRef.current?.retryPixabayImageAfterLoadFailure(
                          o.segmentIndex,
                          o.imageUrl
                        );
                      }
                    }}
                  />
                </div>
                {syncRetroHeisei ? (
                  <div
                    aria-hidden
                    style={{
                      position: "absolute",
                      inset: 0,
                      zIndex: 2,
                      pointerEvents: "none",
                      opacity: 0.38,
                      mixBlendMode: "multiply",
                      backgroundImage:
                        "repeating-linear-gradient(180deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 2px)",
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );

  const displayError = apiError ?? null;

  if (isMobile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 0, minHeight: "100vh" }}>
        <div style={{ position: "sticky", top: 0, zIndex: 10, background: "#fff", padding: 8, marginTop: 8 }}>
          {fullPlayerSection}
        </div>
        <div style={{ flex: 1, padding: 12, paddingBottom: 24 }}>
          <div style={{ marginBottom: 16 }}>{syncPreviewPanel}</div>
          {displayError && (
            <div style={{ color: "red", marginBottom: 8 }}>
              {t("errorPrefix")} {displayError}
            </div>
          )}
          {safeLines.length === 0 ? (
            <div style={{ marginBottom: 12 }}>{t("noLyricsLinesYet")}</div>
          ) : (
            <>
              <div style={{ marginBottom: 12 }}>
                <button type="button" onClick={() => setListOpen(!listOpen)} style={{ marginBottom: 8 }}>
                  {listOpen ? t("closeLyricsList") : t("openLyricsList")} ({safeLines.length} {t("lineCountUnit")})
                </button>
                {listOpen && (
                  <ul style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: 200, overflowY: "auto" }}>
                    {safeLines.map((line, idx) => {
                      const isPlayback = idx === playbackLineIndex;
                      const bg = isPlayback ? "#d4edda" : line.id === activeLineId ? "#fff7e6" : "transparent";
                      return (
                        <li
                          key={line.id}
                          style={{
                            padding: 8,
                            borderBottom: "1px solid #eee",
                            background: bg,
                            cursor: "pointer",
                          }}
                          onClick={() => seekToLineAndPlay(line)}
                        >
                          {isPlayback && "▶ "}#{line.index + 1} {line.text.slice(0, 40)}{line.text.length > 40 ? "…" : ""}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {activeLine && (
                <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>
                    {t("editingColon")} #{activeLine.index + 1}
                  </div>
                  <textarea
                    value={activeLine.text}
                    onChange={(e) =>
                      setLines((prev) =>
                        prev.map((l) => (l.id === activeLine.id ? { ...l, text: e.target.value } : l))
                      )}
                    rows={3}
                    style={{ width: "100%", marginBottom: 12, boxSizing: "border-box" }}
                  />
                  <div style={{ marginBottom: 8 }}>
                    {t("wordStart")}: {formatSecToMinSec(activeLine.startSec ?? 0)} / {t("wordEnd")}:{" "}
                    {formatSecToMinSec(activeLine.endSec ?? 0)}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                    <button type="button" onClick={() => setStartToNow(activeLine.id)} style={{ minHeight: 44 }}>
                      Set start
                    </button>
                    <button type="button" onClick={() => setEndToNow(activeLine.id)} style={{ minHeight: 44 }}>
                      Set end
                    </button>
                    <button type="button" onClick={playFromStart} style={{ minHeight: 44 }}>
                      {t("playFromStartLine")}
                    </button>
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    {t("mobileAdjustTarget")}{" "}
                    <button
                      type="button"
                      onClick={() => setMobileAdjustTarget("start")}
                      style={{ background: mobileAdjustTarget === "start" ? "#e0e0e0" : undefined }}
                    >
                      {t("wordStart")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobileAdjustTarget("end")}
                      style={{ background: mobileAdjustTarget === "end" ? "#e0e0e0" : undefined, marginLeft: 4 }}
                    >
                      {t("wordEnd")}
                    </button>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                    <button type="button" onClick={() => adjustCurrentLine(-1)} style={{ minHeight: 44, minWidth: 56 }}>-1.0s</button>
                    <button type="button" onClick={() => adjustCurrentLine(-0.5)} style={{ minHeight: 44, minWidth: 56 }}>-0.5s</button>
                    <button type="button" onClick={() => adjustCurrentLine(0.5)} style={{ minHeight: 44, minWidth: 56 }}>+0.5s</button>
                    <button type="button" onClick={() => adjustCurrentLine(1)} style={{ minHeight: 44, minWidth: 56 }}>+1.0s</button>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={setActivePrev} disabled={activeIndex <= 0} style={{ minHeight: 44 }}>
                      {t("prev")}
                    </button>
                    <button type="button" onClick={setActiveNext} disabled={activeIndex >= safeLines.length - 1} style={{ minHeight: 44 }}>
                      {t("next")}
                    </button>
                    <button
                      type="button"
                      onClick={() => saveLine(activeLine)}
                      disabled={savingLineIds.has(activeLine.id)}
                      style={{ minHeight: 44 }}
                    >
                      {savingLineIds.has(activeLine.id) ? t("savingEllipsis") : t("save")}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          <div style={{ marginTop: 16, borderTop: "1px solid #eee", paddingTop: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{t("lyricsImportSection")}</div>
            <textarea
              className="lyrics-full-textarea"
              value={lyricsText}
              onChange={(e) => setLyricsText(e.target.value)}
              rows={4}
              placeholder={lyricsFullPlaceholder}
              style={{ width: "100%", minHeight: 88 }}
            />
            <button type="button" onClick={importLyrics} disabled={isImporting} style={{ marginTop: 8 }}>
              {isImporting ? t("importingEllipsis") : t("importOverwriteButton")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /** 区間編集モーダル表示中も video を DOM に残す（アンマウントすると videoRef が null で区間再生が効かない） */
  const editorKeepAliveWhilePreviewStyle: React.CSSProperties | undefined = previewOpen
    ? {
        position: "fixed",
        left: 0,
        bottom: 0,
        width: 400,
        height: 300,
        opacity: 0,
        pointerEvents: "none",
        zIndex: -5,
        overflow: "hidden",
      }
    : undefined;

  return (
    <>
      <style>{`${SYNC_TOOLBAR_PRIMARY_BTN_CSS}\n${LYRICS_FULL_TEXTAREA_CSS}`}</style>
      {crossResumeCandidate ? (
        <div
          role="status"
          style={{
            fontSize: 13,
            lineHeight: 1.4,
            padding: "8px 12px",
            marginBottom: 10,
            maxWidth: 900,
            background: "#f0f9ff",
            border: "1px solid #7dd3fc",
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            color: "#0c4a6e",
          }}
        >
          <span>
            {t("crossResumeBannerTitle")}
            <span style={{ color: "#0369a1" }}>
              {" "}
              （元ファイル: {crossResumeCandidate.displayOriginalName}
              {crossResumeCandidate.updatedAt > 0
                ? ` ・ 保存: ${new Date(crossResumeCandidate.updatedAt).toLocaleString()}`
                : ""}
              ）
            </span>
          </span>
          <button
            type="button"
            onClick={handleCrossResumeRestore}
            style={{
              padding: "4px 10px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              border: "1px solid #0284c7",
              borderRadius: 6,
              background: "#0284c7",
              color: "#fff",
            }}
          >
            {t("resumeContinueButton")}
          </button>
          <button
            type="button"
            onClick={handleCrossResumeDismiss}
            style={{
              padding: "4px 10px",
              fontSize: 13,
              cursor: "pointer",
              border: "1px solid #94a3b8",
              borderRadius: 6,
              background: "#fff",
              color: "#334155",
            }}
          >
            {t("ignoreButton")}
          </button>
        </div>
      ) : null}
      <div style={editorKeepAliveWhilePreviewStyle} aria-hidden={previewOpen ? true : undefined}>
      {/* 描画: 再生バー（再生/停止/現在時間/-1s/+1s/次の行へ）。grid 外に置き sticky で追従 */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          padding: "12px 16px",
          marginBottom: 12,
          width: "100%",
          maxWidth: "100%",
          boxSizing: "border-box" as const,
          background: "#fff",
          border: "1px solid #ddd",
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}
      >
        <button type="button" onClick={handlePanelVideoPlay} className="sync-toolbar-primary-btn sync-toolbar-primary-btn--compact">
          {t("play")}
        </button>
        <button type="button" onClick={handlePanelVideoPause} className="sync-toolbar-primary-btn sync-toolbar-primary-btn--compact">
          {t("stop")}
        </button>
        <span style={{ fontSize: 15, minWidth: 100, color: "#334155" }}>
          {t("currentTime")} <strong>{formatSecToMinSec(nowSec)}</strong>
        </span>
        <button
          type="button"
          onClick={() => handlePanelVideoSeekDelta(-1)}
          className="sync-toolbar-primary-btn sync-toolbar-primary-btn--compact"
        >
          {t("seekMinusOneSec")}
        </button>
        <button
          type="button"
          onClick={() => handlePanelVideoSeekDelta(1)}
          className="sync-toolbar-primary-btn sync-toolbar-primary-btn--compact"
        >
          {t("seekPlusOneSec")}
        </button>
        <button
          type="button"
          onClick={setActiveNext}
          disabled={activeIndex < 0}
          className="sync-toolbar-primary-btn sync-toolbar-primary-btn--compact"
        >
          {t("nextLine")}
        </button>
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <label htmlFor="ui-display-lang" style={{ fontSize: 13, color: "#334155", fontWeight: 600 }}>
            🌐 {t("displayLanguage")}
          </label>
          <select
            id="ui-display-lang"
            value={locale}
            onChange={(e) => {
              const v = e.target.value;
              if (isUiLocale(v)) setLocale(v);
            }}
            aria-label={t("displayLanguage")}
            style={{
              padding: "6px 10px",
              fontSize: 14,
              borderRadius: 8,
              border: "1px solid #cbd5e1",
              background: "#fff",
              minWidth: 160,
            }}
          >
            {localeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

    <div style={{ display: "grid", gap: 16, width: "100%", maxWidth: "100%", boxSizing: "border-box" }}>
      {fullPlayerSection}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(240px, min(34vw, 380px)) minmax(0, 1fr)",
          gap: 12,
          alignItems: "start",
          width: "100%",
          maxWidth: 1600,
          boxSizing: "border-box" as const,
        }}
      >
        <div style={{ minWidth: 0, position: "sticky", top: 80, alignSelf: "start" }}>{syncPreviewPanel}</div>
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 16 }}>
      {displayError && (
        <div style={{ color: "red" }}>
          {t("errorPrefix")} {displayError}
        </div>
      )}
      <div style={{ color: "#555" }}>
        {t("videoFileLabel")}{" "}
        {localMaterialVideo
          ? `${localMaterialVideo.name} ${t("localMp4InUse")}`
          : `${video.originalName}（ID: ${video.id}）`}
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, maxWidth: 900 }}>
        <div style={{ marginBottom: 10 }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#111" }}>{t("fullLyrics")}</span>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 16,
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          <ToolbarPrimaryAction
            buttonText={t("saveDraftJson")}
            helperText={t("saveDraftJsonHelper")}
            onClick={handleSaveProjectToLocal}
            title={t("saveDraftJsonTitle")}
          />
          <ToolbarPrimaryAction
            buttonText={t("resumeJson")}
            helperText={t("resumeJsonHelper")}
            onClick={handleLoadProjectFromLocal}
            title={t("resumeJsonTitle")}
          />
          <ToolbarPrimaryAction
            buttonText={t("loadVideo")}
            helperText={t("loadVideoHelper")}
            onClick={handleLoadMp4AsMaterial}
            title={t("loadVideoTitle")}
          />
          <label
            style={{
              fontSize: 12,
              color: "#444",
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontWeight: 600 }}>{t("previewExportAspectLabel")}</span>
            <select
              value={previewAspectRatio}
              onChange={(e) => setPreviewAspectRatio(e.target.value as PreviewAspectRatio)}
              disabled={isExportingVideo}
              style={{ padding: "6px 10px", fontSize: 13, borderRadius: 6, border: "1px solid #ccc" }}
            >
              {PREVIEW_ASPECT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <ToolbarPrimaryAction
            buttonText={t("videoDownload")}
            buttonTextBusy={t("videoDownloadBusy")}
            busy={isExportingVideo}
            helperText={t("videoDownloadHelper")}
            onClick={() => {
              void handleExportVideoAsMp4();
            }}
            disabled={isExportingVideo}
            title={t("videoDownloadTitle")}
          />
          <ToolbarPrimaryAction
            buttonText={t("generateFullText")}
            helperText={t("generateFullTextHelper")}
            onClick={triggerManualFullTextApply}
            disabled={!lyricsText.trim()}
            title={t("generateFullTextTitle")}
          />
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 8 }}>
          {isAutoGenerating ? (
            <span style={{ fontSize: 12, color: "#1565c0", fontWeight: 600 }}>{t("autoGeneratingEllipsis")}</span>
          ) : null}
          {autoGenerationError ? (
            <span style={{ fontSize: 12, color: "#c62828", fontWeight: 600 }}>{autoGenerationError}</span>
          ) : null}
          {applyFeedback ? (
            <span
              style={{
                fontSize: 12,
                color: "#16a34a",
              }}
            >
              {applyFeedback}
            </span>
          ) : null}
          {isAutosaving ? (
            <span style={{ fontSize: 11, color: "#6b7280" }}>{t("autosavingEllipsis")}</span>
          ) : lastAutosavedAt ? (
            <span style={{ fontSize: 11, color: "#6b7280" }}>
              {t("autosavedLabel")}{" "}
              {new Date(lastAutosavedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          ) : null}
        </div>
        <p style={{ margin: "0 0 8px", fontSize: 12, color: "#666", lineHeight: 1.5 }}>
          {t("autoPipelineDescription")
            .replace("{debounceSec}", String(AUTO_LYRICS_PIPELINE_DEBOUNCE_MS / 1000))
            .replace("{minChars}", String(MIN_LYRICS_FOR_AUTO_PIPELINE))}
        </p>
        {localMaterialVideo ? (
          <p style={{ margin: "0 0 8px", fontSize: 12, color: "#374151", lineHeight: 1.5 }}>
            {t("localMp4Note").replace("{name}", localMaterialVideo.name)}
          </p>
        ) : null}
        {exportVideoMessage ? (
          <p style={{ margin: "0 0 8px", fontSize: 12, color: "#1565c0", lineHeight: 1.5 }}>
            {exportVideoMessage}
          </p>
        ) : null}
        <textarea
          className="lyrics-full-textarea"
          value={lyricsText}
          onChange={(e) => setLyricsText(e.target.value)}
          rows={6}
          placeholder={lyricsFullPlaceholder}
          style={{ width: "100%", maxWidth: 900, minHeight: 120, fontFamily: "ui-monospace, monospace" }}
        />
      </div>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          overflow: "hidden",
          maxWidth: 900,
          width: "100%",
          background: "#fff",
          boxSizing: "border-box" as const,
        }}
      >
        <button
          type="button"
          aria-expanded={isAudioSectionsOpen}
          aria-controls="sync-audio-sections-content"
          id="sync-audio-sections-heading"
          onClick={() => setIsAudioSectionsOpen((v) => !v)}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 14px",
            border: "none",
            background: "#f3f4f6",
            cursor: "pointer",
            textAlign: "left",
            fontFamily: "inherit",
            fontSize: 15,
            fontWeight: 600,
            color: "#111",
          }}
        >
          <span>
            {t("voiceSegmentsCollapsible")}（{segments.length} {t("segmentCountSuffix")}）
          </span>
          <span aria-hidden style={{ flexShrink: 0, fontSize: 12, color: "#555" }}>
            {isAudioSectionsOpen ? "▼" : "▶"}
          </span>
        </button>
        {isAudioSectionsOpen ? (
          <div
            id="sync-audio-sections-content"
            role="region"
            aria-labelledby="sync-audio-sections-heading"
            style={{ padding: 12, borderTop: "1px solid #e8e8e8" }}
          >
            {segments.length === 0 ? (
              <div style={{ padding: "4px 0", color: "#555" }}>
                <p style={{ margin: "0 0 12px", lineHeight: 1.6 }}>{t("voiceSectionsEmptyIntro")}</p>
                <ul style={{ margin: "0 0 12px", paddingLeft: 20, lineHeight: 1.8 }}>
                  <li>
                    <strong>{t("voiceSectionsAutoHeading")}</strong>: {t("voiceSectionsAutoHowto")}
                  </li>
                  <li>
                    <strong>{t("voiceSectionsManualHeading")}</strong>: {t("voiceSectionsManualHowto")}
                  </li>
                </ul>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={handleBulkAssignLyricsToSegments}
                    disabled
                    title={t("bulkAssignDisabledTitle")}
                    style={{ opacity: 0.7 }}
                  >
                    {t("bulkAssignLyricsButton")}
                  </button>
                  <span style={{ fontSize: 12, color: "#888" }}>{t("bulkAssignDisabledNote")}</span>
                </div>
              </div>
            ) : (
              <>
                <p style={{ margin: "0 0 12px", fontSize: 13, color: "#555", lineHeight: 1.5 }}>
                  {t("segmentTableHint")}
                </p>
                <div style={{ maxHeight: 280, overflowY: "auto", marginBottom: 12 }}>
                  <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #ccc", width: 36 }}>#</th>
                        <th style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #ccc", width: 90 }}>
                          start(s)
                        </th>
                        <th style={{ textAlign: "right", padding: 6, borderBottom: "1px solid #ccc", width: 90 }}>
                          end(s)
                        </th>
                        <th style={{ textAlign: "left", padding: 6, borderBottom: "1px solid #ccc" }}>text</th>
                      </tr>
                    </thead>
                    <tbody>
                      {segments.map((seg, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                          <td style={{ padding: 6, textAlign: "right", color: "#666" }}>{i + 1}</td>
                          <td style={{ padding: 6 }}>
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              value={seg.start}
                              onChange={(e) =>
                                setSegments((prev) =>
                                  prev.map((s, j) =>
                                    j === i ? { ...s, start: Number(e.target.value) || 0 } : s
                                  )
                                )
                              }
                              style={{ width: 82, textAlign: "right" }}
                            />
                          </td>
                          <td style={{ padding: 6 }}>
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              value={seg.end}
                              onChange={(e) =>
                                setSegments((prev) =>
                                  prev.map((s, j) =>
                                    j === i ? { ...s, end: Number(e.target.value) || 0 } : s
                                  )
                                )
                              }
                              style={{ width: 82, textAlign: "right" }}
                            />
                          </td>
                          <td style={{ padding: 6, verticalAlign: "top" }}>
                            <textarea
                              value={seg.text}
                              onChange={(e) =>
                                setSegments((prev) =>
                                  prev.map((s, j) => (j === i ? { ...s, text: e.target.value } : s))
                                )
                              }
                              rows={3}
                              style={{
                                width: "100%",
                                minWidth: 120,
                                resize: "vertical",
                                boxSizing: "border-box",
                              }}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>{t("lyricsOneLinePerSegmentNote")}</div>
                  <textarea
                    className="lyrics-full-textarea"
                    value={lyricsText}
                    onChange={(e) => setLyricsText(e.target.value)}
                    rows={5}
                    placeholder={lyricsFullPlaceholder}
                    style={{
                      width: "100%",
                      maxWidth: 900,
                      minHeight: 100,
                      fontFamily: "ui-monospace, monospace",
                    }}
                  />
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" onClick={handleAssignLyricsToSegments}>
                    {t("assignLyricsToSegmentsShort")}
                  </button>
                  <button type="button" onClick={handleSaveSegments} disabled={isSavingSegments}>
                    {isSavingSegments ? t("savingEllipsis") : t("save")}
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkAssignLyricsToSegments}
                    title={t("bulkAssignLyricsButton")}
                  >
                    {t("bulkAssignLyricsButton")}
                  </button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>

      <VoiceSegmentPanel
        ref={segmentPanelRef}
        videoId={videoId}
        videoUrl={currentVideoUrl}
        videoDuration={videoDuration}
        currentTimeSec={nowSec}
        activeLineId={activeLineId}
        onSetLyricStartSec={setStartToSec}
        onSetLyricEndSec={setEndToSec}
        onBulkAssignToLyrics={handleBulkAssignToLyrics}
        onOverlaysChange={setOverlays}
        onSyncPreviewLyrics={setPanelSyncCaptionText}
        onPanelStateDirty={bumpPanelAutosaveTick}
        onVoiceSegmentsChange={handleVoiceSegmentsChange}
        onSegmentTextsChange={handleSegmentTextsChange}
        lyricLineCount={safeLines.length}
        onPlay={handlePanelVideoPlay}
        onPause={handlePanelVideoPause}
        onSeek={handlePanelVideoSeekDelta}
        onSeekToSec={handlePanelSeekToSec}
        onSegmentPlayStart={handleSegmentPlayStartStable}
        applyFromSource={applyManualFullTextSource}
        onApplyComplete={(r) => {
          const applied = r.sourceText?.trim() ?? "";
          if (applied) lastAutoGeneratedLyricsRef.current = applied;
          const parts: string[] = [];
          if (r.phraseCount > 0) parts.push(`${t("phraseQueue")} ${r.phraseCount}`);
          if (r.imageCount > 0) parts.push(`${t("imageCandidatesHeading")} ${r.imageCount}`);
          setApplyFeedback(
            parts.length > 0
              ? t("feedbackManualDone").replace("{parts}", parts.join(" / "))
              : t("feedbackUpdated")
          );
          setTimeout(() => setApplyFeedback(null), 4000);
        }}
        previewRowIndex={previewRowIndex}
        setPreviewRowIndex={setPreviewRowIndex}
        previewAspectRatio={previewAspectRatio}
      />
        </div>
      </div>
    </div>
      </div>

      <input
        ref={projectFileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleProjectInputChange}
        style={{ display: "none" }}
      />
      <input
        ref={materialMp4InputRef}
        type="file"
        accept="video/mp4,.mp4"
        onChange={handleMaterialMp4InputChange}
        style={{ display: "none" }}
      />
    </>
  );
}
