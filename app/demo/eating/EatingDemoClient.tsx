"use client";

import { takePendingHomeImage } from "@/lib/homePendingImageIdb";
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
import type { OutputAspect, ShortFrame } from "@/lib/shortsEditorTypes";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactElement } from "react";

const ACCEPT_ATTR = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";
const ACCEPT_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const ACCEPT_AUDIO_ATTR = "audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,.mp3,.wav,.m4a";
const ACCEPT_AUDIO_MIME = new Set(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a"]);
const MAX_IMAGE_FILE_BYTES = 40 * 1024 * 1024;
const MAX_IMAGES = 8;

type ImageProject = {
  id: string;
  imageId: string;
  title: string;
  fileName: string;
  imageWidth: number;
  imageHeight: number;
  previewUrl: string;
  sourceImage: HTMLImageElement;
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

function newId(): string {
  return `sf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isAllowedImageFile(file: File): boolean {
  if (file.type && ACCEPT_MIME.has(file.type)) return true;
  return /\.(png|jpe?g|webp)$/i.test(file.name);
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

function defaultSixFrames(aspect: OutputAspect): ShortFrame[] {
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
      startTime: index * 3,
      endTime: (index + 1) * 3,
      zoomScale: 1.12,
    };
    const clamped = clampCropBox(draft);
    return { ...draft, ...clamped };
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

async function loadImageFromFile(file: File): Promise<{ image: HTMLImageElement; objectUrl: string }> {
  const objectUrl = URL.createObjectURL(file);
  try {
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
    return { image, objectUrl };
  } catch (e) {
    URL.revokeObjectURL(objectUrl);
    throw e;
  }
}

async function renderSingleSegment(source: HTMLImageElement, frame: ShortFrame, aspect: OutputAspect, kenBurns: number): Promise<Blob> {
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
  const base = getCropPxRect(frame, source.naturalWidth, source.naturalHeight);
  const shrink = 1 + kenBurns * (zoom - 1);
  const innerW = clamp(base.sw / shrink, 1, base.sw);
  const innerH = clamp(base.sh / shrink, 1, base.sh);
  recorder.start(150);
  const startedAt = performance.now();
  await new Promise<void>((resolve) => {
    const draw = () => {
      const progress = clamp((performance.now() - startedAt) / 1000 / duration, 0, 1);
      const eased = easeInOutCubic(progress);
      const sw = base.sw + (innerW - base.sw) * eased;
      const sh = base.sh + (innerH - base.sh) * eased;
      const cx = frame.centerX * source.naturalWidth;
      const cy = frame.centerY * source.naturalHeight;
      const sx = clamp(cx - sw / 2, 0, source.naturalWidth - sw);
      const sy = clamp(cy - sh / 2, 0, source.naturalHeight - sh);
      ctx.clearRect(0, 0, outW, outH);
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);
      const barH = Math.round(outH * 0.18);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(0, outH - barH, outW, barH);
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${Math.max(22, Math.round(outW * 0.055))}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(frame.text, outW / 2, outH - barH / 2, outW - 48);
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

async function renderStitched(source: HTMLImageElement, frames: ShortFrame[], aspect: OutputAspect, kenBurns: number): Promise<Blob> {
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
      const eased = easeInOutCubic(local);
      const zoom = clamp(toSafeNumber(frame.zoomScale, 1.12), 1, 3);
      const base = getCropPxRect(frame, source.naturalWidth, source.naturalHeight);
      const shrink = 1 + kenBurns * (zoom - 1);
      const innerW = clamp(base.sw / shrink, 1, base.sw);
      const innerH = clamp(base.sh / shrink, 1, base.sh);
      const sw = base.sw + (innerW - base.sw) * eased;
      const sh = base.sh + (innerH - base.sh) * eased;
      const cx = frame.centerX * source.naturalWidth;
      const cy = frame.centerY * source.naturalHeight;
      const sx = clamp(cx - sw / 2, 0, source.naturalWidth - sw);
      const sy = clamp(cy - sh / 2, 0, source.naturalHeight - sh);
      ctx.clearRect(0, 0, outW, outH);
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, outW, outH);
      const barH = Math.round(outH * 0.18);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(0, outH - barH, outW, barH);
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${Math.max(22, Math.round(outW * 0.055))}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(frame.text, outW / 2, outH - barH / 2, outW - 48);
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

function FrameThumb(props: { source: HTMLImageElement | null; frame: ShortFrame; width: number; height: number }): ReactElement | null {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !props.source) return;
    c.width = props.width;
    c.height = props.height;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const { sx, sy, sw, sh } = getCropPxRect(props.frame, props.source.naturalWidth, props.source.naturalHeight);
    ctx.clearRect(0, 0, props.width, props.height);
    ctx.drawImage(props.source, sx, sy, sw, sh, 0, 0, props.width, props.height);
  }, [props.frame, props.height, props.source, props.width]);
  if (!props.source) return null;
  return <canvas ref={canvasRef} className="w-full rounded-md border border-slate-200 bg-black" style={{ aspectRatio: `${props.width} / ${props.height}` }} />;
}

export default function EatingDemoClient() {
  const inputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewImageRef = useRef<HTMLImageElement>(null);
  const isDraggingRef = useRef(false);
  const dragFrameIdRef = useRef<string | null>(null);
  const generatedUrlsRef = useRef<string[]>([]);
  const [dragActive, setDragActive] = useState(false);
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
  const [isRenderingWholeVideo, setIsRenderingWholeVideo] = useState(false);
  const [wholeVideoUrl, setWholeVideoUrl] = useState<string | null>(null);
  const [wholeVideoExt, setWholeVideoExt] = useState<"mp4" | "webm">("webm");

  const activeProject = useMemo(() => projects.find((p) => p.id === activeProjectId) ?? null, [projects, activeProjectId]);
  const sortedFrames = useMemo(
    () => (activeProject ? [...activeProject.frames].sort((a, b) => a.order - b.order) : []),
    [activeProject]
  );
  const selectedFrame = useMemo(() => {
    if (!activeProject || sortedFrames.length === 0) return null;
    return sortedFrames.find((f) => f.id === activeProject.selectedFrameId) ?? sortedFrames[0];
  }, [activeProject, sortedFrames]);
  const currentPreviewFrameIndex = getFrameIndexAtTime(audioCurrentTime, sortedFrames);
  const currentPreviewFrame = currentPreviewFrameIndex >= 0 ? sortedFrames[currentPreviewFrameIndex] : null;
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
    const urlsRef = generatedUrlsRef;
    return () => {
      urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      projects.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    const rect = getCropPxRect(currentPreviewFrame, activeProject.sourceImage.naturalWidth, activeProject.sourceImage.naturalHeight);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(activeProject.sourceImage, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, c.width, c.height);
    const barH = Math.round(c.height * 0.18);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(0, c.height - barH, c.width, barH);
    ctx.fillStyle = "#fff";
    ctx.font = `700 ${Math.max(22, Math.round(c.width * 0.055))}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(currentPreviewFrame.text || "", c.width / 2, c.height - barH / 2, c.width - 48);
  }, [activeProject, currentPreviewFrame, previewDims.height, previewDims.width]);

  const buildProject = useCallback(
    async (
      file: File,
      indexHint: number,
      restoreMeta?: PendingRestoreMeta["projects"][number]
    ): Promise<ImageProject> => {
      const imageId = restoreMeta?.imageId ?? newId();
      await putShortsImageBlob(imageId, file);
      const { image, objectUrl } = await loadImageFromFile(file);
      const frames = restoreMeta
        ? relabelByOrder(
            normalizeOrders(restoreMeta.frames).map((f, idx) => ({
              ...f,
              id: toSafeString(f.id, newId()),
              label: `#${idx + 1}`,
              aspect: outputAspect,
              startTime: toSafeNumber((f as Partial<ShortFrame>).startTime, idx * 3),
              endTime: Math.max(
                toSafeNumber((f as Partial<ShortFrame>).endTime, (idx + 1) * 3),
                toSafeNumber((f as Partial<ShortFrame>).startTime, idx * 3) + 0.05
              ),
            }))
          )
        : defaultSixFrames(outputAspect);
      return {
        id: restoreMeta?.id ?? newId(),
        imageId,
        title: `Image ${indexHint}`,
        fileName: file.name,
        imageWidth: image.naturalWidth,
        imageHeight: image.naturalHeight,
        previewUrl: objectUrl,
        sourceImage: image,
        frames,
        selectedFrameId: null,
        stitchedVideoUrl: null,
        singleOutputs: {},
      };
    },
    [outputAspect]
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
        setHint("対応画像がありません。PNG / JPG / JPEG / WebP を選択してください。");
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
          frames: p.frames,
        })
      ),
    };
    saveShortsMultiDraft(payload);
  }, [projects, isHydrated, outputAspect]);

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    void addFiles(files);
    e.target.value = "";
  };

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
    if (!isAllowedAudioFile(file)) {
      setHint("音声は MP3 / WAV / M4A のみ対応です。");
      e.target.value = "";
      return;
    }
    setHint(null);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const nextUrl = URL.createObjectURL(file);
    setAudioUrl(nextUrl);
    setAudioName(file.name);
    setAudioCurrentTime(0);
    setAudioDuration(0);
    setIsPreviewPlaying(false);
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

  async function generateStitchedForProject(project: ImageProject): Promise<string> {
    const sorted = [...project.frames].sort((a, b) => a.order - b.order);
    const blob = await renderStitched(project.sourceImage, sorted, outputAspect, kenBurns);
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
      const blob = await renderSingleSegment(project.sourceImage, frame, outputAspect, kenBurns);
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
      setHint("ダウンロード可能な出力がありません。先に動画生成してください。");
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

      const lastEnd = sortedFrames.reduce((mx, f) => Math.max(mx, toSafeNumber(f.endTime, 0)), 0);
      const totalDuration = Math.max(lastEnd, audioBuffer.duration);
      recorder.start(150);
      source.start(0);
      const startedAt = performance.now();
      await new Promise<void>((resolve) => {
        const draw = () => {
          const t = (performance.now() - startedAt) / 1000;
          const progress = clamp(t / Math.max(totalDuration, 0.001), 0, 1);
          const idx = getFrameIndexAtTime(t, sortedFrames);
          const frame = idx >= 0 ? sortedFrames[idx] : sortedFrames[0];
          const segDuration = Math.max(0.05, getFrameDuration(frame));
          const localT = clamp((t - toSafeNumber(frame.startTime, 0)) / segDuration, 0, 1);
          const eased = easeInOutCubic(localT);
          const zoom = clamp(toSafeNumber(frame.zoomScale, 1.12), 1, 3);
          const base = getCropPxRect(frame, activeProject.sourceImage.naturalWidth, activeProject.sourceImage.naturalHeight);
          const shrink = 1 + kenBurns * (zoom - 1);
          const innerW = clamp(base.sw / shrink, 1, base.sw);
          const innerH = clamp(base.sh / shrink, 1, base.sh);
          const sw = base.sw + (innerW - base.sw) * eased;
          const sh = base.sh + (innerH - base.sh) * eased;
          const cx = frame.centerX * activeProject.sourceImage.naturalWidth;
          const cy = frame.centerY * activeProject.sourceImage.naturalHeight;
          const sx = clamp(cx - sw / 2, 0, activeProject.sourceImage.naturalWidth - sw);
          const sy = clamp(cy - sh / 2, 0, activeProject.sourceImage.naturalHeight - sh);
          ctx.clearRect(0, 0, outW, outH);
          ctx.drawImage(activeProject.sourceImage, sx, sy, sw, sh, 0, 0, outW, outH);
          const barH = Math.round(outH * 0.18);
          ctx.fillStyle = "rgba(0,0,0,0.22)";
          ctx.fillRect(0, outH - barH, outW, barH);
          ctx.fillStyle = "#fff";
          ctx.font = `700 ${Math.max(22, Math.round(outW * 0.055))}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(frame.text, outW / 2, outH - barH / 2, outW - 48);
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
      <h2 className="text-xl font-semibold text-slate-900">複数画像ショート素材編集</h2>
      <p className="mt-1 text-sm text-slate-600">画像ごとに独立タブでフレーム編集し、個別または全画像一括で生成できます。</p>

      <input ref={inputRef} type="file" multiple accept={ACCEPT_ATTR} className="sr-only" aria-label="画像を選択" onChange={onInputChange} />
      <input ref={audioInputRef} type="file" accept={ACCEPT_AUDIO_ATTR} className="sr-only" aria-label="MP3を選択" onChange={onAudioInputChange} />
      <audio ref={audioRef} src={audioUrl ?? undefined} preload="metadata" />
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
        <p className="text-sm font-medium text-slate-800">複数画像をドロップ / タップして選択（最大 {MAX_IMAGES} 枚）</p>
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
          {isGeneratingStitchedProjectId ? "生成中..." : "この画像を生成"}
        </button>
        <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm" disabled={projects.length === 0 || isGeneratingAll} onClick={() => void handleGenerateAllImages()}>
          {isGeneratingAll ? "全画像生成中..." : "全画像一括生成"}
        </button>
        <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm" onClick={downloadAllOutputs}>
          出力をまとめてダウンロード
        </button>
        <button type="button" className="rounded-lg border border-slate-300 px-4 py-2 text-sm" onClick={() => audioInputRef.current?.click()}>
          MP3をアップロード
        </button>
        <button
          type="button"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={!activeProject || !audioUrl || isRenderingWholeVideo}
          onClick={() => void handleRenderWholeVideo()}
        >
          {isRenderingWholeVideo ? "動画生成中…" : "全体動画生成"}
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
          この画像を削除
        </button>
        <button type="button" className="rounded-lg border border-rose-400 px-4 py-2 text-sm font-semibold text-rose-800" disabled={projects.length === 0} onClick={removeAllImages}>
          全画像を削除
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <aside className="order-1 lg:order-2">
          <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 lg:sticky lg:top-4">
            <p className="mb-2 text-sm font-semibold text-slate-800">固定プレビュー（9:16）</p>
            <p className="mb-2 text-xs text-slate-500">{audioName ?? "音声未選択"}</p>
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-2">
              <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={() => void handlePreviewPlay()} disabled={!audioUrl}>
                {isPreviewPlaying ? "⏸ 停止" : "▶ 再生"}
              </button>
              <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={handlePreviewStop}>
                ⏸ 停止
              </button>
              <button type="button" className="rounded border border-slate-300 px-2 py-1 text-xs" onClick={handlePreviewReset}>
                ↻ 先頭
              </button>
              <span className="ml-auto text-xs text-slate-600">
                {formatClock(audioCurrentTime)} / {formatClock(audioDuration)}
              </span>
              <span className="text-xs font-semibold text-slate-700">
                {currentPreviewFrameIndex >= 0 ? `#${currentPreviewFrameIndex + 1}` : "#-"}
              </span>
            </div>
            <div className="mb-3">
              <canvas ref={previewCanvasRef} className="w-full rounded-lg border border-slate-200 bg-black aspect-[9/16]" />
            </div>
            <div className="mb-2 flex flex-wrap gap-2">
              <button type="button" className="rounded border border-slate-300 px-3 py-2 text-sm" onClick={() => void handlePreviewPlay()} disabled={!audioUrl}>
                プレビュー再生
              </button>
              <button type="button" className="rounded border border-slate-300 px-3 py-2 text-sm" onClick={handlePreviewStop}>
                停止
              </button>
              <button type="button" className="rounded border border-slate-300 px-3 py-2 text-sm" onClick={handlePreviewReset}>
                先頭に戻る
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
                <p className="mb-2 text-sm font-semibold text-slate-800">元画像プレビュー</p>
                <div
                  className="relative inline-block max-w-full"
                  onPointerDown={(e) => {
                    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-frame-id]");
                    const id = el?.dataset.frameId;
                    if (!id) return;
                    e.preventDefault();
                    updateActiveProject((project) => ({ ...project, selectedFrameId: id }));
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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img ref={previewImageRef} src={activeProject.previewUrl} alt={activeProject.fileName} className="max-h-[420px] w-auto rounded-lg border border-slate-200" />
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
                <h3 className="mb-3 text-base font-semibold text-slate-800">フレーム一覧（画像ごと）</h3>
                {sortedFrames.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
                    フレームがありません。自動分割またはフレーム追加してください
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    {sortedFrames.map((frame) => (
                    <article key={frame.id} className="rounded-xl border border-slate-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold">{frame.label}</p>
                    <div className="flex gap-1">
                      <button
                        type="button"
                        className="rounded border border-rose-200 px-2 py-1 text-xs text-rose-700"
                        onClick={() => removeFrame(frame.id)}
                      >
                        × 削除
                      </button>
                      <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => moveOrder(frame.id, -1)}>
                        順↑
                      </button>
                      <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => moveOrder(frame.id, 1)}>
                        順↓
                      </button>
                    </div>
                  </div>
                  <div className="mb-2">
                    <FrameThumb source={activeProject.sourceImage} frame={frame} width={thumbDims.width} height={thumbDims.height} />
                  </div>
                  <label className="mb-2 block text-xs">
                    ナレーション
                    <input
                      type="text"
                      value={toSafeString(frame.text, "")}
                      onChange={(e) =>
                        updateActiveProject((project) => ({
                          ...project,
                          frames: project.frames.map((f) => (f.id === frame.id ? { ...f, text: e.target.value.slice(0, 160) } : f)),
                        }))
                      }
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <div className="mb-2 grid grid-cols-2 gap-2 text-xs">
                    <label>
                      start
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
                      end
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
                  <p className="mb-2 text-[11px] text-slate-500">endを変更すると次のstartに反映されます（start変更時は前のendに反映）。</p>
                  <label className="mb-2 block text-xs">
                    zoom {clamp(toSafeNumber(frame.zoomScale, 1.12), 1, 3).toFixed(2)}x
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
                  <button
                    type="button"
                    className="rounded border border-slate-300 px-3 py-2 text-sm"
                    disabled={isGeneratingAll || isGeneratingSingle != null}
                    onClick={() => void handleGenerateSingle(activeProject.id, frame.id)}
                  >
                    {isGeneratingSingle?.projectId === activeProject.id && isGeneratingSingle.frameId === frame.id ? "生成中..." : "この枠だけ生成"}
                  </button>
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
