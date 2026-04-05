"use client";

import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { SearchImageResult } from "@/app/api/search-images/route";
import {
  getPresetParams,
  getSongStyleLabel,
  getDisplayTempoLabel,
  SONG_STYLES,
  DISPLAY_TEMPOS,
  type SongStyle,
  type DisplayTempo,
} from "@/lib/lyrics/displayPresets";
import { autoGeneratePhraseChunks } from "@/lib/lyrics/autoGenerateChunks";
import { phraseifyWithPreset } from "@/lib/lyrics/phraseifyWithPreset";
import { formatSecToMinSec, parseTimeToSec } from "@/lib/time/format";
import { parseLyricsTheme } from "@/lib/theme/parseLyricsTheme";
import {
  IMAGE_TONE_OPTIONS,
  lyricsToSearchTerms,
  type ImageToneId,
} from "@/lib/imageTone";
import {
  getLyricsImageHistory,
  normalizeLyricsForHistoryKey,
  rememberLyricsImageSelection,
  searchResultFromHistory,
  dedupeSearchImageResults,
  searchImageResultStableKey,
  LYRICS_IMAGE_HISTORY_RESULT_ID,
} from "@/lib/lyricsImageHistory";
import {
  getAssistBlendTokens,
  recordManualSearchHistory,
} from "@/lib/searchAssistHistory";
import {
  DEFAULT_SONG_VISUAL_PROFILE,
  MOOD_OPTIONS,
  INTERNATIONAL_OPTIONS,
  PLATFORM_OPTIONS,
  generateSegmentSearchAssist,
  resolveImageSearchApiQuery,
  type SongVisualProfile,
} from "@/lib/songVisualProfile";
import type { VoiceSegment } from "@/lib/vad/sileroVad";
import { ImageSearchQueryCache } from "@/lib/imageSearchCache";
import {
  DEFAULT_LYRICS_FONT_SIZE,
  LYRICS_COLOR_PRESETS,
  LYRICS_FONT_SIZE_MAX,
  LYRICS_FONT_SIZE_MIN,
  SEGMENT_SCREEN_FILTER_OPTIONS,
  clampLyricsFontSize,
  lyricsTextShadowForColor,
  normalizeLyricsColorHex,
  parseSegmentScreenFilter,
  segmentScreenFilterCss,
  type SegmentScreenFilter,
} from "@/lib/segmentVisualStyle";
import { getLyricsDisplayLines, type LyricsCaptionLayoutMode } from "@/lib/lyricsCaptionLayout";
import {
  getPreviewAspectLayout,
  PREVIEW_MEDIA_BOX_CONTAIN_STYLE,
  segmentModalPreviewFullCssFromLayout,
  type PreviewAspectRatio,
} from "@/lib/previewAspectLayout";
import { renderMosaicRegionToCanvas } from "@/lib/privacyMaskCanvas";
import { PreviewLyricsCaptionAutoFit } from "@/lib/previewLyricsCaptionAutoFit";
import { useUiLocale } from "@/lib/i18n/UiLocaleProvider";

/** コンソールで区間一覧サムネを追跡: localStorage.setItem("adVideoDebugTimelineThumb", "1") 後に再読込 */
function shouldLogTimelineThumbDebug(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("adVideoDebugTimelineThumb") === "1";
  } catch {
    return false;
  }
}

/** フレーズキュー1行（安定 id。start/end はタイムライン行と同期し、表示・区間再生は id 参照を優先） */
export type LyricPhraseQueueItem = {
  id: string;
  text: string;
  startSec?: number;
  endSec?: number;
};

/** フレーズに紐づく区間秒（未設定・無効時は null） */
function pickPhraseSegmentTimes(
  phrase: LyricPhraseQueueItem | null | undefined
): { startSec: number; endSec: number } | null {
  if (!phrase) return null;
  const s = phrase.startSec;
  const e = phrase.endSec;
  if (typeof s !== "number" || !Number.isFinite(s) || typeof e !== "number" || !Number.isFinite(e)) return null;
  if (!(e > s)) return null;
  return { startSec: s, endSec: e };
}

function newPhraseQueueId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `pq-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function isPortableRemoteMediaUrl(u: string): boolean {
  const t = (u ?? "").trim();
  return t.startsWith("https://") || t.startsWith("http://");
}

/** phraseQueue の行テキストと segmentTexts が片方だけ進んでいる場合でも、コピーに使う本文を決める */
function canonicalPhraseLineText(phraseText: string, segmentText: string): string {
  const p = phraseText ?? "";
  const s = segmentText ?? "";
  const pt = p.trim();
  const st = s.trim();
  if (!pt && !st) return "";
  if (!pt) return s;
  if (!st) return p;
  if (p === s) return p;
  return s.length >= p.length ? s : p;
}

function stringsToPhraseQueueItems(texts: string[]): LyricPhraseQueueItem[] {
  return texts.map((text) => ({ id: newPhraseQueueId(), text, startSec: undefined, endSec: undefined }));
}

/** 旧 string[] または {id,text}[] を読み込み */
function normalizePhraseQueueImport(raw: unknown): LyricPhraseQueueItem[] {
  if (!Array.isArray(raw)) return [];
  const out: LyricPhraseQueueItem[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      out.push({ id: newPhraseQueueId(), text: item });
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const text = typeof o.text === "string" ? o.text : "";
      const id = typeof o.id === "string" && o.id.trim() !== "" ? o.id : newPhraseQueueId();
      const startSec =
        typeof o.startSec === "number" && Number.isFinite(o.startSec) ? o.startSec : undefined;
      const endSec = typeof o.endSec === "number" && Number.isFinite(o.endSec) ? o.endSec : undefined;
      out.push({ id, text, startSec, endSec });
    }
  }
  return out;
}

/** フレーズキュー行の DnD（タイムラインへのドロップ）用 */
const DRAG_PHRASE_QUEUE_INDEX_KEY = "application/x-lyric-index";

type LyricPhraseQueueRowProps = {
  item: LyricPhraseQueueItem;
  index: number;
  isActive: boolean;
  queueLength: number;
  listItemRef: (el: HTMLLIElement | null) => void;
  onSelect: () => void;
  onDoubleClickInsert: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onSplit: () => void;
  onJoin: () => void;
  /** この行だけを内部クリップボードへ（選択・再生・スクロールに依存しない） */
  onCopyThisRow?: (e: React.MouseEvent<HTMLButtonElement>) => void;
};

const LyricPhraseQueueRow = memo(function LyricPhraseQueueRow({
  item,
  index,
  isActive,
  queueLength,
  listItemRef,
  onSelect,
  onDoubleClickInsert,
  onMoveUp,
  onMoveDown,
  onSplit,
  onJoin,
  onCopyThisRow,
}: LyricPhraseQueueRowProps) {
  const phraseQueueRowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: isActive ? "10px 8px" : "6px 8px",
    background: isActive ? "#fff4e0" : "transparent",
    borderBottom: "1px solid #eee",
    cursor: "grab",
    borderRadius: isActive ? 4 : 0,
    boxShadow: isActive
      ? "inset 4px 0 0 #e89520, 0 1px 3px rgba(0,0,0,0.06)"
      : "none",
  };
  return (
    <li
      ref={listItemRef}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", item.text);
        e.dataTransfer.setData(DRAG_PHRASE_QUEUE_INDEX_KEY, String(index));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button") != null) return;
        e.stopPropagation();
        onSelect();
      }}
      onDoubleClick={(e) => {
        if ((e.target as HTMLElement).closest("button") != null) return;
        e.stopPropagation();
        e.preventDefault();
        onDoubleClickInsert();
      }}
      style={phraseQueueRowStyle}
      title="クリック: 対応するタイムライン区間を編集対象にする / ダブルクリック: 編集中区間の歌詞に挿入"
    >
      <span
        style={{
          minWidth: 28,
          fontSize: 13,
          fontWeight: isActive ? 600 : 400,
          color: isActive ? "#c76a0f" : "#666",
        }}
      >
        {index + 1}
      </span>
      <span style={{ flex: 1, wordBreak: "break-all", fontSize: 14, lineHeight: 1.4 }}>{item.text}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onMoveUp();
        }}
        disabled={index === 0}
        title="上へ"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onMoveDown();
        }}
        disabled={index === queueLength - 1}
        title="下へ"
      >
        ↓
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onSplit();
        }}
        title="分割"
      >
        分割
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onJoin();
        }}
        disabled={index === queueLength - 1}
        title="結合"
      >
        結合
      </button>
      {onCopyThisRow ? (
        <button
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onCopyThisRow(e);
          }}
          title="この行を内部コピー（再生しない・上の再生バーと誤爆しにくい）"
          style={{ padding: "2px 6px", fontSize: 11, flexShrink: 0 }}
        >
          行コピー
        </button>
      ) : null}
    </li>
  );
});

export type { SegmentScreenFilter };

/** 区間オーバーレイのメディア種別（画像 / 動画 / なし） */
export type SegmentMediaType = "none" | "image" | "video";
/** ミニ合成の隠しパターンは mosaic / blackMaskWithBrand のみ */
export type SegmentCompositeMode = "none" | "mosaic" | "blackMaskWithBrand";

/** 矩形モザイク（1区間に複数可。位置・サイズはプレビューステージに対する%） */
export type SegmentMosaicRegion = {
  id: string;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  /** ピクセルブロック一辺（5〜40） */
  pixelSize: number;
  /** 0–1 任意の上乗せ暗幕 */
  opacity: number;
};

/** 黒塗り + 中央「gegenpress app」（1区間に複数可） */
export type SegmentBrandMaskRegion = {
  id: string;
  xPct: number;
  yPct: number;
  wPct: number;
  hPct: number;
  /** 0–1（黒 0.85 への乗算） */
  opacity: number;
};

/** 将来の名前照合・プリセット用（現状は保存のみ。表示は nameArea 固定） */
export type HiddenNameRule = {
  id: string;
  name: string;
  mode: "mosaic" | "blackMaskWithBrand";
};

/** コメント名前欄の固定矩形に自動でモザイク／黒塗りを重ねるプリセット */
export type NameMaskPreset = {
  enabled: boolean;
  nameArea: { xPct: number; yPct: number; wPct: number; hPct: number };
  defaultMode: "mosaic" | "blackMaskWithBrand";
  applyScope: "all" | "segment";
  applySegmentIndex: number;
  mosaicPixelSize: number;
  mosaicOpacity: number;
  brandOpacity: number;
  rules: HiddenNameRule[];
};

export type SegmentOverlayPosition =
  | "center"
  | "topLeft"
  | "topRight"
  | "bottomLeft"
  | "bottomRight";

export type OverlayData = {
  startSec: number;
  endSec: number;
  /** 親プレビューから区間インデックスを参照するため（computeOverlays で付与） */
  segmentIndex?: number;
  text?: string;
  /** 画像 URL（mediaType が image のとき） */
  imageUrl?: string;
  anim?: string;
  mediaType?: SegmentMediaType;
  videoUrl?: string;
  /** 素材動画の再生開始オフセット（秒）。未指定時は 0 扱い */
  videoStart?: number;
  /** 素材動画の再生終了（秒・ソース上）。未指定時は区間長に合わせる想定で将来拡張 */
  videoEnd?: number;
  /** ミュート（仕様上の `muted` と同義。未指定時は音声あり） */
  videoMuted?: boolean;
  /** 動画のポスター画像 URL（未実装時は未設定のまま。重いサムネ生成はしない） */
  posterUrl?: string;
  objectFit?: "cover" | "contain";
  compositeEnabled?: boolean;
  compositeMode?: SegmentCompositeMode;
  /** compositeMode === "mosaic" のとき */
  mosaicRegions?: SegmentMosaicRegion[];
  /** compositeMode === "blackMaskWithBrand" のとき */
  brandMaskRegions?: SegmentBrandMaskRegion[];

  overlayImageUrl?: string;
  overlayText?: string;
  overlayOpacity?: number;
  overlayScaleX?: number;
  overlayScaleY?: number;
  overlayPosition?: SegmentOverlayPosition;
  overlayX?: number;
  overlayY?: number;
  textX?: number;
  textY?: number;
  /** プレビュー用: 歌詞フォント px（24–72） */
  lyricsFontSize?: number;
  /** プレビュー用: 歌詞色 #RRGGBB */
  lyricsColor?: string;
  /** プレビュー用: 画面全体フィルター（メディア＋合成） */
  screenFilter?: SegmentScreenFilter;
};

export type TimelineSegment = {
  startSec: number;
  endSec: number;
  type: "voice" | "silence" | "interlude";
  /** 末尾の固定ブランディング区間 */
  isBranding?: boolean;
};

export type TimelineSegmentWithId = TimelineSegment & { id: string };

function buildTimelineSegments(
  voiceSegments: VoiceSegment[],
  duration: number | null
): TimelineSegment[] {
  const sorted = [...voiceSegments].sort((a, b) => a.startSec - b.startSec);
  if (sorted.length === 0) {
    if (duration != null && duration > 0) {
      return [{ startSec: 0, endSec: duration, type: "silence" }];
    }
    return [];
  }
  if (duration == null || !Number.isFinite(duration) || duration <= 0) {
    return sorted.map((s) => ({ ...s, type: "voice" as const }));
  }
  const out: TimelineSegment[] = [];
  const first = sorted[0]!;
  if (first.startSec > 0) {
    out.push({ startSec: 0, endSec: first.startSec, type: "silence" });
  }
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i]!;
    out.push({ startSec: v.startSec, endSec: v.endSec, type: "voice" });
    const next = sorted[i + 1];
    if (next != null && next.startSec > v.endSec) {
      out.push({ startSec: v.endSec, endSec: next.startSec, type: "silence" });
    }
  }
  const last = sorted[sorted.length - 1]!;
  if (last.endSec < duration) {
    out.push({ startSec: last.endSec, endSec: duration, type: "silence" });
  }
  return out;
}

/** JSON / autosave から復元する timelineSegments を検証・正規化 */
function normalizeImportedTimelineSegments(raw: unknown): TimelineSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: TimelineSegment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const startSec = typeof o.startSec === "number" && Number.isFinite(o.startSec) ? o.startSec : NaN;
    const endSec = typeof o.endSec === "number" && Number.isFinite(o.endSec) ? o.endSec : NaN;
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) continue;
    const t = o.type;
    const type: TimelineSegment["type"] =
      t === "voice" || t === "silence" || t === "interlude" ? t : "silence";
    const isBranding = o.isBranding === true;
    if (isBranding) {
      out.push({ startSec, endSec, type, isBranding: true });
    } else {
      out.push({ startSec, endSec, type });
    }
  }
  return out;
}

/** 派生タイムライン再計算で import 済み行を誤って上書きしないための比較キー */
function timelineTimesFingerprint(segs: TimelineSegment[]): string {
  const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
  return JSON.stringify(
    segs.map((s) => [round6(s.startSec), round6(s.endSec), s.type, Boolean(s.isBranding)])
  );
}

/**
 * autosave / JSON 復元の秒ズレ切り分け用。
 * コンソール: localStorage.setItem("adVideoDebugTimelineRestore", "1") 後にページ再読込。
 * 無効化: removeItem("adVideoDebugTimelineRestore")
 */
function shouldLogTimelineRestoreDebug(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("adVideoDebugTimelineRestore") === "1";
  } catch {
    return false;
  }
}

function logTimelineRestore(stage: string, payload: Record<string, unknown>): void {
  if (!shouldLogTimelineRestoreDebug()) return;
  // eslint-disable-next-line no-console
  console.log(`[adVideo timeline-restore] ${stage}`, payload);
}

function timelineSegmentsDebugRows(
  segs: Array<Pick<TimelineSegment, "startSec" | "endSec" | "type"> & { isBranding?: boolean }>
): Array<{ i: number; startSec: number; endSec: number; type: string; brand: boolean }> {
  const round3 = (x: number) => Math.round(x * 1e3) / 1e3;
  return segs.map((s, i) => ({
    i,
    startSec: round3(s.startSec),
    endSec: round3(s.endSec),
    type: s.type,
    brand: Boolean(s.isBranding),
  }));
}

/** 秒表示（入力欄 placeholder 等で秒のみ必要なとき用） */
function formatSec(sec: number) {
  return sec.toFixed(3);
}

/** 区間素材「自分の動画」のアップロード上限 */
const SEGMENT_UPLOAD_VIDEO_MAX_BYTES = 20 * 1024 * 1024;

function isSegmentUploadVideoFormatSupported(f: File): boolean {
  return (
    /video\/(mp4|webm)/i.test(f.type) ||
    /\.(mp4|webm)$/i.test(f.name)
  );
}

function validateSegmentUploadVideoFile(
  f: File
): { ok: true } | { ok: false; message: string } {
  if (!isSegmentUploadVideoFormatSupported(f)) {
    return { ok: false, message: "対応形式は MP4 / WebM のみです。" };
  }
  if (f.size > SEGMENT_UPLOAD_VIDEO_MAX_BYTES) {
    return { ok: false, message: "ファイルサイズは 20MB 以下にしてください。" };
  }
  return { ok: true };
}

/** 区間のタイムライン上の長さ（表示・クリップ同期用） */
function flowSegmentSpanSec(seg: TimelineSegment): number {
  return Math.max(0, seg.endSec - seg.startSec);
}

/** 流れプレビュー終了時刻 = 全行の endSec の最大（固定秒合計ではない） */
function flowTimelineMaxEndSec(segments: TimelineSegment[]): number {
  if (segments.length === 0) return 0;
  let m = 0;
  for (const s of segments) {
    if (s.endSec > m) m = s.endSec;
  }
  return m;
}

/** 切替は startSec のみ（duration ベースの index 進行は使わない） */
function findIndexByStartTime(t: number, segments: TimelineSegment[]): number {
  if (segments.length === 0) return 0;
  const tt = Math.max(0, t);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (tt >= segments[i]!.startSec) {
      return i;
    }
  }
  return 0;
}

/** 自動保存で復元しうるリモート画像（http(s)）。blob / data URL はセッション専用。 */
function isRestorableRemoteImageUrl(u: string): boolean {
  const t = u.trim();
  return (
    (t.startsWith("https://") || t.startsWith("http://")) &&
    t.length > 10 &&
    t.length < 4096
  );
}

function flowPreviewIndexAndLocal(
  t: number,
  segments: TimelineSegment[]
): { index: number; localSec: number } {
  if (segments.length === 0) return { index: 0, localSec: 0 };
  const tt = Math.max(0, t);
  const index = findIndexByStartTime(tt, segments);
  const seg = segments[index]!;
  return { index, localSec: Math.max(0, tt - seg.startSec) };
}

const CROP_SIZE_RATIO = 0.6;

type CropType = "center" | "left" | "right" | "top" | "bottom";

function cropImage(
  img: HTMLImageElement,
  type: CropType
): string | null {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const cw = Math.floor(w * CROP_SIZE_RATIO);
  const ch = Math.floor(h * CROP_SIZE_RATIO);
  let sx = 0;
  let sy = 0;
  switch (type) {
    case "center":
      sx = Math.floor((w - cw) / 2);
      sy = Math.floor((h - ch) / 2);
      break;
    case "left":
      sx = 0;
      sy = Math.floor((h - ch) / 2);
      break;
    case "right":
      sx = w - cw;
      sy = Math.floor((h - ch) / 2);
      break;
    case "top":
      sx = Math.floor((w - cw) / 2);
      sy = 0;
      break;
    case "bottom":
      sx = Math.floor((w - cw) / 2);
      sy = h - ch;
      break;
  }
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, sx, sy, cw, ch, 0, 0, cw, ch);
  return canvas.toDataURL("image/png");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!src.startsWith("data:") && !src.startsWith("blob:")) {
      img.crossOrigin = "anonymous";
    }
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const ANIM_OPTIONS = [
  { value: "none", label: "none" },
  { value: "fade", label: "fade" },
  { value: "slideR2L", label: "slideR2L" },
  { value: "slideL2R", label: "slideL2R" },
  { value: "zoomIn", label: "zoomIn" },
] as const;

const LOCAL_UPLOAD_AUTOSAVE_HINT_LS_KEY = "segmentLocalImageAutosaveHintSuppress";

function isNarrowViewportForLocalUploadHint(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 768px)").matches;
}

type Props = {
  videoUrl: string;
  videoDuration: number | null;
  /** 再生ヘッド現在時刻（秒） */
  currentTimeSec: number;
  activeLineId: number | null;
  onSetLyricStartSec: (sec: number) => void;
  onSetLyricEndSec: (sec: number) => void;
  onBulkAssignToLyrics: (segments: VoiceSegment[]) => void;
  onOverlaysChange: (overlays: OverlayData[]) => void;
  /** 同期プレビュー左の歌詞1行目用。編集中は localSegmentText、未編集時は再生ヘッド区間の歌詞のみ（親はこれ以外から組み立てない） */
  onSyncPreviewLyrics?: (text: string) => void;
  /** パネル内 state が変わったが親の overlays 等が更新されない場合でも autosave を走らせるための通知（例: lyricsQueue / lyricsFullText） */
  onPanelStateDirty?: () => void;
  /** 音声区間生成後に親に渡す（歌詞一括割当用） */
  onVoiceSegmentsChange?: (segments: VoiceSegment[]) => void;
  /** 枠の歌詞テキスト（声区間のみ・複数行可）が変更されたときに親に渡す */
  onSegmentTextsChange?: (texts: string[]) => void;
  lyricLineCount: number;
  /** 右カラムの再生操作用（親の video を制御） */
  onPlay?: () => void;
  onPause?: () => void;
  onSeek?: (deltaSec: number) => void;
  /** 指定秒へ絶対シーク（0〜duration にクランプ） */
  onSeekToSec?: (sec: number) => void;
  /** 区間再生開始時（演出を再発火するため親がトリガーを更新） */
  onSegmentPlayStart?: () => void;
  /** 親の「歌詞全文」から反映トリガー。id が変わったら sourceLyricsText で一括生成（手動ボタンのみ） */
  applyFromSource?: { text: string; id: number };
  /** 一括生成完了時のフィードバック（sourceText は実際に一括生成に使った全文） */
  onApplyComplete?: (result: {
    phraseCount: number;
    imageCount: number;
    sourceText: string;
  }) => void;
  /** 親の applyFromSource による非同期処理終了時（成功・キャンセル・置き換え）に毎回呼ぶ */
  onApplyFromSourceFinished?: () => void;
  /** 親でプレビュー開閉を制御する場合（指定時は編集UIを親側で非マウントする想定） */
  previewRowIndex?: number | null;
  setPreviewRowIndex?: (index: number | null) => void;
  /** 動画 ID（検索補助の曲ごと履歴用。未指定時は全体履歴のみ） */
  videoId?: number;
  /** 表示・書き出しと共通のアスペクト比（流れ/区間プレビュー枠） */
  previewAspectRatio?: PreviewAspectRatio;
};

/** 親から ref 経由で呼ぶ自動パイプライン（全文一括 → タイムライン自動生成） */
export type VoiceSegmentPanelHandle = {
  runAutoLyricPipeline: (fullText: string) => Promise<{
    ok: boolean;
    phraseCount?: number;
    imageCount?: number;
    error?: string;
  }>;
  exportProjectState: () => VoiceSegmentPanelProjectState;
  importProjectState: (state: VoiceSegmentPanelProjectState) => void;
  /** 保存済み URL が失効したとき Pixabay ID で再取得（同期プレビュー img onError 用） */
  retryPixabayImageAfterLoadFailure: (segmentIndex: number, failedImageUrl: string) => void;
};

export type VoiceSegmentPanelProjectState = {
  timelineSegments: TimelineSegment[];
  lyricsFullText?: string;
  /** 旧形式（string[]）も import で受け付ける */
  lyricsQueue?: string[];
  /** 推奨: 安定 id 付きフレーズ行 */
  phraseQueue?: LyricPhraseQueueItem[];
  lyricsCursor?: number;
  /** 後方互換: 保存 JSON の行インデックス。復元は editingPhraseId を優先 */
  selectedSegmentIndex?: number;
  /** 編集中フレーズ行（phraseQueue 要素の id。旧保存が segment.id の場合は import 時に行へマップ） */
  editingPhraseId?: string | null;
  flowTimeSec?: number;
  segmentTexts: string[];
  segmentImageUrls: (string | undefined)[];
  segmentVideoUrls: (string | undefined)[];
  segmentMediaTypes: SegmentMediaType[];
  segmentAnims: string[];
  segmentDisplayModes: SegmentModalLyricsLayout[];
  segmentLineBreakAt: number[];
  segmentCompositeEnabled: boolean[];
  segmentCompositeModes: SegmentCompositeMode[];
  /** 省略時は import で空配列パディング */
  segmentMosaicRegions?: SegmentMosaicRegion[][];
  segmentBrandMaskRegions?: SegmentBrandMaskRegion[][];
  segmentOverlayImageUrls: (string | undefined)[];
  segmentOverlayTexts: string[];
  segmentOverlayOpacity: number[];
  segmentOverlayScaleX: number[];
  segmentOverlayScaleY: number[];
  segmentOverlayPosition: SegmentOverlayPosition[];
  segmentOverlayX: number[];
  segmentOverlayY: number[];
  segmentTextX: number[];
  segmentTextY: number[];
  segmentMediaObjectFit: ("cover" | "contain")[];
  segmentVideoMuted: boolean[];
  /** 省略時は import 側で既定値パディング */
  segmentLyricsFontSize?: number[];
  segmentLyricsColor?: string[];
  segmentScreenFilters?: SegmentScreenFilter[];
  /** 区間ごとの画像選択メタ（歌詞文脈・検索語・選択元など） */
  segmentImageSelections?: (SegmentImageSelectionMeta | null)[];
  /** 名前欄固定矩形の自動隠し（省略時は import で既定値） */
  nameMaskPreset?: NameMaskPreset;
};

export type SegmentImageSelectionMeta = {
  lyricText: string;
  searchKeywords: string;
  searchTags?: string[];
  imageSource: "suggested" | "uploaded";
  pixabayImageId?: number;
  imageUrl: string;
  previewUrl?: string;
  apiRank?: number;
  boostScore?: number;
  boostReason?: string;
  pageUrl?: string;
  selectedAt: string;
  /** 自動保存復元後など、端末内ファイルの再指定が必要 */
  localImageNeedsReselect?: boolean;
};

/** 区間メイン画像（一覧・モーダル）の読み込み状態 */
export type SegmentImageLoadState = "idle" | "loading" | "loaded" | "error";

/** 自動パイプライン内のタイムライン結合の目安秒数（約3秒/画面切替） */
const AUTO_PIPELINE_SECONDS_PER_SCREEN = 3;
const BRANDING_SEGMENT_SEC = 2.0;
const BRANDING_TEXT = "created with gegenpress app";
/** 自動パイプラインを起動する歌詞全文の最小長（親と共通） */
export const MIN_LYRICS_FOR_AUTO_PIPELINE = 8;

/** 区間編集モーダル内プレビューの歌詞レイアウト（1行/2行/縦書き） */
export type SegmentModalLyricsLayout = LyricsCaptionLayoutMode;

/** 再生・システムクリップボードと分離したフレーズ単位の内部コピー用 */
type PhraseClipboardV1 = {
  v: 1;
  text: string;
  startSec: number;
  endSec: number;
  canApplyTiming: boolean;
  mediaType: SegmentMediaType;
  anim: string;
  displayMode: SegmentModalLyricsLayout;
  lineBreakAt: number;
  imageUrl?: string;
  videoUrl?: string;
};

/** 区間編集モーダル: 検索補助クエリから取得する画像候補の最大枚数（仕様 3〜6 枚想定） */
const PREVIEW_MODAL_SUGGEST_IMAGE_CAP = 6;
/** Pixabay 1ページあたりの取得枚数（初期・「さらに」共通） */
const PREVIEW_MODAL_SUGGEST_PER_PAGE = 6;
/** 候補画像一覧の独立スクロール領域の高さ（固定で画面揺れ防止） */
const MODAL_SUGGEST_LIST_MIN_HEIGHT = 200;
const MODAL_SUGGEST_LIST_MAX_HEIGHT = "min(286px, 45vh)";
const COMPOSITE_MODE_OPTIONS: Array<{ value: SegmentCompositeMode; label: string }> = [
  { value: "mosaic", label: "mosaic（ピクセルモザイク）" },
  { value: "blackMaskWithBrand", label: "blackMaskWithBrand（黒塗り＋gegenpress app）" },
];

const PRIVACY_BRAND_LABEL = "gegenpress app";

function normalizeImportedCompositeMode(raw: unknown): SegmentCompositeMode {
  if (raw === "mosaic" || raw === "blackMaskWithBrand") return raw;
  return "none";
}

function clampMosaicScalar(n: unknown, lo: number, hi: number, fallback: number): number {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(hi, Math.max(lo, x));
}

function normalizeImportedMosaicRegions(raw: unknown): SegmentMosaicRegion[] {
  if (!Array.isArray(raw)) return [];
  const out: SegmentMosaicRegion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const legacyBlur = clampMosaicScalar(o.blurPx, 0, 48, 12);
    const pixelFromLegacy = Math.round(5 + (legacyBlur / 48) * 35);
    const pixelSize =
      o.pixelSize !== undefined
        ? clampMosaicScalar(o.pixelSize, 5, 40, 14)
        : pixelFromLegacy;
    out.push({
      id: typeof o.id === "string" && o.id.trim() !== "" ? o.id : newPhraseQueueId(),
      xPct: clampMosaicScalar(o.xPct, 0, 100, 42),
      yPct: clampMosaicScalar(o.yPct, 0, 100, 45),
      wPct: clampMosaicScalar(o.wPct, 5, 100, 16),
      hPct: clampMosaicScalar(o.hPct, 5, 100, 10),
      opacity: clampMosaicScalar(o.opacity, 0, 1, 0.25),
      pixelSize,
    });
  }
  return out;
}

function normalizeImportedBrandMaskRegions(raw: unknown): SegmentBrandMaskRegion[] {
  if (!Array.isArray(raw)) return [];
  const out: SegmentBrandMaskRegion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    out.push({
      id: typeof o.id === "string" && o.id.trim() !== "" ? o.id : newPhraseQueueId(),
      xPct: clampMosaicScalar(o.xPct, 0, 100, 22),
      yPct: clampMosaicScalar(o.yPct, 0, 100, 41),
      wPct: clampMosaicScalar(o.wPct, 5, 100, 56),
      hPct: clampMosaicScalar(o.hPct, 5, 100, 18),
      opacity: clampMosaicScalar(o.opacity, 0, 1, 1),
    });
  }
  return out;
}

const DEFAULT_NAME_MASK_PRESET: NameMaskPreset = {
  enabled: false,
  nameArea: { xPct: 2, yPct: 6, wPct: 42, hPct: 12 },
  defaultMode: "mosaic",
  applyScope: "all",
  applySegmentIndex: 0,
  mosaicPixelSize: 14,
  mosaicOpacity: 0.28,
  brandOpacity: 1,
  rules: [],
};

function normalizeImportedNameMaskPreset(raw: unknown, timelineLen: number): NameMaskPreset {
  const d = DEFAULT_NAME_MASK_PRESET;
  if (!raw || typeof raw !== "object") return { ...d, rules: [] };
  const o = raw as Record<string, unknown>;
  const area = o.nameArea && typeof o.nameArea === "object" ? (o.nameArea as Record<string, unknown>) : {};
  const rulesRaw = Array.isArray(o.rules) ? o.rules : [];
  const rules: HiddenNameRule[] = [];
  for (const item of rulesRaw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : "";
    const mode = r.mode === "blackMaskWithBrand" ? "blackMaskWithBrand" : "mosaic";
    rules.push({
      id: typeof r.id === "string" && r.id.trim() !== "" ? r.id : newPhraseQueueId(),
      name,
      mode,
    });
  }
  const maxSegIdx = Math.max(0, timelineLen - 1);
  return {
    enabled: Boolean(o.enabled),
    nameArea: {
      xPct: clampMosaicScalar(area.xPct, 0, 100, d.nameArea.xPct),
      yPct: clampMosaicScalar(area.yPct, 0, 100, d.nameArea.yPct),
      wPct: clampMosaicScalar(area.wPct, 5, 100, d.nameArea.wPct),
      hPct: clampMosaicScalar(area.hPct, 5, 100, d.nameArea.hPct),
    },
    defaultMode: o.defaultMode === "blackMaskWithBrand" ? "blackMaskWithBrand" : "mosaic",
    applyScope: o.applyScope === "segment" ? "segment" : "all",
    applySegmentIndex: Math.min(
      maxSegIdx,
      Math.max(0, Math.floor(clampMosaicScalar(o.applySegmentIndex, 0, maxSegIdx, 0)))
    ),
    mosaicPixelSize: clampMosaicScalar(o.mosaicPixelSize, 5, 40, d.mosaicPixelSize),
    mosaicOpacity: clampMosaicScalar(o.mosaicOpacity, 0, 1, d.mosaicOpacity),
    brandOpacity: clampMosaicScalar(o.brandOpacity, 0, 1, d.brandOpacity),
    rules,
  };
}

function defaultMosaicRegion(): SegmentMosaicRegion {
  return {
    id: newPhraseQueueId(),
    xPct: 42,
    yPct: 45,
    wPct: 16,
    hPct: 10,
    pixelSize: 14,
    opacity: 0.25,
  };
}

function defaultBrandMaskRegion(): SegmentBrandMaskRegion {
  return {
    id: newPhraseQueueId(),
    xPct: 22,
    yPct: 41,
    wPct: 56,
    hPct: 18,
    opacity: 1,
  };
}
const OVERLAY_POSITION_OPTIONS: Array<{ value: SegmentOverlayPosition; label: string }> = [
  { value: "center", label: "中央" },
  { value: "topLeft", label: "左上" },
  { value: "topRight", label: "右上" },
  { value: "bottomLeft", label: "左下" },
  { value: "bottomRight", label: "右下" },
];

/**
 * メイン（トップ）パネルの「画像候補①広告」「画像候補②Pixabay」・タグチップ・再検索・青枠向け一覧。
 * false で非表示（関連 state / ハンドラは維持）。区間編集モーダル内の画像・検索 UI は常に表示。
 */
const SHOW_MAIN_EDITOR_IMAGE_CANDIDATE_UI = false;

/** 候補サムネのみ表示（一覧では大画像 URL を読まない） */
const ModalSuggestImageTile = memo(function ModalSuggestImageTile({
  img,
  selected,
  onSelect,
}: {
  img: SearchImageResult;
  selected: boolean;
  onSelect: () => void;
}) {
  const thumb = img.previewUrl?.trim() ?? "";
  const title = img.title ? `${img.title} をこの区間の背景に設定` : "この区間の背景に設定";
  return (
    <button
      type="button"
      title={title}
      onClick={onSelect}
      style={{
        position: "relative",
        padding: 0,
        border: selected ? "3px solid #1565c0" : "2px solid #ddd",
        borderRadius: 6,
        overflow: "hidden",
        cursor: "pointer",
        background: "#fff",
        width: 108,
        height: 72,
        flexShrink: 0,
        boxShadow: selected ? "0 0 0 2px rgba(21,101,192,0.25)" : undefined,
      }}
    >
      {selected ? (
        <span
          style={{
            position: "absolute",
            top: 4,
            left: 4,
            zIndex: 1,
            fontSize: 10,
            fontWeight: 700,
            background: "#1565c0",
            color: "#fff",
            padding: "2px 6px",
            borderRadius: 4,
          }}
        >
          選択中
        </span>
      ) : null}
      {thumb ? (
        <img
          src={thumb}
          alt=""
          width={108}
          height={72}
          loading="lazy"
          decoding="async"
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            aspectRatio: "3/2",
            backgroundColor: "#eee",
          }}
        />
      ) : (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
            height: "100%",
            fontSize: 11,
            color: "#999",
          }}
        >
          No preview
        </span>
      )}
    </button>
  );
});

const MosaicInteractiveRegion = memo(function MosaicInteractiveRegion({
  region,
  onResizeDown,
  showResizeHandle = true,
}: {
  region: SegmentMosaicRegion;
  onResizeDown: (e: React.MouseEvent | React.TouchEvent) => void;
  /** false のとき表示のみ（名前欄自動隠しなど） */
  showResizeHandle?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const box = boxRef.current;
      const canvas = canvasRef.current;
      if (!box || !canvas) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const root = box.closest("[data-segment-preview-root]");
      const media = root?.querySelector("video, img.preview-pv-img") as HTMLVideoElement | HTMLImageElement | null;
      const W = root?.clientWidth ?? 0;
      const H = root?.clientHeight ?? 0;
      if (!media || W < 4 || H < 4) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const rw = Math.max(2, box.clientWidth);
      const rh = Math.max(2, box.clientHeight);
      const dpr = typeof window !== "undefined" ? Math.min(2, window.devicePixelRatio || 1) : 1;
      const bw = Math.max(2, Math.round(rw * dpr));
      const bh = Math.max(2, Math.round(rh * dpr));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const ok = renderMosaicRegionToCanvas({
          dstCtx: ctx,
          dstW: bw,
          dstH: bh,
          media,
          stageW: W,
          stageH: H,
          region: {
            xPct: region.xPct,
            yPct: region.yPct,
            wPct: region.wPct,
            hPct: region.hPct,
            pixelSize: region.pixelSize,
            opacity: region.opacity,
          },
        });
        if (!ok) {
          ctx.fillStyle = "rgba(50,50,50,0.82)";
          ctx.fillRect(0, 0, bw, bh);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [region.xPct, region.yPct, region.wPct, region.hPct, region.pixelSize, region.opacity]);
  return (
    <>
      <div ref={boxRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        <canvas
          ref={canvasRef}
          style={{ display: "block", width: "100%", height: "100%", pointerEvents: "none" }}
        />
      </div>
      {showResizeHandle ? (
        <div
          role="presentation"
          style={{
            position: "absolute",
            right: 2,
            bottom: 2,
            width: 14,
            height: 14,
            borderRadius: 3,
            background: "rgba(255,255,255,0.85)",
            border: "1px solid rgba(0,0,0,0.25)",
            cursor: "nwse-resize",
            zIndex: 2,
            touchAction: "none",
          }}
          onMouseDown={onResizeDown}
          onTouchStart={onResizeDown}
        />
      ) : null}
    </>
  );
});

export const VoiceSegmentPanel = forwardRef<VoiceSegmentPanelHandle, Props>(function VoiceSegmentPanel(
  {
  videoUrl,
  videoDuration,
  currentTimeSec,
  activeLineId,
  onSetLyricStartSec,
  onSetLyricEndSec,
  onBulkAssignToLyrics,
  onOverlaysChange,
  onSyncPreviewLyrics,
  onPanelStateDirty,
  onVoiceSegmentsChange,
  onSegmentTextsChange,
  lyricLineCount,
  onPlay,
  onPause,
  onSeek,
  onSeekToSec,
  onSegmentPlayStart,
  applyFromSource,
  onApplyComplete,
  onApplyFromSourceFinished,
  previewRowIndex: previewRowIndexProp,
  setPreviewRowIndex: setPreviewRowIndexProp,
  videoId = 0,
  previewAspectRatio = "landscape",
}: Props,
  ref
) {
  const { t, screenFilterLabel, overlayPosLabel } = useUiLocale();
  const applyFromSourceLatestRef = useRef(applyFromSource);
  applyFromSourceLatestRef.current = applyFromSource;
  const applyFullTextTriggerId = applyFromSource == null ? -1 : applyFromSource.id;

  const { aspectLayout, segmentModalPreviewCss } = useMemo(() => {
    const layout = getPreviewAspectLayout(previewAspectRatio);
    return {
      aspectLayout: layout,
      segmentModalPreviewCss: segmentModalPreviewFullCssFromLayout(layout),
    };
  }, [previewAspectRatio]);
  /** 本番タイムラインのソース。手動で作成した声区間のみ（無音は buildTimelineSegments で自動挿入） */
  const [manualVoiceSegments, setManualVoiceSegments] = useState<VoiceSegment[]>([]);
  /**
   * 手動モード用: 1ボタントグルの状態
   * - idle: 声待ち（次の「声開始」を待っている）。停止～次の開始 = 無音区間としてタイムラインに反映される
   * - recordingVoice: 声区間記録中（「声停止」で区間完成）
   */
  const [manualRecordingState, setManualRecordingState] = useState<"idle" | "recordingVoice">("idle");
  /** 手動: 声開始を押したときの currentTime（recordingVoice の間だけ保持） */
  const [pendingVoiceStart, setPendingVoiceStart] = useState<number | null>(null);

  const [lyricsFullText, setLyricsFullText] = useState("");
  const [phraseQueue, setPhraseQueue] = useState<LyricPhraseQueueItem[]>([]);
  /** 編集中タイムライン行の segment.id（単一の真実源。cursor / selectedIndex は廃止） */
  const [editingPhraseId, setEditingPhraseId] = useState<string | null>(null);
  const editingPhraseIdRef = useRef<string | null>(editingPhraseId);
  editingPhraseIdRef.current = editingPhraseId;
  /** import 直後の編集対象復元（レガシー: selectedSegmentIndex） */
  const pendingEditingRowIndexRef = useRef<number | null>(null);
  /** import 直後に復元するフレーズ行 id（最優先） */
  const pendingImportEditingPhraseIdRef = useRef<string | null>(null);
  /** フレーズ単位コピー（再生ハンドラ・OS クリップボードの用途と分離） */
  const phraseClipboardRef = useRef<PhraseClipboardV1 | null>(null);
  const [phraseClipReady, setPhraseClipReady] = useState(false);
  /** コピー成功のフィードバック用（先頭数十文字） */
  const [phraseClipSummary, setPhraseClipSummary] = useState("");
  /** 編集中行の歌詞ドラフト（フレーズ切替時に必ず同期。プレビュー歌詞もこれのみ参照） */
  const [localSegmentText, setLocalSegmentText] = useState("");
  /** 自動生成直後にタイムライン行へ歌詞を流し込むための一時バッファ（voice 行のみ対象） */
  const [pendingAutoLyricChunks, setPendingAutoLyricChunks] = useState<string[] | null>(null);

  const [timelineSegments, setTimelineSegments] = useState<TimelineSegmentWithId[]>([]);
  const [segmentTexts, setSegmentTexts] = useState<string[]>([]);
  const [segmentImageUrls, setSegmentImageUrls] = useState<(string | undefined)[]>([]);
  /** 各区間画像の由来（候補API/検索系 vs ユーザーアップロード等）。表示用・拡張用 */
  const [segmentImageSourceKinds, setSegmentImageSourceKinds] = useState<
    ("suggested" | "uploaded" | null)[]
  >([]);
  const [segmentImageSelections, setSegmentImageSelections] = useState<
    (SegmentImageSelectionMeta | null)[]
  >([]);
  /** 各区間メイン画像の読み込み状態（一覧・区間編集モーダルで共有） */
  const [segmentImageLoadStates, setSegmentImageLoadStates] = useState<SegmentImageLoadState[]>([]);
  /** segmentImageUrls 変化検知（読み込み状態の loading へ戻す） */
  const prevSegmentImageUrlsForLoadRef = useRef<(string | undefined)[]>([]);
  /** 各区間のメディア種別（画像・動画・なし）。画像のみ従来データは URL からも推定 */
  const [segmentMediaTypes, setSegmentMediaTypes] = useState<SegmentMediaType[]>([]);
  const [segmentVideoUrls, setSegmentVideoUrls] = useState<(string | undefined)[]>([]);
  const [segmentVideoStartSec, setSegmentVideoStartSec] = useState<number[]>([]);
  const [segmentVideoEndSec, setSegmentVideoEndSec] = useState<(number | undefined)[]>([]);
  const [segmentVideoMuted, setSegmentVideoMuted] = useState<boolean[]>([]);
  const [segmentLyricsFontSize, setSegmentLyricsFontSize] = useState<number[]>([]);
  const [segmentLyricsColor, setSegmentLyricsColor] = useState<string[]>([]);
  const [segmentScreenFilters, setSegmentScreenFilters] = useState<SegmentScreenFilter[]>([]);
  const [segmentMediaObjectFit, setSegmentMediaObjectFit] = useState<("cover" | "contain")[]>([]);
  const [segmentCompositeEnabled, setSegmentCompositeEnabled] = useState<boolean[]>([]);
  const [segmentCompositeModes, setSegmentCompositeModes] = useState<SegmentCompositeMode[]>([]);
  const [segmentMosaicRegions, setSegmentMosaicRegions] = useState<SegmentMosaicRegion[][]>([]);
  const [segmentMosaicSelectedId, setSegmentMosaicSelectedId] = useState<(string | null)[]>([]);
  const [segmentBrandMaskRegions, setSegmentBrandMaskRegions] = useState<SegmentBrandMaskRegion[][]>([]);
  const [segmentBrandMaskSelectedId, setSegmentBrandMaskSelectedId] = useState<(string | null)[]>([]);
  const [segmentOverlayImageUrls, setSegmentOverlayImageUrls] = useState<(string | undefined)[]>([]);
  const [segmentOverlayTexts, setSegmentOverlayTexts] = useState<string[]>([]);
  const [segmentOverlayOpacity, setSegmentOverlayOpacity] = useState<number[]>([]);
  const [segmentOverlayScaleX, setSegmentOverlayScaleX] = useState<number[]>([]);
  const [segmentOverlayScaleY, setSegmentOverlayScaleY] = useState<number[]>([]);
  const [segmentOverlayPosition, setSegmentOverlayPosition] = useState<SegmentOverlayPosition[]>([]);
  const [segmentOverlayX, setSegmentOverlayX] = useState<number[]>([]);
  const [segmentOverlayY, setSegmentOverlayY] = useState<number[]>([]);
  const [segmentTextX, setSegmentTextX] = useState<number[]>([]);
  const [segmentTextY, setSegmentTextY] = useState<number[]>([]);
  const [nameMaskPreset, setNameMaskPreset] = useState<NameMaskPreset>(() => ({
    ...DEFAULT_NAME_MASK_PRESET,
    rules: [],
  }));
  const [nameRuleDraft, setNameRuleDraft] = useState("");
  const segmentVideoUrlsRef = useRef<(string | undefined)[]>([]);
  segmentVideoUrlsRef.current = segmentVideoUrls;
  const segmentImageUrlsRef = useRef<(string | undefined)[]>([]);
  segmentImageUrlsRef.current = segmentImageUrls;
  const segmentImageSelectionsRef = useRef(segmentImageSelections);
  segmentImageSelectionsRef.current = segmentImageSelections;
  const segmentTextsForHistoryRef = useRef(segmentTexts);
  segmentTextsForHistoryRef.current = segmentTexts;
  const phraseQueueRef = useRef(phraseQueue);
  phraseQueueRef.current = phraseQueue;
  const timelineSegmentsRef = useRef(timelineSegments);
  timelineSegmentsRef.current = timelineSegments;
  /** フレーズ行の id 並びのみ追跡（テキスト変更だけでは effect を走らせない） */
  const phraseQueueIdsKey = useMemo(
    () => phraseQueue.map((p) => p.id).join("\u0001"),
    [phraseQueue]
  );
  /** タイムライン行数・segment id 列のみ追跡（秒の変更だけでは正規化 effect を走らせない） */
  const timelineStructureKey = useMemo(
    () =>
      `${timelineSegments.length}\u0002${timelineSegments.map((s) => s.id).join("\u0001")}`,
    [timelineSegments]
  );

  /** ユーザー操作で選択を変えるとき ref を即時同期（同一フレーム内のコピーと editingPhraseId を一致させる） */
  const assignEditingPhraseId = useCallback((next: string | null) => {
    editingPhraseIdRef.current = next;
    setEditingPhraseId(next);
  }, []);

  /** mosaic パターン初回: 既定の矩形1つを入れる（名前・ID隠し用のデフォルト寄せ） */
  const ensureMosaicRegionsForPi = useCallback((pi: number) => {
    const d = defaultMosaicRegion();
    let inserted = false;
    setSegmentMosaicRegions((prev) => {
      const next = prev.map((row) => row.map((r) => ({ ...r })));
      while (next.length <= pi) next.push([]);
      if ((next[pi]?.length ?? 0) > 0) return prev;
      inserted = true;
      next[pi] = [d];
      return next;
    });
    if (inserted) {
      setSegmentMosaicSelectedId((s) => {
        const a = [...s];
        while (a.length <= pi) a.push(null);
        a[pi] = d.id;
        return a;
      });
    }
  }, []);

  const ensureBrandMaskRegionsForPi = useCallback((pi: number) => {
    const d = defaultBrandMaskRegion();
    let inserted = false;
    setSegmentBrandMaskRegions((prev) => {
      const next = prev.map((row) => row.map((r) => ({ ...r })));
      while (next.length <= pi) next.push([]);
      if ((next[pi]?.length ?? 0) > 0) return prev;
      inserted = true;
      next[pi] = [d];
      return next;
    });
    if (inserted) {
      setSegmentBrandMaskSelectedId((s) => {
        const a = [...s];
        while (a.length <= pi) a.push(null);
        a[pi] = d.id;
        return a;
      });
    }
  }, []);

  const patchMosaicRegion = useCallback((pi: number, regionId: string | null, patch: Partial<SegmentMosaicRegion>) => {
    if (!regionId) return;
    setSegmentMosaicRegions((prev) => {
      const next = prev.map((row) => row.map((x) => ({ ...x })));
      while (next.length <= pi) next.push([]);
      const row = [...(next[pi] ?? [])];
      const idx = row.findIndex((x) => x.id === regionId);
      if (idx < 0) return prev;
      row[idx] = { ...row[idx]!, ...patch };
      next[pi] = row;
      return next;
    });
  }, []);

  const patchBrandMaskRegion = useCallback(
    (pi: number, regionId: string | null, patch: Partial<SegmentBrandMaskRegion>) => {
      if (!regionId) return;
      setSegmentBrandMaskRegions((prev) => {
        const next = prev.map((row) => row.map((x) => ({ ...x })));
        while (next.length <= pi) next.push([]);
        const row = [...(next[pi] ?? [])];
        const idx = row.findIndex((x) => x.id === regionId);
        if (idx < 0) return prev;
        row[idx] = { ...row[idx]!, ...patch };
        next[pi] = row;
        return next;
      });
    },
    []
  );

  /** 同一フレーズ選択のままの再描画では phrase リストを scrollIntoView しない */
  const lastPhraseListScrollEditingIdRef = useRef<string | null>(null);
  /** モーダル内フレーズリスト: 同じ preview+選択のままでは scrollIntoView しない */
  const lastModalPhraseScrollKeyRef = useRef("");
  /** 同一区間・同一失敗 URL への Pixabay 再取得は1回に抑え（ループ防止） */
  const pixabayUrlRecoveryAttemptedRef = useRef(new Set<string>());
  const [localUploadHintOpen, setLocalUploadHintOpen] = useState(false);
  const localUploadApplyRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    if (!localUploadHintOpen) return;
    const el = document.getElementById("local-upload-autosave-hint-root");
    requestAnimationFrame(() => el?.focus());
  }, [localUploadHintOpen]);

  const retryPixabayImageAfterLoadFailure = useCallback((segmentIndex: number, failedImageUrl: string) => {
    const trimmedFail = failedImageUrl.trim();
    if (segmentIndex < 0 || !trimmedFail) return;
    const sel = segmentImageSelectionsRef.current[segmentIndex];
    const pid = sel?.pixabayImageId;
    if (
      !sel ||
      sel.imageSource !== "suggested" ||
      typeof pid !== "number" ||
      !Number.isFinite(pid) ||
      pid <= 0
    ) {
      return;
    }
    const attemptKey = `${segmentIndex}\n${trimmedFail}`;
    if (pixabayUrlRecoveryAttemptedRef.current.has(attemptKey)) return;
    pixabayUrlRecoveryAttemptedRef.current.add(attemptKey);

    void (async () => {
      try {
        const res = await fetch(`/api/pixabay-image?id=${encodeURIComponent(String(pid))}`);
        const json = (await res.json()) as {
          ok?: boolean;
          message?: string;
          image?: SearchImageResult;
        };
        if (!json?.ok || !json.image) {
          console.warn("[segmentImage] pixabay refresh failed", {
            segmentIndex,
            pixabayImageId: pid,
            message: json?.message ?? null,
          });
          return;
        }
        const img = json.image;
        const newDisplay = (img.imageUrl || img.previewUrl || "").trim();
        if (!newDisplay) return;

        const stillCurrent = (segmentImageUrlsRef.current[segmentIndex] ?? "").trim();
        if (stillCurrent !== trimmedFail) return;

        const newImageUrl = (img.imageUrl || newDisplay).trim();
        const newPreviewUrl = (img.previewUrl || img.imageUrl || newDisplay).trim();
        const pageUrl =
          img.id > 0 ? `https://pixabay.com/photos/id-${img.id}/` : sel.pageUrl;

        setSegmentImageUrls((prev) => {
          const next = [...prev];
          while (next.length <= segmentIndex) next.push(undefined);
          next[segmentIndex] = newDisplay;
          return next;
        });

        setSegmentImageSelections((prev) => {
          const next = [...prev];
          while (next.length <= segmentIndex) next.push(null);
          const cur = next[segmentIndex];
          if (!cur) return prev;
          next[segmentIndex] = {
            ...cur,
            imageUrl: newImageUrl,
            previewUrl: newPreviewUrl,
            pageUrl: pageUrl ?? cur.pageUrl,
            pixabayImageId: img.id > 0 ? img.id : cur.pixabayImageId,
            localImageNeedsReselect: false,
          };
          return next;
        });

        const lyricsKey = normalizeLyricsForHistoryKey(
          segmentTextsForHistoryRef.current[segmentIndex] ?? ""
        );
        if (lyricsKey) {
          rememberLyricsImageSelection(lyricsKey, newDisplay, "suggested", {
            previewUrl: newPreviewUrl,
            pageUrl: pageUrl ?? undefined,
            pixabayImageId: img.id > 0 ? img.id : pid,
          });
        }
      } catch (e) {
        console.warn("[segmentImage] pixabay refresh error", {
          segmentIndex,
          err: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }, []);

  const warnSegmentImageLoadFailure = useCallback(
    (segmentIndex: number, imageUrl: string) => {
      const seg = timelineSegments[segmentIndex];
      const sel = segmentImageSelections[segmentIndex];
      const pixabayImageId = sel?.pixabayImageId;
      const urlForLog =
        imageUrl.length > 400 ? `${imageUrl.slice(0, 400)}…(len=${imageUrl.length})` : imageUrl;
      console.warn("[segmentImage] image load failed", {
        segmentIndex,
        imageUrl: urlForLog,
        imageUrlLength: imageUrl.length,
        pixabayImageId: pixabayImageId ?? null,
        timelineSegmentId: seg?.id ?? null,
      });
    },
    [timelineSegments, segmentImageSelections]
  );

  const handleSegmentBackgroundImageLoad = useCallback((segmentIndex: number, expectedUrl: string) => {
    const current = (segmentImageUrlsRef.current[segmentIndex] ?? "").trim();
    if (current !== expectedUrl) return;
    setSegmentImageLoadStates((prev) => {
      if (segmentIndex < 0 || segmentIndex >= prev.length) return prev;
      const next = [...prev];
      next[segmentIndex] = "loaded";
      return next;
    });
    if (shouldLogTimelineThumbDebug()) {
      console.log("[timelineThumb] img onLoad", {
        index: segmentIndex,
        srcLength: expectedUrl.length,
      });
    }
  }, []);

  const handleSegmentBackgroundImageError = useCallback(
    (segmentIndex: number, expectedUrl: string) => {
      const current = (segmentImageUrlsRef.current[segmentIndex] ?? "").trim();
      if (current !== expectedUrl) return;
      warnSegmentImageLoadFailure(segmentIndex, expectedUrl);
      setSegmentImageLoadStates((prev) => {
        if (segmentIndex < 0 || segmentIndex >= prev.length) return prev;
        const next = [...prev];
        next[segmentIndex] = "error";
        return next;
      });
      retryPixabayImageAfterLoadFailure(segmentIndex, expectedUrl);
    },
    [warnSegmentImageLoadFailure, retryPixabayImageAfterLoadFailure]
  );

  useEffect(() => {
    const prev = prevSegmentImageUrlsForLoadRef.current;
    const len = segmentImageUrls.length;
    setSegmentImageLoadStates((states) => {
      const next: SegmentImageLoadState[] = [];
      for (let i = 0; i < len; i++) {
        next[i] = states[i] ?? "idle";
      }
      for (let i = 0; i < len; i++) {
        const u = (segmentImageUrls[i] ?? "").trim();
        const prevU = (prev[i] ?? "").trim();
        if (!u) next[i] = "idle";
        else if (u !== prevU) next[i] = "loading";
      }
      return next;
    });
    prevSegmentImageUrlsForLoadRef.current = segmentImageUrls.slice();
  }, [segmentImageUrls]);

  const [segmentAnims, setSegmentAnims] = useState<string[]>([]);
  const fileInputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const segmentRowRefs = useRef<Map<number, HTMLLIElement>>(new Map());
  const phraseItemRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  /** モーダル内フレーズ一覧（プレビュー中はメイン行リストがアンマウントされるため別管理） */
  const modalPhraseItemRefs = useRef<Map<string, HTMLLIElement>>(new Map());
  /** 自動パイプラインの同時実行防止 */
  const autoPipelineLockRef = useRef(false);
  /** useImperativeHandle から常に最新の runFullTextApply / handleAutoGenerate を参照する */
  const pipelineFnsRef = useRef<{
    runFullTextApply: (
      sourceText: string,
      options?: { skipConfirm?: boolean }
    ) => Promise<{ phraseCount: number; imageCount: number } | null>;
    handleAutoGenerate: (
      lyricsOverride?: string,
      options?: { secondsPerScreenOverride?: number }
    ) => void;
  } | null>(null);
  /** 直近でフォーカスしているフィールド（歌詞へのフレーズ挿入先） */
  const [focusTarget, setFocusTarget] = useState<{ rowIndex: number; field: "lyrics" | "start" | "end" } | null>(null);
  const segmentLyricsRefs = useRef<Map<number, HTMLTextAreaElement>>(new Map());

  /** 再生中の currentTime が含まれるタイムライン区間の segment.id（ハイライト用。index は使わない） */
  const activeSegmentId = useMemo(() => {
    const t = currentTimeSec;
    const seg = timelineSegments.find((s) => t >= s.startSec && t < s.endSec);
    return seg?.id ?? null;
  }, [currentTimeSec, timelineSegments]);

  /** 編集中のフレーズ行（phraseQueue の id === editingPhraseId） */
  const editingPhrase = useMemo(
    () =>
      editingPhraseId == null ? null : phraseQueue.find((p) => p.id === editingPhraseId) ?? null,
    [phraseQueue, editingPhraseId]
  );

  /** applyCascadedSegmentTimes 等に渡すタイムライン行（editingPhraseId → phraseQueue 内位置） */
  const timelineRowForEditingPhrase = useMemo(() => {
    if (editingPhraseId == null) return null;
    const i = phraseQueue.findIndex((p) => p.id === editingPhraseId);
    return i >= 0 ? i : null;
  }, [phraseQueue, editingPhraseId]);

  /** 区間再生・モーダル: まず editingPhrase の start/end、無ければその id に対応するタイムライン行 */
  const effectiveEditingSegmentBounds = useMemo(() => {
    const pe = pickPhraseSegmentTimes(editingPhrase);
    if (pe) return pe;
    const ti = timelineRowForEditingPhrase;
    if (ti == null || ti >= timelineSegments.length) return null;
    const s = timelineSegments[ti];
    if (!s || !(s.endSec > s.startSec)) return null;
    return { startSec: s.startSec, endSec: s.endSec };
  }, [editingPhrase, timelineRowForEditingPhrase, timelineSegments]);

  /** タイムライン構造・フレーズ id 列が変わったときだけ editingPhraseId を正規化（コピペ等のテキストのみ更新では走らせない） */
  useEffect(() => {
    const phraseQueue = phraseQueueRef.current;
    const timelineSegments = timelineSegmentsRef.current;
    if (timelineSegments.length === 0 || phraseQueue.length === 0) {
      setEditingPhraseId(null);
      return;
    }
    if (pendingImportEditingPhraseIdRef.current != null) {
      const want = pendingImportEditingPhraseIdRef.current;
      pendingImportEditingPhraseIdRef.current = null;
      if (phraseQueue.some((p) => p.id === want)) {
        setEditingPhraseId(want);
        return;
      }
      const ti = timelineSegments.findIndex((s) => s.id === want);
      if (ti >= 0) {
        const pid = phraseQueue[ti]?.id;
        if (pid != null) {
          setEditingPhraseId(pid);
          return;
        }
      }
    }
    if (pendingEditingRowIndexRef.current != null) {
      const idx = Math.min(
        Math.max(0, pendingEditingRowIndexRef.current),
        phraseQueue.length - 1,
        timelineSegments.length - 1
      );
      pendingEditingRowIndexRef.current = null;
      const pid = phraseQueue[idx]?.id;
      if (pid != null) {
        setEditingPhraseId(pid);
        return;
      }
    }
    setEditingPhraseId((prev) => {
      if (prev != null && phraseQueue.some((p) => p.id === prev)) return prev;
      if (prev != null) {
        const ti = timelineSegments.findIndex((s) => s.id === prev);
        if (ti >= 0) {
          const mapped = phraseQueue[ti]?.id;
          if (mapped != null) return mapped;
        }
      }
      const fi = timelineSegments.findIndex((s) => s.type === "voice" || s.type === "interlude");
      const pqIdx = fi >= 0 ? fi : 0;
      const safeIdx = Math.min(pqIdx, phraseQueue.length - 1);
      return phraseQueue[safeIdx]?.id ?? phraseQueue[0]!.id;
    });
  }, [phraseQueueIdsKey, timelineStructureKey]);

  /** 編集行切替時にローカル歌詞を必ず同期（前フレーズの残りを防ぐ） */
  useEffect(() => {
    if (editingPhraseId == null) {
      setLocalSegmentText("");
      return;
    }
    const pi = phraseQueue.findIndex((p) => p.id === editingPhraseId);
    if (pi < 0) {
      setLocalSegmentText("");
      return;
    }
    setLocalSegmentText(segmentTexts[pi] ?? "");
  }, [editingPhraseId, phraseQueue, segmentTexts]);

  /** 親プレビュー用歌詞: localSegmentText のみ（編集 phrase があるときだけ） */
  const unifiedPreviewLyrics = useMemo(() => {
    if (editingPhrase != null) return localSegmentText;
    return "";
  }, [editingPhrase, localSegmentText]);

  useEffect(() => {
    onSyncPreviewLyrics?.(unifiedPreviewLyrics);
  }, [unifiedPreviewLyrics, onSyncPreviewLyrics]);

  useEffect(() => {
    if (!shouldLogTimelineThumbDebug()) return;
    const withSrc = segmentImageUrls
      .map((u, idx) => {
        const t = (u ?? "").trim();
        return t ? { index: idx, srcLength: t.length, srcPrefix: t.slice(0, 96) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x != null);
    const editingPhrasePQ = editingPhraseId
      ? phraseQueue.findIndex((p) => p.id === editingPhraseId)
      : -1;
    console.log("[timelineThumb] segmentImageUrls snapshot", {
      timelineRowCount: timelineSegments.length,
      editingPhrasePQ,
      activeSegmentId,
      revealMode: "always_src_eager_row_thumb",
      urlsDefinedRows: withSrc.length,
      rows: withSrc.slice(0, 48),
    });
  }, [segmentImageUrls, timelineSegments.length, editingPhraseId, phraseQueue, activeSegmentId]);

  const [bannerSourceUrl, setBannerSourceUrl] = useState<string | null>(null);
  const [productCandidates, setProductCandidates] = useState<string[]>([]);
  const [themeKeywords, setThemeKeywords] = useState<{ word: string; count: number }[]>([]);
  const [themeString, setThemeString] = useState("");
  const [themeImageResults, setThemeImageResults] = useState<SearchImageResult[]>([]);
  const [themeSearchError, setThemeSearchError] = useState<string | null>(null);
  const [themeSearchLoading, setThemeSearchLoading] = useState(false);
  const [manualTrimMode, setManualTrimMode] = useState(false);
  /** 全体画像トーン（自動割当用） */
  const [imageTone, setImageTone] = useState<ImageToneId>("neutral");
  /** 各行で使った検索語（透明性のため） */
  const [segmentSearchTerms, setSegmentSearchTerms] = useState<string[]>([]);
  const [autoAssignLoading, setAutoAssignLoading] = useState(false);
  /** キーワードタグの選択状態 */
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  /** 画像検索用の最終クエリ（検索バー）。手入力で上書き可能。 */
  const [searchQuery, setSearchQuery] = useState("");
  /** ユーザーが searchQuery を手入力したかどうか（自動生成の上書き判定） */
  const [searchDirty, setSearchDirty] = useState(false);
  /** 自動展開: 曲調（しっとり/標準/テンポ速め/ラップ） */
  const [songStyle, setSongStyle] = useState<SongStyle>("standard");
  /** 自動展開: 表示テンポの好み（見やすさ優先/バランス/ノリ優先） */
  const [displayTempo, setDisplayTempo] = useState<DisplayTempo>("balance");
  /** 間奏: 開始・終了秒で追加する区間（タイムラインに開始時刻でマージ表示） */
  const [manualInterludes, setManualInterludes] = useState<{ startSec: number; endSec: number }[]>([]);
  /** importProjectState 直後に一度だけ適用する保存済みタイムライン（無音・Brand 含む） */
  const pendingImportedTimelineRef = useRef<TimelineSegment[] | null>(null);
  const lastTimelineTimesFingerprintRef = useRef<string>("");
  /** 動画長が未確定のとき import したタイムラインを派生再計算で潰さない */
  const deferTimelineDerivedRebuildUntilDurationRef = useRef(false);
  /** 間奏追加用: 開始・終了（分:秒 または 秒で入力可） */
  const [interludeStartInput, setInterludeStartInput] = useState("");
  const [interludeEndInput, setInterludeEndInput] = useState("");
  /** タイムライン行の start/end を編集中の行（null でないときその行の入力値を編集中） */
  const [editingTimeRowIndex, setEditingTimeRowIndex] = useState<number | null>(null);
  const [editingStartStr, setEditingStartStr] = useState("");
  const [editingEndStr, setEditingEndStr] = useState("");
  const [manualTrimUrl, setManualTrimUrl] = useState<string | null>(null);
  /** 拡大プレビューモーダル: タイムライン行インデックス（null で非表示）。親から渡されれば制御される */
  const [internalPreviewRowIndex, setInternalPreviewRowIndex] = useState<number | null>(null);
  const previewRowIndex = previewRowIndexProp !== undefined ? previewRowIndexProp : internalPreviewRowIndex;
  const setPreviewRowIndex = setPreviewRowIndexProp ?? setInternalPreviewRowIndex;
  /** モーダル内でフレーズキューを表示する行（押した行の横 or 直下にローカル表示）。null で非表示 */
  const [openPhraseQueueInModal, setOpenPhraseQueueInModal] = useState<number | null>(null);

  /**
   * モーダル内フレーズ柱だけ、選択フレーズのタイムライン行に追従する。
   * previewRowIndex（区間編集で開いた行）は上書きしない。
   * phraseQueue がタイムラインより短いとき findIndex は歌詞行インデックスになり、無音行を開いても先頭行へ引きずられ
   * 0〜(約 duration/n) 秒固定表示になる不具合の原因だった。
   */
  useEffect(() => {
    if (editingPhraseId == null) return;
    const pq = phraseQueueRef.current;
    const n = timelineSegmentsRef.current.length;
    let idx = -1;
    for (let i = 0; i < pq.length && i < n; i++) {
      if (pq[i]?.id === editingPhraseId) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return;
    if (openPhraseQueueInModal != null && openPhraseQueueInModal !== idx) {
      setOpenPhraseQueueInModal(idx);
    }
  }, [editingPhraseId, phraseQueueIdsKey, timelineStructureKey, openPhraseQueueInModal, setOpenPhraseQueueInModal]);

  /** 曲全体の検索補助設定（全区間共通、モーダル閉じても保持） */
  const [songVisualProfile, setSongVisualProfile] = useState<SongVisualProfile>(DEFAULT_SONG_VISUAL_PROFILE);
  /** 区間再生モード: segment=endで停止, segmentLoop=endでstartに戻して継続, null=通常 */
  const [segmentPlayMode, setSegmentPlayMode] = useState<"segment" | "segmentLoop" | null>(null);
  /** 行プレビュー: 区間ごとの表示モード（1行 / 2行 / 縦右 / 縦左） */
  const [segmentDisplayModes, setSegmentDisplayModes] = useState<SegmentModalLyricsLayout[]>([]);
  /** 行プレビュー: 区間ごとの2行改行位置（0=自動） */
  const [segmentLineBreakAt, setSegmentLineBreakAt] = useState<number[]>([]);
  const segmentMediaTypesRef = useRef(segmentMediaTypes);
  segmentMediaTypesRef.current = segmentMediaTypes;
  const segmentAnimsRef = useRef(segmentAnims);
  segmentAnimsRef.current = segmentAnims;
  const segmentDisplayModesRef = useRef(segmentDisplayModes);
  segmentDisplayModesRef.current = segmentDisplayModes;
  const segmentLineBreakAtRef = useRef(segmentLineBreakAt);
  segmentLineBreakAtRef.current = segmentLineBreakAt;
  /** 行プレビュー: 演出アニメーション再再生用キー */
  const [previewAnimKey, setPreviewAnimKey] = useState(0);
  /** 流れプレビュー: 全区間を壁時計で連続再生（書き出し確認用） */
  const [flowTimeSec, setFlowTimeSec] = useState(0);
  const [isFlowPlaying, setIsFlowPlaying] = useState(false);
  const [flowPreviewAnimKey, setFlowPreviewAnimKey] = useState(0);
  /** 流れプレビュー: 「行へ移動」入力 */
  const [flowJumpInputValue, setFlowJumpInputValue] = useState("");
  /** true の間は流れプレビューを全体スコープ（0〜末尾）で再生 */
  const [flowUseFullTimeline, setFlowUseFullTimeline] = useState(false);
  /** モーダル内・画像候補（検索実行後のみ更新。入力中は触らない） */
  const [imageSearchCandidates, setImageSearchCandidates] = useState<SearchImageResult[]>([]);
  const [isSearchingImages, setIsSearchingImages] = useState(false);
  const [imageSearchLoadingMore, setImageSearchLoadingMore] = useState(false);
  const [hasMoreImageCandidates, setHasMoreImageCandidates] = useState(false);
  const [imageSearchError, setImageSearchError] = useState<string | null>(null);
  const imageSearchFetchGenRef = useRef(0);
  /** 同一 effective クエリの次 Pixabay page（2…） */
  const imageSearchNextPageRef = useRef(2);
  const lastFetchedEffectiveImageQueryRef = useRef("");
  const imageSearchCacheRef = useRef(new ImageSearchQueryCache());
  /** 区間編集モーダル: 画像変更パネル（候補・自分の画像） */
  const [modalImagePickerOpen, setModalImagePickerOpen] = useState(false);
  const [modalImagePickerTab, setModalImagePickerTab] = useState<
    "suggested" | "uploaded" | "uploadedVideo"
  >("suggested");
  /** モーダル「自分の画像」タブ: 選択中ファイルとプレビュー用 object URL */
  const [modalUploadPick, setModalUploadPick] = useState<{ file: File; url: string } | null>(null);
  const modalSegmentImageFileInputRef = useRef<HTMLInputElement>(null);
  const modalSegmentVideoFileInputRef = useRef<HTMLInputElement>(null);
  const modalSegmentOverlayImageFileInputRef = useRef<HTMLInputElement>(null);
  const modalMiniCompositeOverlayImageFileInputRef = useRef<HTMLInputElement>(null);
  /** モーダル「自分の動画」タブ: 選択中ファイルと object URL */
  const [modalVideoPick, setModalVideoPick] = useState<{ file: File; url: string } | null>(null);
  const modalVideoPickBlobUrl = modalVideoPick?.url ?? null;
  const [modalVideoUploadError, setModalVideoUploadError] = useState<string | null>(null);
  /** 自分の動画タブ: クリックするまで video 要素をマウントしない（メタデータ読み込みを避ける） */
  const [modalVideoPreviewVisible, setModalVideoPreviewVisible] = useState(false);
  /** 区間ごと: 画像候補の手動検索語。null = 自動生成クエリを使用 */
  const [segmentModalSuggestQueryOverride, setSegmentModalSuggestQueryOverride] = useState<
    (string | null)[]
  >([]);
  /** 検索バー入力（onChange のみ更新。検索はしない） */
  const [manualImageSearchInput, setManualImageSearchInput] = useState("");
  const manualImageSearchInputRef = useRef<HTMLInputElement>(null);
  const flowPreviewVideoRef = useRef<HTMLVideoElement>(null);
  /** 流れプレビュー: video が muted のとき同じ src で音声だけ再生 */
  const flowPreviewAudioRef = useRef<HTMLAudioElement | null>(null);
  const flowPreviewAudioSrcRef = useRef<string>("");
  /** 流れプレビュー: 画像／素材なし区間で親の素材 MP4 の音声を壁時計に同期 */
  const flowPreviewMaterialAudioRef = useRef<HTMLAudioElement | null>(null);
  const flowPreviewMaterialAudioSrcRef = useRef<string>("");
  const flowRafRef = useRef<number | null>(null);
  const flowTimeSecRef = useRef(0);
  const flowRafPrevSegRef = useRef<number | null>(null);
  /** 流れプレビュー・モーダル: 歌詞がはみ出さないよう実測する基準枠 */
  const flowPreviewStageRef = useRef<HTMLDivElement>(null);
  const modalPreviewStageRef = useRef<HTMLDivElement>(null);
  /** 流れプレビュー: 編集行が変わったときだけ表示行を合わせる（停止直後に上書きしない） */
  const prevPreviewRowForFlowRef = useRef<number | null>(null);
  const dragStateRef = useRef<
    | {
        segIndex: number;
        kind: "overlay" | "text";
        startClientX: number;
        startClientY: number;
        startX: number;
        startY: number;
      }
    | {
        segIndex: number;
        kind: "mosaicMove" | "mosaicResizeBr" | "brandMove" | "brandResizeBr";
        regionId: string;
        startClientX: number;
        startClientY: number;
        startRect: { xPct: number; yPct: number; wPct: number; hPct: number };
        stageW: number;
        stageH: number;
      }
    | null
  >(null);
  /** 「検索」/ Enter で確定したバー文言（空は自動扱いで API は auto） */
  const [committedImageSearchQuery, setCommittedImageSearchQuery] = useState("");
  /** 手動モード（確定バーが自動文と異なるとき true。区間に保存検索語があれば true） */
  const [hasUserEditedSearchQuery, setHasUserEditedSearchQuery] = useState(false);
  /** この区間で少なくとも1回は検索を実行したか（空メッセージの出し分け） */
  const [hasRequestedImageCandidates, setHasRequestedImageCandidates] = useState(false);
  /** 行プレビュー: 時間の直接入力欄（start/end） */
  const [previewTimeStartStr, setPreviewTimeStartStr] = useState("");
  const [previewTimeEndStr, setPreviewTimeEndStr] = useState("");
  const manualTrimRef = useRef<HTMLDivElement>(null);
  const manualTrimCanvasRef = useRef<HTMLCanvasElement>(null);
  const manualTrimImgRef = useRef<HTMLImageElement | null>(null);
  const manualTrimStartRef = useRef<{ x: number; y: number } | null>(null);
  const manualTrimRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const bannerFileInputRef = useRef<HTMLInputElement>(null);

  /** フレーズキュー: 右カラム幅・最小化のみ永続化（旧版の fixed 座標 left/top は無視） */
  const PHRASE_QUEUE_STORAGE_KEY = "ad-video-phrase-queue-panel";
  const DEFAULT_PANEL_WIDTH = 300;
  const MIN_PANEL_WIDTH = 240;
  const MAX_PANEL_WIDTH = 420;
  const [phraseQueuePanel, setPhraseQueuePanel] = useState<{
    width: number;
    minimized: boolean;
  }>(() => {
    if (typeof window === "undefined") return { width: DEFAULT_PANEL_WIDTH, minimized: false };
    try {
      const raw = localStorage.getItem(PHRASE_QUEUE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { left?: number; top?: number; width?: number; minimized?: boolean };
        const w = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, parsed.width ?? DEFAULT_PANEL_WIDTH));
        return {
          width: w,
          minimized: Boolean(parsed.minimized),
        };
      }
    } catch {
      /* ignore */
    }
    return { width: DEFAULT_PANEL_WIDTH, minimized: false };
  });

  /** 狭い画面ではフレーズキューを下段に積み、fixed 相当のズレを避ける */
  const [stackPhraseQueueBelow, setStackPhraseQueueBelow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 1024px)");
    const apply = () => setStackPhraseQueueBelow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  const phraseQueueResizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  flowTimeSecRef.current = flowTimeSec;

  const flowAllEndSec = useMemo(() => flowTimelineMaxEndSec(timelineSegments), [timelineSegments]);

  /** 通常は編集行スコープ、最初から再生時は全体スコープ（0〜末尾） */
  const flowScopeBounds = useMemo(() => {
    if (flowUseFullTimeline || previewRowIndex == null || effectiveEditingSegmentBounds == null) {
      return { startSec: 0, endSec: flowAllEndSec };
    }
    return { startSec: effectiveEditingSegmentBounds.startSec, endSec: effectiveEditingSegmentBounds.endSec };
  }, [flowUseFullTimeline, previewRowIndex, effectiveEditingSegmentBounds, flowAllEndSec]);

  const flowPlaybackEndSec = flowScopeBounds.endSec;
  const flowPlaybackDurationSec = Math.max(0, flowScopeBounds.endSec - flowScopeBounds.startSec);

  const flowPreviewSegments = useMemo(() => {
    if (flowUseFullTimeline || previewRowIndex == null || effectiveEditingSegmentBounds == null) return timelineSegments;
    return timelineSegments.map((s, i) => {
      if (i !== previewRowIndex) return s;
      return { ...s, startSec: effectiveEditingSegmentBounds.startSec, endSec: effectiveEditingSegmentBounds.endSec };
    });
  }, [timelineSegments, flowUseFullTimeline, previewRowIndex, effectiveEditingSegmentBounds]);

  const flowPlayhead = useMemo(() => flowPreviewIndexAndLocal(flowTimeSec, flowPreviewSegments), [flowTimeSec, flowPreviewSegments]);
  const flowCurrentIndex = flowPlayhead.index;
  const flowLocalSecInSegment = flowPlayhead.localSec;

  const flowTimeWithinScopeSec = Math.min(
    flowPlaybackDurationSec,
    Math.max(0, flowTimeSec - flowScopeBounds.startSec)
  );

  const stopFlowPlayback = useCallback(() => {
    setIsFlowPlaying(false);
    setFlowUseFullTimeline(false);
    if (flowRafRef.current != null) {
      cancelAnimationFrame(flowRafRef.current);
      flowRafRef.current = null;
    }
    flowPreviewVideoRef.current?.pause();
    flowPreviewAudioRef.current?.pause();
    flowPreviewMaterialAudioRef.current?.pause();
  }, []);

  useEffect(() => {
    const td = flowPlaybackEndSec;
    setFlowTimeSec((prev) => {
      const next = Math.min(prev, td);
      flowTimeSecRef.current = next;
      return next;
    });
  }, [flowPlaybackEndSec]);

  useEffect(() => {
    const { width, minimized } = phraseQueuePanel;
    try {
      localStorage.setItem(PHRASE_QUEUE_STORAGE_KEY, JSON.stringify({ width, minimized }));
    } catch {
      /* ignore */
    }
  }, [phraseQueuePanel]);

  /**
   * モーダルを閉じたときだけ区間再生を停止して動画を pause。
   * 以前は previewRowIndex==null のあいだ onPause を依存配列付きで毎回呼んでおり、
   * 親がインライン onPause を渡すと再レンダーのたびに再生が止まっていた。
   */
  const prevPreviewRowIndexRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevPreviewRowIndexRef.current;
    const closedFromPreview = prev != null && previewRowIndex == null;
    prevPreviewRowIndexRef.current = previewRowIndex ?? null;
    if (closedFromPreview) {
      setSegmentPlayMode(null);
      onPause?.();
    }
  }, [previewRowIndex, onPause]);

  /** モーダルが閉じたらローカルフレーズキューも閉じる */
  useEffect(() => {
    if (previewRowIndex == null) setOpenPhraseQueueInModal(null);
  }, [previewRowIndex]);

  /** モーダルを閉じたら流れプレビューを止める */
  useEffect(() => {
    if (previewRowIndex != null) return;
    stopFlowPlayback();
    prevPreviewRowForFlowRef.current = null;
  }, [previewRowIndex, stopFlowPlayback]);

  /**
   * モーダル内: 編集行と流れプレビューの壁時計を同期。
   * - 行が変わったらその行の start へ。
   * - 同じ行で start/end を編集したら flowTime を区間内にクランプ（end 補正後の実効境界を最優先）。
   * 全体再生中でも「行切替/境界変更」時は編集単位の範囲にクランプする。
   */
  useLayoutEffect(() => {
    if (previewRowIndex == null) return;
    const b = effectiveEditingSegmentBounds;
    const seg = timelineSegments[previewRowIndex];
    const start = b != null ? b.startSec : seg?.startSec;
    const end = b != null ? b.endSec : seg?.endSec;
    if (
      typeof start !== "number" ||
      !Number.isFinite(start) ||
      typeof end !== "number" ||
      !Number.isFinite(end) ||
      !(end > start)
    )
      return;

    const prevRow = prevPreviewRowForFlowRef.current;
    const rowChanged = prevRow == null || prevRow !== previewRowIndex;
    prevPreviewRowForFlowRef.current = previewRowIndex;

    if (rowChanged) {
      const t0 = start;
      setFlowTimeSec(t0);
      flowTimeSecRef.current = t0;
      return;
    }

    const innerEnd = Math.max(start, end - 1e-3);
    setFlowTimeSec((prevT) => {
      let t = prevT;
      if (t < start) t = start;
      else if (t >= end) t = innerEnd;
      flowTimeSecRef.current = t;
      return t;
    });
  }, [previewRowIndex, isFlowPlaying, timelineSegments, effectiveEditingSegmentBounds]);

  /** 流れプレビュー: 全体連続再生（RAF）＋区間動画・音声同期 */
  useEffect(() => {
    if (!isFlowPlaying || previewRowIndex == null) {
      if (flowRafRef.current != null) {
        cancelAnimationFrame(flowRafRef.current);
        flowRafRef.current = null;
      }
      return;
    }
    const segments = flowPreviewSegments;
    const td = flowPlaybackEndSec;
    if (segments.length === 0 || td <= 0) {
      stopFlowPlayback();
      return;
    }

    const base = flowTimeSecRef.current;
    const start = performance.now();

    const effectiveMtAt = (fi: number): SegmentMediaType => {
      const curUrl = (segmentImageUrls[fi] ?? "").trim();
      const curVideoUrl = (segmentVideoUrls[fi] ?? "").trim();
      const storedMt = segmentMediaTypes[fi];
      if (storedMt === "image" || storedMt === "video") return storedMt;
      if (curVideoUrl) return "video";
      if (curUrl) return "image";
      return "none";
    };

    const syncMedia = (timelineT: number) => {
      const t = Math.min(td, Math.max(0, timelineT));
      const { index: fi, localSec } = flowPreviewIndexAndLocal(t, segments);
      if (flowRafPrevSegRef.current !== fi) {
        flowRafPrevSegRef.current = fi;
        setFlowPreviewAnimKey((k) => k + 1);
      }

      const seg = segments[fi];
      if (!seg) return;

      const materialCap =
        videoDuration != null && Number.isFinite(videoDuration) && videoDuration > 0
          ? videoDuration
          : seg.endSec + 60;
      const masterAudioTime = Math.min(Math.max(0, t), materialCap - 0.02);

      const curUrl = (segmentImageUrls[fi] ?? "").trim();
      const curVideoUrl = (segmentVideoUrls[fi] ?? "").trim();
      const mt = effectiveMtAt(fi);
      const v = flowPreviewVideoRef.current;

      const pauseMaterialAudio = () => {
        flowPreviewMaterialAudioRef.current?.pause();
      };

      const syncMaterialAudioPlay = () => {
        const src = videoUrl?.trim();
        if (!src) return;
        let ma = flowPreviewMaterialAudioRef.current;
        if (!ma) {
          ma = new Audio();
          flowPreviewMaterialAudioRef.current = ma;
        }
        if (flowPreviewMaterialAudioSrcRef.current !== src) {
          flowPreviewMaterialAudioSrcRef.current = src;
          ma.pause();
          ma.src = src;
          ma.load();
        }
        try {
          if (Math.abs(ma.currentTime - masterAudioTime) > 0.18) {
            ma.currentTime = masterAudioTime;
          }
        } catch {
          /* ignore */
        }
        if (ma.paused) void ma.play().catch(() => {});
      };

      if (mt === "video" && curVideoUrl && v) {
        pauseMaterialAudio();
        const vStart = segmentVideoStartSec[fi] ?? 0;
        const vEndRaw = segmentVideoEndSec[fi];
        const spanDur = flowSegmentSpanSec(seg);
        const tEnd = vStart + spanDur;
        const clampEnd =
          vEndRaw != null && Number.isFinite(vEndRaw) ? Math.min(tEnd, vEndRaw) : tEnd;
        const target = Math.min(Math.max(vStart, vStart + localSec), clampEnd - 1e-3);
        const vMuted = segmentVideoMuted[fi] ?? false;

        if (Math.abs(v.currentTime - target) > 0.12) {
          v.currentTime = target;
        }

        let audio = flowPreviewAudioRef.current;
        if (vMuted) {
          if (!audio) {
            audio = new Audio();
            flowPreviewAudioRef.current = audio;
          }
          if (flowPreviewAudioSrcRef.current !== curVideoUrl) {
            flowPreviewAudioSrcRef.current = curVideoUrl;
            audio.pause();
            audio.src = curVideoUrl;
            audio.load();
          }
          try {
            if (Math.abs(audio.currentTime - target) > 0.2) audio.currentTime = target;
          } catch {
            /* ignore */
          }
          if (v.paused) void v.play().catch(() => {});
          if (audio.paused) void audio.play().catch(() => {});
        } else {
          audio?.pause();
          if (v.paused) void v.play().catch(() => {});
        }
        return;
      }

      v?.pause();
      flowPreviewAudioRef.current?.pause();
      syncMaterialAudioPlay();
    };

    flowRafPrevSegRef.current = flowPreviewIndexAndLocal(base, segments).index;

    const tick = (now: number) => {
      const elapsed = (now - start) / 1000;
      const nextT = base + elapsed;
      if (nextT >= td) {
        setFlowTimeSec(td);
        flowTimeSecRef.current = td;
        syncMedia(td);
        stopFlowPlayback();
        return;
      }
      setFlowTimeSec(nextT);
      flowTimeSecRef.current = nextT;
      syncMedia(nextT);
      flowRafRef.current = requestAnimationFrame(tick);
    };

    flowRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (flowRafRef.current != null) {
        cancelAnimationFrame(flowRafRef.current);
        flowRafRef.current = null;
      }
    };
  }, [
    isFlowPlaying,
    previewRowIndex,
    flowPreviewSegments,
    flowPlaybackEndSec,
    segmentImageUrls,
    segmentVideoUrls,
    segmentMediaTypes,
    segmentVideoStartSec,
    segmentVideoEndSec,
    segmentVideoMuted,
    videoUrl,
    videoDuration,
    stopFlowPlayback,
  ]);

  /** 流れプレビュー停止中: タイムライン時刻に合わせて区間動画の1コマを表示 */
  useLayoutEffect(() => {
    if (isFlowPlaying || previewRowIndex == null) return;
    const segments = flowPreviewSegments;
    if (segments.length === 0) return;
    const { index: fi, localSec } = flowPreviewIndexAndLocal(flowTimeSec, segments);
    const seg = segments[fi];
    const curUrl = (segmentImageUrls[fi] ?? "").trim();
    const curVideoUrl = (segmentVideoUrls[fi] ?? "").trim();
    const storedMt = segmentMediaTypes[fi];
    const effectiveMt: SegmentMediaType =
      storedMt === "image" || storedMt === "video"
        ? storedMt
        : curVideoUrl
          ? "video"
          : curUrl
            ? "image"
            : "none";
    const materialCap =
      videoDuration != null && Number.isFinite(videoDuration) && videoDuration > 0
        ? videoDuration
        : seg.endSec + 60;
    const masterAudioTime = Math.min(Math.max(0, flowTimeSec), materialCap - 0.02);

    const syncMaterialPaused = () => {
      const src = videoUrl?.trim();
      if (!src) {
        flowPreviewMaterialAudioRef.current?.pause();
        return;
      }
      let ma = flowPreviewMaterialAudioRef.current;
      if (!ma) {
        ma = new Audio();
        flowPreviewMaterialAudioRef.current = ma;
      }
      if (flowPreviewMaterialAudioSrcRef.current !== src) {
        flowPreviewMaterialAudioSrcRef.current = src;
        ma.pause();
        ma.src = src;
        ma.load();
      }
      try {
        ma.currentTime = masterAudioTime;
      } catch {
        /* ignore */
      }
      ma.pause();
    };

    if (effectiveMt !== "video" || !curVideoUrl || !seg) {
      flowPreviewVideoRef.current?.pause();
      flowPreviewAudioRef.current?.pause();
      syncMaterialPaused();
      return;
    }
    const v = flowPreviewVideoRef.current;
    if (!v) {
      flowPreviewAudioRef.current?.pause();
      flowPreviewMaterialAudioRef.current?.pause();
      return;
    }
    flowPreviewMaterialAudioRef.current?.pause();
    const vStart = segmentVideoStartSec[fi] ?? 0;
    const vEndRaw = segmentVideoEndSec[fi];
    const spanDur = flowSegmentSpanSec(seg);
    const tEnd = vStart + spanDur;
    const clampEnd =
      vEndRaw != null && Number.isFinite(vEndRaw) ? Math.min(tEnd, vEndRaw) : tEnd;
    const target = Math.min(Math.max(vStart, vStart + localSec), clampEnd - 1e-3);
    v.currentTime = target;
    v.pause();
    const au = flowPreviewAudioRef.current;
    if (segmentVideoMuted[fi]) {
      if (au && flowPreviewAudioSrcRef.current !== curVideoUrl) {
        flowPreviewAudioSrcRef.current = curVideoUrl;
        au.src = curVideoUrl;
        au.load();
      }
      if (au) {
        try {
          au.currentTime = target;
        } catch {
          /* ignore */
        }
        au.pause();
      }
    } else {
      au?.pause();
    }
  }, [
    isFlowPlaying,
    previewRowIndex,
    flowTimeSec,
    flowPreviewSegments,
    segmentImageUrls,
    segmentVideoUrls,
    segmentMediaTypes,
    segmentVideoStartSec,
    segmentVideoEndSec,
    segmentVideoMuted,
    videoUrl,
    videoDuration,
  ]);

  /** プレビュー行の時間が変わったら入力欄の表示を同期（editingPhrase の start/end を優先） */
  useEffect(() => {
    if (previewRowIndex == null) return;
    const b = effectiveEditingSegmentBounds;
    if (b) {
      setPreviewTimeStartStr(formatSecToMinSec(b.startSec));
      setPreviewTimeEndStr(formatSecToMinSec(b.endSec));
      return;
    }
    const seg = timelineSegments[previewRowIndex];
    if (seg) {
      setPreviewTimeStartStr(formatSecToMinSec(seg.startSec));
      setPreviewTimeEndStr(formatSecToMinSec(seg.endSec));
    }
  }, [previewRowIndex, timelineSegments, effectiveEditingSegmentBounds]);

  /** 区間が変わったら画像変更パネル・アップロード下書きをリセット */
  useEffect(() => {
    setModalImagePickerOpen(false);
    setModalUploadPick((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    setModalVideoPick((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
    setModalVideoUploadError(null);
    setModalImagePickerTab("suggested");
  }, [previewRowIndex]);

  /** 自分の動画タブ: ファイルが変わったらプレビュー用 video をアンマウント */
  useEffect(() => {
    setModalVideoPreviewVisible(false);
  }, [modalVideoPickBlobUrl]);

  /** モーダル閉じたらフレーズリストの scroll 抑止キーをリセット（再オープン時に必要ならスクロール） */
  useEffect(() => {
    if (previewRowIndex == null) lastModalPhraseScrollKeyRef.current = "";
  }, [previewRowIndex]);

  /** モーダル内フレーズキュー: プレビュー行・選択フレーズが変わったときだけスクロール */
  useEffect(() => {
    if (previewRowIndex == null || openPhraseQueueInModal !== previewRowIndex) return;
    if (editingPhraseId == null) return;
    const key = `${previewRowIndex}:${editingPhraseId}`;
    if (lastModalPhraseScrollKeyRef.current === key) return;
    lastModalPhraseScrollKeyRef.current = key;
    const el = modalPhraseItemRefs.current.get(editingPhraseId);
    if (el) {
      requestAnimationFrame(() => {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    }
  }, [previewRowIndex, openPhraseQueueInModal, editingPhraseId]);

  /** 区間再生: プレビューモーダル内で endSec に達したら停止 or ループ（境界は editingPhrase 優先） */
  useEffect(() => {
    if (segmentPlayMode == null) return;
    const b = effectiveEditingSegmentBounds;
    if (!b || currentTimeSec < b.endSec) return;
    if (segmentPlayMode === "segment") {
      onPause?.();
      setSegmentPlayMode(null);
    } else if (segmentPlayMode === "segmentLoop") {
      onSeekToSec?.(b.startSec);
      setTimeout(() => onSegmentPlayStart?.(), 120);
    }
  }, [segmentPlayMode, effectiveEditingSegmentBounds, currentTimeSec, onPause, onSeekToSec, onSegmentPlayStart]);

  /** モーダル/流れプレビュー: 前景画像・歌詞テキストのドラッグ移動（マウス/タッチ） */
  useEffect(() => {
    const onMove = (ev: MouseEvent | TouchEvent) => {
      const d = dragStateRef.current;
      if (!d) return;
      let clientX = 0;
      let clientY = 0;
      if ("touches" in ev) {
        const t = ev.touches[0];
        if (!t) return;
        clientX = t.clientX;
        clientY = t.clientY;
      } else {
        clientX = ev.clientX;
        clientY = ev.clientY;
      }
      if (d.kind === "mosaicMove" || d.kind === "mosaicResizeBr") {
        const dxPct = ((clientX - d.startClientX) / d.stageW) * 100;
        const dyPct = ((clientY - d.startClientY) / d.stageH) * 100;
        setSegmentMosaicRegions((prev) => {
          const nextRows = prev.map((row) => row.map((x) => ({ ...x })));
          while (nextRows.length <= d.segIndex) nextRows.push([]);
          const row = [...(nextRows[d.segIndex] ?? [])];
          const idx = row.findIndex((x) => x.id === d.regionId);
          if (idx < 0) return prev;
          const cur = row[idx]!;
          if (d.kind === "mosaicMove") {
            const nx = Math.min(100 - d.startRect.wPct, Math.max(0, d.startRect.xPct + dxPct));
            const ny = Math.min(100 - d.startRect.hPct, Math.max(0, d.startRect.yPct + dyPct));
            row[idx] = { ...cur, xPct: nx, yPct: ny };
          } else {
            const nw = Math.min(100 - d.startRect.xPct, Math.max(5, d.startRect.wPct + dxPct));
            const nh = Math.min(100 - d.startRect.yPct, Math.max(5, d.startRect.hPct + dyPct));
            row[idx] = { ...cur, wPct: nw, hPct: nh };
          }
          nextRows[d.segIndex] = row;
          return nextRows;
        });
        if ("touches" in ev) ev.preventDefault();
        return;
      }
      if (d.kind === "brandMove" || d.kind === "brandResizeBr") {
        const dxPct = ((clientX - d.startClientX) / d.stageW) * 100;
        const dyPct = ((clientY - d.startClientY) / d.stageH) * 100;
        setSegmentBrandMaskRegions((prev) => {
          const nextRows = prev.map((row) => row.map((x) => ({ ...x })));
          while (nextRows.length <= d.segIndex) nextRows.push([]);
          const row = [...(nextRows[d.segIndex] ?? [])];
          const idx = row.findIndex((x) => x.id === d.regionId);
          if (idx < 0) return prev;
          const cur = row[idx]!;
          if (d.kind === "brandMove") {
            const nx = Math.min(100 - d.startRect.wPct, Math.max(0, d.startRect.xPct + dxPct));
            const ny = Math.min(100 - d.startRect.hPct, Math.max(0, d.startRect.yPct + dyPct));
            row[idx] = { ...cur, xPct: nx, yPct: ny };
          } else {
            const nw = Math.min(100 - d.startRect.xPct, Math.max(5, d.startRect.wPct + dxPct));
            const nh = Math.min(100 - d.startRect.yPct, Math.max(5, d.startRect.hPct + dyPct));
            row[idx] = { ...cur, wPct: nw, hPct: nh };
          }
          nextRows[d.segIndex] = row;
          return nextRows;
        });
        if ("touches" in ev) ev.preventDefault();
        return;
      }
      if (d.kind !== "overlay" && d.kind !== "text") return;
      const nextX = d.startX + (clientX - d.startClientX);
      const nextY = d.startY + (clientY - d.startClientY);
      if (d.kind === "overlay") {
        setSegmentOverlayX((prev) => {
          const arr = [...prev];
          while (arr.length <= d.segIndex) arr.push(0);
          arr[d.segIndex] = Math.round(nextX);
          return arr;
        });
        setSegmentOverlayY((prev) => {
          const arr = [...prev];
          while (arr.length <= d.segIndex) arr.push(0);
          arr[d.segIndex] = Math.round(nextY);
          return arr;
        });
      } else {
        setSegmentTextX((prev) => {
          const arr = [...prev];
          while (arr.length <= d.segIndex) arr.push(0);
          arr[d.segIndex] = Math.round(nextX);
          return arr;
        });
        setSegmentTextY((prev) => {
          const arr = [...prev];
          while (arr.length <= d.segIndex) arr.push(0);
          arr[d.segIndex] = Math.round(nextY);
          return arr;
        });
      }
      if ("touches" in ev) ev.preventDefault();
    };
    const onUp = () => {
      dragStateRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onUp);
    window.addEventListener("touchcancel", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("touchcancel", onUp);
    };
  }, []);

  const handlePhraseQueueResetPosition = useCallback(() => {
    setPhraseQueuePanel({ width: DEFAULT_PANEL_WIDTH, minimized: false });
  }, []);

  const handlePhraseQueueResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    phraseQueueResizeRef.current = { startX: e.clientX, startWidth: phraseQueuePanel.width };
  }, [phraseQueuePanel.width]);

  useEffect(() => {
    if (phraseQueueResizeRef.current == null) return;
    const onMove = (e: MouseEvent) => {
      const r = phraseQueueResizeRef.current;
      if (!r) return;
      const dx = e.clientX - r.startX;
      setPhraseQueuePanel((prev) => {
        const w = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, r.startWidth - dx));
        return { ...prev, width: w };
      });
    };
    const onUp = () => {
      phraseQueueResizeRef.current = null;
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [phraseQueuePanel.width]);

  /** 本番タイムライン: 復元時は保存済み行をそのまま適用。通常は手動声区間+無音 と 間奏 をマージして生成 */
  useEffect(() => {
    const pending = pendingImportedTimelineRef.current;
    if (pending != null && pending.length > 0) {
      pendingImportedTimelineRef.current = null;
      lastTimelineTimesFingerprintRef.current = timelineTimesFingerprint(pending);
      const waitDuration =
        videoDuration == null || !Number.isFinite(videoDuration) || videoDuration <= 0;
      if (waitDuration) {
        deferTimelineDerivedRebuildUntilDurationRef.current = true;
      } else {
        deferTimelineDerivedRebuildUntilDurationRef.current = false;
      }
      logTimelineRestore("3_effect applyPendingImport → setTimelineSegments（import直後の反映）", {
        rowCount: pending.length,
        fingerprint: lastTimelineTimesFingerprintRef.current,
        videoDuration,
        deferDerivedUntilVideoDuration: waitDuration,
        detail: timelineSegmentsDebugRows(pending),
      });
      setTimelineSegments((prev) =>
        pending.map((s, i) => ({
          ...s,
          id: prev[i]?.id ?? `seg-${i}-${s.startSec}-${s.endSec}-${s.type}`,
        }))
      );
      return;
    }

    if (deferTimelineDerivedRebuildUntilDurationRef.current) {
      if (videoDuration == null || !Number.isFinite(videoDuration) || videoDuration <= 0) {
        logTimelineRestore("3b_effect skipDerived（動画長未確定のため派生再計算を保留）", {
          videoDuration,
        });
        return;
      }
      logTimelineRestore("3c_effect resumeDerived（動画長が来たので派生再計算を許可）", {
        videoDuration,
      });
      deferTimelineDerivedRebuildUntilDurationRef.current = false;
    }

    const built = buildTimelineSegments(manualVoiceSegments, videoDuration);
    const interludeSegs: TimelineSegment[] = manualInterludes
      .filter((m) => Number.isFinite(m.startSec) && Number.isFinite(m.endSec) && m.endSec > m.startSec)
      .map((m) => ({ startSec: m.startSec, endSec: m.endSec, type: "interlude" as const }));
    const mergedBase = [...built, ...interludeSegs].sort((a, b) => a.startSec - b.startSec);
    const timelineEnd = mergedBase.length > 0 ? Math.max(...mergedBase.map((s) => s.endSec)) : 0;
    const brandingStart = Math.max(0, timelineEnd);
    const brandingEnd = brandingStart + BRANDING_SEGMENT_SEC;
    const merged: TimelineSegment[] = [
      ...mergedBase.filter((s) => !s.isBranding),
      {
        startSec: brandingStart,
        endSec: brandingEnd,
        type: "silence",
        isBranding: true,
      },
    ];

    const fp = timelineTimesFingerprint(merged);
    if (fp === lastTimelineTimesFingerprintRef.current) {
      logTimelineRestore("4_effect fingerprintSkip（派生結果＝直前の確定と同一のため setState しない）", {
        mergedRows: merged.length,
        fingerprint: fp,
      });
      return;
    }
    logTimelineRestore("5_effect derivedRebuild → setTimelineSegments（手動声区間＋無音再合成・ここで import とズレるなら要調査）", {
      mergedRows: merged.length,
      previousFingerprint: lastTimelineTimesFingerprintRef.current,
      newFingerprint: fp,
      videoDuration,
      detail: timelineSegmentsDebugRows(merged),
    });
    lastTimelineTimesFingerprintRef.current = fp;

    setTimelineSegments((prev) =>
      merged.map((s, i) => ({
        ...s,
        id: prev[i]?.id ?? `seg-${i}-${s.startSec}-${s.endSec}-${s.type}`,
      }))
    );
  }, [manualVoiceSegments, videoDuration, manualInterludes]);

  useEffect(() => {
    logTimelineRestore("0_videoId 変更で import 用 ref をリセット", { videoId });
    pendingImportedTimelineRef.current = null;
    lastTimelineTimesFingerprintRef.current = "";
    deferTimelineDerivedRebuildUntilDurationRef.current = false;
    phraseClipboardRef.current = null;
    setPhraseClipReady(false);
    setPhraseClipSummary("");
  }, [videoId]);

  /** 区間リストの変更を親に通知（歌詞一括割当用） */
  useEffect(() => {
    onVoiceSegmentsChange?.(manualVoiceSegments);
  }, [manualVoiceSegments, onVoiceSegmentsChange]);

  useEffect(() => {
    const n = timelineSegments.length;
    setSegmentTexts((prev) => {
      if (prev.length === n) return prev;
      const next = prev.slice(0, n);
      while (next.length < n) next.push("");
      return next;
    });
    setPhraseQueue((prev) => {
      if (prev.length === n) return prev;
      if (prev.length > n) return prev.slice(0, n);
      const next = [...prev];
      while (next.length < n) next.push({ id: newPhraseQueueId(), text: "" });
      return next;
    });
    setSegmentImageUrls((prev) => {
      prev.forEach((url, i) => {
        if (i >= n && url?.startsWith("blob:")) URL.revokeObjectURL(url);
      });
      const next = prev.slice(0, n);
      while (next.length < n) next.push(undefined);
      return next;
    });
    setSegmentVideoUrls((prev) => {
      prev.forEach((url, i) => {
        if (i >= n && url?.startsWith("blob:")) URL.revokeObjectURL(url);
      });
      const next = prev.slice(0, n);
      while (next.length < n) next.push(undefined);
      return next;
    });
    setSegmentMediaTypes((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("none");
      return next;
    });
    setSegmentVideoStartSec((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(0);
      return next;
    });
    setSegmentVideoEndSec((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(undefined);
      return next;
    });
    setSegmentVideoMuted((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(false);
      return next;
    });
    setSegmentLyricsFontSize((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(DEFAULT_LYRICS_FONT_SIZE);
      return next;
    });
    setSegmentLyricsColor((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("#ffffff");
      return next;
    });
    setSegmentScreenFilters((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("normal");
      return next;
    });
    setSegmentMediaObjectFit((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("cover");
      return next;
    });
    setSegmentCompositeEnabled((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(false);
      return next;
    });
    setSegmentCompositeModes((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("none");
      return next;
    });
    setSegmentMosaicRegions((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push([]);
      return next;
    });
    setSegmentMosaicSelectedId((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(null);
      return next;
    });
    setSegmentBrandMaskRegions((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push([]);
      return next;
    });
    setSegmentBrandMaskSelectedId((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(null);
      return next;
    });
    setSegmentOverlayImageUrls((prev) => {
      prev.forEach((url, i) => {
        if (i >= n && url?.startsWith("blob:")) URL.revokeObjectURL(url);
      });
      const next = prev.slice(0, n);
      while (next.length < n) next.push(undefined);
      return next;
    });
    setSegmentOverlayTexts((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("");
      return next;
    });
    setSegmentOverlayOpacity((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(0.85);
      return next;
    });
    setSegmentOverlayScaleX((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(1);
      return next;
    });
    setSegmentOverlayScaleY((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(1);
      return next;
    });
    setSegmentOverlayPosition((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("center");
      return next;
    });
    setSegmentOverlayX((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(0);
      return next;
    });
    setSegmentOverlayY((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(0);
      return next;
    });
    setSegmentTextX((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(0);
      return next;
    });
    setSegmentTextY((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(0);
      return next;
    });
    setSegmentAnims((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("none");
      return next;
    });
    setSegmentDisplayModes((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(1);
      return next;
    });
    setSegmentLineBreakAt((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(0);
      return next;
    });
    setSegmentSearchTerms((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push("");
      return next;
    });
    setSegmentImageSourceKinds((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(null);
      return next;
    });
    setSegmentModalSuggestQueryOverride((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) next.push(null);
      return next;
    });
  }, [timelineSegments.length]);

  /** トーンと選択タグから検索クエリを自動生成（searchDirty=false のときのみ反映） */
  useEffect(() => {
    if (searchDirty) return;
    const tone = IMAGE_TONE_OPTIONS.find((t) => t.id === imageTone);
    const tonePart = tone?.keywords?.[0] ?? "";
    const tagPart = selectedTags.slice(0, 3).join(" ");
    const auto = [tonePart, tagPart].filter(Boolean).join(" ").trim();
    setSearchQuery(auto);
  }, [imageTone, selectedTags, searchDirty]);

  /** 自動生成直後に、voice 行へフレーズキュー由来の歌詞を流し込む */
  useEffect(() => {
    if (!pendingAutoLyricChunks || timelineSegments.length === 0) return;
    let voiceIdx = 0;
    setSegmentTexts((prev) => {
      const next = [...prev];
      for (let i = 0; i < timelineSegments.length; i++) {
        const seg = timelineSegments[i];
        if (seg.type === "voice") {
          const text = pendingAutoLyricChunks[voiceIdx] ?? "";
          if (text.trim()) next[i] = text;
          voiceIdx++;
        }
      }
      return next;
    });
    setPendingAutoLyricChunks(null);
  }, [pendingAutoLyricChunks, timelineSegments]);

  /**
   * 手動: 1ボタントグル。声開始 → 声停止 → 区間完成 → 声開始… の繰り返し。
   * 停止から次の開始まで = 無音区間（buildTimelineSegments で自動挿入）。
   */
  function handleManualVoiceToggle() {
    if (manualRecordingState === "idle") {
      setPendingVoiceStart(currentTimeSec);
      setManualRecordingState("recordingVoice");
    } else {
      const start = pendingVoiceStart;
      if (start == null) return;
      let startSec = start;
      let endSec = currentTimeSec;
      if (startSec > endSec) [startSec, endSec] = [endSec, startSec];
      if (endSec - startSec >= 0.01) {
        setManualVoiceSegments((prev) => [...prev, { startSec, endSec }]);
      }
      setPendingVoiceStart(null);
      setManualRecordingState("idle");
    }
  }

  /** 手動: 直前の声区間を削除 */
  function handleRemoveLastSegment() {
    setManualVoiceSegments((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
    setPendingVoiceStart(null);
    setManualRecordingState("idle");
  }

  /** タイムラインをクリア（確認付き）。手動で作り直すときに使用 */
  function handleClearTimeline() {
    if (manualVoiceSegments.length === 0) return;
    if (!window.confirm("タイムラインをすべてクリアしてよろしいですか？\n手動で作成した区間がすべて削除されます。")) return;
    setManualVoiceSegments([]);
    setPendingVoiceStart(null);
    setManualRecordingState("idle");
  }

  function handlePhraseify() {
    const params = getPresetParams(songStyle, displayTempo);
    const q = phraseifyWithPreset(lyricsFullText, params);
    setPhraseQueue(stringsToPhraseQueueItems(q));
  }

  /** 歌詞全文から一括生成: フレーズキュー + 曲イメージキーワード + Pixabay画像候補。sourceText が渡されればそれを使用、なければ lyricsFullText */
  async function runFullTextApply(
    sourceText: string,
    options?: { skipConfirm?: boolean }
  ): Promise<{ phraseCount: number; imageCount: number } | null> {
    const text = sourceText.trim();
    if (!text) return null;
    if (!options?.skipConfirm && (phraseQueue.length > 0 || themeKeywords.length > 0)) {
      if (!window.confirm("フレーズキューと曲イメージ候補を上書きします。よろしいですか？")) return null;
    }
    const params = getPresetParams(songStyle, displayTempo);
    const phrases = phraseifyWithPreset(text, params);
    setPhraseQueue(stringsToPhraseQueueItems(phrases));
    setLyricsFullText(text);
    const { keywords, themeString: nextTheme } = parseLyricsTheme(phrases);
    setThemeKeywords(keywords);
    setThemeString(nextTheme);
    setThemeImageResults([]);
    setThemeSearchError(null);
    let imageCount = 0;
    if (nextTheme.trim()) {
      setThemeSearchLoading(true);
      try {
        const res = await fetch(`/api/search-images?q=${encodeURIComponent(nextTheme)}`);
        const json = (await res.json()) as { ok?: boolean; message?: string; images?: SearchImageResult[] };
        if (json?.ok && Array.isArray(json.images)) {
          setThemeImageResults(json.images);
          imageCount = json.images.length;
        } else {
          setThemeSearchError(json?.message ?? "画像の取得に失敗しました。");
        }
      } catch (e) {
        setThemeSearchError(e instanceof Error ? e.message : "画像検索に失敗しました。");
      } finally {
        setThemeSearchLoading(false);
      }
    }
    return { phraseCount: phrases.length, imageCount };
  }

  function handleFullTextApply() {
    void (async () => {
      const src = lyricsFullText;
      const r = await runFullTextApply(src);
      if (r == null) return;
      onApplyComplete?.({ ...r, sourceText: src });
    })();
  }

  /** 親の「全文から一括生成」手動ボタンのみ（確認ダイアログあり・連鎖なし） */
  useEffect(() => {
    if (applyFullTextTriggerId <= 0) return;
    const src = applyFromSourceLatestRef.current;
    if (!src || src.id <= 0) return;
    const text = src.text?.trim() ?? "";
    if (!text) return;

    let cancelled = false;
    void (async () => {
      try {
        const result = await runFullTextApply(text, { skipConfirm: false });
        if (cancelled || result == null) return;
        onApplyComplete?.({ ...result, sourceText: text });
      } finally {
        if (!cancelled) {
          onApplyFromSourceFinished?.();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyFullTextTriggerId]);

  /**
   * 曲調の「約○秒で画面切替」に合わせてフレーズを結合し、フレーズキューとタイムライン枠の両方に反映。
   * - フレーズキュー: 結合したチャンクを並べる（順にペーストできる）
   * - タイムライン: 動画長をチャンク数で等分した声区間を生成（各枠に歌詞を入れられる）
   * @param lyricsOverride 直前の一括生成直後など state 未反映時用に全文を渡す
   */
  function handleAutoGenerate(
    lyricsOverride?: string,
    options?: { secondsPerScreenOverride?: number }
  ) {
    const params = getPresetParams(songStyle, displayTempo);
    const raw = (
      lyricsOverride ??
      (phraseQueue.length > 0 ? phraseQueue.map((p) => p.text).join("\n") : lyricsFullText)
    ).trim();
    const phrases = phraseifyWithPreset(raw, params);
    const secondsPerScreen = options?.secondsPerScreenOverride ?? params.secondsPerScreen;
    const chunks = autoGeneratePhraseChunks(phrases, videoDuration, secondsPerScreen);
    setPhraseQueue(stringsToPhraseQueueItems(chunks));

    const dur = videoDuration ?? 0;
    if (chunks.length > 0 && Number.isFinite(dur) && dur > 0) {
      const n = chunks.length;
      const newSegments: VoiceSegment[] = [];
      for (let i = 0; i < n; i++) {
        const startSec = (i / n) * dur;
        const endSec = ((i + 1) / n) * dur;
        if (endSec > startSec) newSegments.push({ startSec, endSec });
      }
      // 歌詞付きの枠として扱うため、voice 行用の歌詞チャンクを一時的に保持
      setPendingAutoLyricChunks(chunks);
      setManualVoiceSegments(newSegments);
      setPendingVoiceStart(null);
      setManualRecordingState("idle");
      pendingEditingRowIndexRef.current = 0;

      // デバッグ用: フレーズと生成された行を確認
      const rows = newSegments
        .map((seg, idx) => {
          const lyric = chunks[idx] ?? "";
          if (!lyric.trim()) return null;
          return {
            id: idx,
            lyric,
            phraseIds: [idx],
            startMs: Math.round(seg.startSec * 1000),
            endMs: Math.round(seg.endSec * 1000),
          };
        })
        .filter(Boolean);
      // eslint-disable-next-line no-console
      console.log("VoiceSegmentPanel auto-generate from phrase queue", {
        phrases: chunks.map((text, idx) => ({ id: idx, text })),
        rows,
      });
    }
  }

  pipelineFnsRef.current = { runFullTextApply, handleAutoGenerate };

  useImperativeHandle(ref, () => ({
    async runAutoLyricPipeline(fullText: string) {
      const text = fullText.trim();
      if (text.length < MIN_LYRICS_FOR_AUTO_PIPELINE) {
        return { ok: false, error: "short" };
      }
      if (autoPipelineLockRef.current) {
        return { ok: false, error: "busy" };
      }
      const fns = pipelineFnsRef.current;
      if (!fns) {
        return { ok: false, error: "unmounted" };
      }
      autoPipelineLockRef.current = true;
      try {
        const result = await fns.runFullTextApply(text, { skipConfirm: true });
        if (result == null) {
          return { ok: false, error: "aborted" };
        }
        fns.handleAutoGenerate(text, { secondsPerScreenOverride: AUTO_PIPELINE_SECONDS_PER_SCREEN });
        return {
          ok: true,
          phraseCount: result.phraseCount,
          imageCount: result.imageCount,
        };
      } catch (e) {
        return {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      } finally {
        autoPipelineLockRef.current = false;
      }
    },
    exportProjectState() {
      const exportTimelineForFp: TimelineSegment[] = timelineSegments.map((s) => ({
        startSec: s.startSec,
        endSec: s.endSec,
        type: s.type,
        ...(s.isBranding ? ({ isBranding: true } as const) : {}),
      }));
      logTimelineRestore("1_export（保存ペイロードの秒・型）", {
        rowCount: timelineSegments.length,
        fingerprint: timelineTimesFingerprint(exportTimelineForFp),
        voice: exportTimelineForFp.filter((s) => s.type === "voice").length,
        silence: exportTimelineForFp.filter((s) => s.type === "silence" && !s.isBranding).length,
        interlude: exportTimelineForFp.filter((s) => s.type === "interlude").length,
        branding: exportTimelineForFp.filter((s) => Boolean(s.isBranding)).length,
        detail: timelineSegmentsDebugRows(exportTimelineForFp),
      });
      return {
        timelineSegments: timelineSegments.map((s) => ({
          startSec: s.startSec,
          endSec: s.endSec,
          type: s.type,
          isBranding: Boolean(s.isBranding),
        })),
        lyricsFullText,
        lyricsQueue: phraseQueue.map((p) => p.text),
        phraseQueue: phraseQueue.map((p) => ({ ...p })),
        lyricsCursor: 0,
        selectedSegmentIndex: (() => {
          const i = editingPhraseId ? phraseQueue.findIndex((p) => p.id === editingPhraseId) : -1;
          return i >= 0 ? i : 0;
        })(),
        editingPhraseId,
        flowTimeSec,
        segmentTexts: [...segmentTexts],
        segmentVideoUrls: [...segmentVideoUrls],
        segmentMediaTypes: [...segmentMediaTypes],
        segmentAnims: [...segmentAnims],
        segmentDisplayModes: [...segmentDisplayModes],
        segmentLineBreakAt: [...segmentLineBreakAt],
        segmentCompositeEnabled: [...segmentCompositeEnabled],
        segmentCompositeModes: [...segmentCompositeModes],
        segmentMosaicRegions: segmentMosaicRegions.map((row) => row.map((r) => ({ ...r }))),
        segmentBrandMaskRegions: segmentBrandMaskRegions.map((row) => row.map((r) => ({ ...r }))),
        segmentOverlayImageUrls: [...segmentOverlayImageUrls],
        segmentOverlayTexts: [...segmentOverlayTexts],
        segmentOverlayOpacity: [...segmentOverlayOpacity],
        segmentOverlayScaleX: [...segmentOverlayScaleX],
        segmentOverlayScaleY: [...segmentOverlayScaleY],
        segmentOverlayPosition: [...segmentOverlayPosition],
        segmentOverlayX: [...segmentOverlayX],
        segmentOverlayY: [...segmentOverlayY],
        segmentTextX: [...segmentTextX],
        segmentTextY: [...segmentTextY],
        segmentMediaObjectFit: [...segmentMediaObjectFit],
        segmentVideoMuted: [...segmentVideoMuted],
        segmentLyricsFontSize: [...segmentLyricsFontSize],
        segmentLyricsColor: [...segmentLyricsColor],
        segmentScreenFilters: [...segmentScreenFilters],
        segmentImageUrls: segmentImageUrls.map((url, i) => {
          const u = (url ?? "").trim();
          const sel = segmentImageSelections[i];
          if (sel?.imageSource === "uploaded" && (u.startsWith("blob:") || u.startsWith("data:")))
            return undefined;
          return url;
        }),
        segmentImageSelections: segmentImageSelections.map((sel, i) => {
          if (!sel) return null;
          const u = (segmentImageUrls[i] ?? "").trim();
          if (sel.imageSource === "uploaded" && (u.startsWith("blob:") || u.startsWith("data:"))) {
            return {
              ...sel,
              localImageNeedsReselect: true,
              imageUrl: "",
              previewUrl: undefined,
            };
          }
          return sel;
        }),
        nameMaskPreset: {
          ...nameMaskPreset,
          nameArea: { ...nameMaskPreset.nameArea },
          rules: nameMaskPreset.rules.map((r) => ({ ...r })),
        },
      };
    },
    importProjectState(state: VoiceSegmentPanelProjectState) {
      phraseClipboardRef.current = null;
      setPhraseClipReady(false);
      setPhraseClipSummary("");
      const ts = normalizeImportedTimelineSegments(state.timelineSegments);
      pendingImportedTimelineRef.current = ts.length > 0 ? ts.map((s) => ({ ...s })) : null;
      const voice = ts
        .filter((s) => s.type === "voice")
        .map((s) => ({ startSec: s.startSec, endSec: s.endSec }));
      const interludes = ts
        .filter((s) => s.type === "interlude")
        .map((s) => ({ startSec: s.startSec, endSec: s.endSec }));
      logTimelineRestore("2_import（import直後・正規化済み timelineSegments）", {
        rowCount: ts.length,
        fingerprint: timelineTimesFingerprint(ts),
        voiceRows: voice.length,
        interludeRows: interludes.length,
        silenceRows: ts.filter((s) => s.type === "silence" && !s.isBranding).length,
        brandingRows: ts.filter((s) => Boolean(s.isBranding)).length,
        detail: timelineSegmentsDebugRows(ts),
        pendingQueued: Boolean(pendingImportedTimelineRef.current?.length),
      });
      const n = ts.length;
      const pad = (arr: unknown[] | undefined, fill: unknown): unknown[] => {
        const base = Array.isArray(arr) ? [...arr] : [];
        if (base.length > n) return base.slice(0, n);
        while (base.length < n) base.push(fill);
        return base;
      };
      setManualVoiceSegments(voice);
      setManualInterludes(interludes);
      setLyricsFullText(typeof state.lyricsFullText === "string" ? state.lyricsFullText : "");
      const pqRaw = Array.isArray(state.phraseQueue)
        ? state.phraseQueue
        : Array.isArray(state.lyricsQueue)
          ? state.lyricsQueue
          : [];
      setPhraseQueue(normalizePhraseQueueImport(pqRaw));
      pendingImportEditingPhraseIdRef.current =
        typeof state.editingPhraseId === "string" && state.editingPhraseId.trim() !== ""
          ? state.editingPhraseId.trim()
          : null;
      pendingEditingRowIndexRef.current =
        typeof state.selectedSegmentIndex === "number" && Number.isFinite(state.selectedSegmentIndex)
          ? Math.max(0, Math.floor(state.selectedSegmentIndex))
          : 0;
      setSegmentTexts(pad(state.segmentTexts, "") as string[]);
      const rawImportImageUrls = pad(state.segmentImageUrls, undefined) as (string | undefined)[];
      const rawImportImageSelections = pad(state.segmentImageSelections, null) as unknown[];
      const parsedImportSelections: (SegmentImageSelectionMeta | null)[] = rawImportImageSelections.map((v) => {
        if (!v || typeof v !== "object") return null;
        const x = v as Partial<SegmentImageSelectionMeta>;
        const imageSource = x.imageSource === "uploaded" ? "uploaded" : "suggested";
        const searchTags = Array.isArray(x.searchTags)
          ? x.searchTags.filter((t): t is string => typeof t === "string" && t.trim() !== "")
          : undefined;
        return {
          lyricText: typeof x.lyricText === "string" ? x.lyricText : "",
          searchKeywords: typeof x.searchKeywords === "string" ? x.searchKeywords : "",
          searchTags,
          imageSource,
          apiRank:
            typeof x.apiRank === "number" && Number.isFinite(x.apiRank)
              ? x.apiRank
              : undefined,
          boostScore:
            typeof x.boostScore === "number" && Number.isFinite(x.boostScore)
              ? x.boostScore
              : undefined,
          boostReason:
            typeof x.boostReason === "string" && x.boostReason.trim() !== ""
              ? x.boostReason
              : undefined,
          pixabayImageId:
            typeof x.pixabayImageId === "number" && Number.isFinite(x.pixabayImageId)
              ? x.pixabayImageId
              : undefined,
          imageUrl: typeof x.imageUrl === "string" ? x.imageUrl : "",
          previewUrl: typeof x.previewUrl === "string" ? x.previewUrl : undefined,
          pageUrl: typeof x.pageUrl === "string" ? x.pageUrl : undefined,
          selectedAt:
            typeof x.selectedAt === "string" && x.selectedAt.trim() !== ""
              ? x.selectedAt
              : new Date(0).toISOString(),
          localImageNeedsReselect: x.localImageNeedsReselect === true ? true : undefined,
        } satisfies SegmentImageSelectionMeta;
      });
      const restoredImageUrls: (string | undefined)[] = [];
      const restoredImageSelections: (SegmentImageSelectionMeta | null)[] = [];
      for (let i = 0; i < n; i++) {
        const rawSaved = rawImportImageUrls[i];
        const saved = typeof rawSaved === "string" ? rawSaved.trim() : "";
        const sel = parsedImportSelections[i] ?? null;
        let u = saved;
        let strippedUpload = false;
        if (u.startsWith("blob:")) {
          u = "";
          if (sel?.imageSource === "uploaded") strippedUpload = true;
        }
        if (sel?.imageSource === "uploaded" && u.startsWith("data:")) {
          u = "";
          strippedUpload = true;
        }
        if (sel?.imageSource === "uploaded" && u !== "" && !isRestorableRemoteImageUrl(u)) {
          u = "";
          strippedUpload = true;
        }
        restoredImageUrls.push(u || undefined);
        if (!sel) {
          restoredImageSelections.push(null);
          continue;
        }
        const needsReselect =
          Boolean(sel.localImageNeedsReselect) || (sel.imageSource === "uploaded" && strippedUpload);
        restoredImageSelections.push({
          ...sel,
          imageUrl: u || "",
          previewUrl: u ? sel.previewUrl : undefined,
          localImageNeedsReselect: needsReselect ? true : undefined,
        });
      }
      setSegmentImageUrls(restoredImageUrls);
      setSegmentVideoUrls(pad(state.segmentVideoUrls, undefined) as (string | undefined)[]);
      setSegmentMediaTypes(pad(state.segmentMediaTypes, "none") as SegmentMediaType[]);
      setSegmentAnims(pad(state.segmentAnims, "none") as string[]);
      setSegmentDisplayModes(pad(state.segmentDisplayModes, 1) as SegmentModalLyricsLayout[]);
      setSegmentLineBreakAt(pad(state.segmentLineBreakAt, 0) as number[]);
      setSegmentCompositeEnabled(pad(state.segmentCompositeEnabled, false) as boolean[]);
      const modesPadded = pad(state.segmentCompositeModes, "none") as unknown[];
      setSegmentCompositeModes(
        modesPadded.map((m) => normalizeImportedCompositeMode(m)) as SegmentCompositeMode[]
      );
      const rawMosaicRows = Array.isArray(state.segmentMosaicRegions) ? state.segmentMosaicRegions : [];
      setSegmentMosaicRegions(
        Array.from({ length: n }, (_, i) => normalizeImportedMosaicRegions(rawMosaicRows[i]))
      );
      setSegmentMosaicSelectedId((prev) => {
        const next = prev.slice(0, n);
        while (next.length < n) next.push(null);
        return next;
      });
      const rawBrandRows = Array.isArray(state.segmentBrandMaskRegions) ? state.segmentBrandMaskRegions : [];
      setSegmentBrandMaskRegions(
        Array.from({ length: n }, (_, i) => normalizeImportedBrandMaskRegions(rawBrandRows[i]))
      );
      setSegmentBrandMaskSelectedId((prev) => {
        const next = prev.slice(0, n);
        while (next.length < n) next.push(null);
        return next;
      });
      setSegmentOverlayImageUrls(pad(state.segmentOverlayImageUrls, undefined) as (string | undefined)[]);
      setSegmentOverlayTexts(pad(state.segmentOverlayTexts, "") as string[]);
      setSegmentOverlayOpacity(pad(state.segmentOverlayOpacity, 0.85) as number[]);
      setSegmentOverlayScaleX(pad(state.segmentOverlayScaleX, 1) as number[]);
      setSegmentOverlayScaleY(pad(state.segmentOverlayScaleY, 1) as number[]);
      setSegmentOverlayPosition(pad(state.segmentOverlayPosition, "center") as SegmentOverlayPosition[]);
      setSegmentOverlayX(pad(state.segmentOverlayX, 0) as number[]);
      setSegmentOverlayY(pad(state.segmentOverlayY, 0) as number[]);
      setSegmentTextX(pad(state.segmentTextX, 0) as number[]);
      setSegmentTextY(pad(state.segmentTextY, 0) as number[]);
      setSegmentMediaObjectFit(pad(state.segmentMediaObjectFit, "cover") as ("cover" | "contain")[]);
      setSegmentVideoMuted(pad(state.segmentVideoMuted, false) as boolean[]);
      setSegmentLyricsFontSize(
        (pad(state.segmentLyricsFontSize, DEFAULT_LYRICS_FONT_SIZE) as unknown[]).map((v) =>
          clampLyricsFontSize(typeof v === "number" ? v : DEFAULT_LYRICS_FONT_SIZE)
        )
      );
      setSegmentLyricsColor(
        (pad(state.segmentLyricsColor, "#ffffff") as unknown[]).map((v) => normalizeLyricsColorHex(v))
      );
      setSegmentScreenFilters(
        (pad(state.segmentScreenFilters, "normal") as unknown[]).map((v) => parseSegmentScreenFilter(v))
      );
      setSegmentImageSelections(restoredImageSelections);
      const restoredFlowTimeSec =
        typeof state.flowTimeSec === "number" && Number.isFinite(state.flowTimeSec)
          ? Math.max(0, state.flowTimeSec)
          : 0;
      setFlowTimeSec(restoredFlowTimeSec);
      flowTimeSecRef.current = restoredFlowTimeSec;
      setNameMaskPreset(normalizeImportedNameMaskPreset(state.nameMaskPreset, n));
    },
    retryPixabayImageAfterLoadFailure,
  }));

  function moveLyric(index: number, dir: 1 | -1) {
    const next = index + dir;
    if (next < 0 || next >= phraseQueue.length) return;
    setPhraseQueue((prev) => {
      const arr = [...prev];
      [arr[index], arr[next]] = [arr[next]!, arr[index]!];
      return arr;
    });
  }

  function splitLyric(index: number) {
    const raw = window.prompt(
      "分割する位置（文字数）を入力:",
      String(Math.floor(phraseQueue[index]?.text.length / 2) || 0)
    );
    const n = raw ? parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n) || n <= 0) return;
    const s = phraseQueue[index]?.text ?? "";
    if (n >= s.length) return;
    setPhraseQueue((prev) => {
      const arr = [...prev];
      const cur = arr[index]!;
      arr[index] = { ...cur, text: s.slice(0, n) };
      arr.splice(index + 1, 0, { id: newPhraseQueueId(), text: s.slice(n) });
      return arr;
    });
  }

  function joinLyric(index: number) {
    if (index + 1 >= phraseQueue.length) return;
    const removedId = phraseQueue[index + 1]!.id;
    const keepId = phraseQueue[index]!.id;
    setPhraseQueue((prev) => {
      const arr = [...prev];
      const a = arr[index]!;
      const b = arr[index + 1]!;
      arr[index] = { id: a.id, text: a.text + b.text };
      arr.splice(index + 1, 1);
      return arr;
    });
    setEditingPhraseId((cur) => (cur === removedId ? keepId : cur));
  }

  function setSegmentText(segIndex: number, text: string) {
    setSegmentTexts((prev) => {
      const arr = [...prev];
      arr[segIndex] = text;
      return arr;
    });
  }

  /** フレーズキュー行クリックで、左の歌詞入力欄の末尾へ追記（既存は消さない。クリップボードは使わない） */
  function applyPhraseToLyricInput(phraseText: string) {
    const piece = String(phraseText ?? "").trim();
    if (!piece) return;
    const targetRow = (() => {
      if (previewRowIndex != null) return previewRowIndex;
      if (editingPhraseId == null) return null;
      const pi = phraseQueue.findIndex((p) => p.id === editingPhraseId);
      return pi >= 0 ? pi : null;
    })();
    if (targetRow == null || targetRow < 0 || targetRow >= timelineSegments.length) return;
    let nextValue = "";
    setSegmentTexts((prev) => {
      const arr = [...prev];
      const current = (arr[targetRow] ?? "").trimEnd();
      nextValue = current ? `${current}\n${piece}` : piece;
      arr[targetRow] = nextValue;
      return arr;
    });
    const targetPid = phraseQueueRef.current[targetRow]?.id;
    if (targetPid != null && targetPid === editingPhraseIdRef.current) {
      setLocalSegmentText(nextValue);
    }
  }

  /** 指定枠の末尾にテキストを追記（既に内容があれば改行して追加） */
  function appendSegmentText(segIndex: number, text: string) {
    if (!text.trim()) return;
    setSegmentTexts((prev) => {
      const arr = [...prev];
      const current = (arr[segIndex] ?? "").trimEnd();
      arr[segIndex] = current ? `${current}\n${text.trim()}` : text.trim();
      return arr;
    });
  }

  /** ドロップ時: この枠の末尾に追記し、カーソルを次の歌詞へ、次の声区間へスクロール */
  function handleLyricDrop(segIndex: number, text: string, _draggedLyricIndex: number) {
    appendSegmentText(segIndex, text);
    const nextVoice = (() => {
      for (let j = segIndex + 1; j < timelineSegments.length; j++) {
        if (timelineSegments[j]?.type === "voice") return j;
      }
      return null;
    })();
    if (nextVoice != null) {
      const pid = phraseQueue[nextVoice]?.id;
      if (pid != null) assignEditingPhraseId(pid);
      setTimeout(() => {
        segmentRowRefs.current.get(nextVoice)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 0);
    }
  }

  /** 現在フォーカス中（または選択中）の歌詞欄にフレーズテキストを挿入する */
  function insertPhraseAtFocus(phraseText: string) {
    const text = (phraseText ?? "").toString();
    if (!text) return;
    let targetRow = focusTarget?.rowIndex;
    if (targetRow == null || targetRow < 0 || targetRow >= timelineSegments.length) {
      const pi = phraseQueue.findIndex((p) => p.id === editingPhraseId);
      targetRow = pi >= 0 ? pi : -1;
    }
    if (targetRow == null || targetRow < 0 || targetRow >= timelineSegments.length) return;
    const seg = timelineSegments[targetRow];
    if (!seg || (seg.type !== "voice" && seg.type !== "interlude")) return;

    const textarea = segmentLyricsRefs.current.get(targetRow) ?? null;
    const currentValue = segmentTexts[targetRow] ?? "";
    let nextValue = currentValue;
    let newCursorPos = currentValue.length;

    if (textarea && typeof textarea.selectionStart === "number" && typeof textarea.selectionEnd === "number") {
      const startPos = textarea.selectionStart;
      const endPos = textarea.selectionEnd;
      nextValue =
        currentValue.slice(0, startPos) + text + currentValue.slice(endPos);
      newCursorPos = startPos + text.length;
    } else {
      // フォーカス情報がなければ末尾に追記（改行区切り）
      const trimmed = currentValue.trimEnd();
      nextValue = trimmed ? `${trimmed}\n${text}` : text;
      newCursorPos = nextValue.length;
    }

    setSegmentTexts((prev) => {
      const arr = [...prev];
      arr[targetRow!] = nextValue;
      return arr;
    });

    const rowPid = phraseQueue[targetRow]?.id;
    if (rowPid != null) {
      setPhraseQueue((prev) =>
        prev.map((p) => (p.id === rowPid ? { ...p, text: nextValue } : p))
      );
    }
    if (editingPhraseId === rowPid) {
      setLocalSegmentText(nextValue);
    }

    if (textarea) {
      requestAnimationFrame(() => {
        textarea.focus();
        try {
          textarea.setSelectionRange(newCursorPos, newCursorPos);
        } catch {
          /* ignore */
        }
      });
    }
  }

  function setSegmentImage(
    segIndex: number,
    file: File | null | string,
    sourceKind?: "suggested" | "uploaded",
    selectionContext?: {
      lyricText?: string;
      searchKeywords?: string;
      searchTags?: string[];
      pixabayImageId?: number;
      apiRank?: number;
      boostScore?: number;
      boostReason?: string;
      pageUrl?: string;
      imageUrl?: string;
      previewUrl?: string;
      selectedAt?: string;
    }
  ) {
    const preparedImageUrl =
      file != null && typeof file !== "string" ? URL.createObjectURL(file) : undefined;
    if (file !== null) {
      setSegmentVideoUrls((pv) => {
        const old = pv[segIndex];
        if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
        const next = [...pv];
        while (next.length <= segIndex) next.push(undefined);
        next[segIndex] = undefined;
        return next;
      });
      setSegmentMediaTypes((pm) => {
        const next = [...pm];
        while (next.length <= segIndex) next.push("none");
        next[segIndex] = "image";
        return next;
      });
    }
    setSegmentImageUrls((prev) => {
      const old = prev[segIndex];
      if (old && old.startsWith("blob:")) URL.revokeObjectURL(old);
      const arr = [...prev];
      while (arr.length <= segIndex) arr.push(undefined);
      arr[segIndex] =
        file === null
          ? undefined
          : typeof file === "string"
            ? file
            : preparedImageUrl;
      return arr;
    });
    setSegmentImageSourceKinds((prev) => {
      const arr = [...prev];
      while (arr.length <= segIndex) arr.push(null);
      if (file === null) {
        arr[segIndex] = null;
      } else if (typeof file === "string") {
        arr[segIndex] =
          sourceKind ?? (file.startsWith("blob:") ? "uploaded" : "suggested");
      } else {
        arr[segIndex] = "uploaded";
      }
      return arr;
    });
    if (file === null) {
      setSegmentMediaTypes((prev) => {
        const arr = [...prev];
        while (arr.length <= segIndex) arr.push("none");
        const stillVideo = Boolean(segmentVideoUrlsRef.current[segIndex]);
        arr[segIndex] = stillVideo ? "video" : "none";
        return arr;
      });
      setSegmentImageSelections((prev) => {
        const arr = [...prev];
        while (arr.length <= segIndex) arr.push(null);
        arr[segIndex] = null;
        return arr;
      });
    }
    if (file !== null) {
      const imageSource: "suggested" | "uploaded" =
        sourceKind ??
        (typeof file === "string" ? (file.startsWith("blob:") ? "uploaded" : "suggested") : "uploaded");
      const imageUrl =
        (selectionContext?.imageUrl ?? (typeof file === "string" ? file : preparedImageUrl ?? "")).trim();
      const lyricText = (selectionContext?.lyricText ?? segmentTexts[segIndex] ?? "").trim();
      const searchKeywords = (
        selectionContext?.searchKeywords ??
        segmentSearchTerms[segIndex] ??
        committedImageSearchQuery
      ).trim();
      const searchTags = Array.isArray(selectionContext?.searchTags)
        ? selectionContext.searchTags.filter((t) => typeof t === "string" && t.trim() !== "")
        : undefined;
      const pageUrl = selectionContext?.pageUrl?.trim() || undefined;
      const pixabayImageId =
        typeof selectionContext?.pixabayImageId === "number" &&
        Number.isFinite(selectionContext.pixabayImageId)
          ? selectionContext.pixabayImageId
          : undefined;
      const apiRank =
        typeof selectionContext?.apiRank === "number" &&
        Number.isFinite(selectionContext.apiRank)
          ? selectionContext.apiRank
          : undefined;
      const boostScore =
        typeof selectionContext?.boostScore === "number" &&
        Number.isFinite(selectionContext.boostScore)
          ? selectionContext.boostScore
          : undefined;
      const boostReason =
        typeof selectionContext?.boostReason === "string" &&
        selectionContext.boostReason.trim() !== ""
          ? selectionContext.boostReason
          : undefined;
      const selectedAt = selectionContext?.selectedAt || new Date().toISOString();
      const previewUrlFromCtx = (selectionContext?.previewUrl ?? "").trim();
      const previewUrl =
        previewUrlFromCtx !== "" ? previewUrlFromCtx : imageUrl !== "" ? imageUrl : undefined;
      setSegmentImageSelections((prev) => {
        const arr = [...prev];
        while (arr.length <= segIndex) arr.push(null);
        arr[segIndex] = {
          lyricText,
          searchKeywords,
          searchTags,
          imageSource,
          pixabayImageId,
          imageUrl,
          previewUrl,
          apiRank,
          boostScore,
          boostReason,
          pageUrl,
          selectedAt,
          localImageNeedsReselect: false,
        };
        return arr;
      });
      if (typeof file === "string") {
        const key = normalizeLyricsForHistoryKey(segmentTexts[segIndex] ?? "");
        if (key) {
          rememberLyricsImageSelection(key, file, imageSource, {
            previewUrl: previewUrl ?? file,
            pageUrl,
            pixabayImageId,
          });
        }
      }
    }
  }

  /** 自分の動画を区間に設定（画像とは排他。blob は内部管理） */
  function setSegmentVideo(segIndex: number, file: File | null | string) {
    if (file !== null) {
      setSegmentImageUrls((pi) => {
        const old = pi[segIndex];
        if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
        const next = [...pi];
        while (next.length <= segIndex) next.push(undefined);
        next[segIndex] = undefined;
        return next;
      });
      setSegmentImageSourceKinds((pk) => {
        const next = [...pk];
        while (next.length <= segIndex) next.push(null);
        next[segIndex] = null;
        return next;
      });
      setSegmentImageSelections((prev) => {
        const next = [...prev];
        while (next.length <= segIndex) next.push(null);
        next[segIndex] = null;
        return next;
      });
    }
    setSegmentVideoUrls((prev) => {
      const old = prev[segIndex];
      if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
      const arr = [...prev];
      while (arr.length <= segIndex) arr.push(undefined);
      arr[segIndex] =
        file === null
          ? undefined
          : typeof file === "string"
            ? file
            : URL.createObjectURL(file);
      return arr;
    });
    if (file === null) {
      setSegmentMediaTypes((prev) => {
        const arr = [...prev];
        while (arr.length <= segIndex) arr.push("none");
        const stillImg = Boolean(segmentImageUrlsRef.current[segIndex]);
        arr[segIndex] = stillImg ? "image" : "none";
        return arr;
      });
    } else {
      setSegmentMediaTypes((prev) => {
        const arr = [...prev];
        while (arr.length <= segIndex) arr.push("none");
        arr[segIndex] = "video";
        return arr;
      });
      setSegmentVideoStartSec((prev) => {
        const arr = [...prev];
        while (arr.length <= segIndex) arr.push(0);
        arr[segIndex] = 0;
        return arr;
      });
      setSegmentVideoEndSec((prev) => {
        const arr = [...prev];
        while (arr.length <= segIndex) arr.push(undefined);
        arr[segIndex] = undefined;
        return arr;
      });
      setSegmentVideoMuted((prev) => {
        const arr = [...prev];
        while (arr.length <= segIndex) arr.push(false);
        arr[segIndex] = false;
        return arr;
      });
      setSegmentMediaObjectFit((prev) => {
        const arr = [...prev];
        while (arr.length <= segIndex) arr.push("cover");
        arr[segIndex] = "cover";
        return arr;
      });
    }
  }

  /** 画像・動画の両方を外す（blob 解放込み） */
  function clearSegmentVisualMedia(segIndex: number) {
    setSegmentImageUrls((prev) => {
      const old = prev[segIndex];
      if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
      const arr = [...prev];
      while (arr.length <= segIndex) arr.push(undefined);
      arr[segIndex] = undefined;
      return arr;
    });
    setSegmentVideoUrls((prev) => {
      const old = prev[segIndex];
      if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
      const arr = [...prev];
      while (arr.length <= segIndex) arr.push(undefined);
      arr[segIndex] = undefined;
      return arr;
    });
    setSegmentImageSourceKinds((prev) => {
      const arr = [...prev];
      while (arr.length <= segIndex) arr.push(null);
      arr[segIndex] = null;
      return arr;
    });
    setSegmentImageSelections((prev) => {
      const arr = [...prev];
      while (arr.length <= segIndex) arr.push(null);
      arr[segIndex] = null;
      return arr;
    });
    setSegmentMediaTypes((prev) => {
      const arr = [...prev];
      while (arr.length <= segIndex) arr.push("none");
      arr[segIndex] = "none";
      return arr;
    });
  }

  function clearModalUploadPick() {
    setModalUploadPick((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }

  function clearModalVideoPick() {
    setModalVideoUploadError(null);
    setModalVideoPick((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }

  /** モーダル候補グリッド用: 現在の区間画像と同一候補か */
  function isModalSuggestImageSelected(
    cur: string | undefined,
    img: SearchImageResult
  ): boolean {
    if (!cur) return false;
    const full = img.imageUrl || img.previewUrl;
    const thumb = img.previewUrl || img.imageUrl;
    return cur === full || cur === thumb;
  }

  function setSegmentAnim(segIndex: number, anim: string) {
    setSegmentAnims((prev) => {
      const arr = [...prev];
      arr[segIndex] = anim;
      return arr;
    });
  }

  function setSegmentOverlayImage(segIndex: number, file: File | null | string) {
    setSegmentOverlayImageUrls((prev) => {
      const old = prev[segIndex];
      if (old?.startsWith("blob:")) URL.revokeObjectURL(old);
      const arr = [...prev];
      while (arr.length <= segIndex) arr.push(undefined);
      arr[segIndex] =
        file == null
          ? undefined
          : typeof file === "string"
            ? file
            : URL.createObjectURL(file);
      return arr;
    });
  }

  const offerLocalUploadHintThen = useCallback((apply: () => void) => {
    if (typeof window === "undefined" || !isNarrowViewportForLocalUploadHint()) {
      apply();
      return;
    }
    try {
      if (localStorage.getItem(LOCAL_UPLOAD_AUTOSAVE_HINT_LS_KEY) === "1") {
        apply();
        return;
      }
    } catch {
      apply();
      return;
    }
    localUploadApplyRef.current = apply;
    setLocalUploadHintOpen(true);
  }, []);

  const cancelLocalUploadHint = useCallback(() => {
    localUploadApplyRef.current = null;
    setLocalUploadHintOpen(false);
  }, []);

  const runLocalUploadHintApply = useCallback((options: { suppressForever: boolean }) => {
    if (options.suppressForever) {
      try {
        localStorage.setItem(LOCAL_UPLOAD_AUTOSAVE_HINT_LS_KEY, "1");
      } catch {
        /* ignore */
      }
    }
    const fn = localUploadApplyRef.current;
    localUploadApplyRef.current = null;
    setLocalUploadHintOpen(false);
    fn?.();
  }, []);

  function beginSegmentDrag(
    segIndex: number,
    kind: "overlay" | "text",
    clientX: number,
    clientY: number
  ) {
    const startX = kind === "overlay" ? (segmentOverlayX[segIndex] ?? 0) : (segmentTextX[segIndex] ?? 0);
    const startY = kind === "overlay" ? (segmentOverlayY[segIndex] ?? 0) : (segmentTextY[segIndex] ?? 0);
    dragStateRef.current = {
      segIndex,
      kind,
      startClientX: clientX,
      startClientY: clientY,
      startX,
      startY,
    };
  }

  function beginMosaicPointerDown(
    ev: React.MouseEvent | React.TouchEvent,
    segIndex: number,
    regionId: string,
    mosaicKind: "mosaicMove" | "mosaicResizeBr"
  ) {
    ev.preventDefault();
    ev.stopPropagation();
    const cx =
      "touches" in ev && ev.touches[0] ? ev.touches[0]!.clientX : (ev as React.MouseEvent).clientX;
    const cy =
      "touches" in ev && ev.touches[0] ? ev.touches[0]!.clientY : (ev as React.MouseEvent).clientY;
    const target = ev.currentTarget as HTMLElement;
    const stage = target.closest("[data-segment-preview-root]");
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const regions = segmentMosaicRegions[segIndex] ?? [];
    const r = regions.find((x) => x.id === regionId);
    if (!r) return;
    dragStateRef.current = {
      segIndex,
      kind: mosaicKind,
      regionId,
      startClientX: cx,
      startClientY: cy,
      startRect: { xPct: r.xPct, yPct: r.yPct, wPct: r.wPct, hPct: r.hPct },
      stageW: Math.max(1, rect.width),
      stageH: Math.max(1, rect.height),
    };
  }

  function beginBrandMaskPointerDown(
    ev: React.MouseEvent | React.TouchEvent,
    segIndex: number,
    regionId: string,
    kind: "brandMove" | "brandResizeBr"
  ) {
    ev.preventDefault();
    ev.stopPropagation();
    const cx =
      "touches" in ev && ev.touches[0] ? ev.touches[0]!.clientX : (ev as React.MouseEvent).clientX;
    const cy =
      "touches" in ev && ev.touches[0] ? ev.touches[0]!.clientY : (ev as React.MouseEvent).clientY;
    const target = ev.currentTarget as HTMLElement;
    const stage = target.closest("[data-segment-preview-root]");
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    const regions = segmentBrandMaskRegions[segIndex] ?? [];
    const r = regions.find((x) => x.id === regionId);
    if (!r) return;
    dragStateRef.current = {
      segIndex,
      kind,
      regionId,
      startClientX: cx,
      startClientY: cy,
      startRect: { xPct: r.xPct, yPct: r.yPct, wPct: r.wPct, hPct: r.hPct },
      stageW: Math.max(1, rect.width),
      stageH: Math.max(1, rect.height),
    };
  }

  function previewRetroHeiseiLinesOverlay() {
    return (
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 4,
          pointerEvents: "none",
          opacity: 0.38,
          mixBlendMode: "multiply",
          backgroundImage:
            "repeating-linear-gradient(180deg, rgba(0,0,0,0.15) 0px, rgba(0,0,0,0.15) 1px, transparent 1px, transparent 2px)",
        }}
      />
    );
  }

  function wrapPreviewFilteredMedia(
    segIndex: number,
    animClassName: string,
    contentKey: string,
    children: ReactNode
  ) {
    const filter = segmentScreenFilters[segIndex] ?? "normal";
    const css = segmentScreenFilterCss(filter);
    return (
      <div key={contentKey} className={animClassName} style={{ width: "100%", height: "100%", position: "relative" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            filter: css,
          }}
        >
          {children}
        </div>
        {filter === "retroHeisei" ? previewRetroHeiseiLinesOverlay() : null}
      </div>
    );
  }

  function renderCompositeOverlay(segIndex: number) {
    const enabled = segmentCompositeEnabled[segIndex] ?? false;
    if (!enabled) return null;
    const mode = segmentCompositeModes[segIndex] ?? "none";
    if (mode === "none") return null;
    if (mode === "mosaic") {
      const regions = segmentMosaicRegions[segIndex] ?? [];
      if (regions.length === 0) return null;
      const sel = segmentMosaicSelectedId[segIndex] ?? null;
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 3,
            pointerEvents: "auto",
            touchAction: "none",
          }}
        >
          {regions.map((r) => {
            const isSel = r.id === sel;
            return (
              <div
                key={r.id}
                role="presentation"
                style={{
                  position: "absolute",
                  left: `${r.xPct}%`,
                  top: `${r.yPct}%`,
                  width: `${r.wPct}%`,
                  height: `${r.hPct}%`,
                  boxSizing: "border-box",
                  border: isSel ? "2px solid #38bdf8" : "1px solid rgba(255,255,255,0.45)",
                  borderRadius: 4,
                  overflow: "hidden",
                  touchAction: "none",
                }}
                onMouseDown={(e) => beginMosaicPointerDown(e, segIndex, r.id, "mosaicMove")}
                onTouchStart={(e) => beginMosaicPointerDown(e, segIndex, r.id, "mosaicMove")}
              >
                <MosaicInteractiveRegion
                  region={r}
                  onResizeDown={(e) => beginMosaicPointerDown(e, segIndex, r.id, "mosaicResizeBr")}
                />
              </div>
            );
          })}
        </div>
      );
    }
    if (mode === "blackMaskWithBrand") {
      const regions = segmentBrandMaskRegions[segIndex] ?? [];
      if (regions.length === 0) return null;
      const sel = segmentBrandMaskSelectedId[segIndex] ?? null;
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 3,
            pointerEvents: "auto",
            touchAction: "none",
          }}
        >
          {regions.map((r) => {
            const isSel = r.id === sel;
            const alpha = 0.85 * Math.max(0, Math.min(1, r.opacity));
            return (
              <div
                key={r.id}
                role="presentation"
                style={{
                  position: "absolute",
                  left: `${r.xPct}%`,
                  top: `${r.yPct}%`,
                  width: `${r.wPct}%`,
                  height: `${r.hPct}%`,
                  boxSizing: "border-box",
                  border: isSel ? "2px solid #38bdf8" : "1px solid rgba(255,255,255,0.35)",
                  borderRadius: 4,
                  touchAction: "none",
                  background: `rgba(0,0,0,${alpha})`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
                onMouseDown={(e) => beginBrandMaskPointerDown(e, segIndex, r.id, "brandMove")}
                onTouchStart={(e) => beginBrandMaskPointerDown(e, segIndex, r.id, "brandMove")}
              >
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: "clamp(11px, 2.4vw, 16px)",
                    color: "rgba(255,255,255,0.9)",
                    textAlign: "center",
                    padding: "0 4px",
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {PRIVACY_BRAND_LABEL}
                </span>
                <div
                  role="presentation"
                  style={{
                    position: "absolute",
                    right: 2,
                    bottom: 2,
                    width: 14,
                    height: 14,
                    borderRadius: 3,
                    background: "rgba(255,255,255,0.85)",
                    border: "1px solid rgba(0,0,0,0.25)",
                    cursor: "nwse-resize",
                    zIndex: 2,
                    touchAction: "none",
                  }}
                  onMouseDown={(e) => beginBrandMaskPointerDown(e, segIndex, r.id, "brandResizeBr")}
                  onTouchStart={(e) => beginBrandMaskPointerDown(e, segIndex, r.id, "brandResizeBr")}
                />
              </div>
            );
          })}
        </div>
      );
    }
    return null;
  }

  function nameMaskAppliesToSegmentForPreview(segIndex: number): boolean {
    const p = nameMaskPreset;
    if (!p.enabled) return false;
    if (p.applyScope === "all") return true;
    const maxIdx = Math.max(0, timelineSegments.length - 1);
    const target = Math.min(Math.max(0, p.applySegmentIndex), maxIdx);
    return segIndex === target;
  }

  function renderNameAutoMaskLayer(segIndex: number) {
    if (!nameMaskAppliesToSegmentForPreview(segIndex)) return null;
    const p = nameMaskPreset;
    const a = p.nameArea;
    if (p.defaultMode === "mosaic") {
      const syn: SegmentMosaicRegion = {
        id: "__nameAutoPreview",
        xPct: a.xPct,
        yPct: a.yPct,
        wPct: a.wPct,
        hPct: a.hPct,
        pixelSize: p.mosaicPixelSize,
        opacity: p.mosaicOpacity,
      };
      return (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 5,
            pointerEvents: "none",
            touchAction: "none",
          }}
          aria-hidden
        >
          <div
            style={{
              position: "absolute",
              left: `${a.xPct}%`,
              top: `${a.yPct}%`,
              width: `${a.wPct}%`,
              height: `${a.hPct}%`,
              boxSizing: "border-box",
              border: "1px dashed rgba(251,191,36,0.75)",
              borderRadius: 4,
              overflow: "hidden",
            }}
          >
            <MosaicInteractiveRegion region={syn} onResizeDown={() => {}} showResizeHandle={false} />
          </div>
        </div>
      );
    }
    const alpha = 0.85 * Math.max(0, Math.min(1, p.brandOpacity));
    return (
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 5,
          pointerEvents: "none",
          touchAction: "none",
        }}
        aria-hidden
      >
        <div
          style={{
            position: "absolute",
            left: `${a.xPct}%`,
            top: `${a.yPct}%`,
            width: `${a.wPct}%`,
            height: `${a.hPct}%`,
            boxSizing: "border-box",
            border: "1px dashed rgba(251,191,36,0.75)",
            borderRadius: 4,
            background: `rgba(0,0,0,${alpha})`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              fontWeight: 700,
              fontSize: "clamp(11px, 2.4vw, 16px)",
              color: "rgba(255,255,255,0.9)",
              textAlign: "center",
              padding: "0 4px",
              userSelect: "none",
            }}
          >
            {PRIVACY_BRAND_LABEL}
          </span>
        </div>
      </div>
    );
  }

  // ----- 区間行まわり: start/end の更新、区間編集を開く -----
  /** タイムライン行インデックス → 声区間リスト内のインデックス（voice 行のみ） */
  function getVoiceIndexFromTimelineRow(segIndex: number): number {
    const voiceCount = timelineSegments
      .slice(0, segIndex)
      .filter((s) => s.type === "voice").length;
    return voiceCount;
  }

  function getInterludeIndexFromTimelineRow(segIndex: number): number {
    return timelineSegments.slice(0, segIndex).filter((s) => s.type === "interlude").length;
  }

  /**
   * 無音行を削除 = タイムライン上のギャップを潰す（手動データは voice / interlude のみ）。
   * Brand 直前の無音は直前区間の終了を Brand 手前まで延長する。
   */
  function collapseSilenceTimelineRow(segIndex: number): boolean {
    const silence = timelineSegments[segIndex];
    if (!silence || silence.type !== "silence" || silence.isBranding) return false;
    const prev = segIndex > 0 ? timelineSegments[segIndex - 1]! : null;
    const next = segIndex + 1 < timelineSegments.length ? timelineSegments[segIndex + 1]! : null;
    const sEnd = silence.endSec;

    if (next?.isBranding) {
      if (!prev || prev.isBranding || prev.type === "silence") return false;
      if (prev.type === "voice") {
        const vi = getVoiceIndexFromTimelineRow(segIndex - 1);
        setManualVoiceSegments((prevSegs) => {
          const arr = [...prevSegs];
          const v = arr[vi];
          if (!v) return prevSegs;
          arr[vi] = { startSec: v.startSec, endSec: sEnd };
          return arr;
        });
        return true;
      }
      if (prev.type === "interlude") {
        const ii = getInterludeIndexFromTimelineRow(segIndex - 1);
        setManualInterludes((prevArr) => {
          const arr = [...prevArr];
          const v = arr[ii];
          if (!v) return prevArr;
          arr[ii] = { startSec: v.startSec, endSec: sEnd };
          return arr;
        });
        return true;
      }
      return false;
    }

    if (!prev && next && !next.isBranding && next.type !== "silence") {
      const sStart = silence.startSec;
      if (next.type === "voice") {
        const vi = getVoiceIndexFromTimelineRow(segIndex + 1);
        setManualVoiceSegments((prevSegs) => {
          const arr = [...prevSegs];
          const v = arr[vi];
          if (!v) return prevSegs;
          arr[vi] = { startSec: sStart, endSec: v.endSec };
          return arr;
        });
        return true;
      }
      if (next.type === "interlude") {
        const ii = getInterludeIndexFromTimelineRow(segIndex + 1);
        setManualInterludes((prevArr) => {
          const arr = [...prevArr];
          const v = arr[ii];
          if (!v) return prevArr;
          arr[ii] = { startSec: sStart, endSec: v.endSec };
          return arr;
        });
        return true;
      }
      return false;
    }

    if (prev && next && !next.isBranding && next.type !== "silence") {
      const join = prev.endSec;
      const dur = Math.max(0.001, next.endSec - next.startSec);
      if (next.type === "voice") {
        const vi = getVoiceIndexFromTimelineRow(segIndex + 1);
        setManualVoiceSegments((prevSegs) => {
          const arr = [...prevSegs];
          const v = arr[vi];
          if (!v) return prevSegs;
          arr[vi] = { startSec: join, endSec: join + dur };
          return arr;
        });
        return true;
      }
      if (next.type === "interlude") {
        const ii = getInterludeIndexFromTimelineRow(segIndex + 1);
        setManualInterludes((prevArr) => {
          const arr = [...prevArr];
          const v = arr[ii];
          if (!v) return prevArr;
          arr[ii] = { startSec: join, endSec: join + dur };
          return arr;
        });
        return true;
      }
    }

    return false;
  }

  /** 選択中セグメントの開始秒を指定値に設定（手動・「開始秒に設定」ボタン用）。タイムラインは manualVoiceSegments から再計算される。 */
  function setSegmentStartToSec(segIndex: number, t: number) {
    const seg = timelineSegments[segIndex];
    if (seg?.type !== "voice") return;
    const voiceIdx = getVoiceIndexFromTimelineRow(segIndex);
    const maxSec = videoDuration != null && Number.isFinite(videoDuration) ? videoDuration : Infinity;
    const startSec = Math.max(0, Math.min(t, maxSec));
    setManualVoiceSegments((prev) => {
      const next = prev.map((v) => ({ ...v }));
      const v = next[voiceIdx];
      if (!v) return prev;
      let endSec = v.endSec;
      if (startSec >= endSec) endSec = Math.min(startSec + 0.001, maxSec);
      next[voiceIdx] = { startSec, endSec };
      return next;
    });
  }

  /** 選択中セグメントの終了秒を指定値に設定し、下の声区間を 5 秒刻みで連鎖更新（手動・「終了秒に設定」ボタン用）。 */
  function setSegmentEndToSec(segIndex: number, t: number) {
    const seg = timelineSegments[segIndex];
    if (seg?.type !== "voice") return;
    const voiceIdx = getVoiceIndexFromTimelineRow(segIndex);
    const maxSec = videoDuration != null && Number.isFinite(videoDuration) ? videoDuration : Infinity;
    const slotSec = getPresetParams(songStyle, displayTempo).secondsPerScreen;
    const endSec = Math.max(0, Math.min(t, maxSec));
    setManualVoiceSegments((prev) => {
      const next = prev.map((v) => ({ ...v }));
      const v = next[voiceIdx];
      if (!v) return prev;
      let startSec = v.startSec;
      if (endSec <= startSec) return prev;
      next[voiceIdx] = { startSec, endSec };
      for (let k = voiceIdx + 1; k < next.length; k++) {
        const prevEnd = next[k - 1]!.endSec;
        const endCap = Math.min(prevEnd + slotSec, maxSec);
        if (endCap <= prevEnd) break;
        next[k] = { startSec: prevEnd, endSec: endCap };
      }
      return next;
    });
  }

  const TIME_ADJUST_DELTA = 0.5;
  const maxTimelineSec = videoDuration != null && Number.isFinite(videoDuration) ? videoDuration : Infinity;

  /**
   * 指定行の start/end を変更し、その行以降を「上の end = 次の start」で連動させる。
   * 各行の長さ（duration = end - start）は維持する。
   * 変更後、manualVoiceSegments と manualInterludes に反映してタイムライン本体に即反映。
   */
  function applyCascadedSegmentTimes(timelineIndex: number, newStartSec: number, newEndSec: number) {
    const seg = timelineSegments[timelineIndex];
    if (!seg || (seg.type !== "voice" && seg.type !== "interlude")) return;
    let s = Math.max(0, Math.min(newStartSec, maxTimelineSec));
    let e = Math.max(0, Math.min(newEndSec, maxTimelineSec));
    if (s >= e) e = Math.min(s + 0.001, maxTimelineSec);
    if (s >= e) return;

    const cascaded: TimelineSegment[] = timelineSegments.map((t) => ({ ...t }));
    cascaded[timelineIndex] = { ...seg, startSec: s, endSec: e };
    for (let i = timelineIndex + 1; i < cascaded.length; i++) {
      const prev = cascaded[i - 1]!;
      const orig = timelineSegments[i]!;
      const duration = Math.max(0.001, orig.endSec - orig.startSec);
      const newStart = prev.endSec;
      const newEnd = Math.min(newStart + duration, maxTimelineSec);
      cascaded[i] = { ...orig, startSec: newStart, endSec: Math.max(newEnd, newStart + 0.001) };
    }

    const newVoice = cascaded.filter((x) => x.type === "voice").map((x) => ({ startSec: x.startSec, endSec: x.endSec }));
    const newInterludes = cascaded.filter((x) => x.type === "interlude").map((x) => ({ startSec: x.startSec, endSec: x.endSec }));
    setManualVoiceSegments(newVoice);
    setManualInterludes(newInterludes);

    const eid = editingPhraseIdRef.current;
    const editedSeg = cascaded[timelineIndex];
    if (
      eid != null &&
      editedSeg &&
      (editedSeg.type === "voice" || editedSeg.type === "interlude")
    ) {
      setPhraseQueue((prev) => {
        const idx = prev.findIndex((p) => p.id === eid);
        if (idx < 0) return prev;
        const p = prev[idx]!;
        if (p.startSec === editedSeg.startSec && p.endSec === editedSeg.endSec) return prev;
        const next = [...prev];
        next[idx] = { ...p, startSec: editedSeg.startSec, endSec: editedSeg.endSec };
        return next;
      });
    }
  }

  /**
   * タイムライン行の start/end を手入力で更新（voice / interlude のみ）。
   * 同じ連動ルールでその行以降を更新する。
   */
  function applySegmentTimeEdit(timelineIndex: number, startSec: number, endSec: number) {
    applyCascadedSegmentTimes(timelineIndex, startSec, endSec);
    setEditingTimeRowIndex(null);
  }

  /** 内部クリップボードへ保存のみ（再生・プレビュー・シーク・scroll とは無関係） */
  function copyPhraseAtIndexToClipboard(pi: number) {
    const pq = phraseQueueRef.current;
    const ts = timelineSegmentsRef.current;
    const texts = segmentTextsForHistoryRef.current;
    if (pi < 0 || pi >= pq.length) return;
    const seg = ts[pi];
    const pb = pickPhraseSegmentTimes(pq[pi]);
    const img = (segmentImageUrlsRef.current[pi] ?? "").trim();
    const vid = (segmentVideoUrlsRef.current[pi] ?? "").trim();
    const mt = segmentMediaTypesRef.current[pi] ?? "none";
    const lineText = canonicalPhraseLineText(pq[pi]?.text ?? "", texts[pi] ?? "");
    const payload: PhraseClipboardV1 = {
      v: 1,
      text: lineText,
      startSec: pb?.startSec ?? seg?.startSec ?? 0,
      endSec: pb?.endSec ?? seg?.endSec ?? 0,
      canApplyTiming: Boolean(seg && (seg.type === "voice" || seg.type === "interlude")),
      mediaType: mt === "video" || mt === "image" ? mt : "none",
      anim: segmentAnimsRef.current[pi] ?? "none",
      displayMode: segmentDisplayModesRef.current[pi] ?? 1,
      lineBreakAt: segmentLineBreakAtRef.current[pi] ?? 0,
      imageUrl: mt === "image" && isPortableRemoteMediaUrl(img) ? img : undefined,
      videoUrl: mt === "video" && isPortableRemoteMediaUrl(vid) ? vid : undefined,
    };
    phraseClipboardRef.current = payload;
    setPhraseClipReady(true);
    const oneLine = lineText.replace(/\s+/g, " ").trim();
    setPhraseClipSummary(
      oneLine.length === 0 ? "（空）" : oneLine.length > 36 ? `${oneLine.slice(0, 36)}…` : oneLine
    );
  }

  function handlePhraseClipboardCopy(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (typeof window !== "undefined" && window.localStorage.getItem("debugPhraseCopy") === "1") {
        console.log("[phraseCopy] toolbar click", { id: editingPhraseIdRef.current });
      }
    } catch {
      /* ignore */
    }
    const id = editingPhraseIdRef.current;
    if (id == null) return;
    const pi = phraseQueueRef.current.findIndex((p) => p.id === id);
    if (pi < 0) return;
    copyPhraseAtIndexToClipboard(pi);
  }

  function handlePhraseRowClipboardCopy(phraseId: string, e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (typeof window !== "undefined" && window.localStorage.getItem("debugPhraseCopy") === "1") {
        console.log("[phraseCopy] row button", { phraseId });
      }
    } catch {
      /* ignore */
    }
    const pi = phraseQueueRef.current.findIndex((p) => p.id === phraseId);
    if (pi < 0) return;
    copyPhraseAtIndexToClipboard(pi);
  }

  function handlePhraseClipboardPaste(e: React.MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (typeof window !== "undefined" && window.localStorage.getItem("debugPhraseCopy") === "1") {
        console.log("[phrasePaste] click", { id: editingPhraseIdRef.current });
      }
    } catch {
      /* ignore */
    }
    const payload = phraseClipboardRef.current;
    const id = editingPhraseIdRef.current;
    const pq = phraseQueueRef.current;
    if (payload == null || id == null || pq.length === 0) return;
    const pi = pq.findIndex((p) => p.id === id);
    if (pi < 0) return;
    const text = payload.text ?? "";
    const targetSeg = timelineSegmentsRef.current[pi];

    setPhraseQueue((prev) => {
      const arr = [...prev];
      const idx = arr.findIndex((p) => p.id === id);
      if (idx < 0) return prev;
      arr[idx] = { ...arr[idx]!, text };
      return arr;
    });
    setSegmentTexts((prev) => {
      const arr = [...prev];
      while (arr.length <= pi) arr.push("");
      arr[pi] = text;
      return arr;
    });

    if (
      payload.canApplyTiming &&
      targetSeg &&
      (targetSeg.type === "voice" || targetSeg.type === "interlude") &&
      payload.endSec > payload.startSec
    ) {
      applyCascadedSegmentTimes(pi, payload.startSec, payload.endSec);
    }

    setSegmentAnim(pi, payload.anim);
    setSegmentDisplayModes((prev) => {
      const arr = [...prev];
      while (arr.length <= pi) arr.push(1);
      arr[pi] = payload.displayMode;
      return arr;
    });
    setSegmentLineBreakAt((prev) => {
      const arr = [...prev];
      while (arr.length <= pi) arr.push(0);
      arr[pi] = payload.lineBreakAt;
      return arr;
    });

    if (payload.videoUrl && isPortableRemoteMediaUrl(payload.videoUrl)) {
      setSegmentVideo(pi, payload.videoUrl);
    } else if (payload.imageUrl && isPortableRemoteMediaUrl(payload.imageUrl)) {
      setSegmentImage(pi, payload.imageUrl, "suggested");
    }

    if (editingPhraseIdRef.current === id) {
      setLocalSegmentText(text);
    }

    onPanelStateDirty?.();
  }

  function getSegmentCaptionText(segIndex: number): string {
    const seg = timelineSegments[segIndex];
    if (!seg) return "";
    const raw = (segmentTexts[segIndex] ?? "").trim();
    if (raw) return raw;
    if (seg.isBranding) return BRANDING_TEXT;
    return "";
  }

  function handleDeleteTimelineSegment(segIndex: number) {
    const seg = timelineSegments[segIndex];
    if (!seg) return;
    if (seg.isBranding) return;
    if (seg.type === "voice") {
      const voiceIdx = getVoiceIndexFromTimelineRow(segIndex);
      setManualVoiceSegments((prev) => prev.filter((_, i) => i !== voiceIdx));
    } else if (seg.type === "interlude") {
      const interludeIdx = getInterludeIndexFromTimelineRow(segIndex);
      setManualInterludes((prev) => prev.filter((_, i) => i !== interludeIdx));
    } else if (seg.type === "silence") {
      if (!collapseSilenceTimelineRow(segIndex)) return;
    } else {
      return;
    }
    if (previewRowIndex != null) {
      if (previewRowIndex === segIndex) setPreviewRowIndex(null);
      else if (previewRowIndex > segIndex) setPreviewRowIndex(previewRowIndex - 1);
    }
  }

  function handleAddSegmentAfter(segIndex: number) {
    const seg = timelineSegments[segIndex];
    if (!seg || seg.isBranding) return;
    const startSec = Math.max(0, seg.endSec);
    const nextSeg = timelineSegments[segIndex + 1];
    const capEnd = nextSeg ? nextSeg.startSec : Infinity;
    let endSec = Math.min(startSec + 2, capEnd);
    if (!(endSec > startSec)) endSec = startSec + 0.001;
    setManualVoiceSegments((prev) =>
      [...prev, { startSec, endSec }].sort((a, b) => a.startSec - b.startSec)
    );
  }

  /** 区間行: 「区間編集を開く」ボタン用。既存の区間プレビューモーダルを開く（画像サムネと同じ画面） */
  function handleOpenIntervalEdit(rowIndex: number) {
    handleOpenIntervalPreview(rowIndex);
  }

  /** 区間行: 画像サムネクリック時。区間プレビューモーダルを開く */
  function handleOpenIntervalPreview(rowIndex: number) {
    const pid = phraseQueue[rowIndex]?.id;
    if (pid != null) assignEditingPhraseId(pid);
    setPreviewRowIndex(rowIndex);
    if (phraseQueue.length > 0) {
      setOpenPhraseQueueInModal(rowIndex);
    }
  }

  /** モーダル内で前後のタイムライン行へ（state は既に textarea 等で同期済み） */
  function handlePreviewNavigate(delta: -1 | 1) {
    if (previewRowIndex == null) return;
    const next = previewRowIndex + delta;
    if (next < 0 || next >= timelineSegments.length) return;
    const prevIdx = previewRowIndex;
    const pid = phraseQueue[next]?.id;
    if (pid != null) assignEditingPhraseId(pid);
    setPreviewRowIndex(next);
    setOpenPhraseQueueInModal((o) => (o === prevIdx ? next : o));
  }

  /** 流れプレビュー: 指定タイムライン行へ編集＋流れ表示をまとめて移動（0-based） */
  function jumpFlowPreviewToSegment(targetIdx0: number) {
    const n = timelineSegments.length;
    if (n === 0 || previewRowIndex == null) return;
    const clamped = Math.min(Math.max(0, targetIdx0), n - 1);
    const from = previewRowIndex;
    const pidJump = phraseQueue[clamped]?.id;
    if (pidJump != null) assignEditingPhraseId(pidJump);
    stopFlowPlayback();
    setFlowUseFullTimeline(false);
    const jumpPhrase = phraseQueue[clamped];
    const pb = pickPhraseSegmentTimes(jumpPhrase);
    const t0 = pb?.startSec ?? timelineSegments[clamped]?.startSec ?? 0;
    setFlowTimeSec(t0);
    flowTimeSecRef.current = t0;
    setPreviewRowIndex(clamped);
    setFlowPreviewAnimKey((k) => k + 1);
    prevPreviewRowForFlowRef.current = clamped;
    setOpenPhraseQueueInModal((o) => (o === from ? clamped : o));
  }

  /** 流れプレビュー: 入力欄の行番号（1始まり）へジャンプ */
  function submitFlowJumpFromInput() {
    const raw = flowJumpInputValue.trim();
    if (!raw) return;
    const num = parseInt(raw, 10);
    if (!Number.isFinite(num) || num < 1) return;
    const n = timelineSegments.length;
    if (num > n) return;
    jumpFlowPreviewToSegment(num - 1);
    setFlowJumpInputValue("");
  }

  /** 区間編集モーダル: 再生。startから再生し、endで自動停止（segmentPlayModeで監視） */
  function handleSegmentPlay() {
    const b = effectiveEditingSegmentBounds;
    if (!b) return;
    onSeekToSec?.(b.startSec);
    onPlay?.();
    setSegmentPlayMode("segment");
  }

  /** 区間編集モーダル: 停止。即時 pause、segmentPlayMode 解除 */
  function handleSegmentStop() {
    onPause?.();
    setSegmentPlayMode(null);
  }

  async function handleGenerateProductCandidates() {
    const src = bannerSourceUrl ?? (segmentImageUrls.find(Boolean) ?? null);
    if (!src) {
      console.warn("VoiceSegmentPanel: バナー画像を選択してください");
      return;
    }
    try {
      const img = await loadImage(src);
      const crops: string[] = [];
      for (const type of ["center", "left", "right", "top", "bottom"] as CropType[]) {
        const dataUrl = cropImage(img, type);
        if (dataUrl) crops.push(dataUrl);
      }
      setProductCandidates((prev) => [...prev, ...crops]);
    } catch (e) {
      console.warn("VoiceSegmentPanel: 商品候補生成エラー", e);
    }
  }

  function handleUseCandidate(dataUrl: string) {
    if (timelineSegments.length === 0) return;
    const pqIdx = editingPhraseId ? phraseQueue.findIndex((p) => p.id === editingPhraseId) : -1;
    const idx = pqIdx >= 0 ? pqIdx : 0;
    setSegmentImage(idx, dataUrl, "uploaded");
    const nextPid = phraseQueue[idx + 1]?.id;
    if (nextPid != null) assignEditingPhraseId(nextPid);
  }

  function handleAnalyzeTheme() {
    const { keywords, themeString: nextTheme } = parseLyricsTheme(phraseQueue.map((p) => p.text));
    setThemeKeywords(keywords);
    setThemeString(nextTheme);
    setThemeImageResults([]);
  }

  async function handleSearchThemeImages() {
    const base = searchQuery.trim();
    const fallbackTone = (() => {
      const tone = IMAGE_TONE_OPTIONS.find((t) => t.id === imageTone);
      return tone?.keywords?.[0] ?? "";
    })();
    const fallbackTags = selectedTags.slice(0, 3).join(" ");
    const auto = [fallbackTone, fallbackTags || themeString.trim()].filter(Boolean).join(" ").trim();
    const q = base || auto;
    if (!q) return;
    setThemeSearchLoading(true);
    setThemeImageResults([]);
    setThemeSearchError(null);
    try {
      const res = await fetch(`/api/search-images?q=${encodeURIComponent(q)}`);
      const json = (await res.json()) as { ok?: boolean; message?: string; images?: SearchImageResult[] };
      if (json?.ok && Array.isArray(json.images)) {
        setThemeImageResults(json.images);
      } else {
        setThemeSearchError(json?.message ?? "画像の取得に失敗しました。");
      }
    } catch (e) {
      setThemeSearchError(e instanceof Error ? e.message : "画像検索に失敗しました。");
    } finally {
      setThemeSearchLoading(false);
    }
  }

  /** 歌詞あり区間に画像を自動割当（歌詞＋トーンで検索し1枚ずつ割当） */
  async function handleAutoAssignImages() {
    const voiceRows = timelineSegments
      .map((seg, i) => ({ seg, i }))
      .filter(({ seg }) => seg.type === "voice" || seg.type === "interlude");
    const withLyrics = voiceRows.filter(({ i }) => (segmentTexts[i] ?? "").trim());
    if (withLyrics.length === 0) {
      setThemeSearchError("歌詞が入った区間がありません。");
      return;
    }
    setAutoAssignLoading(true);
    setThemeSearchError(null);
    for (const { i } of withLyrics) {
      const text = (segmentTexts[i] ?? "").trim();
      const q = lyricsToSearchTerms(text, imageTone) || themeString.trim() || "nature";
      setSegmentSearchTerms((prev) => {
        const arr = [...prev];
        arr[i] = q;
        return arr;
      });
      try {
        const res = await fetch(`/api/search-images?q=${encodeURIComponent(q)}`);
        const json = (await res.json()) as { ok?: boolean; message?: string; images?: SearchImageResult[] };
        if (json?.ok && Array.isArray(json.images) && json.images.length > 0) {
          const img = json.images[0];
          const full = img.imageUrl || img.previewUrl;
          setSegmentImage(i, full, "suggested", {
            lyricText: text,
            searchKeywords: q,
            searchTags: img.tags,
            pixabayImageId: img.id,
            apiRank: img.apiRank,
            boostScore: img.boostScore,
            boostReason: img.boostReason,
            imageUrl: img.imageUrl || full,
            previewUrl: img.previewUrl || img.imageUrl || full,
            pageUrl:
              img.id > 0 ? `https://pixabay.com/photos/id-${img.id}/` : undefined,
            selectedAt: new Date().toISOString(),
          });
        }
      } catch {
        /* skip this row on error */
      }
    }
    setAutoAssignLoading(false);
  }

  /** 指定行のみ再抽選 */
  async function handleRegenerateRow(rowIndex: number) {
    const text = (segmentTexts[rowIndex] ?? "").trim();
    const q = lyricsToSearchTerms(text, imageTone) || themeString.trim() || "nature";
    setSegmentSearchTerms((prev) => {
      const arr = [...prev];
      arr[rowIndex] = q;
      return arr;
    });
    setAutoAssignLoading(true);
    try {
      const res = await fetch(`/api/search-images?q=${encodeURIComponent(q)}`);
      const json = (await res.json()) as { ok?: boolean; message?: string; images?: SearchImageResult[] };
      if (json?.ok && Array.isArray(json.images) && json.images.length > 0) {
        const img = json.images[Math.floor(Math.random() * Math.min(3, json.images.length))];
        const full = img.imageUrl || img.previewUrl;
        setSegmentImage(rowIndex, full, "suggested", {
          lyricText: text,
          searchKeywords: q,
          searchTags: img.tags,
          pixabayImageId: img.id,
          apiRank: img.apiRank,
          boostScore: img.boostScore,
          boostReason: img.boostReason,
          imageUrl: img.imageUrl || full,
          previewUrl: img.previewUrl || img.imageUrl || full,
          pageUrl:
            img.id > 0 ? `https://pixabay.com/photos/id-${img.id}/` : undefined,
          selectedAt: new Date().toISOString(),
        });
      }
    } finally {
      setAutoAssignLoading(false);
    }
  }

  /** 全歌詞あり区間を再生成 */
  async function handleRegenerateAll() {
    await handleAutoAssignImages();
  }

  function handleAssignThemeImage(img: SearchImageResult) {
    const pqIdx = editingPhraseId ? phraseQueue.findIndex((p) => p.id === editingPhraseId) : -1;
    const idx = pqIdx >= 0 ? pqIdx : 0;
    const full = img.imageUrl || img.previewUrl;
    const page =
      img.id > 0 ? `https://pixabay.com/photos/id-${img.id}/` : undefined;
    setSegmentImage(idx, full, "suggested", {
      lyricText: (segmentTexts[idx] ?? "").trim(),
      searchKeywords: searchQuery.trim(),
      pixabayImageId: img.id > 0 ? img.id : undefined,
      imageUrl: full,
      previewUrl: img.previewUrl || img.imageUrl,
      pageUrl: page,
      selectedAt: new Date().toISOString(),
    });
    const nextPid = phraseQueue[idx + 1]?.id;
    if (nextPid != null) assignEditingPhraseId(nextPid);
  }

  function handleBannerSelect(file: File | null) {
    if (bannerSourceUrl && bannerSourceUrl.startsWith("blob:")) {
      URL.revokeObjectURL(bannerSourceUrl);
    }
    setBannerSourceUrl(file ? URL.createObjectURL(file) : null);
  }

  function handleManualTrimStart() {
    setManualTrimMode(true);
    setManualTrimUrl(bannerSourceUrl ?? segmentImageUrls.find(Boolean) ?? null);
  }

  function handleManualTrimMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!manualTrimImgRef.current) return;
    const canvas = manualTrimCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    manualTrimStartRef.current = { x, y };
    manualTrimRectRef.current = null;
  }

  function handleManualTrimMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!manualTrimStartRef.current) return;
    const canvas = manualTrimCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    const sx = manualTrimStartRef.current.x;
    const sy = manualTrimStartRef.current.y;
    manualTrimRectRef.current = {
      x: Math.min(sx, x),
      y: Math.min(sy, y),
      w: Math.abs(x - sx),
      h: Math.abs(y - sy),
    };
    redrawManualTrimCanvas();
  }

  function handleManualTrimMouseUp() {
    if (!manualTrimRectRef.current || manualTrimRectRef.current.w < 5 || manualTrimRectRef.current.h < 5) {
      manualTrimStartRef.current = null;
      manualTrimRectRef.current = null;
      redrawManualTrimCanvas();
      return;
    }
    const r = manualTrimRectRef.current;
    const img = manualTrimImgRef.current;
    if (!img) return;
    const canvas = document.createElement("canvas");
    canvas.width = r.w;
    canvas.height = r.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    setProductCandidates((prev) => [...prev, canvas.toDataURL("image/png")]);
    setManualTrimMode(false);
    setManualTrimUrl(null);
    manualTrimStartRef.current = null;
    manualTrimRectRef.current = null;
  }

  function redrawManualTrimCanvas() {
    const canvas = manualTrimCanvasRef.current;
    const img = manualTrimImgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0);
    const r = manualTrimRectRef.current;
    if (r && r.w > 0 && r.h > 0) {
      ctx.strokeStyle = "#0f0";
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
  }

  useEffect(() => {
    if (!manualTrimMode || !manualTrimUrl) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      manualTrimImgRef.current = img;
      redrawManualTrimCanvas();
    };
    img.src = manualTrimUrl;
    return () => {
      manualTrimImgRef.current = null;
    };
  }, [manualTrimMode, manualTrimUrl]);

  const computeOverlays = useCallback((): OverlayData[] => {
    return timelineSegments.map((seg, i) => {
      const stored = segmentMediaTypes[i];
      const imgUrl = segmentImageUrls[i];
      const vidUrl = segmentVideoUrls[i];
      let mt: SegmentMediaType =
        stored === "image" || stored === "video"
          ? stored
          : vidUrl
            ? "video"
            : imgUrl
              ? "image"
              : "none";
      return {
        startSec: seg.startSec,
        endSec: seg.endSec,
        segmentIndex: i,
        text: segmentTexts[i] ?? "",
        anim: segmentAnims[i] || "none",
        mediaType: mt,
        imageUrl: mt === "image" ? imgUrl : undefined,
        videoUrl: mt === "video" ? vidUrl : undefined,
        videoStart: mt === "video" ? (segmentVideoStartSec[i] ?? 0) : undefined,
        videoEnd: mt === "video" ? segmentVideoEndSec[i] : undefined,
        videoMuted: mt === "video" ? (segmentVideoMuted[i] ?? false) : undefined,
        objectFit: mt !== "none" ? (segmentMediaObjectFit[i] ?? "cover") : undefined,
        compositeEnabled: segmentCompositeEnabled[i] ?? false,
        compositeMode: segmentCompositeModes[i] ?? "none",
        overlayImageUrl: segmentOverlayImageUrls[i],
        overlayText: segmentOverlayTexts[i] || undefined,
        overlayOpacity: segmentOverlayOpacity[i] ?? 0.85,
        overlayScaleX: segmentOverlayScaleX[i] ?? 1,
        overlayScaleY: segmentOverlayScaleY[i] ?? 1,
        overlayPosition: segmentOverlayPosition[i] ?? "center",
        overlayX: segmentOverlayX[i] ?? 0,
        overlayY: segmentOverlayY[i] ?? 0,
        textX: segmentTextX[i] ?? 0,
        textY: segmentTextY[i] ?? 0,
        lyricsFontSize: clampLyricsFontSize(segmentLyricsFontSize[i] ?? DEFAULT_LYRICS_FONT_SIZE),
        lyricsColor: normalizeLyricsColorHex(segmentLyricsColor[i] ?? "#ffffff"),
        screenFilter: segmentScreenFilters[i] ?? "normal",
        mosaicRegions:
          (segmentCompositeEnabled[i] ?? false) && (segmentCompositeModes[i] ?? "none") === "mosaic"
            ? (segmentMosaicRegions[i] ?? []).map((r) => ({ ...r }))
            : undefined,
        brandMaskRegions:
          (segmentCompositeEnabled[i] ?? false) && (segmentCompositeModes[i] ?? "none") === "blackMaskWithBrand"
            ? (segmentBrandMaskRegions[i] ?? []).map((r) => ({ ...r }))
            : undefined,
      };
    });
  }, [
    timelineSegments,
    segmentTexts,
    segmentImageUrls,
    segmentAnims,
    segmentMediaTypes,
    segmentVideoUrls,
    segmentVideoStartSec,
    segmentVideoEndSec,
    segmentVideoMuted,
    segmentMediaObjectFit,
    segmentCompositeEnabled,
    segmentCompositeModes,
    segmentMosaicRegions,
    segmentBrandMaskRegions,
    segmentOverlayImageUrls,
    segmentOverlayTexts,
    segmentOverlayOpacity,
    segmentOverlayScaleX,
    segmentOverlayScaleY,
    segmentOverlayPosition,
    segmentOverlayX,
    segmentOverlayY,
    segmentTextX,
    segmentTextY,
    segmentLyricsFontSize,
    segmentLyricsColor,
    segmentScreenFilters,
  ]);

  useEffect(() => {
    onOverlaysChange(computeOverlays());
  }, [computeOverlays, onOverlaysChange]);

  useEffect(() => {
    onPanelStateDirty?.();
  }, [lyricsFullText, phraseQueue, editingPhraseId, onPanelStateDirty]);

  useEffect(() => {
    onPanelStateDirty?.();
  }, [nameMaskPreset, onPanelStateDirty]);

  const lyricVisualFor = useCallback(
    (i: number) => {
      const fontSize = clampLyricsFontSize(segmentLyricsFontSize[i] ?? DEFAULT_LYRICS_FONT_SIZE);
      const color = normalizeLyricsColorHex(segmentLyricsColor[i] ?? "#ffffff");
      return { fontSize, color, textShadow: lyricsTextShadowForColor(color) };
    },
    [segmentLyricsFontSize, segmentLyricsColor]
  );

  /** 声区間の歌詞テキスト（複数行可）を親に同期 */
  useEffect(() => {
    if (!onSegmentTextsChange) return;
    const voiceTexts = timelineSegments
      .map((seg, i) => (seg.type === "voice" ? (segmentTexts[i] ?? "") : null))
      .filter((t): t is string => t !== null);
    onSegmentTextsChange(voiceTexts);
  }, [timelineSegments, segmentTexts, onSegmentTextsChange]);

  useEffect(() => {
    if (editingPhraseId == null) lastPhraseListScrollEditingIdRef.current = null;
  }, [editingPhraseId]);

  /** 編集中フレーズ行へスクロール（グローバルパネルのみ）。同一選択の再描画ではスクロールしない */
  useEffect(() => {
    if (previewRowIndex != null || editingPhraseId == null) return;
    if (lastPhraseListScrollEditingIdRef.current === editingPhraseId) return;
    lastPhraseListScrollEditingIdRef.current = editingPhraseId;
    const el = phraseItemRefs.current.get(editingPhraseId);
    if (el) {
      setTimeout(() => {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 0);
    }
  }, [editingPhraseId, previewRowIndex]);

  /** Enterキーで次のフレーズへ（input/textarea/select 内では発火しない） */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      if (phraseQueue.length === 0) return;
      const target = e.target as Node;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      )
        return;
      const pi = phraseQueue.findIndex((p) => p.id === editingPhraseId);
      if (pi >= 0 && pi < phraseQueue.length - 1) {
        const nextId = phraseQueue[pi + 1]!.id;
        assignEditingPhraseId(nextId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phraseQueue, editingPhraseId, assignEditingPhraseId]);

  /** localStorage 由来の補助トークン（検索実行時のみ更新・小配列） */
  const [searchHistoryBlend, setSearchHistoryBlend] = useState<string[]>([]);
  useEffect(() => {
    setSearchHistoryBlend(getAssistBlendTokens(videoId));
  }, [videoId]);

  /** モーダル内「曲全体の検索補助」: 歌詞・ムード・国際・SNS を依存に明示（編集のたびに再計算） */
  const previewModalCurrentLyrics =
    previewRowIndex != null ? (segmentTexts[previewRowIndex] ?? "") : "";
  const previewModalSearchAssist = useMemo(
    () =>
      generateSegmentSearchAssist(songVisualProfile, previewModalCurrentLyrics.trim(), {
        historyAuxiliaryTokens: searchHistoryBlend,
      }),
    [
      songVisualProfile.mood,
      songVisualProfile.international,
      songVisualProfile.platform,
      previewModalCurrentLyrics,
      searchHistoryBlend,
    ]
  );

  const previewModalAutoImageQuery =
    previewModalSearchAssist.searchQuery.trim() ||
    previewModalSearchAssist.tags.filter(Boolean).join(" ").trim();

  /** 区間切替時: 検索バー・候補・ページをリセット（検索は明示操作まで走らせない） */
  useEffect(() => {
    if (previewRowIndex == null) return;
    const pi = previewRowIndex;
    const ovr = segmentModalSuggestQueryOverride[pi];
    const fromOvr = ovr != null && ovr.trim() !== "";
    setManualImageSearchInput(fromOvr ? ovr.trim() : previewModalAutoImageQuery);
    setHasUserEditedSearchQuery(fromOvr);
    setCommittedImageSearchQuery("");
    setHasRequestedImageCandidates(false);
    setImageSearchCandidates([]);
    setHasMoreImageCandidates(false);
    setImageSearchError(null);
    lastFetchedEffectiveImageQueryRef.current = "";
    imageSearchNextPageRef.current = 2;
    imageSearchFetchGenRef.current += 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 行インデックスが変わったときだけ載せ替え
  }, [previewRowIndex]);

  /** 自動モードのときだけ、歌詞・プロファイル変化で入力欄を自動文に同期 */
  useEffect(() => {
    if (previewRowIndex == null) return;
    if (hasUserEditedSearchQuery) return;
    const pi = previewRowIndex;
    const ovr = segmentModalSuggestQueryOverride[pi];
    if (ovr != null && ovr.trim() !== "") return;
    setManualImageSearchInput(previewModalAutoImageQuery);
  }, [
    previewRowIndex,
    previewModalAutoImageQuery,
    segmentModalSuggestQueryOverride,
    hasUserEditedSearchQuery,
  ]);

  /** 候補画像フェッチ抑止用: この行に画像または動画が既にあるとき */
  const previewRowBlockingMedia =
    previewRowIndex != null &&
    (Boolean(segmentImageUrls[previewRowIndex]) ||
      Boolean(segmentVideoUrls[previewRowIndex]));

  /** プレビュー終了・画像ありでパネル閉じたときに候補 UI 状態を掃除 */
  useEffect(() => {
    if (previewRowIndex == null) {
      imageSearchFetchGenRef.current += 1;
      setImageSearchCandidates([]);
      setIsSearchingImages(false);
      setImageSearchLoadingMore(false);
      setHasMoreImageCandidates(false);
      lastFetchedEffectiveImageQueryRef.current = "";
      setImageSearchError(null);
      setHasRequestedImageCandidates(false);
      return;
    }
    if (previewRowBlockingMedia && !modalImagePickerOpen) {
      imageSearchFetchGenRef.current += 1;
      setImageSearchCandidates([]);
      setIsSearchingImages(false);
      setImageSearchLoadingMore(false);
      setHasMoreImageCandidates(false);
      lastFetchedEffectiveImageQueryRef.current = "";
      setImageSearchError(null);
    }
  }, [previewRowIndex, previewRowBlockingMedia, modalImagePickerOpen]);

  /** 第1ページ取得（キャッシュ優先）。失敗時は一覧を空にしない */
  async function runModalImageSearchPage1(effectiveQuery: string) {
    const gen = ++imageSearchFetchGenRef.current;
    setIsSearchingImages(true);
    setImageSearchError(null);

    const cached = imageSearchCacheRef.current.getPage(effectiveQuery, 1);
    if (cached) {
      if (gen !== imageSearchFetchGenRef.current) return;
      setImageSearchCandidates(cached.images.slice(0, PREVIEW_MODAL_SUGGEST_IMAGE_CAP));
      setHasMoreImageCandidates(cached.hasMore);
      lastFetchedEffectiveImageQueryRef.current = effectiveQuery;
      imageSearchNextPageRef.current = 2;
      setIsSearchingImages(false);
      return;
    }

    try {
      const res = await fetch(
        `/api/search-images?q=${encodeURIComponent(effectiveQuery)}&page=1&per_page=${PREVIEW_MODAL_SUGGEST_PER_PAGE}`
      );
      const json = (await res.json()) as {
        ok?: boolean;
        message?: string;
        images?: SearchImageResult[];
        hasMore?: boolean;
      };
      if (gen !== imageSearchFetchGenRef.current) return;

      if (json?.ok && Array.isArray(json.images) && json.images.length > 0) {
        const slice = json.images.slice(0, PREVIEW_MODAL_SUGGEST_IMAGE_CAP);
        const hasMore = Boolean(json.hasMore);
        imageSearchCacheRef.current.setPage(effectiveQuery, 1, {
          images: json.images,
          hasMore,
        });
        setImageSearchCandidates(slice);
        setHasMoreImageCandidates(hasMore);
        lastFetchedEffectiveImageQueryRef.current = effectiveQuery;
        imageSearchNextPageRef.current = 2;
      } else if (json?.ok && Array.isArray(json.images) && json.images.length === 0) {
        imageSearchCacheRef.current.setPage(effectiveQuery, 1, { images: [], hasMore: false });
        setImageSearchCandidates([]);
        setHasMoreImageCandidates(false);
        lastFetchedEffectiveImageQueryRef.current = effectiveQuery;
        imageSearchNextPageRef.current = 2;
      } else {
        setImageSearchError(json?.message ?? "画像を取得できませんでした");
      }
    } catch {
      if (gen !== imageSearchFetchGenRef.current) return;
      setImageSearchError("画像の取得に失敗しました");
    } finally {
      if (gen === imageSearchFetchGenRef.current) {
        setIsSearchingImages(false);
      }
    }
  }

  /** 同一 effective クエリの次の6枚（キャッシュ優先） */
  async function handleLoadMorePreviewSuggestImages() {
    const q = lastFetchedEffectiveImageQueryRef.current.trim();
    if (!q || !hasMoreImageCandidates || imageSearchLoadingMore || isSearchingImages) return;
    const page = imageSearchNextPageRef.current;
    const genAtStart = imageSearchFetchGenRef.current;

    const cached = imageSearchCacheRef.current.getPage(q, page);
    if (cached) {
      if (genAtStart !== imageSearchFetchGenRef.current) return;
      setImageSearchCandidates((prev) => {
        const merged = [...prev];
        for (const img of cached.images) {
          if (!merged.some((x) => x.id === img.id)) merged.push(img);
        }
        return merged;
      });
      imageSearchNextPageRef.current = page + 1;
      setHasMoreImageCandidates(cached.hasMore);
      return;
    }

    setImageSearchLoadingMore(true);
    try {
      const res = await fetch(
        `/api/search-images?q=${encodeURIComponent(q)}&page=${page}&per_page=${PREVIEW_MODAL_SUGGEST_PER_PAGE}`
      );
      const json = (await res.json()) as {
        ok?: boolean;
        images?: SearchImageResult[];
        hasMore?: boolean;
        message?: string;
      };
      if (genAtStart !== imageSearchFetchGenRef.current) return;
      if (json?.ok && Array.isArray(json.images) && json.images.length > 0) {
        const hasMore = Boolean(json.hasMore);
        imageSearchCacheRef.current.setPage(q, page, { images: json.images, hasMore });
        setImageSearchCandidates((prev) => {
          const merged = [...prev];
          for (const img of json.images!) {
            if (!merged.some((x) => x.id === img.id)) merged.push(img);
          }
          return merged;
        });
        imageSearchNextPageRef.current = page + 1;
        setHasMoreImageCandidates(hasMore);
      } else if (json?.ok && Array.isArray(json.images) && json.images.length === 0) {
        imageSearchCacheRef.current.setPage(q, page, { images: [], hasMore: false });
        setHasMoreImageCandidates(false);
      } else {
        setImageSearchError(json?.message ?? "続きの画像を取得できませんでした");
      }
    } catch {
      if (genAtStart !== imageSearchFetchGenRef.current) return;
      setImageSearchError("続きの取得に失敗しました");
    } finally {
      if (genAtStart === imageSearchFetchGenRef.current) {
        setImageSearchLoadingMore(false);
      }
    }
  }

  /** 検索 / Enter / 候補を再検索: 確定してから取得（入力中は呼ばない） */
  function handleModalSuggestSearchSubmit() {
    if (previewRowIndex == null) return;
    const pi = previewRowIndex;
    const raw = manualImageSearchInput.trim();
    const autoQ =
      previewModalSearchAssist.searchQuery.trim() ||
      previewModalSearchAssist.tags.filter(Boolean).join(" ").trim();
    const barForResolve = raw || autoQ;
    const manualMode = raw !== "" && raw !== autoQ.trim();

    setCommittedImageSearchQuery(barForResolve);
    setHasUserEditedSearchQuery(manualMode);

    setSegmentModalSuggestQueryOverride((prev) => {
      const arr = [...prev];
      while (arr.length <= pi) arr.push(null);
      arr[pi] = raw === "" ? null : raw;
      return arr;
    });

    if (raw === "") {
      setManualImageSearchInput(autoQ);
    }

    setHasRequestedImageCandidates(true);

    /** 手動バーに文字があるときだけ履歴更新（入力中は保存しない・ここだけ） */
    if (raw !== "") {
      recordManualSearchHistory(raw, videoId);
      setSearchHistoryBlend(getAssistBlendTokens(videoId));
    }

    const effectiveQ = resolveImageSearchApiQuery(
      previewModalSearchAssist,
      songVisualProfile,
      barForResolve,
      manualMode
    );
    if (!effectiveQ) return;
    void runModalImageSearchPage1(effectiveQ);
  }

  /** モーダル表示中: 正規化歌詞キーで前回選択（候補先頭にマージ） */
  const lyricsHistoryForModal = useMemo(() => {
    if (previewRowIndex == null) return null;
    const key = normalizeLyricsForHistoryKey(segmentTexts[previewRowIndex] ?? "");
    if (!key) return null;
    return getLyricsImageHistory(key);
  }, [previewRowIndex, segmentTexts]);

  const modalSuggestDisplayCandidates = useMemo((): SearchImageResult[] => {
    const baseDeduped = dedupeSearchImageResults(imageSearchCandidates);
    const histEntry = lyricsHistoryForModal;
    if (!histEntry?.imageUrl) return baseDeduped;
    const pin = searchResultFromHistory(histEntry);
    const pinKey = searchImageResultStableKey(pin);
    const filtered = baseDeduped.filter((c) => searchImageResultStableKey(c) !== pinKey);
    return dedupeSearchImageResults([pin, ...filtered]);
  }, [imageSearchCandidates, lyricsHistoryForModal]);

  const localUploadHintPortal =
    localUploadHintOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            id="local-upload-autosave-hint-root"
            role="dialog"
            aria-modal="true"
            aria-labelledby="local-upload-autosave-hint-title"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 20000,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
              background: "rgba(0,0,0,0.5)",
              boxSizing: "border-box",
            }}
            onClick={cancelLocalUploadHint}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancelLocalUploadHint();
              }
            }}
            tabIndex={-1}
          >
            <div
              role="document"
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: 400,
                width: "100%",
                background: "#fff",
                borderRadius: 12,
                padding: 20,
                boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
                boxSizing: "border-box",
              }}
            >
              <h2
                id="local-upload-autosave-hint-title"
                style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700, color: "#111" }}
              >
                端末内の画像について
              </h2>
              <p style={{ margin: "0 0 18px", fontSize: 14, lineHeight: 1.55, color: "#333" }}>
                この画像は自動保存の対象外で、再読み込み後は再選択が必要な場合があります。
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <button
                  type="button"
                  onClick={() => runLocalUploadHintApply({ suppressForever: false })}
                  style={{
                    padding: "10px 14px",
                    fontSize: 15,
                    fontWeight: 600,
                    borderRadius: 8,
                    border: "none",
                    background: "#1565c0",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  理解して続ける
                </button>
                <button
                  type="button"
                  onClick={cancelLocalUploadHint}
                  style={{
                    padding: "10px 14px",
                    fontSize: 14,
                    borderRadius: 8,
                    border: "1px solid #bbb",
                    background: "#f5f5f5",
                    cursor: "pointer",
                  }}
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={() => runLocalUploadHintApply({ suppressForever: true })}
                  style={{
                    padding: "8px 14px",
                    fontSize: 13,
                    borderRadius: 8,
                    border: "none",
                    background: "transparent",
                    color: "#1565c0",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  次回から表示しない
                </button>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  const previewOpen = previewRowIndex != null;

  // 排他: previewOpen のときは Modal のみ、そうでないときは Editor のみ（初回描画ズレ防止）
  if (previewOpen) {
    return createPortal(
      <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="区間編集・確認（画像と歌詞・範囲限定再生）"
        tabIndex={-1}
        onKeyDown={(e) => e.key === "Escape" && setPreviewRowIndex(null)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          pointerEvents: "auto",
        }}
      >
        <div
          aria-hidden
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 999,
            background: "rgba(0,0,0,0.7)",
          }}
          onClick={() => setPreviewRowIndex(null)}
        />
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "relative",
            zIndex: 1000,
            background: "#fff",
            borderRadius: 8,
            padding: 20,
            maxWidth: openPhraseQueueInModal === previewRowIndex ? 720 : 480,
            width: "100%",
            maxHeight: "90vh",
            overflow: "hidden",
            boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
            pointerEvents: "auto",
            display: "flex",
            flexDirection: "row",
            alignItems: "stretch",
          }}
        >
          <div style={{ flex: 1, minWidth: 0, overflow: "auto", paddingRight: openPhraseQueueInModal === previewRowIndex ? 16 : 0 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 6, flexShrink: 0, paddingTop: 2 }}>
                <button
                  type="button"
                  disabled={previewRowIndex! <= 0}
                  onClick={() => handlePreviewNavigate(-1)}
                  style={{ padding: "4px 12px", opacity: previewRowIndex! <= 0 ? 0.45 : 1 }}
                  title={t("segmentEditorNavPrevTitle")}
                >
                  {t("prev")}
                </button>
                <button
                  type="button"
                  disabled={previewRowIndex! >= timelineSegments.length - 1}
                  onClick={() => handlePreviewNavigate(1)}
                  style={{
                    padding: "4px 12px",
                    opacity: previewRowIndex! >= timelineSegments.length - 1 ? 0.45 : 1,
                  }}
                  title={t("segmentEditorNavNextTitle")}
                >
                  {t("next")}
                </button>
              </div>
              <div style={{ flex: 1, minWidth: 160 }}>
                <strong style={{ display: "block", fontSize: 16 }}>
                  {t("segmentEditorHeading")} #{previewRowIndex! + 1}
                </strong>
                {(() => {
                  const b = effectiveEditingSegmentBounds;
                  const seg = timelineSegments[previewRowIndex!];
                  const start = b?.startSec ?? seg?.startSec;
                  const end = b?.endSec ?? seg?.endSec;
                  if (typeof start !== "number" || typeof end !== "number") return null;
                  return (
                    <span
                      style={{
                        display: "inline-block",
                        marginTop: 6,
                        fontFamily: "ui-monospace, monospace",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#1a237e",
                        background: "#e8eaf6",
                        padding: "4px 10px",
                        borderRadius: 6,
                        border: "1px solid #c5cae9",
                      }}
                    >
                      {t("playbackTargetRangeLabel")} {start.toFixed(3)}s ～ {end.toFixed(3)}s
                    </span>
                  );
                })()}
              </div>
              <button type="button" onClick={() => setPreviewRowIndex(null)} style={{ padding: "4px 12px", flexShrink: 0, marginLeft: "auto" }}>
                {t("close")}
              </button>
            </div>
            {timelineSegments.length > 0
              ? (() => {
                  const fi = flowCurrentIndex;
                  const flowSeg = flowPreviewSegments[fi];
                  const curUrlTrim = (segmentImageUrls[fi] ?? "").trim();
                  const curVideoUrlTrim = (segmentVideoUrls[fi] ?? "").trim();
                  const storedMt = segmentMediaTypes[fi];
                  const effectiveMt: SegmentMediaType =
                    storedMt === "image" || storedMt === "video"
                      ? storedMt
                      : curVideoUrlTrim
                        ? "video"
                        : curUrlTrim
                          ? "image"
                          : "none";
                  const hasVisual =
                    effectiveMt !== "none" &&
                    Boolean(
                      curUrlTrim ||
                        curVideoUrlTrim ||
                        (effectiveMt === "image" && segmentImageSelections[fi]?.localImageNeedsReselect)
                    );
                  const vMuted = segmentVideoMuted[fi] ?? false;
                  const anim = segmentAnims[fi] ?? "none";
                  const textOffsetX = segmentTextX[fi] ?? 0;
                  const textOffsetY = segmentTextY[fi] ?? 0;
                  const flowDisplayMode = segmentDisplayModes[fi] ?? 1;
                  const flowBreakAt = segmentLineBreakAt[fi] ?? 0;
                  const rawLyrics = getSegmentCaptionText(fi);
                  const lines = getLyricsDisplayLines(rawLyrics, flowDisplayMode, flowBreakAt);
                  const lyrFlow = lyricVisualFor(fi);
                  const flowCaptionKey = `flow-${fi}-${rawLyrics}-${flowDisplayMode}-${flowBreakAt}-${flowPreviewAnimKey}-${lyrFlow.fontSize}-${textOffsetX}-${textOffsetY}`;
                  const lyricsCaption =
                    lines.length === 0 ? null : flowDisplayMode === "vRight" ? (
                      <PreviewLyricsCaptionAutoFit
                        measureFrameRef={flowPreviewStageRef}
                        baseFontSize={lyrFlow.fontSize}
                        color={lyrFlow.color}
                        textShadow={lyrFlow.textShadow}
                        className="preview-pv-caption preview-pv-caption--v preview-pv-caption--vr"
                        style={{
                          transform: `translate(${textOffsetX}px, calc(-50% + ${textOffsetY}px))`,
                          cursor: "grab",
                          touchAction: "none",
                        }}
                        onMouseDown={(e) => beginSegmentDrag(fi, "text", e.clientX, e.clientY)}
                        onTouchStart={(e) => {
                          const t = e.touches[0];
                          if (!t) return;
                          beginSegmentDrag(fi, "text", t.clientX, t.clientY);
                        }}
                        contentKey={flowCaptionKey}
                      >
                        {lines[0]}
                      </PreviewLyricsCaptionAutoFit>
                    ) : flowDisplayMode === "vLeft" ? (
                      <PreviewLyricsCaptionAutoFit
                        measureFrameRef={flowPreviewStageRef}
                        baseFontSize={lyrFlow.fontSize}
                        color={lyrFlow.color}
                        textShadow={lyrFlow.textShadow}
                        className="preview-pv-caption preview-pv-caption--v preview-pv-caption--vl"
                        style={{
                          transform: `translate(${textOffsetX}px, calc(-50% + ${textOffsetY}px))`,
                          cursor: "grab",
                          touchAction: "none",
                        }}
                        onMouseDown={(e) => beginSegmentDrag(fi, "text", e.clientX, e.clientY)}
                        onTouchStart={(e) => {
                          const t = e.touches[0];
                          if (!t) return;
                          beginSegmentDrag(fi, "text", t.clientX, t.clientY);
                        }}
                        contentKey={flowCaptionKey}
                      >
                        {lines[0]}
                      </PreviewLyricsCaptionAutoFit>
                    ) : (
                      <PreviewLyricsCaptionAutoFit
                        measureFrameRef={flowPreviewStageRef}
                        baseFontSize={lyrFlow.fontSize}
                        color={lyrFlow.color}
                        textShadow={lyrFlow.textShadow}
                        className="preview-pv-caption preview-pv-caption--h"
                        style={{
                          transform: `translate(${textOffsetX}px, ${textOffsetY}px)`,
                          cursor: "grab",
                          touchAction: "none",
                        }}
                        onMouseDown={(e) => beginSegmentDrag(fi, "text", e.clientX, e.clientY)}
                        onTouchStart={(e) => {
                          const t = e.touches[0];
                          if (!t) return;
                          beginSegmentDrag(fi, "text", t.clientX, t.clientY);
                        }}
                        contentKey={flowCaptionKey}
                      >
                        {lines.map((line, i) => (
                          <div key={i}>{line}</div>
                        ))}
                      </PreviewLyricsCaptionAutoFit>
                    );
                  const typeLabel =
                    flowSeg?.isBranding
                      ? "Branding"
                      : flowSeg?.type === "silence"
                      ? "無音"
                      : flowSeg?.type === "interlude"
                        ? "インタールード"
                        : "声区間";
                  const isEditingHighlight = fi === previewRowIndex;
                  /** flowPreviewSegments へ start/end も上書きしているので、そのまま表示・計算に使う */
                  const segForFlowBanner = flowSeg;
                  const spanFlowBanner =
                    segForFlowBanner != null
                      ? Math.max(0, segForFlowBanner.endSec - segForFlowBanner.startSec)
                      : 0;
                  const durLabel =
                    segForFlowBanner != null && spanFlowBanner > 0
                      ? `${spanFlowBanner.toFixed(3)}s`
                      : "—";
                  const flowLocalForDisplay =
                    isFlowPlaying
                      ? flowLocalSecInSegment
                      : segForFlowBanner != null && spanFlowBanner > 0
                        ? Math.min(
                            Math.max(0, flowTimeSec - segForFlowBanner.startSec),
                            spanFlowBanner
                          )
                        : flowLocalSecInSegment;

                  return (
                    <div
                      style={{
                        marginBottom: 14,
                        padding: 12,
                        background: "#0f172a",
                        borderRadius: 8,
                        border: "1px solid #334155",
                        flexShrink: 0,
                        color: "#fff",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 8,
                        }}
                      >
                        <span style={{ fontSize: 12, fontWeight: 700, color: "#f1f5f9" }}>{t("flowPreview")}</span>
                        <span
                          style={{
                            fontSize: 12,
                            color: "#fff",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            flexWrap: "wrap",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => jumpFlowPreviewToSegment(fi)}
                            title="表示中の区間を編集へ切り替え（行番号をクリック）"
                            style={{
                              font: "inherit",
                              fontFamily: "ui-monospace, monospace",
                              fontSize: 12,
                              fontWeight: 600,
                              color: "#f1f5f9",
                              background: "rgba(148, 163, 184, 0.15)",
                              border: "1px solid #475569",
                              borderRadius: 4,
                              cursor: "pointer",
                              padding: "2px 8px",
                            }}
                          >
                            {fi + 1} / {timelineSegments.length}
                          </button>
                          <span>
                            （長さ {durLabel}
                            {isEditingHighlight ? " · 編集中" : ""}）
                          </span>
                        </span>
                        {isFlowPlaying ? (
                          <span style={{ fontSize: 11, color: "#fff" }}>
                            全体 {flowTimeWithinScopeSec.toFixed(1)}s / {flowPlaybackDurationSec.toFixed(1)}s · 区間内{" "}
                            {flowLocalForDisplay.toFixed(3)}s / {durLabel}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: "#fff" }}>
                            停止中 · 区間内 {flowLocalForDisplay.toFixed(3)}s / {durLabel}
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: "#fff" }}>{typeLabel}</span>
                        <span style={{ flex: 1, minWidth: 8 }} />
                        <button
                          type="button"
                          onClick={() => {
                            if (flowPlaybackDurationSec <= 0) return;
                            setFlowUseFullTimeline(false);
                            setIsFlowPlaying(true);
                          }}
                          disabled={isFlowPlaying || flowPlaybackDurationSec <= 0}
                          style={{ padding: "4px 10px", fontSize: 12, color: "#fff", opacity: isFlowPlaying ? 0.45 : 1 }}
                          title="編集全体を先頭から最後まで連続再生（書き出し確認用。停止位置から再開も可）"
                        >
                          全体再生
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            stopFlowPlayback();
                          }}
                          style={{ padding: "4px 10px", fontSize: 12, color: "#fff" }}
                          title="全体再生を停止"
                        >
                          {t("stop")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (flowAllEndSec <= 0) return;
                            stopFlowPlayback();
                            setFlowUseFullTimeline(true);
                            queueMicrotask(() => {
                              flowTimeSecRef.current = 0;
                              setFlowTimeSec(0);
                              setFlowPreviewAnimKey((k) => k + 1);
                              setIsFlowPlaying(true);
                            });
                          }}
                          style={{ padding: "4px 10px", fontSize: 12, color: "#fff" }}
                          title="1行目から最後まで、各行の編集内容を反映して連続再生"
                        >
                          最初から再生
                        </button>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          alignItems: "center",
                          gap: 8,
                          marginBottom: 8,
                        }}
                      >
                        <span style={{ fontSize: 11, color: "#fff" }}>
                          行へ移動（1〜{timelineSegments.length}）
                        </span>
                        <input
                          value={flowJumpInputValue}
                          onChange={(e) => setFlowJumpInputValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              submitFlowJumpFromInput();
                            }
                          }}
                          placeholder="例: 12"
                          inputMode="numeric"
                          aria-label="移動先の区間番号（1始まり）"
                          style={{
                            width: 56,
                            padding: "4px 8px",
                            fontSize: 12,
                            borderRadius: 4,
                            border: "1px solid #475569",
                            background: "#1e293b",
                            color: "#f1f5f9",
                            boxSizing: "border-box",
                          }}
                        />
                        <button type="button" onClick={submitFlowJumpFromInput} style={{ padding: "4px 10px", fontSize: 12, color: "#fff" }}>
                          移動
                        </button>
                      </div>
                      <div
                        ref={flowPreviewStageRef}
                        data-segment-preview-root
                        data-preview-aspect={aspectLayout.aspectRatio}
                        style={{
                          ...aspectLayout.stage("flow"),
                          position: "relative",
                          outline: isEditingHighlight ? "3px solid #38bdf8" : "1px solid #475569",
                          outlineOffset: 0,
                        }}
                      >
                        {hasVisual &&
                        effectiveMt === "image" &&
                        (curUrlTrim || segmentImageSelections[fi]?.localImageNeedsReselect) ? (
                          <>
                            {wrapPreviewFilteredMedia(
                              fi,
                              anim && anim !== "none" ? `preview-pv-wrap anim-${anim}` : "preview-pv-wrap",
                              `flow-img-${fi}-${flowPreviewAnimKey}`,
                              <>
                                {segmentImageSelections[fi]?.localImageNeedsReselect && !curUrlTrim ? (
                                  <div
                                    className="preview-pv-img"
                                    style={{
                                      display: "flex",
                                      flexDirection: "column",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      color: "#ffcc80",
                                      fontSize: 14,
                                      padding: 16,
                                      textAlign: "center",
                                      width: "100%",
                                      height: "100%",
                                      boxSizing: "border-box",
                                    }}
                                  >
                                    <div>ローカル画像は再選択してください</div>
                                    <div style={{ marginTop: 8, fontSize: 13, opacity: 0.95 }}>
                                      自動保存では端末内の写真は復元できません
                                    </div>
                                  </div>
                                ) : (segmentImageLoadStates[fi] ?? "idle") === "error" ? (
                                  <div
                                    className="preview-pv-img"
                                    style={{
                                      display: "flex",
                                      flexDirection: "column",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      color: "#fecaca",
                                      fontSize: 14,
                                      padding: 16,
                                      textAlign: "center",
                                      width: "100%",
                                      height: "100%",
                                      boxSizing: "border-box",
                                    }}
                                  >
                                    <div>画像を読み込めません</div>
                                    <div style={{ marginTop: 8, fontSize: 13, opacity: 0.95 }}>
                                      再選択してください
                                    </div>
                                  </div>
                                ) : (
                                  <img
                                    key={curUrlTrim.slice(0, 80)}
                                    src={curUrlTrim}
                                    alt=""
                                    className="preview-pv-img"
                                    loading="lazy"
                                    decoding="async"
                                    onLoad={() => handleSegmentBackgroundImageLoad(fi, curUrlTrim)}
                                    onError={() => handleSegmentBackgroundImageError(fi, curUrlTrim)}
                                  />
                                )}
                                {(segmentImageLoadStates[fi] ?? "idle") !== "error" &&
                                !(segmentImageSelections[fi]?.localImageNeedsReselect && !curUrlTrim)
                                  ? renderCompositeOverlay(fi)
                                  : null}
                              </>
                            )}
                            {lyricsCaption}
                          </>
                        ) : hasVisual && effectiveMt === "video" && curVideoUrlTrim ? (
                          <>
                            {wrapPreviewFilteredMedia(
                              fi,
                              anim && anim !== "none" ? `preview-pv-wrap anim-${anim}` : "preview-pv-wrap",
                              `flow-vwrap-${fi}-${flowPreviewAnimKey}`,
                              <>
                                <video
                                  ref={flowPreviewVideoRef}
                                  key={`flow-vid-${fi}`}
                                  src={curVideoUrlTrim}
                                  className="preview-pv-img"
                                  preload={isFlowPlaying ? "auto" : "metadata"}
                                  muted={vMuted}
                                  playsInline
                                  loop={false}
                                />
                                {renderCompositeOverlay(fi)}
                              </>
                            )}
                            {lyricsCaption}
                          </>
                        ) : (
                          <>
                            {wrapPreviewFilteredMedia(
                              fi,
                              "preview-pv-wrap",
                              `flow-empty-${fi}-${flowPreviewAnimKey}`,
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "#94a3b8",
                                  fontSize: 13,
                                  padding: 16,
                                  textAlign: "center",
                                  width: "100%",
                                  height: "100%",
                                  boxSizing: "border-box",
                                }}
                              >
                                <div>{typeLabel}</div>
                                <div style={{ marginTop: 6, fontSize: 12 }}>素材なし · 歌詞のみ表示</div>
                              </div>
                            )}
                            {lyricsCaption}
                          </>
                        )}
                        {renderNameAutoMaskLayer(fi)}
                      </div>
                      <div style={{ fontSize: 10, color: "#64748b", marginTop: 6, lineHeight: 1.4 }}>
                        表示時間はタイムライン上の長さ（start～end）に合わせて切り替わります。動画は表示中の1区間だけ読み込みます。番号クリックまたは「行へ移動」で編集対象の行へ移れます。
                      </div>
                    </div>
                  );
                })()
              : null}
            {(() => {
              const b = effectiveEditingSegmentBounds;
              const seg = timelineSegments[previewRowIndex!];
              const startSec = b?.startSec ?? seg?.startSec ?? 0;
              const endSec = b?.endSec ?? seg?.endSec ?? 0;
              const durationSec = Math.max(0, endSec - startSec);
              const hasControls = Boolean(onSeekToSec && onPlay && onPause);
              return hasControls && seg ? (
                <div
                  style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12, padding: 12, background: "#e3f2fd", borderRadius: 6, border: "1px solid #90caf9" }}
                  onClick={(e) => e.stopPropagation()}
                  role="group"
                >
                  <span style={{ fontSize: 11, fontWeight: 600, color: "#1565c0", width: "100%" }}>区間内での再生</span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      handleSegmentPlay();
                    }}
                    style={{ padding: "6px 12px", background: segmentPlayMode === "segment" ? "#bbdefb" : undefined }}
                    title={`${formatSecToMinSec(startSec)} ～ ${formatSecToMinSec(endSec)} の区間のみ再生、endで自動停止`}
                  >
                    {t("play")}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      handleSegmentStop();
                    }}
                    style={{ padding: "6px 12px" }}
                  >
                    {t("stop")}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      handleSegmentPlay();
                      setTimeout(() => onSegmentPlayStart?.(), 120);
                    }}
                    style={{ padding: "6px 12px", background: segmentPlayMode === "segment" ? "#bbdefb" : undefined }}
                    title={`${formatSecToMinSec(startSec)} ～ ${formatSecToMinSec(endSec)} の ${durationSec.toFixed(1)}秒 のみ再生して自動停止（演出込み）`}
                  >
                    この区間だけ再生
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      onSeekToSec?.(startSec);
                      onPlay?.();
                      setSegmentPlayMode("segmentLoop");
                      setTimeout(() => onSegmentPlayStart?.(), 120);
                    }}
                    style={{ padding: "6px 12px", background: segmentPlayMode === "segmentLoop" ? "#bbdefb" : undefined }}
                    title={`${formatSecToMinSec(startSec)} ～ ${formatSecToMinSec(endSec)} をループ`}
                  >
                    この範囲をループ
                  </button>
                  <span style={{ fontSize: 12, color: "#666", marginLeft: 8 }}>現在: {formatSecToMinSec(currentTimeSec)}</span>
                </div>
              ) : null;
            })()}
            <style>{segmentModalPreviewCss}</style>
            <div style={{ marginBottom: 12, padding: 10, background: "#f8fafc", borderRadius: 6, border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8 }}>
                {t("searchAssistGlobalHeading")}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
                <label style={{ fontSize: 11, color: "#64748b" }}>曲のイメージ:</label>
                <select value={songVisualProfile.mood} onChange={(e) => setSongVisualProfile((p) => ({ ...p, mood: e.target.value as SongVisualProfile["mood"] }))} style={{ padding: "4px 8px", fontSize: 12, minWidth: 100 }}>
                  {MOOD_OPTIONS.map((o) => <option key={o.id || "m-none"} value={o.id}>{o.label}</option>)}
                </select>
                <label style={{ fontSize: 11, color: "#64748b", marginLeft: 4 }}>インターナショナル:</label>
                <select value={songVisualProfile.international} onChange={(e) => setSongVisualProfile((p) => ({ ...p, international: e.target.value as SongVisualProfile["international"] }))} style={{ padding: "4px 8px", fontSize: 12, minWidth: 120 }}>
                  {INTERNATIONAL_OPTIONS.map((o) => <option key={o.id || "i-none"} value={o.id}>{o.label}</option>)}
                </select>
                <label style={{ fontSize: 11, color: "#64748b", marginLeft: 4 }}>SNS:</label>
                <select value={songVisualProfile.platform} onChange={(e) => setSongVisualProfile((p) => ({ ...p, platform: e.target.value as SongVisualProfile["platform"] }))} style={{ padding: "4px 8px", fontSize: 12, minWidth: 120 }}>
                  {PLATFORM_OPTIONS.map((o) => <option key={o.id || "p-none"} value={o.id}>{o.label}</option>)}
                </select>
              </div>
              {(() => {
                const assist = previewModalSearchAssist;
                const enQs =
                  assist.searchQueriesEn?.length > 0
                    ? assist.searchQueriesEn
                    : [assist.searchQuery].filter(Boolean);
                const jaQs =
                  assist.searchQueriesJa?.length > 0
                    ? assist.searchQueriesJa
                    : [assist.searchQueryJa].filter(Boolean);
                const hasAny =
                  assist.tags.length > 0 ||
                  assist.imageConcepts.length > 0 ||
                  enQs.length > 0 ||
                  jaQs.length > 0;
                if (!hasAny) return <div style={{ fontSize: 11, color: "#94a3b8" }}>曲イメージ・インターナショナル・SNSを選ぶか、歌詞を入力すると候補が出ます</div>;
                const copyToClipboard = (text: string) => { navigator.clipboard?.writeText(text).catch(() => {}); };
                const applyWordToSearchBar = (word: string) => {
                  setManualImageSearchInput((prev) => {
                    const t = prev.trim();
                    if (!t) return word;
                    return `${t} ${word}`;
                  });
                  setHasUserEditedSearchQuery(true);
                };
                const tokenizeCandidate = (s: string) =>
                  s
                    .trim()
                    .split(/\s+/)
                    .filter((t) => t.length > 0);
                const tokenChipStyle = {
                  padding: "2px 6px",
                  fontSize: 10,
                  borderRadius: 4,
                  border: "1px solid #cbd5e1",
                  background: "#e2e8f0",
                  cursor: "pointer" as const,
                  fontFamily: "inherit",
                };
                const renderTokenRow = (q: string, rowIdx: number, totalRows: number, keyPrefix: string) => {
                  const tokens = tokenizeCandidate(q);
                  return (
                    <div key={`${keyPrefix}-${rowIdx}`} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4 }}>
                      {totalRows > 1 ? <span style={{ color: "#64748b", minWidth: 22 }}>{rowIdx + 1}.</span> : null}
                      {tokens.map((token, ti) => (
                        <button
                          key={`${keyPrefix}-${rowIdx}-${ti}`}
                          type="button"
                          onClick={() => applyWordToSearchBar(token)}
                          style={tokenChipStyle}
                          title="クリックで検索バーに追加"
                          onMouseEnter={(e) => { e.currentTarget.style.background = "#cbd5e1"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "#e2e8f0"; }}
                        >
                          {token}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          copyToClipboard(q);
                        }}
                        style={{ padding: "2px 6px", fontSize: 10 }}
                      >
                        コピー
                      </button>
                    </div>
                  );
                };
                return (
                  <div style={{ fontSize: 11, color: "#475569", display: "flex", flexDirection: "column", gap: 6 }}>
                    {assist.imageConcepts.length > 0 && (
                      <div>
                        <span style={{ fontWeight: 600 }}>画像候補:</span>{" "}
                        {assist.imageConcepts.map((c, i) => <span key={i}>{c}{i < assist.imageConcepts.length - 1 ? " / " : ""}</span>)}
                      </div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontWeight: 600 }}>{t("searchHintsEnglishShort")}</span>
                      {enQs.length === 0 ? (
                        <span style={{ color: "#94a3b8" }}>—</span>
                      ) : (
                        enQs.map((q, i) => renderTokenRow(q, i, enQs.length, "en"))
                      )}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ fontWeight: 600 }}>{t("searchHintsJapaneseShort")}</span>
                      {jaQs.length === 0 ? (
                        <span style={{ color: "#94a3b8" }}>—</span>
                      ) : (
                        jaQs.map((q, i) => renderTokenRow(q, i, jaQs.length, "ja"))
                      )}
                    </div>
                    {assist.tags.length > 0 && (
                      <div>
                        <span style={{ fontWeight: 600 }}>タグ:</span>{" "}
                        {assist.tags.join(" · ")}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            {(() => {
              const pi = previewRowIndex!;
              const curUrlTrim = (segmentImageUrls[pi] ?? "").trim();
              const curVideoUrlTrim = (segmentVideoUrls[pi] ?? "").trim();
              const storedMt = segmentMediaTypes[pi];
              const effectiveMt: SegmentMediaType =
                storedMt === "image" || storedMt === "video"
                  ? storedMt
                  : curVideoUrlTrim
                    ? "video"
                    : curUrlTrim
                      ? "image"
                      : "none";
              const hasVisualMedia =
                effectiveMt !== "none" &&
                Boolean(
                  curUrlTrim ||
                    curVideoUrlTrim ||
                    (effectiveMt === "image" && segmentImageSelections[pi]?.localImageNeedsReselect)
                );
              const showPickerPanel = !hasVisualMedia || modalImagePickerOpen;
              const kind = segmentImageSourceKinds[pi];
              const vMuted = segmentVideoMuted[pi] ?? false;
              const textOffsetX = segmentTextX[pi] ?? 0;
              const textOffsetY = segmentTextY[pi] ?? 0;
              const compositeEnabled = segmentCompositeEnabled[pi] ?? false;
              const compositeMode = segmentCompositeModes[pi] ?? "none";
              const compositeOverlayImageUrl = segmentOverlayImageUrls[pi];
              const compositeOverlayText = segmentOverlayTexts[pi] ?? "";
              const compositeOpacity = segmentOverlayOpacity[pi] ?? 0.85;
              const compositeScaleX = segmentOverlayScaleX[pi] ?? 1;
              const compositeScaleY = segmentOverlayScaleY[pi] ?? 1;
              const compositePosition = segmentOverlayPosition[pi] ?? "center";
              const hasCompositeForegroundImage = Boolean(compositeOverlayImageUrl);
              const previewDisplayMode = segmentDisplayModes[pi] ?? 1;
              const previewBreakAt = segmentLineBreakAt[pi] ?? 0;
              const lyrPi = lyricVisualFor(pi);
              const modalRawLyrics = getSegmentCaptionText(pi);
              const modalLines = getLyricsDisplayLines(modalRawLyrics, previewDisplayMode, previewBreakAt);
              const modalCaptionKey = `modal-${pi}-${modalRawLyrics}-${previewDisplayMode}-${previewBreakAt}-${previewAnimKey}-${lyrPi.fontSize}-${textOffsetX}-${textOffsetY}`;

              const lyricsCaption =
                modalLines.length === 0 ? null : previewDisplayMode === "vRight" ? (
                  <PreviewLyricsCaptionAutoFit
                    measureFrameRef={modalPreviewStageRef}
                    baseFontSize={lyrPi.fontSize}
                    color={lyrPi.color}
                    textShadow={lyrPi.textShadow}
                    className="preview-pv-caption preview-pv-caption--v preview-pv-caption--vr"
                    style={{
                      transform: `translate(${textOffsetX}px, calc(-50% + ${textOffsetY}px))`,
                      cursor: "grab",
                      touchAction: "none",
                    }}
                    onMouseDown={(e) => beginSegmentDrag(pi, "text", e.clientX, e.clientY)}
                    onTouchStart={(e) => {
                      const t = e.touches[0];
                      if (!t) return;
                      beginSegmentDrag(pi, "text", t.clientX, t.clientY);
                    }}
                    contentKey={modalCaptionKey}
                  >
                    {modalLines[0]}
                  </PreviewLyricsCaptionAutoFit>
                ) : previewDisplayMode === "vLeft" ? (
                  <PreviewLyricsCaptionAutoFit
                    measureFrameRef={modalPreviewStageRef}
                    baseFontSize={lyrPi.fontSize}
                    color={lyrPi.color}
                    textShadow={lyrPi.textShadow}
                    className="preview-pv-caption preview-pv-caption--v preview-pv-caption--vl"
                    style={{
                      transform: `translate(${textOffsetX}px, calc(-50% + ${textOffsetY}px))`,
                      cursor: "grab",
                      touchAction: "none",
                    }}
                    onMouseDown={(e) => beginSegmentDrag(pi, "text", e.clientX, e.clientY)}
                    onTouchStart={(e) => {
                      const t = e.touches[0];
                      if (!t) return;
                      beginSegmentDrag(pi, "text", t.clientX, t.clientY);
                    }}
                    contentKey={modalCaptionKey}
                  >
                    {modalLines[0]}
                  </PreviewLyricsCaptionAutoFit>
                ) : (
                  <PreviewLyricsCaptionAutoFit
                    measureFrameRef={modalPreviewStageRef}
                    baseFontSize={lyrPi.fontSize}
                    color={lyrPi.color}
                    textShadow={lyrPi.textShadow}
                    className="preview-pv-caption preview-pv-caption--h"
                    style={{
                      transform: `translate(${textOffsetX}px, ${textOffsetY}px)`,
                      cursor: "grab",
                      touchAction: "none",
                    }}
                    onMouseDown={(e) => beginSegmentDrag(pi, "text", e.clientX, e.clientY)}
                    onTouchStart={(e) => {
                      const t = e.touches[0];
                      if (!t) return;
                      beginSegmentDrag(pi, "text", t.clientX, t.clientY);
                    }}
                    contentKey={modalCaptionKey}
                  >
                    {modalLines.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </PreviewLyricsCaptionAutoFit>
                );

              return (
                <div style={{ marginBottom: 16 }}>
                  {hasVisualMedia &&
                  effectiveMt === "image" &&
                  (curUrlTrim || segmentImageSelections[pi]?.localImageNeedsReselect) ? (
                    <div
                      ref={modalPreviewStageRef}
                      data-segment-preview-root
                      data-preview-aspect={aspectLayout.aspectRatio}
                      role="button"
                      tabIndex={0}
                      className="preview-img-clickable"
                      onClick={() => setModalImagePickerOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setModalImagePickerOpen(true);
                        }
                      }}
                      style={{
                        ...aspectLayout.stage("modal"),
                        position: "relative",
                        maxWidth: 440,
                        width: "100%",
                        margin: "0 auto 12px",
                        cursor: "pointer",
                        outline: "none",
                      }}
                      title="クリックで素材を変更"
                    >
                      <>
                        {wrapPreviewFilteredMedia(
                          pi,
                          segmentAnims[pi] && segmentAnims[pi] !== "none"
                            ? `preview-pv-wrap anim-${segmentAnims[pi]}`
                            : "preview-pv-wrap",
                          `preview-anim-${previewAnimKey}`,
                          <>
                            {segmentImageSelections[pi]?.localImageNeedsReselect && !curUrlTrim ? (
                              <div
                                className="preview-pv-img"
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "#ffcc80",
                                  fontSize: 15,
                                  padding: 20,
                                  textAlign: "center",
                                  width: "100%",
                                  height: "100%",
                                  boxSizing: "border-box",
                                }}
                              >
                                <div>ローカル画像は再選択してください</div>
                                <div style={{ marginTop: 10, fontSize: 14, opacity: 0.95 }}>
                                  自動保存では端末内の写真は復元できません
                                </div>
                              </div>
                            ) : (segmentImageLoadStates[pi] ?? "idle") === "error" ? (
                              <div
                                className="preview-pv-img"
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "#fecaca",
                                  fontSize: 15,
                                  padding: 20,
                                  textAlign: "center",
                                  width: "100%",
                                  height: "100%",
                                  boxSizing: "border-box",
                                }}
                              >
                                <div>画像を読み込めません</div>
                                <div style={{ marginTop: 10, fontSize: 14, opacity: 0.95 }}>
                                  再選択してください
                                </div>
                              </div>
                            ) : (
                              <img
                                key={curUrlTrim.slice(0, 80)}
                                src={curUrlTrim}
                                alt=""
                                className="preview-pv-img"
                                loading="lazy"
                                decoding="async"
                                onLoad={() => handleSegmentBackgroundImageLoad(pi, curUrlTrim)}
                                onError={() => handleSegmentBackgroundImageError(pi, curUrlTrim)}
                              />
                            )}
                            {(segmentImageLoadStates[pi] ?? "idle") !== "error" &&
                            !(segmentImageSelections[pi]?.localImageNeedsReselect && !curUrlTrim)
                              ? renderCompositeOverlay(pi)
                              : null}
                          </>
                        )}
                        {lyricsCaption}
                        {renderNameAutoMaskLayer(pi)}
                      </>
                      <div
                        className="preview-change-overlay"
                        style={{
                          position: "absolute",
                          inset: 0,
                          zIndex: 4,
                          background: "rgba(0,0,0,0.45)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          opacity: 0,
                          transition: "opacity 0.2s",
                          pointerEvents: "none",
                        }}
                      >
                        <span
                          style={{
                            color: "#fff",
                            fontSize: 14,
                            fontWeight: 600,
                            textShadow: "0 1px 4px black",
                          }}
                        >
                          素材を変更
                        </span>
                      </div>
                    </div>
                  ) : null}
                  {hasVisualMedia && effectiveMt === "video" && curVideoUrlTrim ? (
                    <div
                      ref={modalPreviewStageRef}
                      data-segment-preview-root
                      data-preview-aspect={aspectLayout.aspectRatio}
                      role="button"
                      tabIndex={0}
                      className="preview-img-clickable"
                      onClick={() => setModalImagePickerOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setModalImagePickerOpen(true);
                        }
                      }}
                      style={{
                        ...aspectLayout.stage("modal"),
                        position: "relative",
                        maxWidth: 440,
                        width: "100%",
                        margin: "0 auto 12px",
                        cursor: "pointer",
                        outline: "none",
                      }}
                      title="クリックで素材を変更（動画は再生ボタンでプレビュー）"
                    >
                      <>
                        {wrapPreviewFilteredMedia(
                          pi,
                          segmentAnims[pi] && segmentAnims[pi] !== "none"
                            ? `preview-pv-wrap anim-${segmentAnims[pi]}`
                            : "preview-pv-wrap",
                          `preview-anim-v-${previewAnimKey}`,
                          <>
                            <video
                              src={curVideoUrlTrim}
                              className="preview-pv-img"
                              preload="none"
                              muted={vMuted}
                              playsInline
                              controls
                            />
                            {renderCompositeOverlay(pi)}
                          </>
                        )}
                        {lyricsCaption}
                        {renderNameAutoMaskLayer(pi)}
                      </>
                      <div
                        className="preview-change-overlay"
                        style={{
                          position: "absolute",
                          inset: 0,
                          zIndex: 4,
                          background: "rgba(0,0,0,0.45)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          opacity: 0,
                          transition: "opacity 0.2s",
                          pointerEvents: "none",
                        }}
                      >
                        <span
                          style={{
                            color: "#fff",
                            fontSize: 14,
                            fontWeight: 600,
                            textShadow: "0 1px 4px black",
                          }}
                        >
                          素材を変更
                        </span>
                      </div>
                    </div>
                  ) : null}
                  {hasVisualMedia ? (
                    <div
                      style={{
                        margin: "0 auto 10px",
                        width: "100%",
                        maxWidth: 440,
                        padding: 8,
                        border: "1px solid #d6dce5",
                        borderRadius: 6,
                        background: "#fff",
                        boxSizing: "border-box",
                      }}
                    >
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#334155", marginBottom: 6 }}>
                        ミニ合成パネル（この画像の近くで編集）
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                        <button
                          type="button"
                          onClick={() => {
                            setSegmentCompositeEnabled((prev) => {
                              const arr = [...prev];
                              while (arr.length <= pi) arr.push(false);
                              arr[pi] = false;
                              return arr;
                            });
                          }}
                          style={{
                            padding: "3px 8px",
                            fontSize: 11,
                            borderRadius: 4,
                            border: "1px solid #ccc",
                            background: compositeEnabled ? "#f0f0f0" : "#e0f2fe",
                          }}
                        >
                          {t("compositeNormal")}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const curMode = segmentCompositeModes[pi] ?? "none";
                            const nextMode: SegmentCompositeMode = curMode === "none" ? "mosaic" : curMode;
                            setSegmentCompositeEnabled((prev) => {
                              const arr = [...prev];
                              while (arr.length <= pi) arr.push(false);
                              arr[pi] = true;
                              return arr;
                            });
                            setSegmentCompositeModes((prev) => {
                              const arr = [...prev];
                              while (arr.length <= pi) arr.push("none");
                              arr[pi] = nextMode;
                              return arr;
                            });
                            if (nextMode === "mosaic") ensureMosaicRegionsForPi(pi);
                            else if (nextMode === "blackMaskWithBrand") ensureBrandMaskRegionsForPi(pi);
                          }}
                          style={{
                            padding: "3px 8px",
                            fontSize: 11,
                            borderRadius: 4,
                            border: "1px solid #ccc",
                            background: compositeEnabled ? "#e0f2fe" : "#f0f0f0",
                          }}
                        >
                          {t("useComposite")}
                        </button>
                        <span style={{ fontSize: 10, color: "#64748b" }}>
                          {compositeEnabled
                            ? compositeMode === "mosaic"
                              ? "モザイク"
                              : compositeMode === "blackMaskWithBrand"
                                ? "黒塗り＋gegenpress app"
                                : "—"
                            : "オフ"}
                        </span>
                      </div>
                      {compositeEnabled ? (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 6 }}>
                          <label style={{ fontSize: 11, color: "#555" }}>パターン</label>
                          <select
                            value={compositeMode === "none" ? "mosaic" : compositeMode}
                            onChange={(e) => {
                              const v = e.target.value as SegmentCompositeMode;
                              setSegmentCompositeModes((prev) => {
                                const arr = [...prev];
                                while (arr.length <= pi) arr.push("mosaic");
                                arr[pi] = v;
                                return arr;
                              });
                              if (v === "mosaic") ensureMosaicRegionsForPi(pi);
                              else if (v === "blackMaskWithBrand") ensureBrandMaskRegionsForPi(pi);
                            }}
                            style={{ padding: "3px 6px", fontSize: 11, minWidth: 200 }}
                          >
                            {COMPOSITE_MODE_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                      {compositeEnabled && compositeMode === "mosaic" ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
                          <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.45 }}>
                            プレビュー上の矩形をドラッグで移動、右下の白角でリサイズ。ピクセル化で隠します。
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                            {(segmentMosaicRegions[pi] ?? []).map((reg, idx) => {
                              const activeId =
                                segmentMosaicSelectedId[pi] ?? segmentMosaicRegions[pi]?.[0]?.id ?? null;
                              return (
                                <button
                                  key={reg.id}
                                  type="button"
                                  onClick={() => {
                                    setSegmentMosaicSelectedId((s) => {
                                      const a = [...s];
                                      while (a.length <= pi) a.push(null);
                                      a[pi] = reg.id;
                                      return a;
                                    });
                                  }}
                                  style={{
                                    padding: "2px 8px",
                                    fontSize: 10,
                                    borderRadius: 4,
                                    border: "1px solid #ccc",
                                    background: activeId === reg.id ? "#dbeafe" : "#fff",
                                  }}
                                >
                                  #{idx + 1}
                                </button>
                              );
                            })}
                            <button
                              type="button"
                              onClick={() => {
                                const d = defaultMosaicRegion();
                                setSegmentMosaicRegions((prev) => {
                                  const next = prev.map((r) => r.map((x) => ({ ...x })));
                                  while (next.length <= pi) next.push([]);
                                  next[pi] = [...(next[pi] ?? []), d];
                                  return next;
                                });
                                setSegmentMosaicSelectedId((s) => {
                                  const a = [...s];
                                  while (a.length <= pi) a.push(null);
                                  a[pi] = d.id;
                                  return a;
                                });
                              }}
                              style={{ padding: "2px 8px", fontSize: 10, borderRadius: 4, border: "1px solid #ccc" }}
                            >
                              ＋追加
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const row = [...(segmentMosaicRegions[pi] ?? [])];
                                const sid = (segmentMosaicSelectedId[pi] ?? row[0]?.id) ?? null;
                                if (!sid || row.length === 0) return;
                                const idx = row.findIndex((x) => x.id === sid);
                                if (idx < 0) return;
                                row.splice(idx, 1);
                                const newSel = row[0]?.id ?? null;
                                setSegmentMosaicRegions((prev) => {
                                  const next = prev.map((r) => r.map((x) => ({ ...x })));
                                  while (next.length <= pi) next.push([]);
                                  next[pi] = row;
                                  return next;
                                });
                                setSegmentMosaicSelectedId((s) => {
                                  const a = [...s];
                                  while (a.length <= pi) a.push(null);
                                  a[pi] = newSel;
                                  return a;
                                });
                              }}
                              style={{ padding: "2px 8px", fontSize: 10, borderRadius: 4, border: "1px solid #ccc" }}
                            >
                              選択を削除
                            </button>
                          </div>
                          {(() => {
                            const row = segmentMosaicRegions[pi] ?? [];
                            const rid = segmentMosaicSelectedId[pi] ?? row[0]?.id ?? null;
                            const mr = row.find((x) => x.id === rid);
                            if (!mr) return null;
                            return (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                                <label style={{ fontSize: 11, color: "#555", display: "flex", alignItems: "center", gap: 4 }}>
                                  モザイクの透明度
                                  <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={mr.opacity}
                                    onChange={(e) => {
                                      const v = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
                                      patchMosaicRegion(pi, rid, { opacity: v });
                                    }}
                                  />
                                </label>
                                <label style={{ fontSize: 11, color: "#555", display: "flex", alignItems: "center", gap: 4 }}>
                                  強度（ブロック）
                                  <input
                                    type="range"
                                    min={5}
                                    max={40}
                                    step={1}
                                    value={mr.pixelSize}
                                    onChange={(e) => {
                                      const v = Math.max(5, Math.min(40, parseInt(e.target.value, 10) || 14));
                                      patchMosaicRegion(pi, rid, { pixelSize: v });
                                    }}
                                  />
                                </label>
                                <label style={{ fontSize: 11, color: "#555", display: "flex", alignItems: "center", gap: 4 }}>
                                  幅（%）
                                  <input
                                    type="range"
                                    min={5}
                                    max={100}
                                    step={1}
                                    value={Math.round(mr.wPct)}
                                    onChange={(e) => {
                                      const w = Math.max(5, Math.min(100, parseInt(e.target.value, 10) || 5));
                                      patchMosaicRegion(pi, rid, {
                                        wPct: Math.min(w, 100 - mr.xPct),
                                      });
                                    }}
                                  />
                                </label>
                                <label style={{ fontSize: 11, color: "#555", display: "flex", alignItems: "center", gap: 4 }}>
                                  高さ（%）
                                  <input
                                    type="range"
                                    min={5}
                                    max={100}
                                    step={1}
                                    value={Math.round(mr.hPct)}
                                    onChange={(e) => {
                                      const h = Math.max(5, Math.min(100, parseInt(e.target.value, 10) || 5));
                                      patchMosaicRegion(pi, rid, {
                                        hPct: Math.min(h, 100 - mr.yPct),
                                      });
                                    }}
                                  />
                                </label>
                              </div>
                            );
                          })()}
                        </div>
                      ) : compositeEnabled && compositeMode === "blackMaskWithBrand" ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
                          <div style={{ fontSize: 10, color: "#64748b", lineHeight: 1.45 }}>
                            黒矩形の中央に「gegenpress app」。ドラッグ移動・右下でリサイズ。サイズを変えても文字は中央のままです。
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                            {(segmentBrandMaskRegions[pi] ?? []).map((reg, idx) => {
                              const activeId =
                                segmentBrandMaskSelectedId[pi] ?? segmentBrandMaskRegions[pi]?.[0]?.id ?? null;
                              return (
                                <button
                                  key={reg.id}
                                  type="button"
                                  onClick={() => {
                                    setSegmentBrandMaskSelectedId((s) => {
                                      const a = [...s];
                                      while (a.length <= pi) a.push(null);
                                      a[pi] = reg.id;
                                      return a;
                                    });
                                  }}
                                  style={{
                                    padding: "2px 8px",
                                    fontSize: 10,
                                    borderRadius: 4,
                                    border: "1px solid #ccc",
                                    background: activeId === reg.id ? "#dbeafe" : "#fff",
                                  }}
                                >
                                  #{idx + 1}
                                </button>
                              );
                            })}
                            <button
                              type="button"
                              onClick={() => {
                                const d = defaultBrandMaskRegion();
                                setSegmentBrandMaskRegions((prev) => {
                                  const next = prev.map((r) => r.map((x) => ({ ...x })));
                                  while (next.length <= pi) next.push([]);
                                  next[pi] = [...(next[pi] ?? []), d];
                                  return next;
                                });
                                setSegmentBrandMaskSelectedId((s) => {
                                  const a = [...s];
                                  while (a.length <= pi) a.push(null);
                                  a[pi] = d.id;
                                  return a;
                                });
                              }}
                              style={{ padding: "2px 8px", fontSize: 10, borderRadius: 4, border: "1px solid #ccc" }}
                            >
                              ＋追加
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const row = [...(segmentBrandMaskRegions[pi] ?? [])];
                                const sid = (segmentBrandMaskSelectedId[pi] ?? row[0]?.id) ?? null;
                                if (!sid || row.length === 0) return;
                                const delIdx = row.findIndex((x) => x.id === sid);
                                if (delIdx < 0) return;
                                row.splice(delIdx, 1);
                                const newSel = row[0]?.id ?? null;
                                setSegmentBrandMaskRegions((prev) => {
                                  const next = prev.map((r) => r.map((x) => ({ ...x })));
                                  while (next.length <= pi) next.push([]);
                                  next[pi] = row;
                                  return next;
                                });
                                setSegmentBrandMaskSelectedId((s) => {
                                  const a = [...s];
                                  while (a.length <= pi) a.push(null);
                                  a[pi] = newSel;
                                  return a;
                                });
                              }}
                              style={{ padding: "2px 8px", fontSize: 10, borderRadius: 4, border: "1px solid #ccc" }}
                            >
                              選択を削除
                            </button>
                          </div>
                          {(() => {
                            const row = segmentBrandMaskRegions[pi] ?? [];
                            const rid = segmentBrandMaskSelectedId[pi] ?? row[0]?.id ?? null;
                            const br = row.find((x) => x.id === rid);
                            if (!br) return null;
                            return (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                                <label style={{ fontSize: 11, color: "#555", display: "flex", alignItems: "center", gap: 4 }}>
                                  黒の透明度
                                  <input
                                    type="range"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={br.opacity}
                                    onChange={(e) => {
                                      const v = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
                                      patchBrandMaskRegion(pi, rid, { opacity: v });
                                    }}
                                  />
                                </label>
                                <label style={{ fontSize: 11, color: "#555", display: "flex", alignItems: "center", gap: 4 }}>
                                  幅（%）
                                  <input
                                    type="range"
                                    min={5}
                                    max={100}
                                    step={1}
                                    value={Math.round(br.wPct)}
                                    onChange={(e) => {
                                      const w = Math.max(5, Math.min(100, parseInt(e.target.value, 10) || 5));
                                      patchBrandMaskRegion(pi, rid, {
                                        wPct: Math.min(w, 100 - br.xPct),
                                      });
                                    }}
                                  />
                                </label>
                                <label style={{ fontSize: 11, color: "#555", display: "flex", alignItems: "center", gap: 4 }}>
                                  高さ（%）
                                  <input
                                    type="range"
                                    min={5}
                                    max={100}
                                    step={1}
                                    value={Math.round(br.hPct)}
                                    onChange={(e) => {
                                      const h = Math.max(5, Math.min(100, parseInt(e.target.value, 10) || 5));
                                      patchBrandMaskRegion(pi, rid, {
                                        hPct: Math.min(h, 100 - br.yPct),
                                      });
                                    }}
                                  />
                                </label>
                              </div>
                            );
                          })()}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div
                    style={{
                      margin: "0 auto 10px",
                      width: "100%",
                      maxWidth: 440,
                      padding: 10,
                      border: "1px solid #fde68a",
                      borderRadius: 6,
                      background: "#fffbeb",
                      boxSizing: "border-box",
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#92400e", marginBottom: 6 }}>
                      名前隠し設定（固定位置・簡易版）
                    </div>
                    <div style={{ fontSize: 10, color: "#78716c", lineHeight: 1.45, marginBottom: 8 }}>
                      名前表示位置がほぼ固定のレイアウト向けです。指定した矩形に常に隠しを重ねます。辞書は保存されます（OCRによる照合は今後の拡張用）。
                    </div>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 8,
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={nameMaskPreset.enabled}
                        onChange={(e) =>
                          setNameMaskPreset((prev) => ({ ...prev, enabled: e.target.checked }))
                        }
                      />
                      自動隠しを有効にする
                    </label>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                        marginBottom: 8,
                        alignItems: "center",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setNameMaskPreset((prev) => ({ ...prev, applyScope: "all" }))}
                        style={{
                          padding: "4px 10px",
                          fontSize: 11,
                          borderRadius: 4,
                          border: "1px solid #d6d3d1",
                          background: nameMaskPreset.applyScope === "all" ? "#fde68a" : "#fff",
                        }}
                      >
                        全区間に適用
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setNameMaskPreset((prev) => ({
                            ...prev,
                            applyScope: "segment",
                            applySegmentIndex: pi,
                          }))
                        }
                        style={{
                          padding: "4px 10px",
                          fontSize: 11,
                          borderRadius: 4,
                          border: "1px solid #d6d3d1",
                          background: nameMaskPreset.applyScope === "segment" ? "#fde68a" : "#fff",
                        }}
                      >
                        この区間のみ
                      </button>
                      <span style={{ fontSize: 10, color: "#78716c" }}>
                        {nameMaskPreset.applyScope === "segment"
                          ? `対象: タイムライン ${nameMaskPreset.applySegmentIndex + 1} 行目`
                          : "対象: 全タイムライン行"}
                      </span>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 8,
                        alignItems: "center",
                        marginBottom: 8,
                      }}
                    >
                      <span style={{ fontSize: 11, color: "#444" }}>隠し方</span>
                      <select
                        value={nameMaskPreset.defaultMode}
                        onChange={(e) => {
                          const v = e.target.value as NameMaskPreset["defaultMode"];
                          setNameMaskPreset((prev) => ({ ...prev, defaultMode: v }));
                        }}
                        style={{ padding: "3px 6px", fontSize: 11, minWidth: 200 }}
                      >
                        <option value="mosaic">mosaic（ピクセル）</option>
                        <option value="blackMaskWithBrand">黒塗り＋gegenpress app</option>
                      </select>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        marginBottom: 8,
                        fontSize: 11,
                        color: "#444",
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: 10, color: "#92400e" }}>名前欄矩形（ステージ％）</span>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        左 X
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(nameMaskPreset.nameArea.xPct)}
                          onChange={(e) => {
                            const x = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
                            setNameMaskPreset((prev) => ({
                              ...prev,
                              nameArea: {
                                ...prev.nameArea,
                                xPct: x,
                                wPct: Math.min(prev.nameArea.wPct, 100 - x),
                              },
                            }));
                          }}
                        />
                        {Math.round(nameMaskPreset.nameArea.xPct)}%
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        上 Y
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={Math.round(nameMaskPreset.nameArea.yPct)}
                          onChange={(e) => {
                            const y = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
                            setNameMaskPreset((prev) => ({
                              ...prev,
                              nameArea: {
                                ...prev.nameArea,
                                yPct: y,
                                hPct: Math.min(prev.nameArea.hPct, 100 - y),
                              },
                            }));
                          }}
                        />
                        {Math.round(nameMaskPreset.nameArea.yPct)}%
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        幅
                        <input
                          type="range"
                          min={5}
                          max={100}
                          value={Math.round(nameMaskPreset.nameArea.wPct)}
                          onChange={(e) => {
                            const w = Math.max(5, Math.min(100, parseInt(e.target.value, 10) || 5));
                            setNameMaskPreset((prev) => ({
                              ...prev,
                              nameArea: {
                                ...prev.nameArea,
                                wPct: Math.min(w, 100 - prev.nameArea.xPct),
                              },
                            }));
                          }}
                        />
                        {Math.round(nameMaskPreset.nameArea.wPct)}%
                      </label>
                      <label style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        高さ
                        <input
                          type="range"
                          min={5}
                          max={100}
                          value={Math.round(nameMaskPreset.nameArea.hPct)}
                          onChange={(e) => {
                            const h = Math.max(5, Math.min(100, parseInt(e.target.value, 10) || 5));
                            setNameMaskPreset((prev) => ({
                              ...prev,
                              nameArea: {
                                ...prev.nameArea,
                                hPct: Math.min(h, 100 - prev.nameArea.yPct),
                              },
                            }));
                          }}
                        />
                        {Math.round(nameMaskPreset.nameArea.hPct)}%
                      </label>
                    </div>
                    {nameMaskPreset.defaultMode === "mosaic" ? (
                      <div
                        style={{
                          display: "flex",
                          flexWrap: "wrap",
                          gap: 10,
                          alignItems: "center",
                          marginBottom: 8,
                          fontSize: 11,
                        }}
                      >
                        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          モザイク透明度
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={nameMaskPreset.mosaicOpacity}
                            onChange={(e) => {
                              const v = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
                              setNameMaskPreset((prev) => ({ ...prev, mosaicOpacity: v }));
                            }}
                          />
                        </label>
                        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          ブロック
                          <input
                            type="range"
                            min={5}
                            max={40}
                            step={1}
                            value={nameMaskPreset.mosaicPixelSize}
                            onChange={(e) => {
                              const v = Math.max(5, Math.min(40, parseInt(e.target.value, 10) || 14));
                              setNameMaskPreset((prev) => ({ ...prev, mosaicPixelSize: v }));
                            }}
                          />
                        </label>
                      </div>
                    ) : (
                      <div style={{ marginBottom: 8, fontSize: 11 }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          黒の透明度
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={nameMaskPreset.brandOpacity}
                            onChange={(e) => {
                              const v = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
                              setNameMaskPreset((prev) => ({ ...prev, brandOpacity: v }));
                            }}
                          />
                        </label>
                      </div>
                    )}
                    <div style={{ fontSize: 10, fontWeight: 600, color: "#92400e", marginBottom: 4 }}>
                      登録済み名前（保存・将来の自動照合用）
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                      <input
                        type="text"
                        value={nameRuleDraft}
                        onChange={(e) => setNameRuleDraft(e.target.value)}
                        placeholder="例: たろう"
                        style={{
                          flex: "1 1 140px",
                          minWidth: 120,
                          padding: "4px 8px",
                          fontSize: 12,
                          borderRadius: 4,
                          border: "1px solid #d6d3d1",
                          boxSizing: "border-box",
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const name = nameRuleDraft.trim();
                          if (!name) return;
                          setNameMaskPreset((prev) => ({
                            ...prev,
                            rules: [
                              ...prev.rules,
                              { id: newPhraseQueueId(), name, mode: prev.defaultMode },
                            ],
                          }));
                          setNameRuleDraft("");
                        }}
                        style={{
                          padding: "4px 10px",
                          fontSize: 11,
                          borderRadius: 4,
                          border: "1px solid #d6d3d1",
                          background: "#fff",
                        }}
                      >
                        追加
                      </button>
                    </div>
                    {nameMaskPreset.rules.length === 0 ? (
                      <div style={{ fontSize: 10, color: "#a8a29e" }}>未登録</div>
                    ) : (
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 18,
                          fontSize: 11,
                          color: "#444",
                          maxHeight: 120,
                          overflow: "auto",
                        }}
                      >
                        {nameMaskPreset.rules.map((r) => (
                          <li key={r.id} style={{ marginBottom: 4 }}>
                            <span style={{ marginRight: 6 }}>{r.name}</span>
                            <span style={{ fontSize: 10, color: "#78716c" }}>
                              ({r.mode === "mosaic" ? "mosaic" : "黒塗り"})
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setNameMaskPreset((prev) => ({
                                  ...prev,
                                  rules: prev.rules.filter((x) => x.id !== r.id),
                                }))
                              }
                              style={{
                                marginLeft: 8,
                                padding: "0 6px",
                                fontSize: 10,
                                borderRadius: 3,
                                border: "1px solid #fca5a5",
                                background: "#fff",
                                color: "#b91c1c",
                              }}
                            >
                              削除
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div
                    style={{
                      margin: "0 auto 10px",
                      width: "100%",
                      maxWidth: 440,
                      padding: 10,
                      border: "1px solid #c5cae9",
                      borderRadius: 6,
                      background: "#f3f8ff",
                      boxSizing: "border-box",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 8,
                        flexWrap: "wrap",
                        marginBottom: 8,
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#334155" }}>
                        {t("segmentLyricsScreenTitle")}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          const n = timelineSegments.length;
                          if (n === 0) return;
                          const font = clampLyricsFontSize(
                            segmentLyricsFontSize[pi] ?? DEFAULT_LYRICS_FONT_SIZE
                          );
                          const color = normalizeLyricsColorHex(segmentLyricsColor[pi] ?? "#ffffff");
                          const filt = parseSegmentScreenFilter(segmentScreenFilters[pi] ?? "normal");
                          setSegmentLyricsFontSize(Array.from({ length: n }, () => font));
                          setSegmentLyricsColor(Array.from({ length: n }, () => color));
                          setSegmentScreenFilters(Array.from({ length: n }, () => filt));
                        }}
                        disabled={timelineSegments.length === 0}
                        title={t("applyAllSegmentsTitle")}
                        style={{
                          flexShrink: 0,
                          minHeight: 36,
                          padding: "6px 12px",
                          fontSize: 12,
                          fontWeight: 600,
                          color: "#fff",
                          background: timelineSegments.length === 0 ? "#94a3b8" : "#2563eb",
                          border: "none",
                          borderRadius: 8,
                          cursor: timelineSegments.length === 0 ? "not-allowed" : "pointer",
                        }}
                      >
                        {t("applyAllSegments")}
                      </button>
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <label style={{ fontSize: 11, color: "#475569", display: "block", marginBottom: 4 }}>
                        {t("fontSize")}（{clampLyricsFontSize(segmentLyricsFontSize[pi] ?? DEFAULT_LYRICS_FONT_SIZE)}px）
                      </label>
                      <input
                        type="range"
                        min={LYRICS_FONT_SIZE_MIN}
                        max={LYRICS_FONT_SIZE_MAX}
                        step={1}
                        value={clampLyricsFontSize(segmentLyricsFontSize[pi] ?? DEFAULT_LYRICS_FONT_SIZE)}
                        onChange={(e) => {
                          const v = clampLyricsFontSize(parseInt(e.target.value, 10) || DEFAULT_LYRICS_FONT_SIZE);
                          setSegmentLyricsFontSize((prev) => {
                            const arr = [...prev];
                            while (arr.length <= pi) arr.push(DEFAULT_LYRICS_FONT_SIZE);
                            arr[pi] = v;
                            return arr;
                          });
                        }}
                        style={{ width: "100%", maxWidth: 360 }}
                      />
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <span style={{ fontSize: 11, color: "#475569", display: "block", marginBottom: 6 }}>{t("textColor")}</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                        {LYRICS_COLOR_PRESETS.map((p) => {
                          const active =
                            normalizeLyricsColorHex(segmentLyricsColor[pi] ?? "#ffffff") === p.value.toLowerCase();
                          return (
                            <button
                              key={p.value}
                              type="button"
                              title={p.label}
                              onClick={() => {
                                setSegmentLyricsColor((prev) => {
                                  const arr = [...prev];
                                  while (arr.length <= pi) arr.push("#ffffff");
                                  arr[pi] = p.value;
                                  return arr;
                                });
                              }}
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 6,
                                border: active ? "2px solid #1565c0" : "1px solid #ccc",
                                background: p.value,
                                cursor: "pointer",
                                padding: 0,
                                boxSizing: "border-box",
                              }}
                            />
                          );
                        })}
                        <input
                          type="color"
                          aria-label={t("textColorCustomAria")}
                          value={normalizeLyricsColorHex(segmentLyricsColor[pi] ?? "#ffffff")}
                          onChange={(e) => {
                            const hex = normalizeLyricsColorHex(e.target.value);
                            setSegmentLyricsColor((prev) => {
                              const arr = [...prev];
                              while (arr.length <= pi) arr.push("#ffffff");
                              arr[pi] = hex;
                              return arr;
                            });
                          }}
                          style={{ width: 36, height: 28, padding: 0, border: "1px solid #ccc", borderRadius: 4, cursor: "pointer" }}
                        />
                      </div>
                    </div>
                    <div>
                      <label style={{ fontSize: 11, color: "#475569", display: "block", marginBottom: 4 }}>
                        {t("screenFilterWithComposite")}
                      </label>
                      <select
                        value={segmentScreenFilters[pi] ?? "normal"}
                        onChange={(e) => {
                          const v = parseSegmentScreenFilter(e.target.value);
                          setSegmentScreenFilters((prev) => {
                            const arr = [...prev];
                            while (arr.length <= pi) arr.push("normal");
                            arr[pi] = v;
                            return arr;
                          });
                        }}
                        style={{ width: "100%", maxWidth: 360, padding: "6px 8px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc" }}
                      >
                        {SEGMENT_SCREEN_FILTER_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {screenFilterLabel(o.value)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {showPickerPanel ? (
                    <div
                      style={{
                        padding: 14,
                        background: "#f0f0f0",
                        borderRadius: 8,
                        color: "#333",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          marginBottom: 10,
                          flexWrap: "wrap",
                          alignItems: "center",
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setModalImagePickerTab("suggested")}
                          style={{
                            padding: "6px 12px",
                            background: modalImagePickerTab === "suggested" ? "#e3f2fd" : "#fff",
                            border: "1px solid #ccc",
                            borderRadius: 4,
                          }}
                        >
                          候補画像
                        </button>
                        <button
                          type="button"
                          onClick={() => setModalImagePickerTab("uploaded")}
                          style={{
                            padding: "6px 12px",
                            background: modalImagePickerTab === "uploaded" ? "#e3f2fd" : "#fff",
                            border: "1px solid #ccc",
                            borderRadius: 4,
                          }}
                        >
                          自分の画像
                        </button>
                        <button
                          type="button"
                          onClick={() => setModalImagePickerTab("uploadedVideo")}
                          style={{
                            padding: "6px 12px",
                            background: modalImagePickerTab === "uploadedVideo" ? "#e3f2fd" : "#fff",
                            border: "1px solid #ccc",
                            borderRadius: 4,
                          }}
                        >
                          自分の動画
                        </button>
                        <span style={{ flex: 1, minWidth: 8 }} />
                        {hasVisualMedia ? (
                          <button
                            type="button"
                            onClick={() => setModalImagePickerOpen(false)}
                            style={{ padding: "4px 10px", fontSize: 12 }}
                          >
                            パネルを閉じる
                          </button>
                        ) : null}
                      </div>

                      {hasVisualMedia ? (
                        <div style={{ fontSize: 11, color: "#555", marginBottom: 8 }}>
                          選択中:{" "}
                          {effectiveMt === "video"
                            ? "自分の動画"
                            : kind === "uploaded"
                              ? "自分の画像"
                              : kind === "suggested"
                                ? "候補画像"
                                : "画像"}
                        </div>
                      ) : null}
                      {hasVisualMedia ? (
                        <div
                          style={{
                            marginBottom: 10,
                            padding: 10,
                            border: "1px solid #d6dce5",
                            borderRadius: 6,
                            background: "#fff",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: "#334155" }}>合成:</span>
                            <button
                              type="button"
                              onClick={() => {
                                setSegmentCompositeEnabled((prev) => {
                                  const arr = [...prev];
                                  while (arr.length <= pi) arr.push(false);
                                  arr[pi] = false;
                                  return arr;
                                });
                              }}
                              style={{
                                padding: "4px 10px",
                                fontSize: 12,
                                borderRadius: 4,
                                border: "1px solid #ccc",
                                background: compositeEnabled ? "#f0f0f0" : "#e0f2fe",
                              }}
                            >
                              {t("compositeNormal")}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const curMode = segmentCompositeModes[pi] ?? "none";
                                const nextMode: SegmentCompositeMode = curMode === "none" ? "mosaic" : curMode;
                                setSegmentCompositeEnabled((prev) => {
                                  const arr = [...prev];
                                  while (arr.length <= pi) arr.push(false);
                                  arr[pi] = true;
                                  return arr;
                                });
                                setSegmentCompositeModes((prev) => {
                                  const arr = [...prev];
                                  while (arr.length <= pi) arr.push("none");
                                  arr[pi] = nextMode;
                                  return arr;
                                });
                                if (nextMode === "mosaic") ensureMosaicRegionsForPi(pi);
                                else if (nextMode === "blackMaskWithBrand") ensureBrandMaskRegionsForPi(pi);
                              }}
                              style={{
                                padding: "4px 10px",
                                fontSize: 12,
                                borderRadius: 4,
                                border: "1px solid #ccc",
                                background: compositeEnabled ? "#e0f2fe" : "#f0f0f0",
                              }}
                            >
                              {t("useComposite")}
                            </button>
                          </div>
                          {compositeEnabled ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              <div style={{ fontSize: 11, color: "#64748b" }}>
                                {compositeMode === "mosaic"
                                  ? "プレビュー上の矩形をドラッグで移動、右下の白角でリサイズ。ピクセル化で隠します。"
                                  : compositeMode === "blackMaskWithBrand"
                                    ? "黒塗りの中央に「gegenpress app」。リサイズしても文字は中央です。"
                                    : null}
                              </div>
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                <label style={{ fontSize: 12, color: "#555" }}>パターン:</label>
                                <select
                                  value={compositeMode === "none" ? "mosaic" : compositeMode}
                                  onChange={(e) => {
                                    const v = e.target.value as SegmentCompositeMode;
                                    setSegmentCompositeModes((prev) => {
                                      const arr = [...prev];
                                      while (arr.length <= pi) arr.push("mosaic");
                                      arr[pi] = v;
                                      return arr;
                                    });
                                    if (v === "mosaic") ensureMosaicRegionsForPi(pi);
                                    else if (v === "blackMaskWithBrand") ensureBrandMaskRegionsForPi(pi);
                                  }}
                                  style={{ padding: "4px 8px", fontSize: 12, minWidth: 220 }}
                                >
                                  {COMPOSITE_MODE_OPTIONS.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                  ))}
                                </select>
                              </div>
                              {compositeMode === "mosaic" ? (
                                <>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                    {(segmentMosaicRegions[pi] ?? []).map((reg, idx) => {
                                      const activeId =
                                        segmentMosaicSelectedId[pi] ?? segmentMosaicRegions[pi]?.[0]?.id ?? null;
                                      return (
                                        <button
                                          key={reg.id}
                                          type="button"
                                          onClick={() => {
                                            setSegmentMosaicSelectedId((s) => {
                                              const a = [...s];
                                              while (a.length <= pi) a.push(null);
                                              a[pi] = reg.id;
                                              return a;
                                            });
                                          }}
                                          style={{
                                            padding: "4px 10px",
                                            fontSize: 12,
                                            borderRadius: 4,
                                            border: "1px solid #ccc",
                                            background: activeId === reg.id ? "#dbeafe" : "#fff",
                                          }}
                                        >
                                          モザイク #{idx + 1}
                                        </button>
                                      );
                                    })}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const d = defaultMosaicRegion();
                                        setSegmentMosaicRegions((prev) => {
                                          const next = prev.map((r) => r.map((x) => ({ ...x })));
                                          while (next.length <= pi) next.push([]);
                                          next[pi] = [...(next[pi] ?? []), d];
                                          return next;
                                        });
                                        setSegmentMosaicSelectedId((s) => {
                                          const a = [...s];
                                          while (a.length <= pi) a.push(null);
                                          a[pi] = d.id;
                                          return a;
                                        });
                                      }}
                                      style={{ padding: "4px 10px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc" }}
                                    >
                                      ＋矩形を追加
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const row = [...(segmentMosaicRegions[pi] ?? [])];
                                        const sid = (segmentMosaicSelectedId[pi] ?? row[0]?.id) ?? null;
                                        if (!sid || row.length === 0) return;
                                        const delIdx = row.findIndex((x) => x.id === sid);
                                        if (delIdx < 0) return;
                                        row.splice(delIdx, 1);
                                        const newSel = row[0]?.id ?? null;
                                        setSegmentMosaicRegions((prev) => {
                                          const next = prev.map((r) => r.map((x) => ({ ...x })));
                                          while (next.length <= pi) next.push([]);
                                          next[pi] = row;
                                          return next;
                                        });
                                        setSegmentMosaicSelectedId((s) => {
                                          const a = [...s];
                                          while (a.length <= pi) a.push(null);
                                          a[pi] = newSel;
                                          return a;
                                        });
                                      }}
                                      style={{ padding: "4px 10px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc" }}
                                    >
                                      選択を削除
                                    </button>
                                  </div>
                                  {(() => {
                                    const row = segmentMosaicRegions[pi] ?? [];
                                    const rid = segmentMosaicSelectedId[pi] ?? row[0]?.id ?? null;
                                    const mr = row.find((x) => x.id === rid);
                                    if (!mr) return null;
                                    return (
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
                                        <label style={{ fontSize: 12, color: "#555", display: "flex", alignItems: "center", gap: 6 }}>
                                          モザイクの透明度
                                          <input
                                            type="range"
                                            min={0}
                                            max={1}
                                            step={0.05}
                                            value={mr.opacity}
                                            onChange={(e) => {
                                              const v = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
                                              patchMosaicRegion(pi, rid, { opacity: v });
                                            }}
                                          />
                                          <span>{mr.opacity.toFixed(2)}</span>
                                        </label>
                                        <label style={{ fontSize: 12, color: "#555", display: "flex", alignItems: "center", gap: 6 }}>
                                          強度（ブロック 5〜40）
                                          <input
                                            type="range"
                                            min={5}
                                            max={40}
                                            step={1}
                                            value={mr.pixelSize}
                                            onChange={(e) => {
                                              const v = Math.max(5, Math.min(40, parseInt(e.target.value, 10) || 14));
                                              patchMosaicRegion(pi, rid, { pixelSize: v });
                                            }}
                                          />
                                          <span>{mr.pixelSize}</span>
                                        </label>
                                        <label style={{ fontSize: 12, color: "#555", display: "flex", alignItems: "center", gap: 6 }}>
                                          幅（%）
                                          <input
                                            type="range"
                                            min={5}
                                            max={100}
                                            step={1}
                                            value={Math.round(mr.wPct)}
                                            onChange={(e) => {
                                              const w = Math.max(5, Math.min(100, parseInt(e.target.value, 10) || 5));
                                              patchMosaicRegion(pi, rid, { wPct: Math.min(w, 100 - mr.xPct) });
                                            }}
                                          />
                                          <span>{Math.round(mr.wPct)}</span>
                                        </label>
                                        <label style={{ fontSize: 12, color: "#555", display: "flex", alignItems: "center", gap: 6 }}>
                                          高さ（%）
                                          <input
                                            type="range"
                                            min={5}
                                            max={100}
                                            step={1}
                                            value={Math.round(mr.hPct)}
                                            onChange={(e) => {
                                              const h = Math.max(5, Math.min(100, parseInt(e.target.value, 10) || 5));
                                              patchMosaicRegion(pi, rid, { hPct: Math.min(h, 100 - mr.yPct) });
                                            }}
                                          />
                                          <span>{Math.round(mr.hPct)}</span>
                                        </label>
                                      </div>
                                    );
                                  })()}
                                </>
                              ) : compositeMode === "blackMaskWithBrand" ? (
                                <>
                                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                                    {(segmentBrandMaskRegions[pi] ?? []).map((reg, idx) => {
                                      const activeId =
                                        segmentBrandMaskSelectedId[pi] ?? segmentBrandMaskRegions[pi]?.[0]?.id ?? null;
                                      return (
                                        <button
                                          key={reg.id}
                                          type="button"
                                          onClick={() => {
                                            setSegmentBrandMaskSelectedId((s) => {
                                              const a = [...s];
                                              while (a.length <= pi) a.push(null);
                                              a[pi] = reg.id;
                                              return a;
                                            });
                                          }}
                                          style={{
                                            padding: "4px 10px",
                                            fontSize: 12,
                                            borderRadius: 4,
                                            border: "1px solid #ccc",
                                            background: activeId === reg.id ? "#dbeafe" : "#fff",
                                          }}
                                        >
                                          黒塗り #{idx + 1}
                                        </button>
                                      );
                                    })}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const d = defaultBrandMaskRegion();
                                        setSegmentBrandMaskRegions((prev) => {
                                          const next = prev.map((r) => r.map((x) => ({ ...x })));
                                          while (next.length <= pi) next.push([]);
                                          next[pi] = [...(next[pi] ?? []), d];
                                          return next;
                                        });
                                        setSegmentBrandMaskSelectedId((s) => {
                                          const a = [...s];
                                          while (a.length <= pi) a.push(null);
                                          a[pi] = d.id;
                                          return a;
                                        });
                                      }}
                                      style={{ padding: "4px 10px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc" }}
                                    >
                                      ＋矩形を追加
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const row = [...(segmentBrandMaskRegions[pi] ?? [])];
                                        const sid = (segmentBrandMaskSelectedId[pi] ?? row[0]?.id) ?? null;
                                        if (!sid || row.length === 0) return;
                                        const delIdx = row.findIndex((x) => x.id === sid);
                                        if (delIdx < 0) return;
                                        row.splice(delIdx, 1);
                                        const newSel = row[0]?.id ?? null;
                                        setSegmentBrandMaskRegions((prev) => {
                                          const next = prev.map((r) => r.map((x) => ({ ...x })));
                                          while (next.length <= pi) next.push([]);
                                          next[pi] = row;
                                          return next;
                                        });
                                        setSegmentBrandMaskSelectedId((s) => {
                                          const a = [...s];
                                          while (a.length <= pi) a.push(null);
                                          a[pi] = newSel;
                                          return a;
                                        });
                                      }}
                                      style={{ padding: "4px 10px", fontSize: 12, borderRadius: 4, border: "1px solid #ccc" }}
                                    >
                                      選択を削除
                                    </button>
                                  </div>
                                  {(() => {
                                    const row = segmentBrandMaskRegions[pi] ?? [];
                                    const rid = segmentBrandMaskSelectedId[pi] ?? row[0]?.id ?? null;
                                    const br = row.find((x) => x.id === rid);
                                    if (!br) return null;
                                    return (
                                      <div style={{ display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center" }}>
                                        <label style={{ fontSize: 12, color: "#555", display: "flex", alignItems: "center", gap: 6 }}>
                                          黒の透明度
                                          <input
                                            type="range"
                                            min={0}
                                            max={1}
                                            step={0.05}
                                            value={br.opacity}
                                            onChange={(e) => {
                                              const v = Math.max(0, Math.min(1, parseFloat(e.target.value) || 0));
                                              patchBrandMaskRegion(pi, rid, { opacity: v });
                                            }}
                                          />
                                          <span>{br.opacity.toFixed(2)}</span>
                                        </label>
                                        <label style={{ fontSize: 12, color: "#555", display: "flex", alignItems: "center", gap: 6 }}>
                                          幅（%）
                                          <input
                                            type="range"
                                            min={5}
                                            max={100}
                                            step={1}
                                            value={Math.round(br.wPct)}
                                            onChange={(e) => {
                                              const w = Math.max(5, Math.min(100, parseInt(e.target.value, 10) || 5));
                                              patchBrandMaskRegion(pi, rid, { wPct: Math.min(w, 100 - br.xPct) });
                                            }}
                                          />
                                          <span>{Math.round(br.wPct)}</span>
                                        </label>
                                        <label style={{ fontSize: 12, color: "#555", display: "flex", alignItems: "center", gap: 6 }}>
                                          高さ（%）
                                          <input
                                            type="range"
                                            min={5}
                                            max={100}
                                            step={1}
                                            value={Math.round(br.hPct)}
                                            onChange={(e) => {
                                              const h = Math.max(5, Math.min(100, parseInt(e.target.value, 10) || 5));
                                              patchBrandMaskRegion(pi, rid, { hPct: Math.min(h, 100 - br.yPct) });
                                            }}
                                          />
                                          <span>{Math.round(br.hPct)}</span>
                                        </label>
                                      </div>
                                    );
                                  })()}
                                </>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}

                      {modalImagePickerTab === "suggested" ? (
                        <>
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 8,
                              alignItems: "center",
                              marginBottom: 10,
                            }}
                          >
                            <div
                              style={{
                                position: "relative",
                                flex: "1 1 180px",
                                minWidth: 140,
                              }}
                            >
                              <input
                                ref={manualImageSearchInputRef}
                                type="text"
                                value={manualImageSearchInput}
                                onChange={(e) => setManualImageSearchInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    handleModalSuggestSearchSubmit();
                                  }
                                }}
                                placeholder="検索語（例: urban city japanese）"
                                disabled={isSearchingImages}
                                style={{
                                  width: "100%",
                                  padding: "6px 10px",
                                  paddingRight: manualImageSearchInput ? 26 : 10,
                                  fontSize: 13,
                                  borderRadius: 4,
                                  border: "1px solid #ccc",
                                  boxSizing: "border-box",
                                }}
                                title="入力中は検索しません。「検索」または Enter で取得します"
                              />
                              {manualImageSearchInput ? (
                                <button
                                  type="button"
                                  aria-label="検索語をクリア"
                                  disabled={isSearchingImages}
                                  onClick={() => {
                                    setManualImageSearchInput("");
                                    queueMicrotask(() =>
                                      manualImageSearchInputRef.current?.focus(),
                                    );
                                  }}
                                  style={{
                                    position: "absolute",
                                    right: 4,
                                    top: "50%",
                                    transform: "translateY(-50%)",
                                    width: 22,
                                    height: 22,
                                    padding: 0,
                                    margin: 0,
                                    lineHeight: 1,
                                    fontSize: 16,
                                    color: "#666",
                                    background: "transparent",
                                    border: "none",
                                    borderRadius: 2,
                                    cursor: isSearchingImages ? "default" : "pointer",
                                  }}
                                >
                                  ×
                                </button>
                              ) : null}
                            </div>
                            <button
                              type="button"
                              onClick={handleModalSuggestSearchSubmit}
                              disabled={isSearchingImages}
                              style={{ padding: "6px 12px", fontSize: 12 }}
                            >
                              検索
                            </button>
                            <button
                              type="button"
                              onClick={handleModalSuggestSearchSubmit}
                              disabled={isSearchingImages}
                              style={{ padding: "6px 12px", fontSize: 12 }}
                            >
                              候補を再検索
                            </button>
                          </div>
                          {imageSearchError ? (
                            <div
                              style={{
                                fontSize: 12,
                                color: "#c62828",
                                marginBottom: 8,
                                padding: "4px 6px",
                                background: "#ffebee",
                                borderRadius: 4,
                              }}
                            >
                              {imageSearchError}
                            </div>
                          ) : null}
                          <div
                            className="modal-suggest-image-scroll"
                            aria-label={
                              committedImageSearchQuery
                                ? `画像候補（確定検索語: ${committedImageSearchQuery.slice(0, 80)}）`
                                : "画像候補（未検索）"
                            }
                            style={{
                              minHeight: MODAL_SUGGEST_LIST_MIN_HEIGHT,
                              maxHeight: MODAL_SUGGEST_LIST_MAX_HEIGHT,
                              overflowY: "auto",
                              overflowX: "hidden",
                              overscrollBehavior: "contain",
                              padding: "10px 8px 12px 10px",
                              marginBottom: 4,
                              border: "1px solid #e0e0e0",
                              borderRadius: 6,
                              background: "#fafafa",
                              boxSizing: "border-box",
                            }}
                          >
                          {isSearchingImages && imageSearchCandidates.length > 0 ? (
                            <div
                              style={{
                                textAlign: "center",
                                fontSize: 12,
                                padding: "6px 8px",
                                marginBottom: 8,
                                color: "#555",
                                background: "#eee",
                                borderRadius: 4,
                              }}
                            >
                              検索中…（前回の候補を表示しています）
                            </div>
                          ) : null}
                          {isSearchingImages &&
                          imageSearchCandidates.length === 0 &&
                          modalSuggestDisplayCandidates.length === 0 ? (
                            <div style={{ textAlign: "center", fontSize: 13, padding: 12, color: "#666" }}>
                              候補画像を検索中...
                            </div>
                          ) : null}
                          {!isSearchingImages &&
                          modalSuggestDisplayCandidates.length === 0 &&
                          !hasRequestedImageCandidates ? (
                            <div style={{ textAlign: "center", fontSize: 13, padding: 12, color: "#666" }}>
                              「検索」または Enter で候補を表示します。
                              <br />
                              <span style={{ fontSize: 12, color: "#888" }}>
                                入力中は通信しません（テザリング向け）。
                              </span>
                            </div>
                          ) : null}
                          {!isSearchingImages &&
                          modalSuggestDisplayCandidates.length === 0 &&
                          hasRequestedImageCandidates ? (
                            <div style={{ textAlign: "center", fontSize: 13, padding: 12, color: "#666" }}>
                              該当する画像がありません
                            </div>
                          ) : null}
                          {modalSuggestDisplayCandidates.length > 0 ? (
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 12,
                                rowGap: 12,
                                justifyContent: "center",
                                alignItems: "flex-start",
                                paddingBottom: 4,
                              }}
                            >
                              {modalSuggestDisplayCandidates.map((img) => (
                                <ModalSuggestImageTile
                                  key={searchImageResultStableKey(img)}
                                  img={img}
                                  selected={isModalSuggestImageSelected(curUrlTrim, img)}
                                  onSelect={() => {
                                    if (previewRowIndex == null) return;
                                    const full = img.imageUrl || img.previewUrl;
                                    const kind =
                                      img.id === LYRICS_IMAGE_HISTORY_RESULT_ID
                                        ? getLyricsImageHistory(
                                            normalizeLyricsForHistoryKey(
                                              segmentTexts[previewRowIndex] ?? ""
                                            )
                                          )?.sourceType ?? "suggested"
                                        : "suggested";
                                    setSegmentImage(previewRowIndex, full, kind, {
                                      lyricText: (segmentTexts[previewRowIndex] ?? "").trim(),
                                      searchKeywords:
                                        committedImageSearchQuery.trim() ||
                                        manualImageSearchInput.trim() ||
                                        previewModalAutoImageQuery,
                                      searchTags: img.tags,
                                      pixabayImageId: img.id > 0 ? img.id : undefined,
                                      apiRank: img.apiRank,
                                      boostScore: img.boostScore,
                                      boostReason: img.boostReason,
                                      imageUrl: full,
                                      previewUrl: img.previewUrl || img.imageUrl || full,
                                      pageUrl:
                                        img.id > 0
                                          ? `https://pixabay.com/photos/id-${img.id}/`
                                          : undefined,
                                      selectedAt: new Date().toISOString(),
                                    });
                                  }}
                                />
                              ))}
                            </div>
                          ) : null}
                          {!isSearchingImages &&
                          imageSearchCandidates.length > 0 &&
                          (hasMoreImageCandidates || imageSearchLoadingMore) ? (
                            <div
                              style={{
                                textAlign: "center",
                                paddingTop: 12,
                                paddingBottom: 4,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => void handleLoadMorePreviewSuggestImages()}
                                disabled={
                                  imageSearchLoadingMore ||
                                  !hasMoreImageCandidates ||
                                  isSearchingImages
                                }
                                style={{
                                  padding: "8px 16px",
                                  fontSize: 13,
                                  borderRadius: 6,
                                  border: "1px solid #bbb",
                                  background: "#fff",
                                  cursor:
                                    imageSearchLoadingMore || !hasMoreImageCandidates
                                      ? "default"
                                      : "pointer",
                                }}
                              >
                                {imageSearchLoadingMore
                                  ? "読み込み中…"
                                  : "さらに候補を見る"}
                              </button>
                            </div>
                          ) : null}
                          </div>
                        </>
                      ) : modalImagePickerTab === "uploaded" ? (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 10,
                            alignItems: "flex-start",
                          }}
                        >
                          <input
                            ref={modalSegmentImageFileInputRef}
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (!f) return;
                              const byExt = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif|tiff?|svg)$/i.test(
                                f.name
                              );
                              const ok = f.type.startsWith("image/") || byExt;
                              if (!ok) {
                                window.alert("画像ファイルを選んでください");
                                return;
                              }
                              setModalUploadPick((prev) => {
                                if (prev) URL.revokeObjectURL(prev.url);
                                return { file: f, url: URL.createObjectURL(f) };
                              });
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => modalSegmentImageFileInputRef.current?.click()}
                            style={{ padding: "6px 12px" }}
                          >
                            ファイルを選ぶ
                          </button>
                          {modalUploadPick ? (
                            <>
                              <img
                                src={modalUploadPick.url}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                style={{
                                  maxWidth: "100%",
                                  maxHeight: 220,
                                  borderRadius: 6,
                                  border: "1px solid #ccc",
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (previewRowIndex == null) return;
                                  offerLocalUploadHintThen(() => {
                                    setSegmentImage(previewRowIndex, modalUploadPick.file, "uploaded");
                                    clearModalUploadPick();
                                  });
                                }}
                                style={{ padding: "6px 14px", fontWeight: 600 }}
                              >
                                この区間の背景に設定
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (previewRowIndex == null) return;
                                  offerLocalUploadHintThen(() => {
                                    setSegmentCompositeEnabled((prev) => {
                                      const arr = [...prev];
                                      while (arr.length <= previewRowIndex) arr.push(false);
                                      arr[previewRowIndex] = true;
                                      return arr;
                                    });
                                    setSegmentCompositeModes((prev) => {
                                      const arr = [...prev];
                                      while (arr.length <= previewRowIndex) arr.push("none");
                                      arr[previewRowIndex] = "mosaic";
                                      return arr;
                                    });
                                    ensureMosaicRegionsForPi(previewRowIndex);
                                    clearModalUploadPick();
                                  });
                                }}
                                style={{ padding: "6px 14px", fontWeight: 600 }}
                              >
                                ミニ合成（モザイク）をオン
                              </button>
                            </>
                          ) : null}
                          <p style={{ fontSize: 11, color: "#666", margin: 0 }}>
                            スマホの写真・ギャラリーから選べます（画像形式。透過PNGはブラウザ表示どおり反映されます）
                          </p>
                        </div>
                      ) : (
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 10,
                            alignItems: "flex-start",
                          }}
                        >
                          <div
                            style={{
                              width: "100%",
                              maxWidth: 420,
                              padding: "10px 12px",
                              background: "#f5f5f5",
                              borderRadius: 6,
                              border: "1px solid #ddd",
                              fontSize: 12,
                              color: "#333",
                              lineHeight: 1.55,
                              boxSizing: "border-box",
                            }}
                          >
                            <div style={{ fontWeight: 700, marginBottom: 6, color: "#222" }}>
                              アップロード条件
                            </div>
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                              <li>対応形式: MP4 / WebM</li>
                              <li>最大容量: 20MB</li>
                              <li>推奨長さ: 15秒以内</li>
                              <li>プレビュー・区間再生では映像に加え音声も再生されます</li>
                            </ul>
                          </div>
                          <input
                            ref={modalSegmentVideoFileInputRef}
                            type="file"
                            accept="video/mp4,video/webm,.mp4,.webm"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              e.target.value = "";
                              if (!f) return;
                              const v = validateSegmentUploadVideoFile(f);
                              if (!v.ok) {
                                setModalVideoUploadError(v.message);
                                return;
                              }
                              setModalVideoUploadError(null);
                              setModalVideoPick((prev) => {
                                if (prev) URL.revokeObjectURL(prev.url);
                                return { file: f, url: URL.createObjectURL(f) };
                              });
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setModalVideoUploadError(null);
                              modalSegmentVideoFileInputRef.current?.click();
                            }}
                            style={{ padding: "6px 12px" }}
                          >
                            動画ファイルを選ぶ
                          </button>
                          {modalVideoUploadError ? (
                            <div
                              role="alert"
                              style={{
                                fontSize: 13,
                                color: "#b71c1c",
                                fontWeight: 600,
                                maxWidth: 420,
                              }}
                            >
                              {modalVideoUploadError}
                            </div>
                          ) : null}
                          {modalVideoPick ? (
                            <>
                              <div style={{ fontSize: 12, color: "#444", marginBottom: 6 }}>
                                選択: <strong>{modalVideoPick.file.name}</strong>
                              </div>
                              {!modalVideoPreviewVisible ? (
                                <button
                                  type="button"
                                  onClick={() => setModalVideoPreviewVisible(true)}
                                  style={{ padding: "8px 14px", marginBottom: 8 }}
                                >
                                  プレビューを表示（動画を読み込みます）
                                </button>
                              ) : (
                                <video
                                  key={modalVideoPick.url}
                                  src={modalVideoPick.url}
                                  preload="metadata"
                                  playsInline
                                  controls
                                  style={{
                                    maxWidth: "100%",
                                    maxHeight: 220,
                                    borderRadius: 6,
                                    border: "1px solid #ccc",
                                    background: "#000",
                                  }}
                                />
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  if (previewRowIndex == null) return;
                                  const v = validateSegmentUploadVideoFile(modalVideoPick.file);
                                  if (!v.ok) {
                                    setModalVideoUploadError(v.message);
                                    return;
                                  }
                                  setModalVideoUploadError(null);
                                  setSegmentVideo(previewRowIndex, modalVideoPick.file);
                                  clearModalVideoPick();
                                }}
                                style={{ padding: "6px 14px", fontWeight: 600 }}
                              >
                                この区間の背景に設定
                              </button>
                            </>
                          ) : null}
                          <p style={{ fontSize: 11, color: "#666", margin: 0 }}>
                            一覧では動画を読み込みません。プレビューは「プレビューを表示」押下時のみです。
                          </p>
                        </div>
                      )}

                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          marginTop: 14,
                          flexWrap: "wrap",
                          borderTop: "1px solid #ddd",
                          paddingTop: 12,
                        }}
                      >
                        <button
                          type="button"
                          disabled={!hasVisualMedia}
                          onClick={() => {
                            if (previewRowIndex == null) return;
                            clearSegmentVisualMedia(previewRowIndex);
                            clearModalUploadPick();
                            clearModalVideoPick();
                          }}
                          style={{ padding: "4px 12px", opacity: hasVisualMedia ? 1 : 0.45 }}
                        >
                          素材を外す（画像・動画）
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })()}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#555" }}>歌詞（この区間の画面上に表示）</label>
              <textarea value={segmentTexts[previewRowIndex!] ?? ""} onChange={(e) => setSegmentText(previewRowIndex!, e.target.value)} placeholder="歌詞を入力（フレーズキューから反映も可）" rows={2} style={{ width: "100%", boxSizing: "border-box", padding: 8, fontSize: 14, borderRadius: 4, border: "1px solid #ddd" }} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 12, color: "#555" }}>表示:</span>
              <span style={{ fontSize: 11, color: "#888" }}>歌詞はドラッグで移動できます</span>
              <button
                type="button"
                onClick={() => {
                  const idx = previewRowIndex!;
                  setSegmentDisplayModes((prev) => {
                    const arr = [...prev];
                    while (arr.length <= idx) arr.push(1);
                    arr[idx] = 1;
                    return arr;
                  });
                }}
                style={{ padding: "4px 10px", background: (segmentDisplayModes[previewRowIndex!] ?? 1) === 1 ? "#e0f0ff" : "#f0f0f0", border: "1px solid #ccc", borderRadius: 4 }}
              >
                1行
              </button>
              <button
                type="button"
                onClick={() => {
                  const idx = previewRowIndex!;
                  setSegmentDisplayModes((prev) => {
                    const arr = [...prev];
                    while (arr.length <= idx) arr.push(1);
                    arr[idx] = 2;
                    return arr;
                  });
                }}
                style={{ padding: "4px 10px", background: (segmentDisplayModes[previewRowIndex!] ?? 1) === 2 ? "#e0f0ff" : "#f0f0f0", border: "1px solid #ccc", borderRadius: 4 }}
              >
                2行
              </button>
              <button
                type="button"
                onClick={() => {
                  const idx = previewRowIndex!;
                  setSegmentDisplayModes((prev) => {
                    const arr = [...prev];
                    while (arr.length <= idx) arr.push(1);
                    arr[idx] = "vRight";
                    return arr;
                  });
                }}
                style={{ padding: "4px 10px", background: (segmentDisplayModes[previewRowIndex!] ?? 1) === "vRight" ? "#e0f0ff" : "#f0f0f0", border: "1px solid #ccc", borderRadius: 4 }}
                title="画面右・縦書き（簡易）"
              >
                縦右
              </button>
              <button
                type="button"
                onClick={() => {
                  const idx = previewRowIndex!;
                  setSegmentDisplayModes((prev) => {
                    const arr = [...prev];
                    while (arr.length <= idx) arr.push(1);
                    arr[idx] = "vLeft";
                    return arr;
                  });
                }}
                style={{ padding: "4px 10px", background: (segmentDisplayModes[previewRowIndex!] ?? 1) === "vLeft" ? "#e0f0ff" : "#f0f0f0", border: "1px solid #ccc", borderRadius: 4 }}
                title="画面左・縦書き（簡易）"
              >
                縦左
              </button>
              {(segmentDisplayModes[previewRowIndex!] ?? 1) === 2 && (
                <label style={{ fontSize: 12, color: "#555", display: "flex", alignItems: "center", gap: 4 }}>
                  改行位置:
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, (segmentTexts[previewRowIndex!] ?? "").length)}
                    value={segmentLineBreakAt[previewRowIndex!] ?? 0}
                    onChange={(e) => {
                      const idx = previewRowIndex!;
                      const v = Math.max(0, parseInt(e.target.value, 10) || 0);
                      setSegmentLineBreakAt((prev) => {
                        const arr = [...prev];
                        while (arr.length <= idx) arr.push(0);
                        arr[idx] = v;
                        return arr;
                      });
                    }}
                    style={{ width: 56, padding: "2px 4px" }}
                    title="0=自動。2行時、ここで区切ります"
                  />
                </label>
              )}
              <button type="button" onClick={() => { if (phraseQueue.length === 0) return; setOpenPhraseQueueInModal(previewRowIndex!); }} disabled={phraseQueue.length === 0} title="この区間の横にフレーズキューを表示（スクロールなし）" style={{ padding: "4px 10px", fontSize: 12 }}>このフレーズをフレーズキューで開く</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <label style={{ fontSize: 12, color: "#555" }}>演出(transition):</label>
              <select value={segmentAnims[previewRowIndex!] ?? "none"} onChange={(e) => setSegmentAnim(previewRowIndex!, e.target.value)} style={{ padding: "4px 8px", minWidth: 100 }}>
                {ANIM_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
              <button type="button" onClick={() => setPreviewAnimKey((k) => k + 1)} style={{ padding: "4px 10px", fontSize: 12 }} title="画像の演出アニメーションを再再生">演出を試す</button>
            </div>
            {(() => {
              const timelineApplyIndex = timelineRowForEditingPhrase ?? previewRowIndex!;
              const seg = timelineSegments[timelineApplyIndex];
              const isEditable = seg && (seg.type === "voice" || seg.type === "interlude");
              if (!isEditable || !seg) return null;
              const b = effectiveEditingSegmentBounds;
              const startSec = b?.startSec ?? seg.startSec;
              const endSec = b?.endSec ?? seg.endSec;
              const applyPreviewTimeInput = () => {
                const a = parseTimeToSec(previewTimeStartStr);
                const c = parseTimeToSec(previewTimeEndStr);
                if (a != null && c != null) applyCascadedSegmentTimes(timelineApplyIndex, a, c);
              };
              return (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: "#555", marginRight: 4 }}>時間:</span>
                  <input type="text" value={previewTimeStartStr} onChange={(e) => setPreviewTimeStartStr(e.target.value)} onBlur={applyPreviewTimeInput} onKeyDown={(e) => { if (e.key === "Enter") applyPreviewTimeInput(); }} placeholder="0:00.000" style={{ width: 82, padding: "2px 4px", fontSize: 12 }} title="開始（分:秒または秒）。反映で以下連動" />
                  <span style={{ color: "#999" }}>～</span>
                  <input type="text" value={previewTimeEndStr} onChange={(e) => setPreviewTimeEndStr(e.target.value)} onBlur={applyPreviewTimeInput} onKeyDown={(e) => { if (e.key === "Enter") applyPreviewTimeInput(); }} placeholder="0:00.000" style={{ width: 82, padding: "2px 4px", fontSize: 12 }} title="終了。反映で以下連動" />
                  <span style={{ width: 8 }} />
                  <button type="button" onClick={() => applyCascadedSegmentTimes(timelineApplyIndex, startSec, Math.max(startSec + 0.001, endSec - TIME_ADJUST_DELTA))} title="終了を0.5秒早く（以下連動）" style={{ padding: "2px 8px", fontSize: 11 }}>end -0.5s</button>
                  <button type="button" onClick={() => applyCascadedSegmentTimes(timelineApplyIndex, startSec, endSec + TIME_ADJUST_DELTA)} title="終了を0.5秒遅く（以下連動）" style={{ padding: "2px 8px", fontSize: 11 }}>end +0.5s</button>
                  <span style={{ width: 8, borderLeft: "1px solid #ddd", marginLeft: 4, alignSelf: "stretch" }} aria-hidden />
                  <div className="segment-footer">
                    <button type="button" disabled={previewRowIndex! <= 0} onClick={() => handlePreviewNavigate(-1)} title="前の区間へ" style={{ padding: "4px 12px", opacity: previewRowIndex! <= 0 ? 0.45 : 1 }}>前へ</button>
                    <button type="button" disabled={previewRowIndex! >= timelineSegments.length - 1} onClick={() => handlePreviewNavigate(1)} title="次の区間へ" style={{ padding: "4px 12px", opacity: previewRowIndex! >= timelineSegments.length - 1 ? 0.45 : 1 }}>次へ</button>
                    <button type="button" onClick={() => setPreviewRowIndex(null)} style={{ padding: "4px 12px" }}>閉じる</button>
                    <span className="segment-index">
                      #{previewRowIndex! + 1} / {timelineSegments.length}
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>
          {openPhraseQueueInModal === previewRowIndex && phraseQueue.length > 0 && (() => {
            return (
            <div style={{ width: 240, flexShrink: 0, borderLeft: "1px solid #e0e0e0", display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
              <div style={{ padding: "8px 12px", borderBottom: "1px solid #e8e8e8", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8, background: "#fafafa" }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#555" }}>フレーズキュー</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => handlePhraseClipboardCopy(e)}
                    disabled={phraseQueue.length === 0 || editingPhraseId == null}
                    title="選択中のフレーズ（テキスト・区間時間・演出・リモート画像/動画URL）を内部バッファにコピー"
                    style={{ padding: "2px 8px", fontSize: 11 }}
                  >
                    フレーズコピー
                  </button>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => handlePhraseClipboardPaste(e)}
                    disabled={phraseQueue.length === 0 || editingPhraseId == null || !phraseClipReady}
                    title="内部バッファの内容を選択中フレーズに貼り付け（先にフレーズコピー）"
                    style={{ padding: "2px 8px", fontSize: 11 }}
                  >
                    フレーズ貼付
                  </button>
                  <button type="button" onClick={() => setOpenPhraseQueueInModal(null)} style={{ padding: "2px 8px", fontSize: 12 }}>閉じる</button>
                </div>
                {phraseClipReady ? (
                  <div style={{ width: "100%", fontSize: 11, color: "#2e7d32", marginTop: 2 }}>
                    コピー済み: <span style={{ wordBreak: "break-all" }}>{phraseClipSummary}</span>
                  </div>
                ) : null}
              </div>
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 8 }}>
                <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>クリックで歌詞欄の末尾に追記 / ダブルクリックでも追記</div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {phraseQueue.map((item, i) => {
                    const isPhraseActive = item.id === editingPhraseId;
                    const modalPhraseRowStyle: CSSProperties = {
                      padding: "8px 10px",
                      background: isPhraseActive ? "#fff4e0" : "transparent",
                      borderBottom: "1px solid #eee",
                      boxShadow: isPhraseActive ? "inset 4px 0 0 #e89520" : "none",
                      cursor: "pointer",
                      fontSize: 13,
                      lineHeight: 1.4,
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 6,
                    };
                    return (
                    <li
                      key={item.id}
                      ref={(el) => {
                        if (el) modalPhraseItemRefs.current.set(item.id, el);
                        else modalPhraseItemRefs.current.delete(item.id);
                      }}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("button") != null) return;
                        e.stopPropagation();
                        e.preventDefault();
                        applyPhraseToLyricInput(item.text);
                      }}
                      onDoubleClick={(e) => {
                        if ((e.target as HTMLElement).closest("button") != null) return;
                        e.stopPropagation();
                        e.preventDefault();
                        const row = previewRowIndex;
                        if (row == null) return;
                        appendSegmentText(row, item.text);
                      }}
                      style={modalPhraseRowStyle}
                    >
                      <span style={{ color: "#888", flexShrink: 0 }}>{i + 1}.</span>
                      <span style={{ flex: 1, wordBreak: "break-all", minWidth: 0 }}>{item.text}</span>
                      <button
                        type="button"
                        onMouseDown={(ev) => {
                          ev.preventDefault();
                          ev.stopPropagation();
                        }}
                        onClick={(ev) => handlePhraseRowClipboardCopy(item.id, ev)}
                        title="この行を内部コピー（再生しない）"
                        style={{ padding: "0 4px", fontSize: 10, flexShrink: 0, lineHeight: 1.2 }}
                      >
                        行コピー
                      </button>
                    </li>
                    );
                  })}
                </ul>
              </div>
            </div>
            );
          })()}
        </div>
      </div>
      {localUploadHintPortal}
      </>,
      document.body
    );
  }

  return (
        <>
        <div
          style={{
            border: "1px solid #ddd",
            borderRadius: 8,
            padding: 12,
            maxWidth: 1280,
          }}
        >
      {/* 手動タイムライン作成 + 簡易タイムライン */}
      <div
        style={{
          marginBottom: 16,
          padding: 12,
          background: "#f0f8ff",
          borderRadius: 8,
          border: "1px solid #b8d4e8",
          display: "flex",
          gap: 16,
          alignItems: "stretch",
        }}
      >
        {/* 左: 手動モード操作 */}
          <div style={{ minWidth: 280, flexShrink: 0 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>{t("manualModeHeading")}</div>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onPlay?.();
                }}
                disabled={!onPlay}
                style={{ padding: "6px 12px" }}
              >
                {t("play")}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onPause?.();
                }}
                disabled={!onPause}
                style={{ padding: "6px 12px" }}
              >
                {t("stop")}
              </button>
              <span style={{ fontSize: 14, minWidth: 88 }}>{formatSecToMinSec(currentTimeSec)}</span>
              <button
                type="button"
                onClick={handleManualVoiceToggle}
                style={{
                  padding: "8px 20px",
                  fontWeight: 600,
                  background: manualRecordingState === "recordingVoice" ? "#1565c0" : "#2e7d32",
                  color: "#fff",
                  border: "none",
                  borderRadius: 4,
                }}
              >
                {manualRecordingState === "idle" ? t("voiceStart") : t("voiceStop")}
              </button>
              <button
                type="button"
                onClick={handleRemoveLastSegment}
                disabled={manualVoiceSegments.length === 0}
                style={{ padding: "6px 12px", color: "#c62828" }}
              >
                {t("deletePrevSegment")}
              </button>
              <button
                type="button"
                onClick={handleClearTimeline}
                disabled={manualVoiceSegments.length === 0}
                style={{ padding: "6px 12px", color: "#666" }}
                title={t("clearTimelineTitle")}
              >
                {t("clearTimeline")}
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#555", marginTop: 6 }}>
              {manualRecordingState === "idle" ? (
                <>今は<strong>声待ち</strong> — 「声開始」で区間の開始を記録。声停止～次の声開始は無音区間としてタイムラインに反映されます。</>
              ) : (
                <>今は<strong>声区間記録中</strong>（開始: {formatSecToMinSec(pendingVoiceStart ?? 0)}）— 「声停止」で区間を確定。</>
              )}
            </div>
            {manualVoiceSegments.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>作成済み音声区間（{manualVoiceSegments.length} 件）</div>
                <ul style={{ listStyle: "none", padding: 0, margin: 0, maxHeight: 120, overflowY: "auto", fontSize: 12 }}>
                  {manualVoiceSegments.map((seg, i) => (
                    <li key={i} style={{ padding: "2px 0", borderBottom: "1px solid #e0e0e0" }}>
                      #{i + 1} {formatSecToMinSec(seg.startSec)} ～ {formatSecToMinSec(seg.endSec)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* 右: 簡易タイムライン */}
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>簡易タイムライン（クリックでシーク・区間クリックで選択）</div>
            {videoDuration != null && videoDuration > 0 ? (
              <div
                role="presentation"
                style={{
                  position: "relative",
                  height: 48,
                  background: "#e8e8e8",
                  borderRadius: 4,
                  overflow: "hidden",
                  cursor: "pointer",
                }}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const pct = Math.max(0, Math.min(1, x / rect.width));
                  const targetSec = pct * videoDuration;
                  const delta = targetSec - currentTimeSec;
                  if (Math.abs(delta) > 0.05) onSeek?.(delta);
                }}
              >
                {timelineSegments.map((seg, i) => {
                  const totalTimelineSec = Math.max(
                    videoDuration ?? 0,
                    timelineSegments.length > 0 ? timelineSegments[timelineSegments.length - 1]!.endSec : 0
                  ) || 1;
                  const left = (seg.startSec / totalTimelineSec) * 100;
                  const width = ((seg.endSec - seg.startSec) / totalTimelineSec) * 100;
                  const isVoice = seg.type === "voice";
                  const isInterlude = seg.type === "interlude";
                  const isBranding = Boolean(seg.isBranding);
                  const rowPhraseId = phraseQueue[i]?.id;
                  const isSelected = rowPhraseId != null && rowPhraseId === editingPhraseId;
                  return (
                    <div
                      key={seg.id}
                      role="button"
                      tabIndex={0}
                      title={`${isBranding ? "Branding" : seg.type === "voice" ? "声" : seg.type === "interlude" ? "間奏" : "無音"} ${formatSecToMinSec(seg.startSec)} ～ ${formatSecToMinSec(seg.endSec)}`}
                      style={{
                        position: "absolute",
                        left: `${left}%`,
                        width: `${width}%`,
                        height: "100%",
                        background: isBranding ? "#c4b5fd" : isVoice ? "#4caf50" : isInterlude ? "#e0c4a0" : "#bdbdbd",
                        border: isSelected ? "2px solid #1565c0" : "1px solid rgba(0,0,0,0.1)",
                        boxSizing: "border-box",
                        cursor: "pointer",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (rowPhraseId != null) assignEditingPhraseId(rowPhraseId);
                        const delta = seg.startSec - currentTimeSec;
                        if (Math.abs(delta) > 0.05) onSeek?.(delta);
                      }}
                    />
                  );
                })}
                {/* 再生位置マーカー */}
                <div
                  style={{
                    position: "absolute",
                    left: `${Math.min(100, (currentTimeSec / videoDuration) * 100)}%`,
                    top: 0,
                    bottom: 0,
                    width: 2,
                    background: "#c62828",
                    pointerEvents: "none",
                  }}
                />
              </div>
            ) : (
              <div style={{ height: 48, background: "#eee", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#666" }}>
                動画の長さを取得中
              </div>
            )}
          </div>
      </div>
      <section
        style={{
          display: "grid",
          gridTemplateColumns: stackPhraseQueueBelow
            ? "minmax(0, 1fr)"
            : phraseQueuePanel.minimized
              ? "minmax(0, 1fr) 200px"
              : `minmax(0, 1fr) 6px minmax(${MIN_PANEL_WIDTH}px, ${phraseQueuePanel.width}px)`,
          gridTemplateRows: stackPhraseQueueBelow ? "auto minmax(220px, min(48vh, 560px))" : undefined,
          gap: stackPhraseQueueBelow ? 12 : 0,
          columnGap: stackPhraseQueueBelow ? 12 : 0,
          alignItems: "stretch",
          width: "100%",
          minWidth: 0,
        }}
      >
        {/* 左: 広告 / 曲イメージ / タイムライン（動画プレビューは親ページ左カラム） */}
        <div style={{ minWidth: 0, overflow: "hidden" }}>
          {SHOW_MAIN_EDITOR_IMAGE_CANDIDATE_UI ? (
          <>
          {/* 広告バナー・商品候補 */}
          <div style={{ marginTop: 16, marginBottom: 16, borderTop: "1px solid #eee", paddingTop: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>画像候補（1）広告バナー・商品</div>
        <p style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
          バナー画像から候補を生成 → 「Use」で青枠の選択中行に割当
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8 }}>
          <input
            ref={bannerFileInputRef}
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => handleBannerSelect(e.target.files?.[0] ?? null)}
          />
          <button type="button" onClick={() => bannerFileInputRef.current?.click()} title="バナー画像を選ぶ">
            バナー画像を選ぶ
          </button>
          {bannerSourceUrl && (
            <img
              src={bannerSourceUrl}
              alt=""
              loading="lazy"
              decoding="async"
              style={{ width: 80, height: 60, objectFit: "cover", borderRadius: 4 }}
            />
          )}
          <span style={{ fontSize: 12, color: "#666" }}>
            （既存の区間画像 or アップロード）
          </span>
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button
            type="button"
            onClick={handleGenerateProductCandidates}
            disabled={!bannerSourceUrl && !segmentImageUrls.some(Boolean) && !segmentVideoUrls.some(Boolean)}
            title="5パターンのトリミング候補を自動生成"
          >
            商品候補を自動生成
          </button>
          <button
            type="button"
            onClick={handleManualTrimStart}
            disabled={!bannerSourceUrl && !segmentImageUrls.some(Boolean) && !segmentVideoUrls.some(Boolean)}
            title="手動で矩形選択して切り出し"
          >
            手動トリミング
          </button>
        </div>
        {manualTrimMode && manualTrimUrl && (
          <div
            ref={manualTrimRef}
            style={{ marginBottom: 8, border: "1px solid #ccc", padding: 8, background: "#f9f9f9" }}
          >
            <div style={{ fontSize: 12, marginBottom: 4 }}>ドラッグで矩形選択 → 離すと候補に追加</div>
            <canvas
              ref={manualTrimCanvasRef}
              onMouseDown={handleManualTrimMouseDown}
              onMouseMove={handleManualTrimMouseMove}
              onMouseUp={handleManualTrimMouseUp}
              onMouseLeave={handleManualTrimMouseUp}
              style={{ maxWidth: "100%", cursor: "crosshair", display: "block" }}
            />
          </div>
        )}
        {productCandidates.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
              適用先（青枠の行）:{" "}
              <select
                value={editingPhraseId ?? ""}
                onChange={(e) => {
                  const id = e.target.value;
                  if (id) assignEditingPhraseId(id);
                }}
                style={{ minWidth: 60 }}
              >
                {phraseQueue.length === 0 ? (
                  <option value="">-</option>
                ) : (
                  phraseQueue.map((p, i) => (
                    <option key={p.id} value={p.id}>
                      #{i + 1}
                    </option>
                  ))
                )}
              </select>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {productCandidates.map((dataUrl, i) => (
                <div
                  key={i}
                  style={{
                    border: "1px solid #ddd",
                    borderRadius: 4,
                    padding: 4,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <img
                    src={dataUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    style={{ width: 60, height: 45, objectFit: "cover", borderRadius: 2 }}
                  />
                  <button
                    type="button"
                    onClick={() => handleUseCandidate(dataUrl)}
                    disabled={timelineSegments.length === 0}
                    style={{ fontSize: 12 }}
                  >
                    Use
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 曲イメージ（テーマ解析 + 画像検索 + 自動割当） */}
      <div style={{ marginTop: 16, marginBottom: 16, borderTop: "1px solid #eee", paddingTop: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>画像候補（2）曲イメージ（Pixabay）</div>
        <p style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
          歌詞キーワード解析 → テーマで検索 → 候補をクリックで青枠の選択中行に割当（割当後に次行へ）
        </p>
        <div style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 12, color: "#555" }}>全体トーン:</label>
          <select
            value={imageTone}
            onChange={(e) => setImageTone(e.target.value as ImageToneId)}
            style={{ padding: "4px 8px", minWidth: 120 }}
            title="画像の世界観を統一"
          >
            {IMAGE_TONE_OPTIONS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleAutoAssignImages}
            disabled={autoAssignLoading || timelineSegments.length === 0}
            title="歌詞あり区間に画像を自動割当（歌詞＋トーンで検索）"
            style={{ padding: "6px 12px", fontWeight: 600 }}
          >
            {autoAssignLoading ? "割当中..." : "画像を自動割当"}
          </button>
          <button
            type="button"
            onClick={handleRegenerateAll}
            disabled={autoAssignLoading || timelineSegments.length === 0}
            title="このトーンで全歌詞区間を再生成"
            style={{ padding: "6px 12px" }}
          >
            このトーンで再生成
          </button>
          <button
            type="button"
            onClick={handleRegenerateAll}
            disabled={autoAssignLoading || timelineSegments.length === 0}
            title="全歌詞区間の画像をやり直し"
            style={{ padding: "6px 12px", fontSize: 12, color: "#666" }}
          >
            全部やり直し
          </button>
        </div>
        <div style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={handleAnalyzeTheme}
            disabled={phraseQueue.length === 0}
          >
            キーワード・テーマを解析
          </button>
        </div>
        {themeKeywords.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: "#666", marginRight: 4 }}>抽出キーワード:</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {themeKeywords.map((k) => {
                const selected = selectedTags.includes(k.word);
                return (
                  <button
                    key={k.word}
                    type="button"
                    onClick={() => {
                      setSearchDirty(false);
                      setSelectedTags((prev) =>
                        prev.includes(k.word) ? prev.filter((w) => w !== k.word) : [...prev, k.word]
                      );
                    }}
                    style={{
                      padding: "2px 8px",
                      borderRadius: 999,
                      border: "1px solid " + (selected ? "#2563eb" : "#ccc"),
                      background: selected ? "#e0ecff" : "#f8f8f8",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                    title={`${k.word} (${k.count})`}
                  >
                    {k.word}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={() => setSelectedTags([])}
            disabled={selectedTags.length === 0}
            style={{ fontSize: 11 }}
            title="選択中のタグをクリア"
          >
            タグ選択をクリア
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchDirty(false);
              setSearchQuery("");
            }}
            style={{ fontSize: 11 }}
            title="検索文言をリセット（トーン＋タグから再自動生成）"
          >
            検索文言をリセット
          </button>
        </div>
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>検索バー（画像検索クエリ）</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchDirty(true);
              setSearchQuery(e.target.value);
            }}
            placeholder="例: office stress meeting / dark office conflict"
            style={{ width: "100%", maxWidth: 480, padding: 6 }}
          />
          {searchQuery.trim() === "" && (
            <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
              トーンとタグから自動生成された文言を使います
            </div>
          )}
        </div>
        <div style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            onClick={handleSearchThemeImages}
            disabled={themeSearchLoading || (!searchQuery.trim() && !themeString.trim() && selectedTags.length === 0)}
          >
            {themeSearchLoading ? "検索中..." : "この条件で再検索"}
          </button>
          {themeSearchError && (
            <span style={{ fontSize: 12, color: "#c00" }}>{themeSearchError}</span>
          )}
          <span style={{ fontSize: 12, color: "#666" }}>
            {timelineSegments.length > 0
              ? `適用先（青枠の行）: #${(() => {
                  const pi = editingPhraseId ? phraseQueue.findIndex((p) => p.id === editingPhraseId) : -1;
                  return pi >= 0 ? pi + 1 : 1;
                })()}（クリックで割当→次行へ）`
              : "（タイムライン生成後に割当可）"}
          </span>
        </div>
        {themeImageResults.length > 0 && (
          <div>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>↓ クリックで青枠の行に割当</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {themeImageResults.map((img) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() => handleAssignThemeImage(img)}
                  title={`${img.title} / ${img.author}`}
                  style={{
                    padding: 0,
                    border: "1px solid #ddd",
                    borderRadius: 4,
                    overflow: "hidden",
                    background: "none",
                    cursor: "pointer",
                  }}
                >
                  <img
                    src={img.previewUrl}
                    alt={img.title}
                    loading="lazy"
                    decoding="async"
                    style={{ width: 120, height: 90, objectFit: "cover", display: "block" }}
                  />
                  <div style={{ fontSize: 10, color: "#666", padding: "2px 4px", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {img.author || img.title}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

          </>
          ) : null}

      {/* B) タイムライン描画: 各行は start/end、歌詞、画像、区間編集を開く など */}
      {timelineSegments.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 600 }}>
              タイムライン（{timelineSegments.length} 区間 / 声 {timelineSegments.filter((s) => s.type === "voice").length} + 無音 {timelineSegments.filter((s) => s.type === "silence").length} + 間奏 {timelineSegments.filter((s) => s.type === "interlude").length}）
            </span>
            <span style={{ fontSize: 12, color: "#666" }}>
              緑=再生中 / 青枠=選択中 / 行クリックで選択 / フレーズの流し込み・画像の細かい操作は<strong>区間編集を開く</strong>から / 一覧は時間・歌詞の確認と追加・削除に絞っています
            </span>
            <button
              type="button"
              onClick={() => onBulkAssignToLyrics(manualVoiceSegments)}
              disabled={lyricLineCount === 0}
              title={lyricLineCount === 0 ? "歌詞行を先に作成してください" : "全歌詞行に声区間を一括割当"}
            >
              歌詞を区間に一括割当
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap", fontSize: 13 }}>
            <span style={{ color: "#666" }}>間奏:</span>
            <input
              type="text"
              placeholder="開始 例: 1:40.000"
              value={interludeStartInput}
              onChange={(e) => setInterludeStartInput(e.target.value)}
              style={{ width: 100, padding: "4px 6px" }}
              title="開始（分:秒 または 秒）"
            />
            <span style={{ color: "#999" }}>～</span>
            <input
              type="text"
              placeholder="終了 例: 1:45.000"
              value={interludeEndInput}
              onChange={(e) => setInterludeEndInput(e.target.value)}
              style={{ width: 100, padding: "4px 6px" }}
              title="終了（分:秒 または 秒）"
            />
            <button
              type="button"
              onClick={() => {
                const a = parseTimeToSec(interludeStartInput);
                const b = parseTimeToSec(interludeEndInput);
                if (a != null && b != null && a < b) {
                  setManualInterludes((prev) => [...prev, { startSec: a, endSec: b }]);
                  setInterludeStartInput("");
                  setInterludeEndInput("");
                }
              }}
              disabled={
                parseTimeToSec(interludeStartInput) == null ||
                parseTimeToSec(interludeEndInput) == null ||
                (parseTimeToSec(interludeStartInput) ?? 0) >= (parseTimeToSec(interludeEndInput) ?? 0)
              }
              title="開始・終了を指定して間奏区間を追加（タイムラインに開始時刻でマージ表示）"
            >
              間奏を追加
            </button>
            {manualInterludes.length > 0 && (
              <button
                type="button"
                onClick={() => setManualInterludes([])}
                title="追加した間奏をすべて削除"
                style={{ fontSize: 12, color: "#666" }}
              >
                間奏をクリア
              </button>
            )}
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {timelineSegments.map((seg, i) => {
              const rowPhraseId = phraseQueue[i]?.id;
              const isPlaying = seg.id === activeSegmentId;
              const isSelected = rowPhraseId != null && rowPhraseId === editingPhraseId;
              const rowBg =
                isPlaying && isSelected
                  ? "#d4edda"
                  : isPlaying
                    ? "#d4edda"
                    : isSelected
                      ? "#e8f4fd"
                      : seg.type === "silence"
                        ? "#f0f0f0"
                        : seg.type === "interlude"
                          ? "#f5e6d3"
                          : "transparent";
              const timelineRowStyle: CSSProperties = {
                display: "flex",
                flexDirection: "column",
                alignItems: "stretch",
                gap: 8,
                padding: "10px 10px 12px",
                marginBottom: 8,
                border: "1px solid #e0e4ec",
                borderRadius: 8,
                background: rowBg,
                boxShadow:
                  isSelected && timelineSegments.length > 0
                    ? "inset 4px 0 0 #2196F3"
                    : "none",
                cursor: "default",
                boxSizing: "border-box",
              };
              return (
              <li
                key={seg.id}
                ref={(el) => {
                  if (el) segmentRowRefs.current.set(i, el);
                  else segmentRowRefs.current.delete(i);
                }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("input, button, select"))
                    return;
                  const pid = phraseQueue[i]?.id;
                  if (pid != null) assignEditingPhraseId(pid);
                }}
                style={timelineRowStyle}
              >
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <span style={{ minWidth: 28, fontSize: 11, fontWeight: 600, color: seg.isBranding ? "#7c3aed" : seg.type === "silence" ? "#666" : seg.type === "interlude" ? "#b4531a" : "#1565c0" }}>
                    {seg.isBranding ? "Brand" : seg.type === "voice" ? "声" : seg.type === "interlude" ? "間奏" : "無音"}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#37474f" }}>#{i + 1}</span>
                  <span
                    style={{
                      fontFamily: "ui-monospace, monospace",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#1a237e",
                      background: "#e8eaf6",
                      padding: "3px 10px",
                      borderRadius: 6,
                      border: "1px solid #c5cae9",
                    }}
                    title="この行で扱う時間区間（開始〜終了）。区間編集を開くとこの範囲だけが再生対象になります。"
                  >
                    区間編集: {seg.startSec.toFixed(3)}s → {seg.endSec.toFixed(3)}s
                  </span>
                </div>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#455a64", lineHeight: 1.45 }}>
                  時間・歌詞の細かい操作は「<strong>区間編集を開く</strong>」から。ここでは流れの確認と追加・削除に絞っています。
                </p>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    width: "100%",
                  }}
                >
                {(seg.type === "voice" || seg.type === "interlude") ? (
                <>
                  <input
                    type="text"
                    value={editingTimeRowIndex === i ? editingStartStr : formatSecToMinSec(seg.startSec)}
                    onChange={(e) => {
                      setEditingTimeRowIndex(i);
                      setEditingStartStr(e.target.value);
                      if (editingTimeRowIndex !== i) setEditingEndStr(formatSecToMinSec(seg.endSec));
                    }}
                    onFocus={() => {
                      setEditingTimeRowIndex(i);
                      setEditingStartStr(formatSecToMinSec(seg.startSec));
                      setEditingEndStr(formatSecToMinSec(seg.endSec));
                    }}
                    onBlur={() => {
                      const a = parseTimeToSec(editingStartStr);
                      const b = parseTimeToSec(editingEndStr);
                      if (a != null && b != null) applySegmentTimeEdit(i, a, b);
                      setEditingTimeRowIndex(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const a = parseTimeToSec(editingStartStr);
                        const b = parseTimeToSec(editingEndStr);
                        if (a != null && b != null) applySegmentTimeEdit(i, a, b);
                        setEditingTimeRowIndex(null);
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    placeholder="0:00.000"
                    style={{ width: 88, padding: "2px 4px", fontSize: 12 }}
                    title="開始（分:秒または秒）。区間編集モーダル内でも変更できます。"
                  />
                  <span style={{ color: "#999" }}>～</span>
                  <input
                    type="text"
                    value={editingTimeRowIndex === i ? editingEndStr : formatSecToMinSec(seg.endSec)}
                    onChange={(e) => {
                      setEditingTimeRowIndex(i);
                      setEditingEndStr(e.target.value);
                      if (editingTimeRowIndex !== i) setEditingStartStr(formatSecToMinSec(seg.startSec));
                    }}
                    onFocus={() => {
                      setEditingTimeRowIndex(i);
                      setEditingStartStr(formatSecToMinSec(seg.startSec));
                      setEditingEndStr(formatSecToMinSec(seg.endSec));
                    }}
                    onBlur={() => {
                      const a = parseTimeToSec(editingStartStr);
                      const b = parseTimeToSec(editingEndStr);
                      if (a != null && b != null) applySegmentTimeEdit(i, a, b);
                      setEditingTimeRowIndex(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const a = parseTimeToSec(editingStartStr);
                        const b = parseTimeToSec(editingEndStr);
                        if (a != null && b != null) applySegmentTimeEdit(i, a, b);
                        setEditingTimeRowIndex(null);
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                    placeholder="0:00.000"
                    style={{ width: 88, padding: "2px 4px", fontSize: 12 }}
                    title="終了（分:秒または秒）。手入力はそのまま採用。変更すると下の行が5秒刻みで連鎖更新"
                  />
                </>
              ) : (
                <span style={{ minWidth: 180 }}>
                  {formatSecToMinSec(seg.startSec)} ～ {formatSecToMinSec(seg.endSec)}
                </span>
              )}
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    marginTop: 4,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleOpenIntervalEdit(i)}
                    disabled={!onSeekToSec || !onPlay}
                    title={`この区間（${seg.startSec.toFixed(3)}s ～ ${seg.endSec.toFixed(3)}s）を編集・確認する画面を開きます。再生はこの範囲に限定されます（フル再生プレイヤーとは別）。`}
                    style={{ fontWeight: 600, background: "#e3f2fd", border: "1px solid #90caf9", borderRadius: 4, padding: "6px 12px" }}
                  >
                    区間編集を開く
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddSegmentAfter(i)}
                    disabled={Boolean(seg.isBranding)}
                    title="この区間の終了時刻から約2秒の新規区間を追加"
                    style={{ padding: "6px 12px", borderRadius: 4, border: "1px solid #bdbdbd", background: "#fff" }}
                  >
                    後ろに追加
                  </button>
                  {!seg.isBranding ? (
                    <button
                      type="button"
                      onClick={() => handleDeleteTimelineSegment(i)}
                      title="この区間を削除"
                      style={{ padding: "6px 12px", borderRadius: 4, border: "1px solid #e57373", background: "#fff", color: "#b71c1c" }}
                    >
                      削除
                    </button>
                  ) : null}
                </div>
                <textarea
                  value={
                    seg.isBranding
                      ? BRANDING_TEXT
                      : rowPhraseId === editingPhraseId
                        ? localSegmentText
                        : (segmentTexts[i] ?? "")
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (rowPhraseId === editingPhraseId) setLocalSegmentText(v);
                    setSegmentText(i, v);
                    if (rowPhraseId != null) {
                      setPhraseQueue((prev) =>
                        prev.map((p) => (p.id === rowPhraseId ? { ...p, text: v } : p))
                      );
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const text = e.dataTransfer.getData("text/plain");
                    const indexStr = e.dataTransfer.getData(DRAG_PHRASE_QUEUE_INDEX_KEY);
                    if (text == null || indexStr === "") return;
                    const draggedIndex = parseInt(indexStr, 10);
                    if (!Number.isFinite(draggedIndex)) return;
                    handleLyricDrop(i, text, draggedIndex);
                  }}
                  placeholder="歌詞（複数行可） — フレーズの追記は区間編集を開くから"
                  rows={3}
                  style={{ width: "100%", maxWidth: "100%", boxSizing: "border-box", padding: 8, marginTop: 6, resize: "vertical", fontFamily: "inherit" }}
                  disabled={Boolean(seg.isBranding)}
                />
                <button
                  type="button"
                  onClick={() => {
                    const pi = phraseQueue.findIndex((p) => p.id === editingPhraseId);
                    if (pi < 0 || pi >= phraseQueue.length - 1) return;
                    const nextId = phraseQueue[pi + 1]!.id;
                    assignEditingPhraseId(nextId);
                  }}
                  disabled={(() => {
                    const pi = phraseQueue.findIndex((p) => p.id === editingPhraseId);
                    return pi < 0 || pi >= phraseQueue.length - 1;
                  })()}
                  title="選択を次の枠へ（歌詞は変更しない）"
                  style={{ marginTop: 4, padding: "4px 10px", fontSize: 12 }}
                >
                  次の枠へ
                </button>
                <input
                  ref={(el) => { if (el) fileInputRefs.current.set(i, el); }}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) {
                      setSegmentImage(i, null, undefined);
                      return;
                    }
                    offerLocalUploadHintThen(() => {
                      setSegmentImage(i, f, "uploaded");
                      const nextPid = phraseQueue[i + 1]?.id;
                      if (nextPid != null) assignEditingPhraseId(nextPid);
                    });
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRefs.current.get(i)?.click()}
                  title="この行にファイルから画像を直接割当"
                  style={{ marginTop: 4, padding: "4px 10px", fontSize: 12 }}
                >
                  この行に画像を選ぶ
                </button>
                {(segmentImageUrls[i] ||
                  segmentVideoUrls[i] ||
                  (Boolean(segmentImageSelections[i]?.localImageNeedsReselect) &&
                    !segmentVideoUrls[i] &&
                    segmentMediaTypes[i] === "image")) && (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenIntervalPreview(i);
                      }}
                      title="この区間の編集・確認画面を開く（素材+歌詞。音声はこの行の開始〜終了の範囲のみ）"
                      style={{ padding: 0, border: "none", background: "none", cursor: "pointer", borderRadius: 4 }}
                    >
                      {segmentVideoUrls[i] ? (
                        <span
                          style={{
                            width: 40,
                            height: 30,
                            borderRadius: 4,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: "#1a1a2e",
                            color: "#9cf",
                            fontSize: 9,
                            fontWeight: 700,
                            border: "1px solid #334",
                            boxSizing: "border-box",
                          }}
                          title="動画（一覧では再生・読み込みしません）"
                        >
                          MOV
                        </span>
                      ) : (() => {
                        if (segmentImageSelections[i]?.localImageNeedsReselect && !segmentVideoUrls[i]) {
                          return (
                            <span
                              title="自動保存から復元したローカル画像は、端末上のファイルとして再選択してください。"
                              style={{
                                width: 40,
                                minHeight: 30,
                                borderRadius: 4,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                background: "#fff8e1",
                                border: "1px solid #ffb74d",
                                boxSizing: "border-box",
                                color: "#e65100",
                                fontSize: 5.5,
                                fontWeight: 700,
                                lineHeight: 1.08,
                                textAlign: "center",
                                padding: "1px 1px",
                                overflow: "hidden",
                                wordBreak: "break-all",
                              }}
                            >
                              <span>ローカル画像</span>
                              <span style={{ marginTop: 1, fontWeight: 600 }}>再選択</span>
                            </span>
                          );
                        }
                        const rawUrl = segmentImageUrls[i];
                        const thumbUrl = typeof rawUrl === "string" ? rawUrl.trim() : "";
                        const dbg = shouldLogTimelineThumbDebug();
                        const loadSt = segmentImageLoadStates[i] ?? "idle";
                        if (!thumbUrl) {
                          if (dbg && rawUrl != null && String(rawUrl).trim().length === 0) {
                            console.warn("[timelineThumb] row src is whitespace-only", { index: i });
                          }
                          return null;
                        }
                        if (loadSt === "error") {
                          return (
                            <span
                              title="画像を読み込めません。再選択してください。"
                              style={{
                                width: 40,
                                minHeight: 30,
                                borderRadius: 4,
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                background: "#ffebee",
                                border: "1px solid #e57373",
                                boxSizing: "border-box",
                                color: "#b71c1c",
                                fontSize: 5.5,
                                fontWeight: 700,
                                lineHeight: 1.08,
                                textAlign: "center",
                                padding: "1px 1px",
                                overflow: "hidden",
                                wordBreak: "break-all",
                              }}
                            >
                              <span>画像を読み込めません</span>
                              <span style={{ marginTop: 1, fontWeight: 600 }}>再選択してください</span>
                            </span>
                          );
                        }
                        return (
                          <div key={thumbUrl.slice(0, 48)} style={aspectLayout.timelineThumbFrame()}>
                            <img
                              src={thumbUrl}
                              alt=""
                              decoding="async"
                              style={PREVIEW_MEDIA_BOX_CONTAIN_STYLE}
                              onLoad={() => handleSegmentBackgroundImageLoad(i, thumbUrl)}
                              onError={() => handleSegmentBackgroundImageError(i, thumbUrl)}
                            />
                          </div>
                        );
                      })()}
                    </button>
                    <button type="button" onClick={() => clearSegmentVisualMedia(i)} title="素材解除（画像・動画）">
                      Clear
                    </button>
                  </>
                )}
                {(seg.type === "voice" || seg.type === "interlude") && (segmentTexts[i] ?? "").trim() ? (
                  <button
                    type="button"
                    onClick={() => handleRegenerateRow(i)}
                    disabled={autoAssignLoading}
                    title="この行の画像だけ再抽選（歌詞＋トーンで検索）"
                    style={{ fontSize: 11 }}
                  >
                    この行だけ再抽選
                  </button>
                ) : null}
                {segmentSearchTerms[i] && (
                  <span style={{ fontSize: 10, color: "#888", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={segmentSearchTerms[i]}>
                    検索: {segmentSearchTerms[i]}
                  </span>
                )}
                <select
                  value={segmentAnims[i] ?? "none"}
                  onChange={(e) => setSegmentAnim(i, e.target.value)}
                  title="アニメーション"
                  style={{ minWidth: 90 }}
                >
                  {ANIM_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                </div>
              </li>
              );
            })}
          </ul>
        </div>
      )}
        </div>

        {!stackPhraseQueueBelow && !phraseQueuePanel.minimized ? (
          <div
            role="separator"
            aria-orientation="vertical"
            onMouseDown={handlePhraseQueueResizeStart}
            style={{
              width: 6,
              cursor: "col-resize",
              alignSelf: "stretch",
              touchAction: "none",
              minWidth: 0,
            }}
            title="ドラッグでフレーズ列の幅を変更"
          />
        ) : null}

        {/* 右: フレーズキュー（editingPhraseId = フレーズ行 id）。z-index で上に載せ、sticky の再生バー(z100)と重なった誤クリックを防ぐ */}
        <div
          style={{
            position: "relative",
            zIndex: 110,
            isolation: "isolate",
            width: stackPhraseQueueBelow ? "100%" : undefined,
            minWidth: 0,
            height: stackPhraseQueueBelow ? undefined : "100%",
            maxWidth: stackPhraseQueueBelow ? "100%" : MAX_PANEL_WIDTH,
            maxHeight: stackPhraseQueueBelow ? "min(48vh, 520px)" : "min(85vh, 920px)",
            minHeight: phraseQueuePanel.minimized ? undefined : 240,
            border: "1px solid #e0e0e0",
            borderRadius: 8,
            background: "#fafafa",
            boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
        <div
          style={{
            fontWeight: 600,
            padding: "8px 10px",
            background: "#eee",
            borderBottom: "1px solid #e0e0e0",
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span style={{ flex: 1, minWidth: 0, fontSize: 14 }}>歌詞フレーズキュー</span>
          <button
            type="button"
            onClick={() => setPhraseQueuePanel((p) => ({ ...p, minimized: !p.minimized }))}
            title={phraseQueuePanel.minimized ? "展開" : "最小化"}
            style={{ padding: "2px 8px", fontSize: 12, flexShrink: 0 }}
          >
            {phraseQueuePanel.minimized ? "▲" : "▼"}
          </button>
          <button
            type="button"
            onClick={handlePhraseQueueResetPosition}
            title="列幅をデフォルトに戻す"
            style={{ padding: "2px 8px", fontSize: 12, flexShrink: 0 }}
          >
            幅リセット
          </button>
        </div>
        {!phraseQueuePanel.minimized && (
          <div
            style={{
              padding: 12,
              overflow: "hidden",
              flex: 1,
              minHeight: 0,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
            }}
          >
          <div style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", fontSize: 13 }}>
            <span style={{ color: "#666" }}>曲調:</span>
            <select
              value={songStyle}
              onChange={(e) => setSongStyle(e.target.value as SongStyle)}
              style={{ padding: "4px 8px", minWidth: 140 }}
            >
              {SONG_STYLES.map((s) => (
                <option key={s} value={s}>{getSongStyleLabel(s)}</option>
              ))}
            </select>
            <span style={{ color: "#666", marginLeft: 4 }}>表示テンポ:</span>
            <select
              value={displayTempo}
              onChange={(e) => setDisplayTempo(e.target.value as DisplayTempo)}
              style={{ padding: "4px 8px", minWidth: 120 }}
            >
              {DISPLAY_TEMPOS.map((t) => (
                <option key={t} value={t}>{getDisplayTempoLabel(t)}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => handleAutoGenerate()}
              disabled={
                !(phraseQueue.length > 0
                  ? phraseQueue.map((p) => p.text).join("\n").trim()
                  : lyricsFullText.trim())
              }
              title={`現在の曲調で約${getPresetParams(songStyle, displayTempo).secondsPerScreen}秒ごとに画面切替になるようフレーズを自動生成（後から分割・結合で調整可）`}
              style={{ padding: "4px 10px", fontSize: 13, fontWeight: 600 }}
            >
              自動生成
            </button>
            <span style={{ fontSize: 11, color: "#888" }}>{getPresetParams(songStyle, displayTempo).description}</span>
          </div>
          <textarea
            value={editingPhrase?.text ?? ""}
            onChange={(e) => {
              const id = editingPhraseId;
              if (id == null) return;
              const v = e.target.value;
              setPhraseQueue((prev) => {
                const pi = prev.findIndex((p) => p.id === id);
                if (pi < 0) return prev;
                setSegmentTexts((st) => {
                  const arr = [...st];
                  while (arr.length <= pi) arr.push("");
                  arr[pi] = v;
                  return arr;
                });
                const next = [...prev];
                next[pi] = { ...next[pi]!, text: v };
                return next;
              });
            }}
            disabled={phraseQueue.length === 0 || editingPhraseId == null}
            rows={3}
            placeholder={
              phraseQueue.length === 0
                ? "フレーズ取り込み後、タイムラインで区間を選ぶとここでその行のフレーズを編集できます"
                : "編集中のタイムライン区間に対応するフレーズを編集（全文はページ上部の歌詞欄）"
            }
            style={{ width: "100%", marginBottom: 8, fontFamily: "inherit", boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            <button
              type="button"
              onClick={handleFullTextApply}
              disabled={!lyricsFullText.trim() || themeSearchLoading}
              title="フレーズキュー・キーワード解析・関連処理を一括更新（トップの画像候補パネル非表示時も内部処理は従来どおり）"
              style={{ padding: "6px 14px", fontWeight: 600 }}
            >
              {themeSearchLoading ? t("generating") : t("generateFullTextInPanel")}
            </button>
            <button type="button" onClick={handlePhraseify} disabled={!lyricsFullText.trim()} style={{ padding: "6px 12px" }}>
              フレーズ化のみ
            </button>
          </div>
          {phraseQueue.length > 0 ? (
            <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 6, flexShrink: 0 }}>
                <span style={{ fontSize: 13, color: "#555" }}>
                  編集中:{" "}
                  <strong>
                    {editingPhraseId
                      ? (() => {
                          const pi = phraseQueue.findIndex((p) => p.id === editingPhraseId);
                          return pi >= 0 ? pi + 1 : "—";
                        })()
                      : "—"}
                  </strong>{" "}
                  / {phraseQueue.length}（行クリックで選択のみ・ダブルクリックで歌詞枠へ挿入）
                </span>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => handlePhraseClipboardCopy(e)}
                  disabled={editingPhraseId == null}
                  title="選択中フレーズを内部バッファへ（再生・シークは起こさない）。2ページ目以降は「行コピー」も利用可"
                  style={{ padding: "4px 10px", fontSize: 12 }}
                >
                  フレーズコピー
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => handlePhraseClipboardPaste(e)}
                  disabled={editingPhraseId == null || !phraseClipReady}
                  title="内部バッファを選択中フレーズへ貼り付け（先にフレーズコピー）"
                  style={{ padding: "4px 10px", fontSize: 12 }}
                >
                  フレーズ貼付
                </button>
                {phraseClipReady ? (
                  <span style={{ fontSize: 11, color: "#2e7d32", maxWidth: 280 }}>
                    コピー済み: {phraseClipSummary}
                  </span>
                ) : null}
              </div>
              <ul
                style={{
                  listStyle: "none",
                  padding: 0,
                  margin: 0,
                  flex: 1,
                  minHeight: 0,
                  height: "100%",
                  maxHeight: "min(560px, 65vh)",
                  overflowY: "auto",
                  overflowX: "hidden",
                }}
              >
                {phraseQueue.map((item, i) => {
                  const isEditingRow = item.id === editingPhraseId;
                  return (
                    <LyricPhraseQueueRow
                      key={item.id}
                      item={item}
                      index={i}
                      isActive={isEditingRow}
                      queueLength={phraseQueue.length}
                      listItemRef={(el) => {
                        if (el) phraseItemRefs.current.set(item.id, el);
                        else phraseItemRefs.current.delete(item.id);
                      }}
                      onSelect={() => {
                        applyPhraseToLyricInput(item.text);
                        if (previewRowIndex != null) return;
                        assignEditingPhraseId(item.id);
                      }}
                      onDoubleClickInsert={() => insertPhraseAtFocus(item.text)}
                      onMoveUp={() => moveLyric(i, -1)}
                      onMoveDown={() => moveLyric(i, 1)}
                      onSplit={() => splitLyric(i)}
                      onJoin={() => joinLyric(i)}
                      onCopyThisRow={(e) => handlePhraseRowClipboardCopy(item.id, e)}
                    />
                  );
                })}
              </ul>
            </div>
          ) : (
            <p style={{ fontSize: 13, color: "#888" }}>
              歌詞全文はページ上部の入力欄で。取り込み後にフレーズがここに並びます。
            </p>
          )}
          </div>
        )}
        </div>
      </section>
        </div>
        {localUploadHintPortal}
        </>
  );
});
