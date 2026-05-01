import type { OutputAspect, ShortFrame, ShortsMediaType } from "@/lib/shortsEditorTypes";

export const SHORTS_MULTI_EDITOR_KEY = "shorts-multi-image-editor-v1";

export type PersistedShortsProjectMeta = {
  id: string;
  imageId: string;
  imageName: string;
  imageWidth: number;
  imageHeight: number;
  mediaType?: ShortsMediaType;
  frames: ShortFrame[];
};

export type PersistedShortsMultiDraftV2 = {
  version: 2;
  savedAt: number;
  outputAspect: OutputAspect;
  projects: PersistedShortsProjectMeta[];
};

export function createPersistableProject(input: {
  id: string;
  imageId: string;
  imageName: string;
  imageWidth: number;
  imageHeight: number;
  mediaType?: ShortsMediaType;
  frames: ShortFrame[];
}): PersistedShortsProjectMeta {
  return {
    id: input.id,
    imageId: input.imageId,
    imageName: input.imageName,
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
    mediaType: input.mediaType,
    frames: input.frames.map((frame) => ({
      id: frame.id,
      order: frame.order,
      label: frame.label,
      aspect: frame.aspect,
      centerX: frame.centerX,
      centerY: frame.centerY,
      cropW: frame.cropW,
      cropH: frame.cropH,
      frameCropX: frame.frameCropX,
      frameCropY: frame.frameCropY,
      frameScale: frame.frameScale,
      frameFit: frame.frameFit,
      frameCropLeft: frame.frameCropLeft,
      frameCropRight: frame.frameCropRight,
      frameCropTop: frame.frameCropTop,
      frameCropBottom: frame.frameCropBottom,
      videoStart: frame.videoStart,
      videoEnd: frame.videoEnd,
      videoMuted: frame.videoMuted,
      videoLoop: frame.videoLoop,
      playbackRate: frame.playbackRate,
      text: frame.text,
      narrationByLang: frame.narrationByLang,
      bannerEnabled: frame.bannerEnabled,
      bannerSettings: frame.bannerSettings,
      startTime: frame.startTime,
      endTime: frame.endTime,
      zoomScale: frame.zoomScale,
    })),
  };
}

export function safeSave(key: string, payload: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch (error) {
    console.warn("localStorage save failed", error);
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      try {
        window.localStorage.removeItem(key);
        window.localStorage.setItem(key, JSON.stringify(payload));
      } catch (retryError) {
        console.warn("localStorage retry failed", retryError);
      }
    }
  }
}

export function saveShortsMultiDraft(draft: PersistedShortsMultiDraftV2): void {
  safeSave(SHORTS_MULTI_EDITOR_KEY, draft);
}

export function clearShortsMultiDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SHORTS_MULTI_EDITOR_KEY);
  } catch {
    // noop
  }
}

export function loadShortsMultiDraft(): PersistedShortsMultiDraftV2 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SHORTS_MULTI_EDITOR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedShortsMultiDraftV2;
    if (!parsed || parsed.version !== 2 || !Array.isArray(parsed.projects)) {
      window.localStorage.removeItem(SHORTS_MULTI_EDITOR_KEY);
      return null;
    }
    return parsed;
  } catch {
    try {
      window.localStorage.removeItem(SHORTS_MULTI_EDITOR_KEY);
    } catch {
      // noop
    }
    return null;
  }
}
