/**
 * 歌詞（正規化キー）→ 前回選択した画像 URL（localStorage・軽量）。
 * blob: は保存しない（セッションで無効になるため）。http(s) のみ永続化。
 */

import type { SearchImageResult } from "@/app/api/search-images/route";

const LS_KEY = "adVideo.lyricsToSelectedImage";

export type LyricsImageHistoryEntry = {
  imageUrl: string;
  sourceType?: "suggested" | "uploaded";
  previewUrl?: string;
  pageUrl?: string;
  pixabayImageId?: number;
};

/** Pixabay ID と衝突しない負の定数 */
export const LYRICS_IMAGE_HISTORY_RESULT_ID = -9_000_001;

/** 比較用キー: 前後空白・改行・連続空白の軽い正規化（完全一致） */
export function normalizeLyricsForHistoryKey(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\n+/g, "\n")
    .trim();
}

function isPersistentImageUrl(url: string): boolean {
  const u = url.trim();
  return (
    (u.startsWith("https://") || u.startsWith("http://")) &&
    u.length > 10 &&
    u.length < 4096
  );
}

function loadAll(): Record<string, LyricsImageHistoryEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return {};
    const out: Record<string, LyricsImageHistoryEntry> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val !== "object" || val == null) continue;
      const imageUrl = (val as { imageUrl?: unknown }).imageUrl;
      if (typeof imageUrl !== "string" || !isPersistentImageUrl(imageUrl)) continue;
      const st = (val as { sourceType?: unknown }).sourceType;
      const previewUrl = (val as { previewUrl?: unknown }).previewUrl;
      const pageUrl = (val as { pageUrl?: unknown }).pageUrl;
      const pid = (val as { pixabayImageId?: unknown }).pixabayImageId;
      out[k] = {
        imageUrl,
        sourceType: st === "uploaded" || st === "suggested" ? st : undefined,
        previewUrl:
          typeof previewUrl === "string" && isPersistentImageUrl(previewUrl)
            ? previewUrl.trim()
            : undefined,
        pageUrl: typeof pageUrl === "string" && pageUrl.trim() !== "" ? pageUrl.trim() : undefined,
        pixabayImageId:
          typeof pid === "number" && Number.isFinite(pid) && pid > 0 ? Math.floor(pid) : undefined,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function saveAll(data: Record<string, LyricsImageHistoryEntry>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

export type RememberLyricsImageMeta = {
  previewUrl?: string;
  pageUrl?: string;
  pixabayImageId?: number;
};

/** 画像確定時に呼ぶ（入力中は呼ばない想定） */
export function rememberLyricsImageSelection(
  lyricsNormalizedKey: string,
  imageUrl: string,
  sourceType?: "suggested" | "uploaded",
  meta?: RememberLyricsImageMeta
): void {
  const key = lyricsNormalizedKey.trim();
  if (!key) return;
  if (!isPersistentImageUrl(imageUrl)) return;
  const all = loadAll();
  const previewRaw = meta?.previewUrl?.trim();
  const pageRaw = meta?.pageUrl?.trim();
  const pid = meta?.pixabayImageId;
  all[key] = {
    imageUrl: imageUrl.trim(),
    sourceType,
    previewUrl:
      previewRaw && isPersistentImageUrl(previewRaw) ? previewRaw : undefined,
    pageUrl: pageRaw && pageRaw.length > 0 ? pageRaw : undefined,
    pixabayImageId:
      typeof pid === "number" && Number.isFinite(pid) && pid > 0 ? Math.floor(pid) : undefined,
  };
  saveAll(all);
}

export function getLyricsImageHistory(lyricsNormalizedKey: string): LyricsImageHistoryEntry | null {
  const key = lyricsNormalizedKey.trim();
  if (!key) return null;
  const e = loadAll()[key];
  if (!e?.imageUrl || !isPersistentImageUrl(e.imageUrl)) return null;
  return e;
}

export function searchResultFromHistory(entry: LyricsImageHistoryEntry): SearchImageResult {
  const u = entry.imageUrl.trim();
  const preview =
    entry.previewUrl && isPersistentImageUrl(entry.previewUrl) ? entry.previewUrl.trim() : u;
  const id =
    typeof entry.pixabayImageId === "number" &&
    Number.isFinite(entry.pixabayImageId) &&
    entry.pixabayImageId > 0
      ? entry.pixabayImageId
      : LYRICS_IMAGE_HISTORY_RESULT_ID;
  return {
    id,
    title: "前回この歌詞で使用",
    imageUrl: u,
    previewUrl: preview,
    tags: [],
    author: "",
  };
}

/**
 * 候補の一意キー（React key・重複排除の共通基準）。
 * Pixabay ID（`id` が正のヒット）→ なければ `imageUrl` → なければ `id`
 */
export function searchImageResultStableKey(item: SearchImageResult): string {
  const pixabayImageId =
    typeof item.id === "number" &&
    item.id > 0 &&
    item.id !== LYRICS_IMAGE_HISTORY_RESULT_ID
      ? item.id
      : undefined;
  const url = typeof item.imageUrl === "string" ? item.imageUrl.trim() : "";
  return String(pixabayImageId ?? (url !== "" ? url : undefined) ?? item.id);
}

/** 先頭優先で重複を落とす（検索・履歴 pin マージ後の描画用） */
export function dedupeSearchImageResults(items: SearchImageResult[]): SearchImageResult[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = searchImageResultStableKey(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
