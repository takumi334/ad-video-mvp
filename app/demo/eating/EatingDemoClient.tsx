"use client";

import { takePendingHomeImage } from "@/lib/homePendingImageIdb";
import { useUiLocale } from "@/lib/i18n/UiLocaleProvider";
import type { UiLocale } from "@/lib/i18n/uiLocale";
import {
  clearShortsMultiDraft,
  createPersistableProject,
  loadShortsMultiDraft,
  saveShortsMultiDraft,
} from "@/lib/shortsEditorStorage";
import {
  clearShortsImageBlobs,
  deleteShortsImageBlob,
  getShortsImageBlob,
  putShortsImageBlob,
} from "@/lib/shortsImageIdb";
import type { OutputAspect, ShortFrame, ShortFrameBannerSettings, ShortsMediaType } from "@/lib/shortsEditorTypes";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactElement } from "react";

const ACCEPT_ATTR = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.png,.jpg,.jpeg,.webp,.gif,.mp4,.webm,.mov";
const ACCEPT_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const ACCEPT_VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const ACCEPT_AUDIO_ATTR = "audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a";
const ACCEPT_AUDIO_MIME = new Set(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a"]);
const MAX_IMAGE_FILE_BYTES = 40 * 1024 * 1024;
const MAX_IMAGES = 8;
const SHORTS_MULTI_I18N_KEY = "shorts-multi-image-editor-i18n-v1";
const SHORTS_MULTI_THEME_KEY = "shorts-multi-image-editor-theme-v1";

type ShortsI18nText = {
  title: string;
  subtitle: string;
  generateThisImage: string;
  generateAllImages: string;
  downloadAllOutputs: string;
  uploadMp3: string;
  generateWholeVideo: string;
  deleteThisImage: string;
  deleteAllImages: string;
  originalPreview: string;
  fixedPreview: string;
  frameList: string;
  narration: string;
  start: string;
  end: string;
  zoom: string;
  play: string;
  stop: string;
  backToStart: string;
  noOutput: string;
  selectImages: string;
};

const narrationDefaults: Record<UiLocale, string> = {
  en: "AI Match Prediction",
  es: "Prediccion del partido con IA",
  pt: "Previsao da partida com IA",
  id: "Prediksi pertandingan AI",
  th: "การทำนายการแข่งขันด้วย AI",
  ko: "AI 경기 예측",
  ja: "AI試合予測",
};

const shortsI18n: Record<UiLocale, ShortsI18nText> = {
  en: {
    title: "Multi-image short editor",
    subtitle: "Edit frames in separate tabs per image, then generate per image or all at once.",
    generateThisImage: "Generate this image",
    generateAllImages: "Generate all images",
    downloadAllOutputs: "Download all outputs",
    uploadMp3: "Upload MP3",
    generateWholeVideo: "Generate full video",
    deleteThisImage: "Delete this image",
    deleteAllImages: "Delete all images",
    originalPreview: "Original image preview",
    fixedPreview: "Fixed preview",
    frameList: "Frame list",
    narration: "Narration",
    start: "Start",
    end: "End",
    zoom: "Zoom",
    play: "Play",
    stop: "Stop",
    backToStart: "Back to start",
    noOutput: "No downloadable output yet. Please generate a video first.",
    selectImages: "Drop images or tap to choose (max 8)",
  },
  es: {
    title: "Editor de videos cortos con varias imagenes",
    subtitle: "Edita cuadros por imagen y genera por imagen o todo junto.",
    generateThisImage: "Generar esta imagen",
    generateAllImages: "Generar todas las imagenes",
    downloadAllOutputs: "Descargar todas las salidas",
    uploadMp3: "Subir MP3",
    generateWholeVideo: "Generar video completo",
    deleteThisImage: "Eliminar esta imagen",
    deleteAllImages: "Eliminar todas las imagenes",
    originalPreview: "Vista previa original",
    fixedPreview: "Vista previa fija",
    frameList: "Lista de cuadros",
    narration: "Narracion",
    start: "Inicio",
    end: "Fin",
    zoom: "Zoom",
    play: "Reproducir",
    stop: "Detener",
    backToStart: "Volver al inicio",
    noOutput: "No hay salida descargable. Genera un video primero.",
    selectImages: "Suelta imagenes o toca para elegir (max 8)",
  },
  pt: {
    title: "Editor de shorts com varias imagens",
    subtitle: "Edite quadros por imagem e gere por imagem ou tudo de uma vez.",
    generateThisImage: "Gerar esta imagem",
    generateAllImages: "Gerar todas as imagens",
    downloadAllOutputs: "Baixar todas as saidas",
    uploadMp3: "Enviar MP3",
    generateWholeVideo: "Gerar video completo",
    deleteThisImage: "Excluir esta imagem",
    deleteAllImages: "Excluir todas as imagens",
    originalPreview: "Previa da imagem original",
    fixedPreview: "Previa fixa",
    frameList: "Lista de quadros",
    narration: "Narracao",
    start: "Inicio",
    end: "Fim",
    zoom: "Zoom",
    play: "Reproduzir",
    stop: "Parar",
    backToStart: "Voltar ao inicio",
    noOutput: "Ainda nao ha saida para download. Gere um video primeiro.",
    selectImages: "Solte imagens ou toque para escolher (max 8)",
  },
  id: {
    title: "Editor video pendek multi-gambar",
    subtitle: "Edit frame per gambar lalu hasilkan per gambar atau sekaligus.",
    generateThisImage: "Buat gambar ini",
    generateAllImages: "Buat semua gambar",
    downloadAllOutputs: "Unduh semua output",
    uploadMp3: "Unggah MP3",
    generateWholeVideo: "Buat video penuh",
    deleteThisImage: "Hapus gambar ini",
    deleteAllImages: "Hapus semua gambar",
    originalPreview: "Pratinjau gambar asli",
    fixedPreview: "Pratinjau tetap",
    frameList: "Daftar frame",
    narration: "Narasi",
    start: "Mulai",
    end: "Selesai",
    zoom: "Zoom",
    play: "Putar",
    stop: "Berhenti",
    backToStart: "Kembali ke awal",
    noOutput: "Belum ada output untuk diunduh. Buat video terlebih dahulu.",
    selectImages: "Jatuhkan gambar atau ketuk untuk memilih (maks 8)",
  },
  th: {
    title: "ตัวแก้ไขวิดีโอสั้นหลายภาพ",
    subtitle: "แก้ไขเฟรมต่อภาพและสร้างทีละภาพหรือทั้งหมดพร้อมกัน",
    generateThisImage: "สร้างภาพนี้",
    generateAllImages: "สร้างทุกภาพ",
    downloadAllOutputs: "ดาวน์โหลดผลลัพธ์ทั้งหมด",
    uploadMp3: "อัปโหลด MP3",
    generateWholeVideo: "สร้างวิดีโอเต็ม",
    deleteThisImage: "ลบภาพนี้",
    deleteAllImages: "ลบภาพทั้งหมด",
    originalPreview: "พรีวิวภาพต้นฉบับ",
    fixedPreview: "พรีวิวคงที่",
    frameList: "รายการเฟรม",
    narration: "คำบรรยาย",
    start: "เริ่ม",
    end: "จบ",
    zoom: "ซูม",
    play: "เล่น",
    stop: "หยุด",
    backToStart: "กลับไปจุดเริ่มต้น",
    noOutput: "ยังไม่มีผลลัพธ์ให้ดาวน์โหลด กรุณาสร้างวิดีโอก่อน",
    selectImages: "วางรูปภาพหรือแตะเพื่อเลือก (สูงสุด 8)",
  },
  ko: {
    title: "여러 이미지 숏 편집기",
    subtitle: "이미지별로 프레임을 편집하고 개별 또는 일괄 생성합니다.",
    generateThisImage: "이 이미지 생성",
    generateAllImages: "전체 이미지 생성",
    downloadAllOutputs: "출력 모두 다운로드",
    uploadMp3: "MP3 업로드",
    generateWholeVideo: "전체 영상 생성",
    deleteThisImage: "이 이미지 삭제",
    deleteAllImages: "전체 이미지 삭제",
    originalPreview: "원본 이미지 미리보기",
    fixedPreview: "고정 미리보기",
    frameList: "프레임 목록",
    narration: "나레이션",
    start: "시작",
    end: "종료",
    zoom: "줌",
    play: "재생",
    stop: "정지",
    backToStart: "처음으로",
    noOutput: "다운로드 가능한 출력이 없습니다. 먼저 영상을 생성하세요.",
    selectImages: "이미지를 드롭하거나 탭해서 선택 (최대 8장)",
  },
  ja: {
    title: "複数画像ショート素材編集",
    subtitle: "画像ごとに独立タブでフレーム編集し、個別または全画像一括で生成できます。",
    generateThisImage: "この画像を生成",
    generateAllImages: "全画像一括生成",
    downloadAllOutputs: "出力をまとめてダウンロード",
    uploadMp3: "MP3をアップロード",
    generateWholeVideo: "全体動画生成",
    deleteThisImage: "この画像を削除",
    deleteAllImages: "全画像を削除",
    originalPreview: "元画像プレビュー",
    fixedPreview: "固定プレビュー",
    frameList: "フレーム一覧",
    narration: "ナレーション",
    start: "開始",
    end: "終了",
    zoom: "ズーム",
    play: "再生",
    stop: "停止",
    backToStart: "先頭に戻る",
    noOutput: "ダウンロード可能な出力がありません。先に動画生成してください。",
    selectImages: "複数画像をドロップ / タップして選択（最大 8 枚）",
  },
};

type ImageProject = {
  id: string;
  imageId: string;
  title: string;
  fileName: string;
  imageWidth: number;
  imageHeight: number;
  mediaType: ShortsMediaType;
  previewUrl: string;
  sourceMedia: HTMLImageElement | HTMLVideoElement;
  frames: ShortFrame[];
  selectedFrameId: string | null;
  stitchedVideoUrl: string | null;
  singleOutputs: Record<string, string>;
};

type PendingRestoreMeta = {
  outputAspect: OutputAspect;
  projects: Array<{
    id: string;
    imageId: string;
    imageName: string;
    imageWidth: number;
    imageHeight: number;
    frames: ShortFrame[];
  }>;
};

type BannerAsset = {
  imageId: string;
  imageName: string;
  width: number;
  height: number;
};

type ThemeSettings = {
  themeEnabled: boolean;
  themeBlur: number;
  themeDarkness: number;
  frameScale: number;
};

type BannerSettings = {
  bannerMode: boolean;
  bannerEnabled: boolean;
  bannerUseCurrentImage: boolean;
  bannerPosition: "top" | "bottom";
  bannerHeightPercent: number;
  bannerFit: "contain" | "cover";
  bannerCropX: number;
  bannerCropY: number;
  bannerCropLeft?: number;
  bannerCropRight?: number;
  bannerCropTop?: number;
  bannerCropBottom?: number;
  bannerScale: number;
  bannerOpacity: number;
  bannerImageId: string | null;
};

const DEFAULT_THEME_SETTINGS: ThemeSettings = {
  themeEnabled: true,
  themeBlur: 12,
  themeDarkness: 0.45,
  frameScale: 0.92,
};
const SHORTS_MULTI_BANNER_KEY = "shorts-multi-image-editor-banner-v1";
const DEFAULT_BANNER_SETTINGS: BannerSettings = {
  bannerMode: false,
  bannerEnabled: true,
  bannerUseCurrentImage: false,
  bannerPosition: "top",
  bannerHeightPercent: 20,
  bannerFit: "contain",
  bannerCropX: 0,
  bannerCropY: 0,
  bannerCropLeft: 0,
  bannerCropRight: 0,
  bannerCropTop: 0,
  bannerCropBottom: 0,
  bannerScale: 1,
  bannerOpacity: 0.9,
  bannerImageId: null,
};

const accentColorCache = new WeakMap<HTMLImageElement | HTMLVideoElement, string>();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toSafeNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) return fallback;
  return value;
}

function toSafeString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

type RawStoredFrameBannerSettings = Partial<ShortFrameBannerSettings> & {
  bannerOffsetX?: number;
  bannerOffsetY?: number;
};

function normalizeRestoredFrameBannerSettings(raw: unknown): ShortFrameBannerSettings | undefined {
  if (raw === null || raw === undefined || typeof raw !== "object") return undefined;
  const r = raw as RawStoredFrameBannerSettings;
  return {
    bannerPosition: r.bannerPosition === "bottom" ? "bottom" : "top",
    bannerHeightPercent: clamp(
      toSafeNumber(r.bannerHeightPercent, DEFAULT_BANNER_SETTINGS.bannerHeightPercent),
      10,
      35
    ),
    bannerFit: r.bannerFit === "cover" ? "cover" : "contain",
    bannerCropX: clamp(toSafeNumber(r.bannerCropX ?? r.bannerOffsetX, 0), -100, 100),
    bannerCropY: clamp(toSafeNumber(r.bannerCropY ?? r.bannerOffsetY, 0), -100, 100),
    bannerCropLeft: clamp(toSafeNumber(r.bannerCropLeft, 0), 0, 50),
    bannerCropRight: clamp(toSafeNumber(r.bannerCropRight, 0), 0, 50),
    bannerCropTop: clamp(toSafeNumber(r.bannerCropTop, 0), 0, 50),
    bannerCropBottom: clamp(toSafeNumber(r.bannerCropBottom, 0), 0, 50),
    bannerScale: clamp(toSafeNumber(r.bannerScale, DEFAULT_BANNER_SETTINGS.bannerScale), 0.5, 2.5),
    bannerOpacity: clamp(toSafeNumber(r.bannerOpacity, DEFAULT_BANNER_SETTINGS.bannerOpacity), 0, 1),
  };
}

function globalBannerToFrameBannerSettings(g: BannerSettings): ShortFrameBannerSettings {
  return {
    bannerPosition: g.bannerPosition === "bottom" ? "bottom" : "top",
    bannerHeightPercent: clamp(toSafeNumber(g.bannerHeightPercent, DEFAULT_BANNER_SETTINGS.bannerHeightPercent), 10, 35),
    bannerFit: g.bannerFit === "cover" ? "cover" : "contain",
    bannerCropX: clamp(toSafeNumber(g.bannerCropX, 0), -100, 100),
    bannerCropY: clamp(toSafeNumber(g.bannerCropY, 0), -100, 100),
    bannerCropLeft: clamp(toSafeNumber(g.bannerCropLeft, 0), 0, 50),
    bannerCropRight: clamp(toSafeNumber(g.bannerCropRight, 0), 0, 50),
    bannerCropTop: clamp(toSafeNumber(g.bannerCropTop, 0), 0, 50),
    bannerCropBottom: clamp(toSafeNumber(g.bannerCropBottom, 0), 0, 50),
    bannerScale: clamp(toSafeNumber(g.bannerScale, DEFAULT_BANNER_SETTINGS.bannerScale), 0.5, 2.5),
    bannerOpacity: clamp(toSafeNumber(g.bannerOpacity, DEFAULT_BANNER_SETTINGS.bannerOpacity), 0, 1),
  };
}

