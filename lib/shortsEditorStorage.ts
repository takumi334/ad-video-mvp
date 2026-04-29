import type { ShortFrame } from "@/lib/shortsEditorTypes";

export type PersistedShortsEditorV1 = {
  version: 1;
  savedAt: number;
  /** data URL (PNG) */
  imageDataUrl: string;
  imageName: string;
  outputAspect: "1:1" | "16:9" | "9:16";
  frames: ShortFrame[];
};

const KEY = "shorts-editor-draft-v1";

export function loadShortsEditorDraft(): PersistedShortsEditorV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedShortsEditorV1;
    if (!parsed || parsed.version !== 1) return null;
    if (typeof parsed.imageDataUrl !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveShortsEditorDraft(draft: PersistedShortsEditorV1): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // quota / private mode などは握りつぶす（UI側でヒント表示）
  }
}

export function clearShortsEditorDraft(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // noop
  }
}