function newId(): string {
  return `sf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isAllowedImageFile(file: File): boolean {
  if (file.type === "image/gif") return true;
  if (file.type && ACCEPT_MIME.has(file.type)) return true;
  if (file.type && ACCEPT_VIDEO_MIME.has(file.type)) return true;
  return /\.(png|jpe?g|webp|gif|mp4|webm|mov)$/i.test(file.name);
}

function detectMediaType(file: File): ShortsMediaType {
  if (file.type === "image/gif" || /\.gif$/i.test(file.name)) return "gif";
  if (file.type.startsWith("video/") || /\.(mp4|webm|mov)$/i.test(file.name)) return "video";
  return "image";
}

function isAllowedAudioFile(file: File): boolean {
  if (file.type && ACCEPT_AUDIO_MIME.has(file.type)) return true;
  return /\.(mp3|wav|m4a)$/i.test(file.name);
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mm = Math.floor(safe / 60);
  const ss = Math.floor(safe % 60);
  return `${mm}:${String(ss).padStart(2, "0")}`;
}

function getOutputDimensions(aspect: OutputAspect): { width: number; height: number } {
  switch (aspect) {
    case "1:1":
      return { width: 720, height: 720 };
    case "16:9":
      return { width: 960, height: 540 };
    case "9:16":
    default:
      return { width: 540, height: 960 };
  }
}

function getCropAspectFromOutput(aspect: OutputAspect): number {
  const { width, height } = getOutputDimensions(aspect);
  return width / height;
}

function maxCenteredCropNormalized(centerX: number, centerY: number, cropAspect: number): { cropW: number; cropH: number } {
  const cx = clamp(toSafeNumber(centerX, 0.5), 0, 1);
  const cy = clamp(toSafeNumber(centerY, 0.5), 0, 1);
  const maxHalfW = Math.min(cx, 1 - cx);
  const maxHalfH = Math.min(cy, 1 - cy);
  const maxBoxW = 2 * maxHalfW;
  const maxBoxH = 2 * maxHalfH;
  let cropH = maxBoxH;
  let cropW = cropH * cropAspect;
  if (cropW > maxBoxW) {
    cropW = maxBoxW;
    cropH = cropW / cropAspect;
  }
  return {
    cropW: clamp(cropW, 0.0001, 1),
    cropH: clamp(cropH, 0.0001, 1),
  };
}

function clampCropBox(frame: Pick<ShortFrame, "centerX" | "centerY" | "cropW" | "cropH">): { centerX: number; centerY: number } {
  const cx = clamp(toSafeNumber(frame.centerX, 0.5), 0, 1);
  const cy = clamp(toSafeNumber(frame.centerY, 0.5), 0, 1);
  const halfW = frame.cropW / 2;
  const halfH = frame.cropH / 2;
  return {
    centerX: clamp(cx, halfW, 1 - halfW),
    centerY: clamp(cy, halfH, 1 - halfH),
  };
}

function getCropPxRect(frame: ShortFrame, imageWidth: number, imageHeight: number): { sx: number; sy: number; sw: number; sh: number } {
  const { centerX, centerY } = clampCropBox(frame);
  const sw = frame.cropW * imageWidth;
  const sh = frame.cropH * imageHeight;
  const cx = centerX * imageWidth;
  const cy = centerY * imageHeight;
  return {
    sx: clamp(cx - sw / 2, 0, imageWidth - sw),
    sy: clamp(cy - sh / 2, 0, imageHeight - sh),
    sw,
    sh,
  };
}

function normalizeOrders(frames: ShortFrame[]): ShortFrame[] {
  return [...frames].sort((a, b) => a.order - b.order).map((f, idx) => ({ ...f, order: idx + 1 }));
}

function getFrameIndexAtTime(timeSec: number, frames: ShortFrame[]): number {
  if (frames.length === 0) return -1;
  const t = Math.max(0, Number.isFinite(timeSec) ? timeSec : 0);
  const firstStart = Math.max(0, toSafeNumber(frames[0].startTime, 0));
  if (t < firstStart) return 0;
  for (let i = 0; i < frames.length; i += 1) {
    const start = Math.max(0, toSafeNumber(frames[i].startTime, i * 3));
    const end = Math.max(start + 0.05, toSafeNumber(frames[i].endTime, start + 3));
    if (t >= start && t < end) return i;
  }
  return frames.length - 1;
}

function getFrameDuration(frame: ShortFrame): number {
  const start = Math.max(0, toSafeNumber(frame.startTime, 0));
  const end = Math.max(start + 0.05, toSafeNumber(frame.endTime, start + 3));
  return end - start;
}

function relabelByOrder(frames: ShortFrame[]): ShortFrame[] {
  return normalizeOrders(frames).map((f, idx) => ({ ...f, label: `#${idx + 1}` }));
}

function withNarrationByLang(frame: ShortFrame, fallbackText?: string): ShortFrame {
  const seed = toSafeString(fallbackText ?? frame.text, "");
  const narrationByLang: Partial<Record<UiLocale, string>> = {
    en: toSafeString(frame.narrationByLang?.en, seed || narrationDefaults.en),
    es: toSafeString(frame.narrationByLang?.es, seed || narrationDefaults.es),
    pt: toSafeString(frame.narrationByLang?.pt, seed || narrationDefaults.pt),
    id: toSafeString(frame.narrationByLang?.id, seed || narrationDefaults.id),
    th: toSafeString(frame.narrationByLang?.th, seed || narrationDefaults.th),
    ko: toSafeString(frame.narrationByLang?.ko, seed || narrationDefaults.ko),
    ja: toSafeString(frame.narrationByLang?.ja, seed || narrationDefaults.ja),
  };
  return {
    ...frame,
    narrationByLang,
  };
}

function defaultSixFrames(aspect: OutputAspect, locale: UiLocale): ShortFrame[] {
  const cropAspect = getCropAspectFromOutput(aspect);
  const centers = [
    { label: "#1", cx: 1 / 6, cy: 0.25, text: "Intuitive Formation Editor" },
    { label: "#2", cx: 0.5, cy: 0.25, text: "Simulate Your Tactics" },
    { label: "#3", cx: 5 / 6, cy: 0.25, text: "Global League Data" },
    { label: "#4", cx: 1 / 6, cy: 0.75, text: "Monetize with Ad Spaces" },
    { label: "#5", cx: 0.5, cy: 0.75, text: "Match Prediction" },
    { label: "#6", cx: 5 / 6, cy: 0.75, text: "Make Football More Strategic" },
  ];
  return centers.map((c, index) => {
    const { cropW, cropH } = maxCenteredCropNormalized(c.cx, c.cy, cropAspect);
    const draft: ShortFrame = {
      id: newId(),
      order: index + 1,
      label: c.label,
      aspect,
      centerX: c.cx,
      centerY: c.cy,
      cropW: cropW * 0.92,
      cropH: cropH * 0.92,
      text: c.text,
      narrationByLang: {
        en: c.text,
        es: narrationDefaults.es,
        pt: narrationDefaults.pt,
        id: narrationDefaults.id,
        th: narrationDefaults.th,
        ko: narrationDefaults.ko,
        ja: narrationDefaults.ja,
      },
      startTime: index * 3,
      endTime: (index + 1) * 3,
      zoomScale: 1.12,
      frameCropX: 0,
      frameCropY: 0,
      frameScale: 1,
      frameFit: "cover",
      frameCropLeft: 0,
      frameCropRight: 0,
      frameCropTop: 0,
      frameCropBottom: 0,
      videoStart: index * 1,
      videoEnd: (index + 1) * 1,
      videoMuted: true,
      videoLoop: false,
      playbackRate: 1,
    };
    const clamped = clampCropBox(draft);
    const normalized = withNarrationByLang({ ...draft, ...clamped }, c.text);
    return { ...normalized, text: toSafeString(normalized.narrationByLang?.[locale], c.text) };
  });
}

function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
}

function pickMimeType(): string {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "video/webm";
}

function pickExportMimeType(): { mimeType: string; ext: "mp4" | "webm" } {
  const candidates: Array<{ mimeType: string; ext: "mp4" | "webm" }> = [
    { mimeType: "video/mp4;codecs=h264,aac", ext: "mp4" },
    { mimeType: "video/mp4", ext: "mp4" },
    { mimeType: "video/webm;codecs=vp9,opus", ext: "webm" },
    { mimeType: "video/webm;codecs=vp8,opus", ext: "webm" },
    { mimeType: "video/webm", ext: "webm" },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  return { mimeType: "video/webm", ext: "webm" };
}

function drawCoverImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | HTMLVideoElement,
  destW: number,
  destH: number
): void {
  const dims = getMediaDims(image);
  const sw = dims.width;
  const sh = dims.height;
  if (sw <= 0 || sh <= 0) return;
  const scale = Math.max(destW / sw, destH / sh);
  const drawW = sw * scale;
  const drawH = sh * scale;
  const dx = (destW - drawW) / 2;
  const dy = (destH - drawH) / 2;
  ctx.drawImage(image, dx, dy, drawW, drawH);
}

function drawCoverIntoRect(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | HTMLVideoElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): void {
  const dims = getMediaDims(image);
  const sw = dims.width;
  const sh = dims.height;
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return;
  const scale = Math.max(dw / sw, dh / sh);
  const drawW = sw * scale;
  const drawH = sh * scale;
  const x = dx + (dw - drawW) / 2;
  const y = dy + (dh - drawH) / 2;
  ctx.drawImage(image, x, y, drawW, drawH);
}

function getFitRect(
  image: HTMLImageElement | HTMLVideoElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
  fit: "contain" | "cover"
): { x: number; y: number; width: number; height: number } {
  const dims = getMediaDims(image);
  const sw = dims.width;
  const sh = dims.height;
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return { x: dx, y: dy, width: 0, height: 0 };
  const scale = fit === "contain" ? Math.min(dw / sw, dh / sh) : Math.max(dw / sw, dh / sh);
  const width = sw * scale;
  const height = sh * scale;
  return {
    x: dx + (dw - width) / 2,
    y: dy + (dh - height) / 2,
    width,
    height,
  };
}

function clampCropPair(primary: number, secondary: number): { primary: number; secondary: number } {
  const p = clamp(primary, 0, 50);
  const s = clamp(secondary, 0, 50);
  if (p + s <= 90) return { primary: p, secondary: s };
  return { primary: p, secondary: clamp(90 - p, 0, 50) };
}

function croppedSourceRect(
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  cropLeft: number,
  cropRight: number,
  cropTop: number,
  cropBottom: number
): { sx: number; sy: number; sw: number; sh: number } {
  const lr = clampCropPair(cropLeft, cropRight);
  const tb = clampCropPair(cropTop, cropBottom);
  const nextSx = sx + sw * (lr.primary / 100);
  const nextSy = sy + sh * (tb.primary / 100);
  const nextSw = Math.max(1, sw * (1 - (lr.primary + lr.secondary) / 100));
  const nextSh = Math.max(1, sh * (1 - (tb.primary + tb.secondary) / 100));
  return { sx: nextSx, sy: nextSy, sw: nextSw, sh: nextSh };
}

function getBannerDrawRect(
  outW: number,
  outH: number,
  banner: BannerSettings,
  bannerImage: HTMLImageElement | HTMLVideoElement
): { x: number; y: number; width: number; height: number } {
  const bannerH = outH * clamp(toSafeNumber(banner.bannerHeightPercent, 20) / 100, 0.1, 0.35);
  const baseY = banner.bannerPosition === "bottom" ? outH - bannerH : 0;
  const fitRect = getFitRect(
    bannerImage,
    0,
    baseY,
    outW,
    bannerH,
    banner.bannerFit === "cover" ? "cover" : "contain"
  );
  const scale = clamp(toSafeNumber(banner.bannerScale, 1), 0.5, 2.5);
  const scaledW = fitRect.width * scale;
  const scaledH = fitRect.height * scale;
  const centerX = fitRect.x + fitRect.width / 2 + (clamp(toSafeNumber(banner.bannerCropX, 0), -100, 100) / 100) * outW;
  const centerY = fitRect.y + fitRect.height / 2 + (clamp(toSafeNumber(banner.bannerCropY, 0), -100, 100) / 100) * outH;
  return {
    x: centerX - scaledW / 2,
    y: centerY - scaledH / 2,
    width: scaledW,
    height: scaledH,
  };
}

function getMediaDims(media: HTMLImageElement | HTMLVideoElement): { width: number; height: number } {
  if (media instanceof HTMLVideoElement) {
    return { width: Math.max(1, media.videoWidth || 1), height: Math.max(1, media.videoHeight || 1) };
  }
  return { width: Math.max(1, media.naturalWidth || 1), height: Math.max(1, media.naturalHeight || 1) };
}

function syncVideoTimeForFrame(source: HTMLImageElement | HTMLVideoElement, frame: ShortFrame, progress: number): void {
  if (!(source instanceof HTMLVideoElement)) return;
  const duration = Math.max(0.001, source.duration || 0.001);
  const start = clamp(toSafeNumber(frame.videoStart, 0), 0, duration);
  const rawEnd = toSafeNumber(frame.videoEnd, duration);
  const end = clamp(Math.max(start, rawEnd), start, duration);
  const t = start + (end - start) * clamp(progress, 0, 1);
  if (Number.isFinite(t) && Math.abs((source.currentTime || 0) - t) > 0.02) {
    source.currentTime = t;
  }
}

function drawMainWithFrameAdjust(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLVideoElement,
  frame: ShortFrame,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): void {
  const src = croppedSourceRect(
    sx,
    sy,
    sw,
    sh,
    toSafeNumber(frame.frameCropLeft, 0),
    toSafeNumber(frame.frameCropRight, 0),
    toSafeNumber(frame.frameCropTop, 0),
    toSafeNumber(frame.frameCropBottom, 0)
  );
  const fit = frame.frameFit === "contain" ? "contain" : "cover";
  const fitScale = fit === "contain" ? Math.min(dw / src.sw, dh / src.sh) : Math.max(dw / src.sw, dh / src.sh);
  const baseW = src.sw * fitScale;
  const baseH = src.sh * fitScale;
  const scale = clamp(toSafeNumber(frame.frameScale, 1), 0.5, 2.5);
  const drawW = baseW * scale;
  const drawH = baseH * scale;
  const offsetX = (clamp(toSafeNumber(frame.frameCropX, 0), -100, 100) / 100) * dw;
  const offsetY = (clamp(toSafeNumber(frame.frameCropY, 0), -100, 100) / 100) * dh;
  const x = dx + (dw - drawW) / 2 + offsetX;
  const y = dy + (dh - drawH) / 2 + offsetY;
  ctx.drawImage(source as CanvasImageSource, src.sx, src.sy, src.sw, src.sh, x, y, drawW, drawH);
}

function pickFrameBannerSettings(frame: ShortFrame | null | undefined, globalBanner: BannerSettings): BannerSettings {
  const frameEnabled = frame?.bannerEnabled === true;
  const globalEnabled = globalBanner.bannerEnabled === true;
  const shouldDraw = frameEnabled || globalEnabled;
  if (!shouldDraw) return { ...globalBanner, bannerEnabled: false, bannerMode: false };
  const resolved = {
    ...globalBanner,
    ...(frame?.bannerSettings ?? {}),
    bannerEnabled: shouldDraw,
    bannerMode: true,
  };
  console.log("[pickFrameBannerSettings] resolved", {
    frameId: frame?.id ?? null,
    frameEnabled,
    globalEnabled,
    frameBannerSettings: frame?.bannerSettings ?? null,
    resolved,
  });
  return resolved;
}

function getThemeAccentColor(image: HTMLImageElement | HTMLVideoElement): string {
  const cached = accentColorCache.get(image);
  if (cached) return cached;
  const probe = document.createElement("canvas");
  probe.width = 24;
  probe.height = 24;
  const pctx = probe.getContext("2d");
  if (!pctx) return "255,72,72";
  pctx.drawImage(image, 0, 0, probe.width, probe.height);
  const data = pctx.getImageData(0, 0, probe.width, probe.height).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    const pxR = data[i];
    const pxG = data[i + 1];
    const pxB = data[i + 2];
    const luma = 0.299 * pxR + 0.587 * pxG + 0.114 * pxB;
    if (luma < 25) continue;
    r += pxR;
    g += pxG;
    b += pxB;
    count += 1;
  }
  const avgR = Math.round((count > 0 ? r / count : 255) * 0.95);
  const avgG = Math.round((count > 0 ? g / count : 72) * 0.55);
  const avgB = Math.round((count > 0 ? b / count : 72) * 0.55);
  const value = `${clamp(avgR, 0, 255)},${clamp(avgG, 0, 255)},${clamp(avgB, 0, 255)}`;
  accentColorCache.set(image, value);
  return value;
}

function drawFrameComposite(params: {
  ctx: CanvasRenderingContext2D;
  source: HTMLImageElement | HTMLVideoElement;
  frame: ShortFrame;
  outW: number;
  outH: number;
  theme: ThemeSettings;
  banner: BannerSettings;
  bannerImage: HTMLImageElement | HTMLVideoElement | null;
}): void {
  const { ctx, source, frame, outW, outH, theme, banner, bannerImage } = params;
  const dims = getMediaDims(source);
  const rect = getCropPxRect(frame, dims.width, dims.height);
  ctx.clearRect(0, 0, outW, outH);
  if (!theme.themeEnabled) {
    drawMainWithFrameAdjust(ctx, source, frame, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, outW, outH);
  } else {
    const blurPx = clamp(theme.themeBlur, 0, 24);
    const darkness = clamp(theme.themeDarkness, 0, 0.85);
    const scale = clamp(theme.frameScale, 0.72, 1);
    const cardW = outW * scale;
    const cardH = outH * scale;
    const cardX = (outW - cardW) / 2;
    const cardY = (outH - cardH) / 2;
    const radius = 16;
    const accentRgb = getThemeAccentColor(source);

    ctx.save();
    ctx.filter = `blur(${blurPx}px)`;
    drawCoverImage(ctx, source, outW, outH);
    ctx.restore();

    ctx.fillStyle = `rgba(0,0,0,${darkness})`;
    ctx.fillRect(0, 0, outW, outH);

    const topGrad = ctx.createLinearGradient(0, 0, 0, outH * 0.28);
    topGrad.addColorStop(0, `rgba(${accentRgb},0.28)`);
    topGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, outW, outH * 0.28);

    const bottomGrad = ctx.createLinearGradient(0, outH, 0, outH * 0.62);
    bottomGrad.addColorStop(0, `rgba(${accentRgb},0.24)`);
    bottomGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = bottomGrad;
    ctx.fillRect(0, outH * 0.62, outW, outH * 0.38);

    ctx.strokeStyle = `rgba(${accentRgb},0.55)`;
    ctx.lineWidth = Math.max(2, Math.round(outW * 0.005));
    ctx.strokeRect(0, Math.round(outH * 0.18), outW, Math.round(outH * 0.64));

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, radius);
    ctx.closePath();
    ctx.clip();
    drawMainWithFrameAdjust(ctx, source, frame, rect.sx, rect.sy, rect.sw, rect.sh, cardX, cardY, cardW, cardH);
    ctx.restore();

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 8;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, radius);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  const barH = Math.round(outH * 0.18);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fillRect(0, outH - barH, outW, barH);
  ctx.fillStyle = "#fff";
  ctx.font = `700 ${Math.max(22, Math.round(outW * 0.055))}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(frame.text || "", outW / 2, outH - barH / 2, outW - 48);

  if (banner.bannerMode && banner.bannerEnabled && bannerImage) {
    const rect = getBannerDrawRect(outW, outH, banner, bannerImage);
    const src = croppedSourceRect(
      0,
      0,
      bannerImage instanceof HTMLVideoElement ? bannerImage.videoWidth : bannerImage.naturalWidth,
      bannerImage instanceof HTMLVideoElement ? bannerImage.videoHeight : bannerImage.naturalHeight,
      toSafeNumber((banner as Partial<BannerSettings>).bannerCropLeft, 0),
      toSafeNumber((banner as Partial<BannerSettings>).bannerCropRight, 0),
      toSafeNumber((banner as Partial<BannerSettings>).bannerCropTop, 0),
      toSafeNumber((banner as Partial<BannerSettings>).bannerCropBottom, 0)
    );
    ctx.save();
    ctx.globalAlpha = clamp(toSafeNumber(banner.bannerOpacity, 0.9), 0, 1);
    ctx.drawImage(bannerImage as CanvasImageSource, src.sx, src.sy, src.sw, src.sh, rect.x, rect.y, rect.width, rect.height);
    ctx.restore();
  }
}

async function loadMediaFromFile(file: File): Promise<{ media: HTMLImageElement | HTMLVideoElement; objectUrl: string; mediaType: ShortsMediaType; width: number; height: number }> {
  const objectUrl = URL.createObjectURL(file);
  const mediaType = detectMediaType(file);
  try {
    if (mediaType === "video") {
      const video = await new Promise<HTMLVideoElement>((resolve, reject) => {
        const v = document.createElement("video");
        v.preload = "auto";
        v.muted = true;
        v.playsInline = true;
        v.onloadedmetadata = () => resolve(v);
        v.onerror = (ev) => reject(new Error(`video load failed: ${String(ev)}`));
        v.src = objectUrl;
      });
      return { media: video, objectUrl, mediaType, width: video.videoWidth || 1920, height: video.videoHeight || 1080 };
    }
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new window.Image();
      img.onload = () => resolve(img);
      img.onerror = (ev) => reject(new Error(`img.onload で失敗: ${String(ev)}`));
      img.src = objectUrl;
    });
    const probe = document.createElement("canvas");
    probe.width = 2;
    probe.height = 2;
    const ctx = probe.getContext("2d");
    if (!ctx) throw new Error("canvas context 取得に失敗しました。");
    ctx.drawImage(image, 0, 0, 2, 2);
    return { media: image, objectUrl, mediaType, width: image.naturalWidth, height: image.naturalHeight };
  } catch (e) {
    URL.revokeObjectURL(objectUrl);
    throw e;
  }
}

async function renderSingleSegment(
  source: HTMLImageElement | HTMLVideoElement,
  frame: ShortFrame,
  aspect: OutputAspect,
  kenBurns: number,
  theme: ThemeSettings,
  banner: BannerSettings,
  bannerImage: HTMLImageElement | HTMLVideoElement | null
): Promise<Blob> {
  const { width: outW, height: outH } = getOutputDimensions(aspect);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable.");
  const stream = canvas.captureStream(30);
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: pickMimeType(), videoBitsPerSecond: 4_000_000 });
  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };
  const stopPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error("動画生成に失敗しました。"));
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
    };
  });
  const duration = clamp(getFrameDuration(frame), 0.05, 30);
  const zoom = clamp(toSafeNumber(frame.zoomScale, 1.12), 1, 3);
  const dims = getMediaDims(source);
  const base = getCropPxRect(frame, dims.width, dims.height);
  const shrink = 1 + kenBurns * (zoom - 1);
  const innerW = clamp(base.sw / shrink, 1, base.sw);
  const innerH = clamp(base.sh / shrink, 1, base.sh);
  recorder.start(150);
  const startedAt = performance.now();
  await new Promise<void>((resolve) => {
    const draw = () => {
      const progress = clamp((performance.now() - startedAt) / 1000 / duration, 0, 1);
      syncVideoTimeForFrame(source, frame, progress);
      const eased = easeInOutCubic(progress);
      const sw = base.sw + (innerW - base.sw) * eased;
      const sh = base.sh + (innerH - base.sh) * eased;
      const cx = frame.centerX * dims.width;
      const cy = frame.centerY * dims.height;
      const sx = clamp(cx - sw / 2, 0, dims.width - sw);
      const sy = clamp(cy - sh / 2, 0, dims.height - sh);
      drawFrameComposite({
        ctx,
        source,
        frame: {
          ...frame,
          centerX: (sx + sw / 2) / dims.width,
          centerY: (sy + sh / 2) / dims.height,
          cropW: sw / dims.width,
          cropH: sh / dims.height,
        },
        outW,
        outH,
        theme,
        banner: pickFrameBannerSettings(frame, banner),
        bannerImage,
      });
      if (progress >= 1) {
        recorder.stop();
        resolve();
        return;
      }
      requestAnimationFrame(draw);
    };
    draw();
  });
  return stopPromise;
}

async function renderStitched(
  source: HTMLImageElement | HTMLVideoElement,
  frames: ShortFrame[],
  aspect: OutputAspect,
  kenBurns: number,
  theme: ThemeSettings,
  banner: BannerSettings,
  bannerImage: HTMLImageElement | HTMLVideoElement | null
): Promise<Blob> {
  const { width: outW, height: outH } = getOutputDimensions(aspect);
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas context unavailable.");
  const stream = canvas.captureStream(30);
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: pickMimeType(), videoBitsPerSecond: 4_000_000 });
  recorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };
  const stopPromise = new Promise<Blob>((resolve, reject) => {
    recorder.onerror = () => reject(new Error("動画生成に失敗しました。"));
    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
    };
  });
  const durations = frames.map((f) => clamp(getFrameDuration(f), 0.05, 30));
  const starts: number[] = [];
  let acc = 0;
  for (const d of durations) {
    starts.push(acc);
    acc += d;
  }
  const total = Math.max(acc, 0.001);
  recorder.start(150);
  const startedAt = performance.now();
  await new Promise<void>((resolve) => {
    const draw = () => {
      const elapsed = (performance.now() - startedAt) / 1000;
      const global = clamp(elapsed / total, 0, 1);
      let idx = 0;
      while (idx < frames.length - 1 && elapsed >= starts[idx + 1]) idx += 1;
      const frame = frames[idx];
      const local = clamp((elapsed - starts[idx]) / durations[idx], 0, 1);
      syncVideoTimeForFrame(source, frame, local);
      const eased = easeInOutCubic(local);
      const zoom = clamp(toSafeNumber(frame.zoomScale, 1.12), 1, 3);
      const dims = getMediaDims(source);
      const base = getCropPxRect(frame, dims.width, dims.height);
      const shrink = 1 + kenBurns * (zoom - 1);
      const innerW = clamp(base.sw / shrink, 1, base.sw);
      const innerH = clamp(base.sh / shrink, 1, base.sh);
      const sw = base.sw + (innerW - base.sw) * eased;
      const sh = base.sh + (innerH - base.sh) * eased;
      const cx = frame.centerX * dims.width;
      const cy = frame.centerY * dims.height;
      const sx = clamp(cx - sw / 2, 0, dims.width - sw);
      const sy = clamp(cy - sh / 2, 0, dims.height - sh);
      drawFrameComposite({
        ctx,
        source,
        frame: {
          ...frame,
          centerX: (sx + sw / 2) / dims.width,
          centerY: (sy + sh / 2) / dims.height,
          cropW: sw / dims.width,
          cropH: sh / dims.height,
        },
        outW,
        outH,
        theme,
        banner: pickFrameBannerSettings(frame, banner),
        bannerImage,
      });
      if (global >= 1) {
        recorder.stop();
        resolve();
        return;
      }
      requestAnimationFrame(draw);
    };
    draw();
  });
  return stopPromise;
}

function drawBrandEndCard(ctx: CanvasRenderingContext2D, outW: number, outH: number): void {
  ctx.clearRect(0, 0, outW, outH);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, outW, outH);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.max(24, Math.round(outW * 0.06))}px sans-serif`;
  ctx.fillText("create with", outW / 2, outH * 0.45);
  ctx.font = `800 ${Math.max(34, Math.round(outW * 0.09))}px sans-serif`;
  ctx.fillText("gegenpress app", outW / 2, outH * 0.56);
}

function FrameThumb(props: { source: HTMLImageElement | null; frame: ShortFrame; width: number; height: number }): ReactElement | null {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !props.source) return;
    c.width = props.width;
    c.height = props.height;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const base = getCropPxRect(props.frame, props.source.naturalWidth, props.source.naturalHeight);
    const { sx, sy, sw, sh } = croppedSourceRect(
      base.sx,
      base.sy,
      base.sw,
      base.sh,
      toSafeNumber(props.frame.frameCropLeft, 0),
      toSafeNumber(props.frame.frameCropRight, 0),
      toSafeNumber(props.frame.frameCropTop, 0),
      toSafeNumber(props.frame.frameCropBottom, 0)
    );
    ctx.clearRect(0, 0, props.width, props.height);
    ctx.drawImage(props.source, sx, sy, sw, sh, 0, 0, props.width, props.height);
  }, [props.frame, props.height, props.source, props.width]);
  if (!props.source) return null;
  return <canvas ref={canvasRef} className="w-full rounded-md border border-slate-200 bg-black" style={{ aspectRatio: `${props.width} / ${props.height}` }} />;
}

export default function EatingDemoClient() {
  const { locale } = useUiLocale();
  const t = shortsI18n[locale] ?? shortsI18n.en;
  const themeLabel = locale === "en" ? "Apply original image theme" : "元画像テーマを合成";
  const blurLabel = locale === "en" ? "Background blur" : "背景ぼかし";
  const darkLabel = locale === "en" ? "Background darkness" : "背景暗さ";
  const scaleLabel = locale === "en" ? "Frame scale" : "フレーム拡大率";
  const useAsBannerLabel = locale === "en" ? "Use this image as banner" : "この画像を帯として使う";
  const uploadBannerLabel = locale === "en" ? "Upload banner image" : "帯画像をアップロード";
  const bannerOnOffLabel = locale === "en" ? "Show banner" : "帯表示";
  const bannerPositionLabel = locale === "en" ? "Banner position" : "帯位置";
  const bannerHeightLabel = locale === "en" ? "Banner height" : "帯の高さ";
  const bannerFitLabel = locale === "en" ? "Fit mode" : "表示方法";
  const containLabel = locale === "en" ? "contain" : "contain";
  const coverLabel = locale === "en" ? "cover" : "cover";
  const bannerOffsetXLabel = locale === "en" ? "Horizontal position" : "横位置";
  const bannerOffsetYLabel = locale === "en" ? "Vertical position" : "縦位置";
  const bannerScaleLabel = locale === "en" ? "Banner scale" : "帯の拡大率";
  const bannerOpacityLabel = locale === "en" ? "Opacity" : "透明度";
  const bannerResetLabel = locale === "en" ? "Reset banner position" : "帯位置をリセット";
  const frameOffsetXLabel = locale === "en" ? "Main horizontal position" : "本体 横位置";
  const frameOffsetYLabel = locale === "en" ? "Main vertical position" : "本体 縦位置";
  const frameScaleLabel = locale === "en" ? "Main scale" : "本体 拡大率";
  const frameFitLabel = locale === "en" ? "Main fit" : "本体 表示方法";
  const frameCropLeftLabel = locale === "en" ? "Main crop left" : "本体 crop 左";
  const frameCropRightLabel = locale === "en" ? "Main crop right" : "本体 crop 右";
  const frameCropTopLabel = locale === "en" ? "Main crop top" : "本体 crop 上";
  const frameCropBottomLabel = locale === "en" ? "Main crop bottom" : "本体 crop 下";
  const frameCropResetLabel = locale === "en" ? "Reset main crop" : "本体 crop リセット";
  const bannerCropLeftLabel = locale === "en" ? "Banner crop left" : "帯 crop 左";
  const bannerCropRightLabel = locale === "en" ? "Banner crop right" : "帯 crop 右";
  const bannerCropTopLabel = locale === "en" ? "Banner crop top" : "帯 crop 上";
  const bannerCropBottomLabel = locale === "en" ? "Banner crop bottom" : "帯 crop 下";
  const bannerCropResetLabel = locale === "en" ? "Reset banner crop" : "帯 crop リセット";
  const topLabel = locale === "en" ? "Top" : "上";
  const bottomLabel = locale === "en" ? "Bottom" : "下";
  const inputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasWrapRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewImageRef = useRef<HTMLImageElement | HTMLVideoElement>(null);
  const isDraggingRef = useRef(false);
  const dragFrameIdRef = useRef<string | null>(null);
  const generatedUrlsRef = useRef<string[]>([]);
  const dragStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [draggingBanner, setDraggingBanner] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [outputAspect, setOutputAspect] = useState<OutputAspect>("9:16");
  const [kenBurns, setKenBurns] = useState(0.55);
  const [projects, setProjects] = useState<ImageProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [isGeneratingStitchedProjectId, setIsGeneratingStitchedProjectId] = useState<string | null>(null);
  const [isGeneratingSingle, setIsGeneratingSingle] = useState<{ projectId: string; frameId: string } | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [pendingRestoreMeta, setPendingRestoreMeta] = useState<PendingRestoreMeta | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [previewFrameId, setPreviewFrameId] = useState<string | null>(null);
  const [isRenderingWholeVideo, setIsRenderingWholeVideo] = useState(false);
  const [wholeVideoUrl, setWholeVideoUrl] = useState<string | null>(null);
  const [wholeVideoExt, setWholeVideoExt] = useState<"mp4" | "webm">("webm");
  const [themeSettings, setThemeSettings] = useState<ThemeSettings>(DEFAULT_THEME_SETTINGS);
  const [bannerSettings, setBannerSettings] = useState<BannerSettings>(DEFAULT_BANNER_SETTINGS);
  const [bannerAsset, setBannerAsset] = useState<BannerAsset | null>(null);
  const [bannerPreviewUrl, setBannerPreviewUrl] = useState<string | null>(null);
  const [bannerSourceImage, setBannerSourceImage] = useState<HTMLImageElement | HTMLVideoElement | null>(null);

  const activeProject = useMemo(() => projects.find((p) => p.id === activeProjectId) ?? null, [projects, activeProjectId]);
  const bannerImage = bannerSourceImage;
  const safeBannerCropX = clamp(toSafeNumber((bannerSettings as Partial<BannerSettings>).bannerCropX, 0), -100, 100);
  const safeBannerCropY = clamp(toSafeNumber((bannerSettings as Partial<BannerSettings>).bannerCropY, 0), -100, 100);
  const safeBannerScale = clamp(toSafeNumber(bannerSettings.bannerScale, 1), 0.5, 2.5);
  const safeBannerOpacity = clamp(toSafeNumber(bannerSettings.bannerOpacity, 0.9), 0, 1);
  const safeBannerHeightPercent = clamp(toSafeNumber(bannerSettings.bannerHeightPercent, 20), 10, 35);
  const safeBannerFit: "contain" | "cover" = bannerSettings.bannerFit === "cover" ? "cover" : "contain";
  const safeBannerPosition: "top" | "bottom" = bannerSettings.bannerPosition === "bottom" ? "bottom" : "top";
  const sortedFrames = useMemo(
    () => {
      if (!activeProject) return [];
      return [...activeProject.frames].sort((a, b) => a.order - b.order);
    },
    [activeProject]
  );
  const selectedFrame = useMemo(() => {
    if (!activeProject || sortedFrames.length === 0) return null;
    return sortedFrames.find((f) => f.id === activeProject.selectedFrameId) ?? sortedFrames[0];
  }, [activeProject, sortedFrames]);
  const currentPreviewFrameIndex = getFrameIndexAtTime(audioCurrentTime, sortedFrames);
  const currentPreviewFrame = useMemo(() => {
    if (sortedFrames.length === 0) return null;
    if (isPreviewPlaying) return currentPreviewFrameIndex >= 0 ? sortedFrames[currentPreviewFrameIndex] : sortedFrames[0];
    if (previewFrameId) return sortedFrames.find((f) => f.id === previewFrameId) ?? selectedFrame ?? sortedFrames[0];
    return selectedFrame ?? sortedFrames[0];
  }, [sortedFrames, isPreviewPlaying, currentPreviewFrameIndex, previewFrameId, selectedFrame]);
  const timingWarnings = useMemo(() => {
    const warns: string[] = [];
    for (let i = 0; i < sortedFrames.length; i += 1) {
      const f = sortedFrames[i];
      const s = toSafeNumber(f.startTime, i * 3);
      const e = toSafeNumber(f.endTime, (i + 1) * 3);
      if (!(s < e)) warns.push(`${f.label}: start < end にしてください`);
      if (i > 0) {
        const prev = sortedFrames[i - 1];
        const prevEnd = toSafeNumber(prev.endTime, i * 3);
        if (Math.abs(prevEnd - s) > 0.05) {
          warns.push(`${prev.label} end と ${f.label} start がズレています`);
        }
      }
    }
    if (audioDuration > 0 && sortedFrames.length > 0) {
      const last = sortedFrames[sortedFrames.length - 1];
      const lastEnd = toSafeNumber(last.endTime, 0);
      if (lastEnd > audioDuration + 0.01) warns.push(`最後の end が音声長 (${audioDuration.toFixed(1)}s) を超えています`);
    }
    return warns;
  }, [sortedFrames, audioDuration]);
  const thumbDims = getOutputDimensions(outputAspect);
  const previewDims = getOutputDimensions("9:16");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SHORTS_MULTI_THEME_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
      setThemeSettings({
        themeEnabled: typeof parsed.themeEnabled === "boolean" ? parsed.themeEnabled : DEFAULT_THEME_SETTINGS.themeEnabled,
        themeBlur: clamp(toSafeNumber(parsed.themeBlur, DEFAULT_THEME_SETTINGS.themeBlur), 0, 24),
        themeDarkness: clamp(toSafeNumber(parsed.themeDarkness, DEFAULT_THEME_SETTINGS.themeDarkness), 0, 0.85),
        frameScale: clamp(toSafeNumber(parsed.frameScale, DEFAULT_THEME_SETTINGS.frameScale), 0.72, 1),
      });
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        SHORTS_MULTI_THEME_KEY,
        JSON.stringify({
          themeEnabled: themeSettings.themeEnabled,
          themeBlur: themeSettings.themeBlur,
          themeDarkness: themeSettings.themeDarkness,
          frameScale: themeSettings.frameScale,
        })
      );
    } catch {
      // noop
    }
  }, [themeSettings]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SHORTS_MULTI_BANNER_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<BannerSettings> & {
        bannerOffsetX?: number;
        bannerOffsetY?: number;
      };
      setBannerSettings({
        bannerMode: typeof parsed.bannerMode === "boolean" ? parsed.bannerMode : DEFAULT_BANNER_SETTINGS.bannerMode,
        bannerEnabled: typeof parsed.bannerEnabled === "boolean" ? parsed.bannerEnabled : DEFAULT_BANNER_SETTINGS.bannerEnabled,
        bannerUseCurrentImage: typeof parsed.bannerUseCurrentImage === "boolean" ? parsed.bannerUseCurrentImage : DEFAULT_BANNER_SETTINGS.bannerUseCurrentImage,
        bannerPosition: parsed.bannerPosition === "bottom" ? "bottom" : "top",
        bannerHeightPercent: clamp(toSafeNumber(parsed.bannerHeightPercent, DEFAULT_BANNER_SETTINGS.bannerHeightPercent), 10, 35),
        bannerFit: parsed.bannerFit === "cover" ? "cover" : "contain",
        bannerCropX: clamp(toSafeNumber((parsed as { bannerCropX?: number; bannerOffsetX?: number }).bannerCropX ?? parsed.bannerOffsetX, DEFAULT_BANNER_SETTINGS.bannerCropX), -100, 100),
        bannerCropY: clamp(toSafeNumber((parsed as { bannerCropY?: number; bannerOffsetY?: number }).bannerCropY ?? parsed.bannerOffsetY, DEFAULT_BANNER_SETTINGS.bannerCropY), -100, 100),
        bannerCropLeft: clamp(toSafeNumber((parsed as { bannerCropLeft?: number }).bannerCropLeft, 0), 0, 50),
        bannerCropRight: clamp(toSafeNumber((parsed as { bannerCropRight?: number }).bannerCropRight, 0), 0, 50),
        bannerCropTop: clamp(toSafeNumber((parsed as { bannerCropTop?: number }).bannerCropTop, 0), 0, 50),
        bannerCropBottom: clamp(toSafeNumber((parsed as { bannerCropBottom?: number }).bannerCropBottom, 0), 0, 50),
        bannerScale: clamp(toSafeNumber(parsed.bannerScale, DEFAULT_BANNER_SETTINGS.bannerScale), 0.5, 2.5),
        bannerOpacity: clamp(toSafeNumber(parsed.bannerOpacity, DEFAULT_BANNER_SETTINGS.bannerOpacity), 0, 1),
        bannerImageId: toSafeString(parsed.bannerImageId, "") || null,
      });
      const parsedAsset = parsed as Partial<BannerAsset>;
      if (parsedAsset.imageId) {
        setBannerAsset({
          imageId: parsedAsset.imageId,
          imageName: toSafeString(parsedAsset.imageName, "banner"),
          width: toSafeNumber(parsedAsset.width, 0),
          height: toSafeNumber(parsedAsset.height, 0),
        });
      }
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        SHORTS_MULTI_BANNER_KEY,
        JSON.stringify({
          bannerMode: bannerSettings.bannerMode,
          bannerEnabled: bannerSettings.bannerEnabled,
          bannerUseCurrentImage: bannerSettings.bannerUseCurrentImage,
          bannerPosition: safeBannerPosition,
          bannerHeightPercent: safeBannerHeightPercent,
          bannerFit: safeBannerFit,
          bannerCropX: safeBannerCropX,
          bannerCropY: safeBannerCropY,
          bannerCropLeft: clamp(toSafeNumber((bannerSettings as Partial<BannerSettings>).bannerCropLeft, 0), 0, 50),
          bannerCropRight: clamp(toSafeNumber((bannerSettings as Partial<BannerSettings>).bannerCropRight, 0), 0, 50),
          bannerCropTop: clamp(toSafeNumber((bannerSettings as Partial<BannerSettings>).bannerCropTop, 0), 0, 50),
          bannerCropBottom: clamp(toSafeNumber((bannerSettings as Partial<BannerSettings>).bannerCropBottom, 0), 0, 50),
          bannerScale: safeBannerScale,
          bannerOpacity: safeBannerOpacity,
          bannerImageId: bannerSettings.bannerImageId,
          imageId: bannerAsset?.imageId ?? null,
          imageName: bannerAsset?.imageName ?? null,
          width: bannerAsset?.width ?? null,
          height: bannerAsset?.height ?? null,
        })
      );
    } catch {
      // noop
    }
  }, [bannerAsset, bannerSettings, safeBannerCropX, safeBannerCropY, safeBannerFit, safeBannerHeightPercent, safeBannerOpacity, safeBannerPosition, safeBannerScale]);

  useEffect(() => {
    void (async () => {
      if (!bannerSettings.bannerImageId) {
        setBannerSourceImage(null);
        if (bannerPreviewUrl) {
          URL.revokeObjectURL(bannerPreviewUrl);
          setBannerPreviewUrl(null);
        }
        return;
      }
      const blob = await getShortsImageBlob(bannerSettings.bannerImageId);
      if (!blob) return;
      const objectUrl = URL.createObjectURL(blob);
      try {
        const isVideo = blob.type.startsWith("video/");
        const img = await new Promise<HTMLImageElement | HTMLVideoElement>((resolve, reject) => {
          if (isVideo) {
            const v = document.createElement("video");
            v.muted = true;
            v.playsInline = true;
            v.onloadedmetadata = () => resolve(v);
            v.onerror = (ev) => reject(new Error(String(ev)));
            v.src = objectUrl;
            return;
          }
          const el = new window.Image();
          el.onload = () => resolve(el);
          el.onerror = (ev) => reject(new Error(String(ev)));
          el.src = objectUrl;
        });
        if (bannerPreviewUrl) URL.revokeObjectURL(bannerPreviewUrl);
        setBannerPreviewUrl(objectUrl);
        setBannerSourceImage(img);
      } catch {
        URL.revokeObjectURL(objectUrl);
      }
    })();
  }, [bannerSettings.bannerImageId]);

  useEffect(() => {
    const urlsRef = generatedUrlsRef;
    return () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      projects.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (bannerPreviewUrl) URL.revokeObjectURL(bannerPreviewUrl);
    };
  }, [bannerPreviewUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => setAudioCurrentTime(audio.currentTime || 0);
    const onMeta = () => setAudioDuration(audio.duration || 0);
    const onPlay = () => setIsPreviewPlaying(true);
    const onPause = () => setIsPreviewPlaying(false);
    const onEnded = () => setIsPreviewPlaying(false);
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [audioUrl]);

  useEffect(() => {
    const c = previewCanvasRef.current;
    if (!c || !activeProject || !currentPreviewFrame) return;
    c.width = previewDims.width;
    c.height = previewDims.height;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    drawFrameComposite({
      ctx,
      source: activeProject.sourceMedia,
      frame: currentPreviewFrame,
      outW: c.width,
      outH: c.height,
      theme: activeProject.sourceMedia ? themeSettings : { ...themeSettings, themeEnabled: false },
      banner: bannerImage && bannerAsset ? pickFrameBannerSettings(currentPreviewFrame, bannerSettings) : { ...bannerSettings, bannerMode: false, bannerEnabled: false },
      bannerImage,
    });
  }, [activeProject, currentPreviewFrame, previewDims.height, previewDims.width, themeSettings, bannerSettings, bannerImage, bannerAsset]);

  const buildProject = useCallback(
    async (
      file: File,
      indexHint: number,
      restoreMeta?: PendingRestoreMeta["projects"][number]
    ): Promise<ImageProject> => {
      const imageId = restoreMeta?.imageId ?? newId();
      await putShortsImageBlob(imageId, file);
      const { media, objectUrl, mediaType, width, height } = await loadMediaFromFile(file);
      const frames = restoreMeta
        ? relabelByOrder(
            normalizeOrders(restoreMeta.frames).map((f, idx) => ({
              ...withNarrationByLang(f as ShortFrame, toSafeString(f.text, narrationDefaults[locale])),
              id: toSafeString(f.id, newId()),
              label: `#${idx + 1}`,
              aspect: outputAspect,
              text: toSafeString((f as ShortFrame).narrationByLang?.[locale], toSafeString(f.text, narrationDefaults[locale])),
              startTime: toSafeNumber((f as Partial<ShortFrame>).startTime, idx * 3),
              endTime: Math.max(
                toSafeNumber((f as Partial<ShortFrame>).endTime, (idx + 1) * 3),
                toSafeNumber((f as Partial<ShortFrame>).startTime, idx * 3) + 0.05
              ),
              frameCropX: clamp(toSafeNumber((f as Partial<ShortFrame>).frameCropX, 0), -100, 100),
              frameCropY: clamp(toSafeNumber((f as Partial<ShortFrame>).frameCropY, 0), -100, 100),
              frameScale: clamp(toSafeNumber((f as Partial<ShortFrame>).frameScale, 1), 0.5, 2.5),
              frameFit: (f as Partial<ShortFrame>).frameFit === "contain" ? "contain" : "cover",
              frameCropLeft: clamp(toSafeNumber((f as Partial<ShortFrame>).frameCropLeft, 0), 0, 50),
              frameCropRight: clamp(toSafeNumber((f as Partial<ShortFrame>).frameCropRight, 0), 0, 50),
              frameCropTop: clamp(toSafeNumber((f as Partial<ShortFrame>).frameCropTop, 0), 0, 50),
              frameCropBottom: clamp(toSafeNumber((f as Partial<ShortFrame>).frameCropBottom, 0), 0, 50),
              videoStart: Math.max(0, toSafeNumber((f as Partial<ShortFrame>).videoStart, 0)),
              videoEnd: Math.max(0, toSafeNumber((f as Partial<ShortFrame>).videoEnd, 0)),
              videoMuted: Boolean((f as Partial<ShortFrame>).videoMuted),
              videoLoop: Boolean((f as Partial<ShortFrame>).videoLoop),
              playbackRate: clamp(toSafeNumber((f as Partial<ShortFrame>).playbackRate, 1), 0.25, 2),
              bannerSettings: normalizeRestoredFrameBannerSettings((f as Partial<ShortFrame>).bannerSettings),
            }))
          )
        : defaultSixFrames(outputAspect, locale);
      return {
        id: restoreMeta?.id ?? newId(),
        imageId,
        title: `Image ${indexHint}`,
        fileName: file.name,
        imageWidth: width,
        imageHeight: height,
        mediaType,
        previewUrl: objectUrl,
        sourceMedia: media,
        frames,
        selectedFrameId: null,
        stitchedVideoUrl: null,
        singleOutputs: {},
      };
    },
    [locale, outputAspect]
  );

  const hydrateProjectsFromStorage = useCallback(async () => {
    const draft = loadShortsMultiDraft();
    if (!draft) return;
    setOutputAspect(draft.outputAspect);
    const restored: ImageProject[] = [];
    const missing: PendingRestoreMeta["projects"] = [];
    for (let i = 0; i < draft.projects.length; i += 1) {
      const meta = draft.projects[i];
      const blob = await getShortsImageBlob(meta.imageId);
      if (!blob) {
        missing.push({
          id: meta.id,
          imageId: meta.imageId,
          imageName: meta.imageName,
          imageWidth: meta.imageWidth,
          imageHeight: meta.imageHeight,
          frames: meta.frames,
        });
        continue;
      }
      const project = await buildProject(
        new File([blob], meta.imageName || `image-${i + 1}.png`, { type: blob.type || "image/png" }),
        i + 1,
        {
          id: meta.id,
          imageId: meta.imageId,
          imageName: meta.imageName,
          imageWidth: meta.imageWidth,
          imageHeight: meta.imageHeight,
          frames: meta.frames,
        }
      );
      restored.push(project);
    }
    if (restored.length > 0) {
      setProjects(restored);
      setActiveProjectId(restored[0].id);
    }
    if (missing.length > 0) {
      setPendingRestoreMeta({
        outputAspect: draft.outputAspect,
        projects: missing,
      });
      setHint("一部画像が見つかりません。画像を再アップロードしてください。");
    } else {
      setPendingRestoreMeta(null);
      if (restored.length > 0) setHint("編集内容を復元しました。");
    }
  }, [buildProject]);

  const addFiles = useCallback(
    async (files: File[]) => {
      const remaining = MAX_IMAGES - projects.length;
      if (remaining <= 0) {
        setHint(`最大 ${MAX_IMAGES} 枚までです。`);
        return;
      }
      const picked = files.slice(0, remaining);
      const accepted: File[] = [];
      for (const file of picked) {
        if (!isAllowedImageFile(file)) continue;
        if (file.size > MAX_IMAGE_FILE_BYTES) continue;
        accepted.push(file);
      }
      if (accepted.length === 0) {
        setHint("対応素材がありません。PNG / JPG / JPEG / WebP / GIF / MP4 / WebM / MOV を選択してください。");
        return;
      }
      setHint(null);
      const newProjects: ImageProject[] = [];
      for (let i = 0; i < accepted.length; i += 1) {
        try {
          const restoreMeta = pendingRestoreMeta?.projects?.[projects.length + i];
          const project = await buildProject(accepted[i], projects.length + i + 1, restoreMeta);
          newProjects.push(project);
        } catch (e) {
          console.error("Image load failed", e);
        }
      }
      if (newProjects.length === 0) {
        setHint("画像の読み込みに失敗しました。");
        return;
      }
      setProjects((prev) => [...prev, ...newProjects]);
      setActiveProjectId((prev) => prev ?? newProjects[0].id);
    },
    [projects.length, buildProject, pendingRestoreMeta]
  );

  useEffect(() => {
    void (async () => {
      const pending = await takePendingHomeImage().catch(() => null);
      if (pending) {
        await addFiles([pending]);
      } else {
        await hydrateProjectsFromStorage();
      }
      setIsHydrated(true);
    })();
  }, [addFiles, hydrateProjectsFromStorage]);

  useEffect(() => {
    if (!isHydrated) return;
    const payload = {
      version: 2 as const,
      savedAt: Date.now(),
      outputAspect,
      projects: projects.map((p) =>
        createPersistableProject({
          id: p.id,
          imageId: p.imageId,
          imageName: p.fileName,
          imageWidth: p.imageWidth,
          imageHeight: p.imageHeight,
          mediaType: p.mediaType,
          frames: p.frames,
        })
      ),
    };
    saveShortsMultiDraft(payload);
  }, [projects, isHydrated, outputAspect]);

  useEffect(() => {
    setProjects((prev) =>
      prev.map((project) => ({
        ...project,
        frames: project.frames.map((frame) => {
          const normalized = withNarrationByLang(frame, frame.text);
          return {
            ...normalized,
            text: toSafeString(normalized.narrationByLang?.[locale], normalized.text ?? ""),
          };
        }),
      }))
    );
  }, [locale]);

  useEffect(() => {
    if (!isHydrated) return;
    const narrationSnapshot = projects.map((project) => ({
      projectId: project.id,
      frames: project.frames.map((frame) => ({
        frameId: frame.id,
        narrationByLang: withNarrationByLang(frame, frame.text).narrationByLang,
      })),
    }));
    try {
      localStorage.setItem(
        SHORTS_MULTI_I18N_KEY,
        JSON.stringify({
          displayLang: locale,
          narrationByLang: narrationSnapshot,
        })
      );
    } catch {
      // noop
    }
  }, [isHydrated, locale, projects]);

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    void addFiles(files);
    e.target.value = "";
  };

  const onBannerInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = (e.target.files?.[0] ?? null) as File | null;
    if (!file) return;
    if (!isAllowedImageFile(file) || file.size > MAX_IMAGE_FILE_BYTES) {
      setHint(locale === "en" ? "Please select PNG / JPG / JPEG / WebP." : "PNG / JPG / JPEG / WebP を選択してください。");
      e.target.value = "";
      return;
    }
    void (async () => {
      try {
        const imageId = newId();
        await putShortsImageBlob(imageId, file);
        const { media, objectUrl, width, height } = await loadMediaFromFile(file);
        if (bannerPreviewUrl) URL.revokeObjectURL(bannerPreviewUrl);
        setBannerPreviewUrl(objectUrl);
        setBannerSourceImage(media);
        setBannerAsset({
          imageId,
          imageName: file.name,
          width,
          height,
        });
        setBannerSettings((prev) => ({
          ...prev,
          bannerMode: true,
          bannerEnabled: true,
          bannerUseCurrentImage: false,
          bannerImageId: imageId,
        }));
        setHint(locale === "en" ? "Banner asset has been set." : "帯素材として設定しました");
      } catch (err) {
        console.error("Banner set failed", err);
        setHint(locale === "en" ? "Failed to set banner asset." : "帯素材の設定に失敗しました。");
      }
    })();
    e.target.value = "";
  };

  function handleUseCurrentImageAsBanner() {
    if (!activeProject) return;
    if (bannerPreviewUrl && bannerPreviewUrl !== activeProject.previewUrl) {
      URL.revokeObjectURL(bannerPreviewUrl);
    }
    setBannerPreviewUrl(activeProject.previewUrl);
    setBannerSourceImage(activeProject.sourceMedia);
    setBannerAsset({
      imageId: activeProject.imageId,
      imageName: activeProject.fileName,
      width: activeProject.imageWidth,
      height: activeProject.imageHeight,
    });
    setBannerSettings((prev) => ({
      ...prev,
      bannerMode: true,
      bannerEnabled: true,
      bannerUseCurrentImage: true,
      bannerImageId: activeProject.imageId,
      bannerPosition: "top",
      bannerScale: 1,
      bannerOpacity: 0.9,
    }));
    setHint(locale === "en" ? "This image has been set as a banner asset." : "この画像を帯として設定しました");
  }

  function clearBannerAsset() {
    if (bannerPreviewUrl) URL.revokeObjectURL(bannerPreviewUrl);
    setBannerPreviewUrl(null);
    setBannerSourceImage(null);
    setBannerAsset(null);
    setBannerSettings((prev) => ({
      ...prev,
      bannerEnabled: false,
      bannerImageId: null,
      bannerUseCurrentImage: false,
    }));
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    void addFiles(files);
  };

  const onAudioInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = (e.target.files?.[0] ?? null) as File | null;
    if (!file) return;
    console.log("NEW AUDIO FILE", {
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
    });
    if (!isAllowedAudioFile(file)) {
      setHint("音声は MP3 / WAV / M4A のみ対応です。");
      e.target.value = "";
      return;
    }
    setHint(null);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const nextAudioUrl = URL.createObjectURL(file);
    setAudioUrl(nextAudioUrl);
    setAudioName(file.name);
    setAudioCurrentTime(0);
    setAudioDuration(0);
    setIsPreviewPlaying(false);
    if (sortedFrames.length > 0) {
      setPreviewFrameId(sortedFrames[0].id);
      updateActiveProject((project) => ({ ...project, selectedFrameId: sortedFrames[0].id }));
    }
    e.target.value = "";
  };

  async function handlePreviewPlay() {
    const audio = audioRef.current;
    if (!audio || !audioUrl) {
      setHint("先にMP3音声をアップロードしてください。");
      return;
    }
    try {
      await audio.play();
    } catch (e) {
      console.error("Audio play failed", e);
      setHint("音声再生を開始できませんでした。");
    }
  }

  function handlePreviewStop() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
  }

  function handlePreviewReset() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    setAudioCurrentTime(0);
  }

  function updateActiveProject(updater: (project: ImageProject) => ImageProject) {
    if (!activeProjectId) return;
    setProjects((prev) => prev.map((p) => (p.id === activeProjectId ? updater(p) : p)));
  }

  function removeActiveImage() {
    if (!activeProjectId || !activeProject) return;
    if (!window.confirm(`"${activeProject.title}" を削除しますか？`)) return;
    URL.revokeObjectURL(activeProject.previewUrl);
    void deleteShortsImageBlob(activeProject.imageId);
    if (activeProject.stitchedVideoUrl) URL.revokeObjectURL(activeProject.stitchedVideoUrl);
    Object.values(activeProject.singleOutputs).forEach((url) => URL.revokeObjectURL(url));
    setProjects((prev) => {
      const next = prev.filter((p) => p.id !== activeProjectId);
      return next.map((p, idx) => ({ ...p, title: `Image ${idx + 1}` }));
    });
    setActiveProjectId((prev) => {
      if (prev !== activeProjectId) return prev;
      const remain = projects.filter((p) => p.id !== activeProjectId);
      return remain[0]?.id ?? null;
    });
    setProgressText(null);
  }

  function resetBannerTransform() {
    updateBannerSettings((prev) => ({
      ...prev,
      bannerCropX: 0,
      bannerCropY: 0,
      bannerScale: 1,
      bannerOpacity: 0.9,
    }));
  }

  function updateBannerSettings(updater: (prev: BannerSettings) => BannerSettings) {
    setBannerSettings((prev) => {
      const next = updater(prev);
      const selectedFrameId = selectedFrame?.id ?? null;
      if (selectedFrameId) {
        updateActiveProject((project) => ({
          ...project,
          frames: project.frames.map((f) =>
            f.id === selectedFrameId && f.bannerEnabled
              ? {
                  ...f,
                  bannerSettings: {
                    ...(f.bannerSettings ?? {}),
                    ...globalBannerToFrameBannerSettings(next),
                  },
                }
              : f
          ),
        }));
      }
      return next;
    });
  }

  function applyBannerToFrame(frameId: string) {
    if (!bannerAsset) {
      window.alert(locale === "en" ? "Please set a banner image first." : "先に帯画像を設定してください");
      return;
    }
    const target = sortedFrames.find((f) => f.id === frameId);
    if (target) {
      setAudioCurrentTime(Math.max(0, toSafeNumber(target.startTime, 0)));
    }
    updateActiveProject((project) => {
      const nextFrames = project.frames.map((f) =>
        f.id === frameId
          ? {
              ...f,
              bannerEnabled: true,
              bannerSettings: globalBannerToFrameBannerSettings(bannerSettings),
            }
          : f
      );
      const updated = nextFrames.find((f) => f.id === frameId);
      console.log("[applyBannerToFrame] updated frame", {
        frameId,
        bannerEnabled: updated?.bannerEnabled ?? null,
        bannerSettings: updated?.bannerSettings ?? null,
      });
      return {
        ...project,
        selectedFrameId: frameId,
        frames: nextFrames,
      };
    });
  }

  function applyBannerToAllFrames() {
    if (!bannerAsset) {
      window.alert(locale === "en" ? "Please set a banner image first." : "先に帯画像を設定してください");
      return;
    }
    updateActiveProject((project) => ({
      ...project,
      frames: project.frames.map((f) => ({
        ...f,
        bannerEnabled: true,
        bannerSettings: globalBannerToFrameBannerSettings(bannerSettings),
      })),
    }));
  }

  function removeAllImages() {
    if (projects.length === 0) return;
    if (!window.confirm("全画像とフレームを削除しますか？")) return;
    projects.forEach((p) => {
      URL.revokeObjectURL(p.previewUrl);
      if (p.stitchedVideoUrl) URL.revokeObjectURL(p.stitchedVideoUrl);
      Object.values(p.singleOutputs).forEach((url) => URL.revokeObjectURL(url));
    });
    generatedUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    generatedUrlsRef.current = [];
    setProjects([]);
    setActiveProjectId(null);
    setProgressText(null);
    clearShortsMultiDraft();
    void clearShortsImageBlobs();
  }

  function removeFrame(frameId: string) {
    updateActiveProject((project) => {
      const filtered = project.frames.filter((f) => f.id !== frameId);
      const relabeled = relabelByOrder(filtered);
      const selectedExists = relabeled.some((f) => f.id === project.selectedFrameId);
      const nextSelected = selectedExists ? project.selectedFrameId : relabeled[0]?.id ?? null;
      const nextOutputs = { ...project.singleOutputs };
      const oldUrl = nextOutputs[frameId];
      if (oldUrl) URL.revokeObjectURL(oldUrl);
      delete nextOutputs[frameId];
      return {
        ...project,
        frames: relabeled,
        selectedFrameId: nextSelected,
        singleOutputs: nextOutputs,
      };
    });
  }

  function recomputeActiveFramesForAspect(nextAspect: OutputAspect) {
    const cropAspect = getCropAspectFromOutput(nextAspect);
    updateActiveProject((project) => ({
      ...project,
      frames: normalizeOrders(
        project.frames.map((f) => {
          const { cropW, cropH } = maxCenteredCropNormalized(f.centerX, f.centerY, cropAspect);
          const next = { ...f, aspect: nextAspect, cropW: cropW * 0.92, cropH: cropH * 0.92 };
          const clamped = clampCropBox(next);
          return { ...next, ...clamped };
        })
      ),
    }));
  }

  function moveOrder(frameId: string, dir: -1 | 1) {
    updateActiveProject((project) => {
      const sorted = [...project.frames].sort((a, b) => a.order - b.order);
      const idx = sorted.findIndex((f) => f.id === frameId);
      if (idx < 0) return project;
      const swapWith = idx + dir;
      if (swapWith < 0 || swapWith >= sorted.length) return project;
      const a = sorted[idx];
      const b = sorted[swapWith];
      const frames = project.frames.map((f) => {
        if (f.id === a.id) return { ...f, order: b.order };
        if (f.id === b.id) return { ...f, order: a.order };
        return f;
      });
      return { ...project, frames: normalizeOrders(frames) };
    });
  }

  function applyLinkedTimeEdit(frames: ShortFrame[], frameId: string, mode: "start" | "end", rawValue: number): ShortFrame[] {
    const minDuration = 0.5;
    const maxAudioEnd = audioDuration > 0 ? audioDuration : Number.POSITIVE_INFINITY;
    const sorted = [...frames].sort((a, b) => a.order - b.order).map((f) => ({ ...f }));
    const idx = sorted.findIndex((f) => f.id === frameId);
    if (idx < 0) return frames;

    if (mode === "end") {
      const current = sorted[idx];
      let nextEnd = Math.max(rawValue, toSafeNumber(current.startTime, 0) + minDuration);
      if (idx === sorted.length - 1) nextEnd = Math.min(nextEnd, maxAudioEnd);
      current.endTime = nextEnd;

      if (idx + 1 < sorted.length) {
        const next = sorted[idx + 1];
        next.startTime = nextEnd;
        if (toSafeNumber(next.endTime, 0) < next.startTime + minDuration) {
          next.endTime = next.startTime + minDuration;
        }
        if (idx + 1 === sorted.length - 1) {
          next.endTime = Math.min(next.endTime, maxAudioEnd);
          if (next.endTime < next.startTime + minDuration) {
            next.endTime = next.startTime + minDuration;
          }
        }
      }
    } else {
      const current = sorted[idx];
      let nextStart = Math.max(0, rawValue);
      if (idx === sorted.length - 1 && Number.isFinite(maxAudioEnd)) {
        nextStart = Math.min(nextStart, Math.max(0, maxAudioEnd - minDuration));
      }
      if (idx > 0) {
        const prev = sorted[idx - 1];
        nextStart = Math.max(nextStart, toSafeNumber(prev.startTime, 0) + minDuration);
        prev.endTime = nextStart;
      }
      current.startTime = nextStart;
      if (toSafeNumber(current.endTime, 0) < current.startTime + minDuration) {
        current.endTime = current.startTime + minDuration;
      }
      if (idx === sorted.length - 1) {
        current.endTime = Math.min(current.endTime, maxAudioEnd);
        if (current.endTime < current.startTime + minDuration) {
          current.endTime = current.startTime + minDuration;
        }
      }
    }

    const byId = new Map(sorted.map((f) => [f.id, f]));
    return frames.map((f) => byId.get(f.id) ?? f);
  }

  function updateFrameCenterFromClient(frameId: string, clientX: number, clientY: number) {
    if (!activeProject) return;
    const imgEl = previewImageRef.current;
    if (!imgEl) return;
    const rect = imgEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = clamp((clientX - rect.left) / rect.width, 0, 1);
    const ny = clamp((clientY - rect.top) / rect.height, 0, 1);
    updateActiveProject((project) => ({
      ...project,
      frames: project.frames.map((f) => {
        if (f.id !== frameId) return f;
        const clamped = clampCropBox({ ...f, centerX: nx, centerY: ny });
        return { ...f, ...clamped };
      }),
    }));
  }

  function selectFrameForPreview(frame: ShortFrame) {
    updateActiveProject((project) => ({ ...project, selectedFrameId: frame.id }));
    setPreviewFrameId(frame.id);
    const start = Math.max(0, toSafeNumber(frame.startTime, 0));
    setAudioCurrentTime(start);
    if (audioRef.current) {
      audioRef.current.currentTime = start;
    }
  }

  async function generateStitchedForProject(project: ImageProject): Promise<string> {
    const sorted = [...project.frames].sort((a, b) => a.order - b.order);
    const withBanner = sorted.map((frame) => ({
      ...frame,
      bannerSettings: pickFrameBannerSettings(frame, bannerSettings),
      bannerEnabled: !!frame.bannerEnabled,
    }));
    const blob = await renderStitched(
      project.sourceMedia,
      withBanner,
      outputAspect,
      kenBurns,
      themeSettings,
      bannerSettings,
      bannerAsset ? bannerImage : null
    );
    const url = URL.createObjectURL(blob);
    generatedUrlsRef.current.push(url);
    return url;
  }

  async function handleGenerateActiveStitched() {
    if (!activeProject) return;
    if (activeProject.frames.length === 0) {
      setHint("フレームがありません。自動分割またはフレーム追加してください");
      return;
    }
    setIsGeneratingStitchedProjectId(activeProject.id);
    setProgressText(`${activeProject.title} を連結生成中...`);
    setHint(null);
    try {
      const url = await generateStitchedForProject(activeProject);
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== activeProject.id) return p;
          if (p.stitchedVideoUrl) URL.revokeObjectURL(p.stitchedVideoUrl);
          return { ...p, stitchedVideoUrl: url };
        })
      );
      setProgressText(`${activeProject.title} の連結動画を生成しました。`);
    } catch (e) {
      setHint(e instanceof Error ? e.message : "動画生成に失敗しました。");
      setProgressText(null);
    } finally {
      setIsGeneratingStitchedProjectId(null);
    }
  }

  async function handleGenerateSingle(projectId: string, frameId: string) {
    const project = projects.find((p) => p.id === projectId);
    const frame = project?.frames.find((f) => f.id === frameId);
    if (!project || !frame) return;
    setIsGeneratingSingle({ projectId, frameId });
    setProgressText(`${project.title} ${frame.label} を生成中...`);
    try {
      const frameWithBanner = {
        ...frame,
        bannerSettings: pickFrameBannerSettings(frame, bannerSettings),
        bannerEnabled: !!frame.bannerEnabled,
      };
      const blob = await renderSingleSegment(
        project.sourceMedia,
        frameWithBanner,
        outputAspect,
        kenBurns,
        themeSettings,
        bannerSettings,
        bannerAsset ? bannerImage : null
      );
      const url = URL.createObjectURL(blob);
      generatedUrlsRef.current.push(url);
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== projectId) return p;
          const prevUrl = p.singleOutputs[frameId];
          if (prevUrl) URL.revokeObjectURL(prevUrl);
          return { ...p, singleOutputs: { ...p.singleOutputs, [frameId]: url } };
        })
      );
      setProgressText(`${project.title} ${frame.label} の生成完了`);
    } catch (e) {
      setHint(e instanceof Error ? e.message : "動画生成に失敗しました。");
    } finally {
      setIsGeneratingSingle(null);
    }
  }

  async function handleGenerateAllImages() {
    if (projects.length === 0) return;
    setIsGeneratingAll(true);
    setHint(null);
    try {
      for (let i = 0; i < projects.length; i += 1) {
        const project = projects[i];
        if (project.frames.length === 0) continue;
        setProgressText(`全画像一括生成: ${project.title} (${i + 1}/${projects.length})`);
        const url = await generateStitchedForProject(project);
        setProjects((prev) =>
          prev.map((p) => {
            if (p.id !== project.id) return p;
            if (p.stitchedVideoUrl) URL.revokeObjectURL(p.stitchedVideoUrl);
            return { ...p, stitchedVideoUrl: url };
          })
        );
      }
      setProgressText("全画像の連結動画生成が完了しました。");
    } catch (e) {
      setHint(e instanceof Error ? e.message : "全画像一括生成に失敗しました。");
    } finally {
      setIsGeneratingAll(false);
    }
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const timelineTotal = sortedFrames.reduce((acc, f) => acc + clamp(getFrameDuration(f), 0.05, 30), 0);
    if (audio.duration > 0 && audio.currentTime >= audio.duration) {
      setIsPreviewPlaying(false);
      return;
    }
    if (timelineTotal > 0 && audio.currentTime > timelineTotal && audio.duration > timelineTotal) {
      // 音声が長い場合は最後のフレーム維持（停止しない）
      setAudioCurrentTime(timelineTotal);
    }
  }, [sortedFrames, audioCurrentTime]);

  useEffect(() => {
    return () => {
      if (wholeVideoUrl) URL.revokeObjectURL(wholeVideoUrl);
    };
  }, [wholeVideoUrl]);

  function downloadAllOutputs() {
    const urls: Array<{ url: string; name: string }> = [];
    projects.forEach((project, pIdx) => {
      if (project.stitchedVideoUrl) urls.push({ url: project.stitchedVideoUrl, name: `image-${pIdx + 1}-stitched.webm` });
      Object.entries(project.singleOutputs).forEach(([frameId, url]) => {
        const frame = project.frames.find((f) => f.id === frameId);
        urls.push({ url, name: `image-${pIdx + 1}-${frame?.label ?? frameId}.webm` });
      });
    });
    if (urls.length === 0) {
      setHint(t.noOutput);
      return;
    }
    urls.forEach((item) => {
      const a = document.createElement("a");
      a.href = item.url;
      a.download = item.name;
      a.click();
    });
  }

  async function handleRenderWholeVideo() {
    if (!activeProject) return;
    if (!audioUrl) {
      setHint("先にMP3音声をアップロードしてください。");
      return;
    }
    if (sortedFrames.length === 0) {
      setHint("フレームがありません。");
      return;
    }
    setIsRenderingWholeVideo(true);
    setHint(null);
    setProgressText("動画生成中…");
    try {
      const { width: outW, height: outH } = getOutputDimensions(outputAspect);
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas context unavailable.");

      const audioContext = new AudioContext();
      const audioDest = audioContext.createMediaStreamDestination();
      const audioArrayBuffer = await (await fetch(audioUrl)).arrayBuffer();
      const audioBuffer = await audioContext.decodeAudioData(audioArrayBuffer);
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioDest);

      const videoStream = canvas.captureStream(30);
      const mixed = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...audioDest.stream.getAudioTracks(),
      ]);

      const exportFormat = pickExportMimeType();
      const chunks: BlobPart[] = [];
      const recorder = new MediaRecorder(mixed, {
        mimeType: exportFormat.mimeType,
        videoBitsPerSecond: 4_000_000,
      });
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      const stopPromise = new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => reject(new Error("動画生成に失敗しました。"));
        recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType || exportFormat.mimeType }));
      });

      const endCardDuration = 2.0;
      const lastEnd = sortedFrames.reduce((mx, f) => Math.max(mx, toSafeNumber(f.endTime, 0)), 0);
      const contentDuration = Math.max(lastEnd, audioBuffer.duration);
      const totalDuration = contentDuration + endCardDuration;
      recorder.start(150);
      source.start(0);
      const startedAt = performance.now();
      await new Promise<void>((resolve) => {
        const draw = () => {
          const t = (performance.now() - startedAt) / 1000;
          const progress = clamp(t / Math.max(totalDuration, 0.001), 0, 1);
          if (t >= contentDuration) {
            drawBrandEndCard(ctx, outW, outH);
          } else {
            const idx = getFrameIndexAtTime(t, sortedFrames);
            const frame = idx >= 0 ? sortedFrames[idx] : sortedFrames[0];
            const segDuration = Math.max(0.05, getFrameDuration(frame));
            const localT = clamp((t - toSafeNumber(frame.startTime, 0)) / segDuration, 0, 1);
            syncVideoTimeForFrame(activeProject.sourceMedia, frame, localT);
            const eased = easeInOutCubic(localT);
            const zoom = clamp(toSafeNumber(frame.zoomScale, 1.12), 1, 3);
            const mediaDims = getMediaDims(activeProject.sourceMedia);
            const base = getCropPxRect(frame, mediaDims.width, mediaDims.height);
            const shrink = 1 + kenBurns * (zoom - 1);
            const innerW = clamp(base.sw / shrink, 1, base.sw);
            const innerH = clamp(base.sh / shrink, 1, base.sh);
            const sw = base.sw + (innerW - base.sw) * eased;
            const sh = base.sh + (innerH - base.sh) * eased;
            const cx = frame.centerX * mediaDims.width;
            const cy = frame.centerY * mediaDims.height;
            const sx = clamp(cx - sw / 2, 0, mediaDims.width - sw);
            const sy = clamp(cy - sh / 2, 0, mediaDims.height - sh);
            drawFrameComposite({
              ctx,
              source: activeProject.sourceMedia,
              frame: {
                ...frame,
                centerX: (sx + sw / 2) / mediaDims.width,
                centerY: (sy + sh / 2) / mediaDims.height,
                cropW: sw / mediaDims.width,
                cropH: sh / mediaDims.height,
              },
              outW,
              outH,
              theme: themeSettings,
              banner: pickFrameBannerSettings(frame, bannerSettings),
              bannerImage: bannerAsset ? bannerImage : null,
            });
          }
          if (progress >= 1) {
            recorder.stop();
            resolve();
            return;
          }
          requestAnimationFrame(draw);
        };
        draw();
      });
      const blob = await stopPromise;
      source.stop();
      audioContext.close().catch(() => undefined);
      const url = URL.createObjectURL(blob);
      generatedUrlsRef.current.push(url);
      if (wholeVideoUrl) URL.revokeObjectURL(wholeVideoUrl);
      setWholeVideoUrl(url);
      setWholeVideoExt(exportFormat.ext);
      setProgressText("全体動画の生成が完了しました。");
    } catch (e) {
      console.error("Render whole video failed", e);
      setHint(e instanceof Error ? e.message : "全体動画の生成に失敗しました。");
      setProgressText(null);
    } finally {
      setIsRenderingWholeVideo(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-xl font-semibold text-slate-900">{t.title}</h2>
      <p className="mt-1 text-sm text-slate-600">{t.subtitle}</p>

      <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTR} className="sr-only" aria-label="画像を選択" onChange={onInputChange} />
      <input ref={bannerInputRef} type="file" accept={ACCEPT_ATTR} className="sr-only" aria-label="帯画像を選択" onChange={onBannerInputChange} />
      <input ref={audioInputRef} type="file" accept={ACCEPT_AUDIO_ATTR} className="sr-only" aria-label="MP3を選択" onChange={onAudioInputChange} />
      <audio key={audioUrl ?? "no-audio"} ref={audioRef} src={audioUrl ?? undefined} preload="metadata" />
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragActive(false);
        }}
        onDrop={onDrop}
        className={[
          "my-4 cursor-pointer rounded-xl border-2 border-dashed px-4 py-9 text-center transition-colors",
          dragActive ? "border-slate-500 bg-slate-50" : "border-slate-300 bg-slate-50/80",
        ].join(" ")}
      >
        <p className="text-sm font-medium text-slate-800">{t.selectImages.replace("8", String(MAX_IMAGES))}</p>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            className={[
              "rounded-lg border px-3 py-2 text-sm",
              activeProjectId === project.id ? "border-sky-600 bg-sky-50 text-sky-700" : "border-slate-300 text-slate-700",
            ].join(" ")}
            onClick={() => setActiveProjectId(project.id)}
          >
            {project.title}
          </button>
        ))}
      </div>
      <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50/50 p-3 text-sm">
        <p className="font-semibold text-violet-900">Banner: {bannerAsset?.imageName ?? "-"}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="rounded border border-violet-300 bg-white px-3 py-1 text-xs text-violet-700" onClick={() => bannerInputRef.current?.click()}>
            {uploadBannerLabel}
          </button>
          <button type="button" className="rounded border border-violet-300 bg-white px-3 py-1 text-xs text-violet-700" onClick={clearBannerAsset} disabled={!bannerAsset}>
            {locale === "en" ? "Clear banner" : "帯を解除"}
          </button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <label className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
          出力アスペクト比
          <select
            value={outputAspect}
            onChange={(e) => {
              const next = e.target.value as OutputAspect;
              setOutputAspect(next);
              recomputeActiveFramesForAspect(next);
            }}
            className="mt-2 w-full rounded border border-slate-300 bg-white px-2 py-2 text-sm"
          >
            <option value="9:16">9:16</option>
            <option value="16:9">16:9</option>
            <option value="1:1">1:1</option>
          </select>
        </label>
        <label className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700 lg:col-span-2">
          Ken Burns 強さ
          <input type="range" min={0} max={1} step={0.01} value={kenBurns} onChange={(e) => setKenBurns(clamp(Number(e.target.value), 0, 1))} className="mt-2 w-full" />
        </label>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={!activeProject || isGeneratingAll} onClick={() => void handleGenerateActiveStitched()}>
          {isGeneratingStitchedProjectId ? "..." : t.generateThisImage}
        </button>
        <button
          type="button"
          className="rounded-lg border border-violet-300 px-4 py-2 text-sm text-violet-700"
          disabled={!activeProject}
          onClick={handleUseCurrentImageAsBanner}
        >
          {useAsBannerLabel}
        </button>
        <button type="button" className="rounded-lg border border-violet-300 px-4 py-2 text-sm text-violet-700" onClick={() => bannerInputRef.current?.click()}>
          {uploadBannerLabel}
        </button>
        <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm" disabled={projects.length === 0 || isGeneratingAll} onClick={() => void handleGenerateAllImages()}>
          {isGeneratingAll ? "..." : t.generateAllImages}
        </button>
        <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm" onClick={downloadAllOutputs}>
          {t.downloadAllOutputs}
        </button>
        <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm" onClick={() => audioInputRef.current?.click()}>
          {t.uploadMp3}
        </button>
        <button
          type="button"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!activeProject || !audioUrl || isRenderingWholeVideo}
          onClick={() => void handleRenderWholeVideo()}
        >
          {isRenderingWholeVideo ? "..." : t.generateWholeVideo}
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
          disabled={!activeProject || audioDuration <= 0 || sortedFrames.length === 0}
          onClick={() =>
            updateActiveProject((project) => {
              const sorted = [...project.frames].sort((a, b) => a.order - b.order);
              const segment = audioDuration / Math.max(sorted.length, 1);
              return {
                ...project,
                frames: sorted.map((f, idx) => {
                  const start = idx * segment;
                  const end = idx === sorted.length - 1 ? audioDuration : (idx + 1) * segment;
                  return { ...f, startTime: Number(start.toFixed(2)), endTime: Number(Math.max(start + 0.05, end).toFixed(2)) };
                }),
              };
            })
          }
        >
          音声長で均等分割
        </button>
        <button type="button" className="rounded-lg border border-rose-200 px-4 py-2 text-sm text-rose-700" disabled={!activeProject} onClick={removeActiveImage}>
          {t.deleteThisImage}
        </button>
        <button type="button" className="rounded-lg border border-rose-400 px-4 py-2 text-sm font-semibold text-rose-800" disabled={projects.length === 0} onClick={removeAllImages}>
          {t.deleteAllImages}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <aside className="order-1 lg:order-2">
          <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 lg:sticky lg:top-4">
            <p className="mb-2 text-sm font-semibold text-slate-800">{t.fixedPreview} (9:16)</p>
            <p className="mb-2 text-xs text-slate-500">現在の音声: {audioName ?? "音声未選択"}</p>
            <div className="mb-3 rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700">
              <label className="mb-2 flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={themeSettings.themeEnabled}
                  onChange={(e) => setThemeSettings((prev) => ({ ...prev, themeEnabled: e.target.checked }))}
                />
                <span>{themeLabel}</span>
              </label>
              <label className="mb-1 block">
                {blurLabel}: {themeSettings.themeBlur.toFixed(0)}
                <input
                  type="range"
                  min={0}
                  max={24}
                  step={1}
                  value={themeSettings.themeBlur}
                  onChange={(e) => setThemeSettings((prev) => ({ ...prev, themeBlur: clamp(Number(e.target.value), 0, 24) }))}
                  className="w-full"
                />
              </label>
              <label className="mb-1 block">
                {darkLabel}: {themeSettings.themeDarkness.toFixed(2)}
                <input
                  type="range"
                  min={0}
                  max={0.85}
                  step={0.01}
                  value={themeSettings.themeDarkness}
                  onChange={(e) => setThemeSettings((prev) => ({ ...prev, themeDarkness: clamp(Number(e.target.value), 0, 0.85) }))}
                  className="w-full"
                />
              </label>
              <label className="block">
                {scaleLabel}: {themeSettings.frameScale.toFixed(2)}
                <input
                  type="range"
                  min={0.72}
                  max={1}
                  step={0.01}
                  value={themeSettings.frameScale}
                  onChange={(e) => setThemeSettings((prev) => ({ ...prev, frameScale: clamp(Number(e.target.value), 0.72, 1) }))}
                  className="w-full"
                />
              </label>
            </div>
            <div className="mb-3 rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700">
              <label className="mb-2 flex items-center gap-2 font-medium">
                <input
                  type="checkbox"
                  checked={bannerSettings.bannerEnabled ?? false}
                  onChange={(e) => updateBannerSettings((prev) => ({ ...prev, bannerEnabled: e.target.checked }))}
                />
                <span>{bannerOnOffLabel}</span>
              </label>
              <label className="mb-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={bannerSettings.bannerMode ?? false}
                  onChange={(e) => updateBannerSettings((prev) => ({ ...prev, bannerMode: e.target.checked, bannerUseCurrentImage: false }))}
                />
                <span>{useAsBannerLabel}</span>
              </label>
              <div className="mb-2">
                <p className="mb-1 font-medium">{bannerPositionLabel}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={[
                      "rounded border px-2 py-1",
                      safeBannerPosition === "top" ? "border-sky-600 bg-sky-50 text-sky-700" : "border-slate-300",
                    ].join(" ")}
                    onClick={() => updateBannerSettings((prev) => ({ ...prev, bannerPosition: "top" }))}
                  >
                    {topLabel}
                  </button>
                  <button
                    type="button"
                    className={[
                      "rounded border px-2 py-1",
                      safeBannerPosition === "bottom" ? "border-sky-600 bg-sky-50 text-sky-700" : "border-slate-300",
                    ].join(" ")}
                    onClick={() => updateBannerSettings((prev) => ({ ...prev, bannerPosition: "bottom" }))}
                  >
                    {bottomLabel}
                  </button>
                </div>
              </div>
              <label className="block">
                {bannerHeightLabel}: {(bannerSettings.bannerHeightPercent ?? 20).toFixed(0)}%
                <input
                  type="range"
                  min={10}
                  max={35}
                  step={1}
                  value={bannerSettings.bannerHeightPercent ?? 20}
                  onChange={(e) => updateBannerSettings((prev) => ({ ...prev, bannerHeightPercent: clamp(Number(e.target.value), 10, 35) }))}
                  className="w-full"
                />
              </label>
              <label className="mt-2 block">
                {bannerFitLabel}
                <select
                  value={bannerSettings.bannerFit ?? "contain"}
                  onChange={(e) =>
                    updateBannerSettings((prev) => ({
                      ...prev,
                      bannerFit: e.target.value === "cover" ? "cover" : "contain",
                    }))
                  }
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1"
                >
                  <option value="contain">{containLabel}</option>
                  <option value="cover">{coverLabel}</option>
                </select>
              </label>
              <label className="mt-2 block">
                {bannerOffsetXLabel}: {(bannerSettings.bannerCropX ?? 0).toFixed(0)}
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={bannerSettings.bannerCropX ?? 0}
                  onChange={(e) => updateBannerSettings((prev) => ({ ...prev, bannerCropX: clamp(Number(e.target.value), -100, 100) }))}
                  className="w-full"
                />
              </label>
              <label className="mt-2 block">
                {bannerOffsetYLabel}: {(bannerSettings.bannerCropY ?? 0).toFixed(0)}
                <input
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={bannerSettings.bannerCropY ?? 0}
                  onChange={(e) => updateBannerSettings((prev) => ({ ...prev, bannerCropY: clamp(Number(e.target.value), -100, 100) }))}
                  className="w-full"
                />
              </label>
              <label className="mt-2 block">
                {bannerScaleLabel}: {(bannerSettings.bannerScale ?? 1).toFixed(2)}
                <input
                  type="range"
                  min={0.5}
                  max={2.5}
                  step={0.01}
                  value={bannerSettings.bannerScale ?? 1}
                  onChange={(e) => updateBannerSettings((prev) => ({ ...prev, bannerScale: clamp(Number(e.target.value), 0.5, 2.5) }))}
                  className="w-full"
                />
              </label>
              <label className="mt-2 block">
                {bannerOpacityLabel}: {(bannerSettings.bannerOpacity ?? 0.9).toFixed(2)}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={bannerSettings.bannerOpacity ?? 0.9}
                  onChange={(e) => updateBannerSettings((prev) => ({ ...prev, bannerOpacity: clamp(Number(e.target.value), 0, 1) }))}
                  className="w-full"
                />
              </label>
              <label className="mt-2 block">
                {bannerCropLeftLabel}: {(bannerSettings.bannerCropLeft ?? 0).toFixed(0)}%
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={1}
                  value={bannerSettings.bannerCropLeft ?? 0}
                  onChange={(e) =>
                    updateBannerSettings((prev) => {
                      const pair = clampCropPair(Number(e.target.value), toSafeNumber(prev.bannerCropRight, 0));
                      return { ...prev, bannerCropLeft: pair.primary, bannerCropRight: pair.secondary };
                    })
                  }
                  className="w-full"
                />
              </label>
              <label className="mt-2 block">
                {bannerCropRightLabel}: {(bannerSettings.bannerCropRight ?? 0).toFixed(0)}%
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={1}
                  value={bannerSettings.bannerCropRight ?? 0}
                  onChange={(e) =>
                    updateBannerSettings((prev) => {
                      const pair = clampCropPair(Number(e.target.value), toSafeNumber(prev.bannerCropLeft, 0));
                      return { ...prev, bannerCropRight: pair.primary, bannerCropLeft: pair.secondary };
                    })
                  }
                  className="w-full"
                />
              </label>
              <label className="mt-2 block">
                {bannerCropTopLabel}: {(bannerSettings.bannerCropTop ?? 0).toFixed(0)}%
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={1}
                  value={bannerSettings.bannerCropTop ?? 0}
                  onChange={(e) =>
                    updateBannerSettings((prev) => {
                      const pair = clampCropPair(Number(e.target.value), toSafeNumber(prev.bannerCropBottom, 0));
                      return { ...prev, bannerCropTop: pair.primary, bannerCropBottom: pair.secondary };
                    })
                  }
                  className="w-full"
                />
              </label>
              <label className="mt-2 block">
                {bannerCropBottomLabel}: {(bannerSettings.bannerCropBottom ?? 0).toFixed(0)}%
                <input
                  type="range"
                  min={0}
                  max={50}
                  step={1}
                  value={bannerSettings.bannerCropBottom ?? 0}
                  onChange={(e) =>
                    updateBannerSettings((prev) => {
                      const pair = clampCropPair(Number(e.target.value), toSafeNumber(prev.bannerCropTop, 0));
                      return { ...prev, bannerCropBottom: pair.primary, bannerCropTop: pair.secondary };
                    })
                  }
                  className="w-full"
                />
              </label>
              <button
                type="button"
                className="mt-2 rounded border border-slate-300 px-2 py-1"
                onClick={() => updateBannerSettings((prev) => ({ ...prev, bannerCropLeft: 0, bannerCropRight: 0, bannerCropTop: 0, bannerCropBottom: 0 }))}
              >
                {bannerCropResetLabel}
              </button>
              <button type="button" className="mt-2 rounded border border-slate-300 px-2 py-1" onClick={resetBannerTransform}>
                {bannerResetLabel}
              </button>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
              <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={() => void handlePreviewPlay()} disabled={!audioUrl}>
                {isPreviewPlaying ? `⏸ ${t.stop}` : `▶ ${t.play}`}
              </button>
              <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={handlePreviewStop}>
                {`⏸ ${t.stop}`}
              </button>
              <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={handlePreviewReset}>
                {`↻ ${t.backToStart}`}
              </button>
              <span className="ml-auto text-xs text-slate-600">
                {formatClock(audioCurrentTime)} / {formatClock(audioDuration)}
              </span>
              <span className="text-xs font-semibold text-slate-700">
                {currentPreviewFrameIndex >= 0 ? `#${currentPreviewFrameIndex + 1}` : "#-"}
              </span>
            </div>
            <div
              ref={previewCanvasWrapRef}
              className="mb-3"
              onMouseDown={(e) => {
                if (!(bannerSettings.bannerEnabled ?? false) || !bannerAsset || !bannerImage || !previewCanvasWrapRef.current) return;
                const rect = previewCanvasWrapRef.current.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return;
                const cx = ((e.clientX - rect.left) / rect.width) * previewDims.width;
                const cy = ((e.clientY - rect.top) / rect.height) * previewDims.height;
                const bannerRect = getBannerDrawRect(previewDims.width, previewDims.height, bannerSettings, bannerImage);
                const hit = cx >= bannerRect.x && cx <= bannerRect.x + bannerRect.width && cy >= bannerRect.y && cy <= bannerRect.y + bannerRect.height;
                if (!hit) return;
                dragStartRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  offsetX: bannerSettings.bannerCropX ?? 0,
                  offsetY: bannerSettings.bannerCropY ?? 0,
                };
                setDraggingBanner(true);
              }}
              onMouseMove={(e) => {
                if (!draggingBanner || !dragStartRef.current || !previewCanvasWrapRef.current) return;
                if (!(bannerSettings.bannerEnabled ?? false) || !bannerAsset || !bannerImage) return;
                const drag = dragStartRef.current;
                const rect = previewCanvasWrapRef.current.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return;
                const dx = ((e.clientX - drag.x) / rect.width) * 100;
                const dy = ((e.clientY - drag.y) / rect.height) * 100;
                updateBannerSettings((prev) => ({
                  ...prev,
                  bannerCropX: clamp(drag.offsetX + dx, -100, 100),
                  bannerCropY: clamp(drag.offsetY + dy, -100, 100),
                }));
              }}
              onMouseUp={() => {
                setDraggingBanner(false);
                dragStartRef.current = null;
              }}
              onMouseLeave={() => {
                setDraggingBanner(false);
                dragStartRef.current = null;
              }}
              onTouchStart={(e) => {
                const t = e.touches[0];
                if (!t || !(bannerSettings.bannerEnabled ?? false) || !bannerAsset || !bannerImage || !previewCanvasWrapRef.current) return;
                const rect = previewCanvasWrapRef.current.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return;
                const cx = ((t.clientX - rect.left) / rect.width) * previewDims.width;
                const cy = ((t.clientY - rect.top) / rect.height) * previewDims.height;
                const bannerRect = getBannerDrawRect(previewDims.width, previewDims.height, bannerSettings, bannerImage);
                const hit = cx >= bannerRect.x && cx <= bannerRect.x + bannerRect.width && cy >= bannerRect.y && cy <= bannerRect.y + bannerRect.height;
                if (!hit) return;
                dragStartRef.current = {
                  x: t.clientX,
                  y: t.clientY,
                  offsetX: bannerSettings.bannerCropX ?? 0,
                  offsetY: bannerSettings.bannerCropY ?? 0,
                };
                setDraggingBanner(true);
              }}
              onTouchMove={(e) => {
                const t = e.touches[0];
                if (!t || !draggingBanner || !dragStartRef.current || !previewCanvasWrapRef.current) return;
                if (!(bannerSettings.bannerEnabled ?? false) || !bannerAsset || !bannerImage) return;
                const drag = dragStartRef.current;
                const rect = previewCanvasWrapRef.current.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) return;
                const dx = ((t.clientX - drag.x) / rect.width) * 100;
                const dy = ((t.clientY - drag.y) / rect.height) * 100;
                updateBannerSettings((prev) => ({
                  ...prev,
                  bannerCropX: clamp(drag.offsetX + dx, -100, 100),
                  bannerCropY: clamp(drag.offsetY + dy, -100, 100),
                }));
              }}
              onTouchEnd={() => {
                setDraggingBanner(false);
                dragStartRef.current = null;
              }}
            >
              <canvas
                ref={previewCanvasRef}
                className={["w-full rounded-lg border border-slate-200 bg-black aspect-[9/16]", draggingBanner ? "cursor-grabbing" : "cursor-default"].join(" ")}
              />
            </div>
            <div className="mb-2 flex flex-wrap gap-2">
              <button type="button" className="rounded border border-slate-300 px-3 py-2 text-sm" onClick={() => void handlePreviewPlay()} disabled={!audioUrl}>
                {t.play}
              </button>
              <button type="button" className="rounded border border-slate-300 px-3 py-2 text-sm" onClick={handlePreviewStop}>
                {t.stop}
              </button>
              <button type="button" className="rounded border border-slate-300 px-3 py-2 text-sm" onClick={handlePreviewReset}>
                {t.backToStart}
              </button>
            </div>
            <div className="space-y-1 text-xs text-slate-600">
              <p>
                現在のフレーム番号: {currentPreviewFrameIndex >= 0 ? `#${currentPreviewFrameIndex + 1}` : "-"} / 音声時間:{" "}
                {formatClock(audioCurrentTime)} / {formatClock(audioDuration)}
                {isPreviewPlaying ? "（再生中）" : ""}
              </p>
              <p>フレーム番号: {selectedFrame?.label ?? "-"}</p>
              <p>ナレーション: {toSafeString(selectedFrame?.text, "-")}</p>
              <p>
                時間: {selectedFrame ? `${toSafeNumber(selectedFrame.startTime, 0).toFixed(1)}s → ${toSafeNumber(selectedFrame.endTime, 0).toFixed(1)}s` : "-"}
              </p>
              <p>zoom: {clamp(toSafeNumber(selectedFrame?.zoomScale, 1), 1, 3).toFixed(2)}x</p>
            </div>
          </section>
        </aside>

        <div className="order-2 lg:order-1">
          {activeProject ? (
            <>
              <p className="mb-2 text-xs text-slate-500">{activeProject.fileName}</p>
              <div className="mb-6">
              <p className="mb-2 text-sm font-semibold text-slate-800">{t.originalPreview}</p>
                <div
                  className="relative inline-block max-w-full"
                  onPointerDown={(e) => {
                    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-frame-id]");
                    const id = el?.dataset.frameId;
                    if (!id) return;
                    e.preventDefault();
                    updateActiveProject((project) => ({ ...project, selectedFrameId: id }));
                    setPreviewFrameId(id);
                    dragFrameIdRef.current = id;
                    isDraggingRef.current = true;
                    updateFrameCenterFromClient(id, e.clientX, e.clientY);
                  }}
                  onPointerMove={(e) => {
                    if (!isDraggingRef.current || !dragFrameIdRef.current) return;
                    updateFrameCenterFromClient(dragFrameIdRef.current, e.clientX, e.clientY);
                  }}
                  onPointerUp={() => {
                    isDraggingRef.current = false;
                    dragFrameIdRef.current = null;
                  }}
                  onPointerLeave={() => {
                    isDraggingRef.current = false;
                    dragFrameIdRef.current = null;
                  }}
                >
                  {activeProject.mediaType === "video" ? (
                    <video
                      ref={(el) => {
                        previewImageRef.current = el;
                      }}
                      src={activeProject.previewUrl}
                      className="max-h-[420px] w-auto rounded-lg border border-slate-200"
                      muted
                      loop
                      playsInline
                      autoPlay
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      ref={(el) => {
                        previewImageRef.current = el;
                      }}
                      src={activeProject.previewUrl}
                      alt={activeProject.fileName}
                      className="max-h-[420px] w-auto rounded-lg border border-slate-200"
                    />
                  )}
                  {sortedFrames.map((frame) => {
                    const { centerX, centerY } = clampCropBox(frame);
                    const left = centerX - frame.cropW / 2;
                    const top = centerY - frame.cropH / 2;
                    const isSelected = frame.id === (activeProject.selectedFrameId ?? sortedFrames[0]?.id);
                    return (
                      <div
                        key={frame.id}
                        data-frame-id={frame.id}
                        className={["absolute cursor-grab rounded-md border-2 bg-white/10", isSelected ? "border-sky-600 ring-2 ring-sky-300" : "border-white/70"].join(" ")}
                        style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${frame.cropW * 100}%`, height: `${frame.cropH * 100}%` }}
                      >
                        <div className="absolute left-2 top-2 rounded bg-slate-900/70 px-2 py-1 text-xs font-bold text-white">{frame.label}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="mb-6">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-slate-800">{t.frameList}</h3>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-2 py-1 text-xs"
                    onClick={applyBannerToAllFrames}
                    disabled={!bannerImage}
                  >
                    全フレームに帯を適用
                  </button>
                </div>
                {sortedFrames.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                    フレームがありません。自動分割またはフレーム追加してください
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {sortedFrames.map((frame) => (
                    <article
                      key={frame.id}
                      className={[
                        "rounded-xl border bg-white p-3 cursor-pointer",
                        selectedFrame?.id === frame.id ? "border-sky-500 ring-2 ring-sky-200" : "border-slate-200",
                      ].join(" ")}
                      onClick={() => selectFrameForPreview(frame)}
                    >
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold">{frame.label}</p>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFrame(frame.id);
                        }}
                      >
                        × 削除
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          moveOrder(frame.id, -1);
                        }}
                      >
                        順↑
                      </button>
                      <button
                        type="button"
                        className="rounded border px-2 py-1 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          moveOrder(frame.id, 1);
                        }}
                      >
                        順↓
                      </button>
                    </div>
                  </div>
                  <div className="mb-2">
                    <FrameThumb source={activeProject.sourceMedia instanceof HTMLImageElement ? activeProject.sourceMedia : null} frame={frame} width={thumbDims.width} height={thumbDims.height} />
                  </div>
                  <label className="mb-2 block text-xs">
                    {t.narration}
                    <input
                      type="text"
                      value={toSafeString(frame.narrationByLang?.[locale], toSafeString(frame.text, ""))}
                      onChange={(e) =>
                        updateActiveProject((project) => ({
                          ...project,
                          frames: project.frames.map((f) =>
                            f.id === frame.id
                              ? {
                                  ...withNarrationByLang(f, f.text),
                                  text: e.target.value.slice(0, 160),
                                  narrationByLang: {
                                    ...withNarrationByLang(f, f.text).narrationByLang,
                                    [locale]: e.target.value.slice(0, 160),
                                  },
                                }
                              : f
                          ),
                        }))
                      }
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <div className="mb-2 grid grid-cols-2 gap-2 text-xs">
                    <label>
                      {t.start}
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={toSafeNumber(frame.startTime, 0)}
                        onChange={(e) =>
                          updateActiveProject((project) => ({
                            ...project,
                            frames: applyLinkedTimeEdit(project.frames, frame.id, "start", Number(e.target.value)),
                          }))
                        }
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                      />
                    </label>
                    <label>
                      {t.end}
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={toSafeNumber(frame.endTime, 0)}
                        onChange={(e) =>
                          updateActiveProject((project) => ({
                            ...project,
                            frames: applyLinkedTimeEdit(project.frames, frame.id, "end", Number(e.target.value)),
                          }))
                        }
                        className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                      />
                    </label>
                  </div>
                  {activeProject.mediaType === "video" ? (
                    <div className="mb-2 grid grid-cols-2 gap-2 text-xs">
                      <label>
                        動画開始秒
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={toSafeNumber(frame.videoStart, 0)}
                          onChange={(e) =>
                            updateActiveProject((project) => ({
                              ...project,
                              frames: project.frames.map((f) =>
                                f.id === frame.id ? { ...f, videoStart: Math.max(0, Number(e.target.value)) } : f
                              ),
                            }))
                          }
                          className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                        />
                      </label>
                      <label>
                        動画終了秒
                        <input
                          type="number"
                          min={0}
                          step={0.1}
                          value={toSafeNumber(frame.videoEnd, 0)}
                          onChange={(e) =>
                            updateActiveProject((project) => ({
                              ...project,
                              frames: project.frames.map((f) =>
                                f.id === frame.id ? { ...f, videoEnd: Math.max(0, Number(e.target.value)) } : f
                              ),
                            }))
                          }
                          className="mt-1 w-full rounded border border-slate-300 px-2 py-1"
                        />
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={!!frame.videoMuted}
                          onChange={(e) =>
                            updateActiveProject((project) => ({
                              ...project,
                              frames: project.frames.map((f) => (f.id === frame.id ? { ...f, videoMuted: e.target.checked } : f)),
                            }))
                          }
                        />
                        ミュートON/OFF
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={!!frame.videoLoop}
                          onChange={(e) =>
                            updateActiveProject((project) => ({
                              ...project,
                              frames: project.frames.map((f) => (f.id === frame.id ? { ...f, videoLoop: e.target.checked } : f)),
                            }))
                          }
                        />
                        ループON/OFF
                      </label>
                      <label className="col-span-2">
                        再生速度 {toSafeNumber(frame.playbackRate, 1).toFixed(2)}x
                        <input
                          type="range"
                          min={0.25}
                          max={2}
                          step={0.05}
                          value={toSafeNumber(frame.playbackRate, 1)}
                          onChange={(e) =>
                            updateActiveProject((project) => ({
                              ...project,
                              frames: project.frames.map((f) => (f.id === frame.id ? { ...f, playbackRate: clamp(Number(e.target.value), 0.25, 2) } : f)),
                            }))
                          }
                          className="mt-1 w-full"
                        />
                      </label>
                    </div>
                  ) : null}
                  <p className="mb-2 text-[11px] text-slate-500">endを変更すると次のstartに反映されます（start変更時は前のendに反映）。</p>
                  <label className="mb-2 block text-xs">
                    {t.zoom} {clamp(toSafeNumber(frame.zoomScale, 1.12), 1, 3).toFixed(2)}x
                    <input
                      type="range"
                      min={1}
                      max={3}
                      step={0.01}
                      value={clamp(toSafeNumber(frame.zoomScale, 1.12), 1, 3)}
                      onChange={(e) =>
                        updateActiveProject((project) => ({
                          ...project,
                          frames: project.frames.map((f) => (f.id === frame.id ? { ...f, zoomScale: clamp(Number(e.target.value), 1, 3) } : f)),
                        }))
                      }
                      className="w-full"
                    />
                  </label>
                  <label className="mb-2 block text-xs">
                    {frameOffsetXLabel}: {(frame.frameCropX ?? 0).toFixed(0)}
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      step={1}
                      value={frame.frameCropX ?? 0}
                      onChange={(e) =>
                        updateActiveProject((project) => ({
                          ...project,
                          frames: project.frames.map((f) => (f.id === frame.id ? { ...f, frameCropX: clamp(Number(e.target.value), -100, 100) } : f)),
                        }))
                      }
                      className="w-full"
                    />
                  </label>
                  <label className="mb-2 block text-xs">
                    {frameOffsetYLabel}: {(frame.frameCropY ?? 0).toFixed(0)}
                    <input
                      type="range"
                      min={-100}
                      max={100}
                      step={1}
                      value={frame.frameCropY ?? 0}
                      onChange={(e) =>
                        updateActiveProject((project) => ({
                          ...project,
                          frames: project.frames.map((f) => (f.id === frame.id ? { ...f, frameCropY: clamp(Number(e.target.value), -100, 100) } : f)),
                        }))
                      }
                      className="w-full"
                    />
                  </label>
                  <label className="mb-2 block text-xs">
                    {frameScaleLabel}: {(frame.frameScale ?? 1).toFixed(2)}
                    <input
                      type="range"
                      min={0.5}
                      max={2.5}
                      step={0.01}
                      value={frame.frameScale ?? 1}
                      onChange={(e) =>
                        updateActiveProject((project) => ({
                          ...project,
                          frames: project.frames.map((f) => (f.id === frame.id ? { ...f, frameScale: clamp(Number(e.target.value), 0.5, 2.5) } : f)),
                        }))
                      }
                      className="w-full"
                    />
                  </label>
                  <label className="mb-2 block text-xs">
                    {frameFitLabel}
                    <select
                      value={frame.frameFit ?? "cover"}
                      onChange={(e) =>
                        updateActiveProject((project) => ({
                          ...project,
                          frames: project.frames.map((f) => (f.id === frame.id ? { ...f, frameFit: e.target.value === "contain" ? "contain" : "cover" } : f)),
                        }))
                      }
                      className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1"
                    >
                      <option value="contain">contain</option>
                      <option value="cover">cover</option>
                    </select>
                  </label>
                  <label className="mb-2 block text-xs">
                    {frameCropLeftLabel}: {(frame.frameCropLeft ?? 0).toFixed(0)}%
                    <input
                      type="range"
                      min={0}
                      max={50}
                      step={1}
                      value={frame.frameCropLeft ?? 0}
                      onChange={(e) =>
                        updateActiveProject((project) => ({
                          ...project,
                          frames: project.frames.map((f) => {
                            if (f.id !== frame.id) return f;
                            const pair = clampCropPair(Number(e.target.value), toSafeNumber(f.frameCropRight, 0));
                            return { ...f, frameCropLeft: pair.primary, frameCropRight: pair.secondary };
                          }),
                        }))
                      }
                      className="w-full"
                    />
                  </label>
                  <label className="mb-2 block text-xs">
                    {frameCropRightLabel}: {(frame.frameCropRight ?? 0).toFixed(0)}%
                    <input
                      type="range"
                      min={0}
                      max={50}
                      step={1}
                      value={frame.frameCropRight ?? 0}
                      onChange={(e) =>
                        updateActiveProject((project) => ({
                          ...project,
                          frames: project.frames.map((f) => {
                            if (f.id !== frame.id) return f;
                            const pair = clampCropPair(Number(e.target.value), toSafeNumber(f.frameCropLeft, 0));
                            return { ...f, frameCropRight: pair.primary, frameCropLeft: pair.secondary };
                          }),
                        }))
                      }
                      className="w-full"
                    />
                  </label>
                  <label className="mb-2 block text-xs">
                    {frameCropTopLabel}: {(frame.frameCropTop ?? 0).toFixed(0)}%
                    <input
                      type="range"
                      min={0}
                      max={50}
                      step={1}
                      value={frame.frameCropTop ?? 0}
                      onChange={(e) =>
                        updateActiveProject((project) => ({
                          ...project,
                          frames: project.frames.map((f) => {
                            if (f.id !== frame.id) return f;
                            const pair = clampCropPair(Number(e.target.value), toSafeNumber(f.frameCropBottom, 0));
                            return { ...f, frameCropTop: pair.primary, frameCropBottom: pair.secondary };
                          }),
                        }))
                      }
                      className="w-full"
                    />
                  </label>
                  <label className="mb-2 block text-xs">
                    {frameCropBottomLabel}: {(frame.frameCropBottom ?? 0).toFixed(0)}%
                    <input
                      type="range"
                      min={0}
                      max={50}
                      step={1}
                      value={frame.frameCropBottom ?? 0}
                      onChange={(e) =>
                        updateActiveProject((project) => ({
                          ...project,
                          frames: project.frames.map((f) => {
                            if (f.id !== frame.id) return f;
                            const pair = clampCropPair(Number(e.target.value), toSafeNumber(f.frameCropTop, 0));
                            return { ...f, frameCropBottom: pair.primary, frameCropTop: pair.secondary };
                          }),
                        }))
                      }
                      className="w-full"
                    />
                  </label>
                  <button
                    type="button"
                    className="mb-2 rounded border border-slate-300 px-2 py-1 text-xs"
                    onClick={() =>
                      updateActiveProject((project) => ({
                        ...project,
                        frames: project.frames.map((f) =>
                          f.id === frame.id
                            ? { ...f, frameCropLeft: 0, frameCropRight: 0, frameCropTop: 0, frameCropBottom: 0 }
                            : f
                        ),
                      }))
                    }
                  >
                    {frameCropResetLabel}
                  </button>
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-3 py-2 text-sm"
                    disabled={isGeneratingAll || isGeneratingSingle != null}
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleGenerateSingle(activeProject.id, frame.id);
                    }}
                  >
                    {isGeneratingSingle?.projectId === activeProject.id && isGeneratingSingle.frameId === frame.id ? "生成中..." : "この枠だけ生成"}
                  </button>
                  <button
                    type="button"
                    className="mt-2 rounded border border-violet-300 px-3 py-2 text-sm text-violet-700"
                    onClick={(e) => {
                      e.stopPropagation();
                      applyBannerToFrame(frame.id);
                    }}
                    disabled={!bannerImage}
                  >
                    帯をこのフレームに適用
                  </button>
                  <label className="mt-2 flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={!!frame.bannerEnabled}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        updateActiveProject((project) => ({
                          ...project,
                          frames: project.frames.map((f) => (f.id === frame.id ? { ...f, bannerEnabled: e.target.checked } : f)),
                        }))
                      }
                    />
                    帯ON/OFF
                  </label>
                  <p className="mt-1 text-[10px] text-slate-500">
                    bannerEnabled: {String(!!frame.bannerEnabled)} / hasBannerAsset: {String(!!bannerAsset)}
                  </p>
                  {activeProject.singleOutputs[frame.id] ? (
                    <div className="mt-2">
                      <video src={activeProject.singleOutputs[frame.id]} controls className="w-full rounded border border-slate-200 bg-black" />
                    </div>
                  ) : null}
                    </article>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {projects.map((project) =>
        project.stitchedVideoUrl ? (
          <div key={`out-${project.id}`} className="mb-3 rounded-lg border border-slate-200 p-3">
            <p className="mb-2 text-sm font-semibold">{project.title} 生成結果</p>
            <video src={project.stitchedVideoUrl} controls className="w-full max-w-md rounded border border-slate-200 bg-black" />
            <a href={project.stitchedVideoUrl} download={`${project.title}-stitched.webm`} className="mt-2 inline-block text-sm text-sky-700 hover:underline">
              ダウンロード
            </a>
          </div>
        ) : null
      )}

      {wholeVideoUrl ? (
        <div className="mb-3 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
          <p className="mb-2 text-sm font-semibold text-indigo-900">全体動画（音声結合）</p>
          <video src={wholeVideoUrl} controls className="w-full max-w-md rounded border border-slate-200 bg-black" />
          <a
            href={wholeVideoUrl}
            download={`whole-video.${wholeVideoExt}`}
            className="mt-2 inline-block text-sm font-semibold text-indigo-700 hover:underline"
          >
            ダウンロード
          </a>
        </div>
      ) : null}

      {timingWarnings.length > 0 ? (
        <div className="mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
          {timingWarnings.map((w) => (
            <p key={w}>- {w}</p>
          ))}
        </div>
      ) : null}
      {progressText ? <p className="text-sm text-sky-700">{progressText}</p> : null}
      {hint ? <p className="text-sm text-amber-800">{hint}</p> : null}
    </section>
  );
}
