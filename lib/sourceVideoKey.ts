/**
 * 同一素材の再アップロード（videoId が変わる）向けに、autosave を横断して探すための識別子。
 * 軽量に filename + size + duration（秒）でキーを作る。
 */

export const VIDEO_EDITOR_AUTOSAVE_PREFIX = "videoEditorAutosave:";

export type SourceVideoMeta = {
  originalName: string;
  size: number;
  /** メタデータ取得時点の再生長（秒）。未確定時は null */
  durationSec: number | null;
  /** このスナップショットを記録した時刻（ms） */
  updatedAt: number;
};

export function normalizeOriginalName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * 例: svk:v1|my-movie.mp4|1048576|125.334
 * duration が未確定のときは末尾が na（この状態では横断マッチは原則しない）
 */
export function buildSourceVideoKey(meta: {
  originalName: string;
  size: number;
  durationSec: number | null;
}): string {
  const n = normalizeOriginalName(meta.originalName);
  const dur =
    meta.durationSec != null &&
    Number.isFinite(meta.durationSec) &&
    meta.durationSec > 0
      ? Math.round(meta.durationSec * 1000) / 1000
      : "na";
  return `svk:v1|${n}|${meta.size}|${dur}`;
}

/** duration が正の数まで揃ったときだけメタを確定できる */
export function buildSourceVideoMetaForDraft(opts: {
  originalName: string;
  size: number;
  durationSec: number | null;
}): { originalName: string; size: number; durationSec: number } | null {
  if (!opts.originalName.trim()) return null;
  if (!Number.isFinite(opts.size) || opts.size < 0) return null;
  if (
    opts.durationSec == null ||
    !Number.isFinite(opts.durationSec) ||
    opts.durationSec <= 0
  ) {
    return null;
  }
  return {
    originalName: opts.originalName,
    size: opts.size,
    durationSec: opts.durationSec,
  };
}

export function finalizeSourceVideoMeta(
  draft: { originalName: string; size: number; durationSec: number }
): SourceVideoMeta {
  return { ...draft, updatedAt: Date.now() };
}

/** 誤復元抑制: 名前正規化一致 + サイズ一致 + 両方の duration が近い */
export function isHighConfidenceMetaMatch(
  a: SourceVideoMeta,
  b: SourceVideoMeta,
  durationToleranceSec = 0.25
): boolean {
  if (normalizeOriginalName(a.originalName) !== normalizeOriginalName(b.originalName)) {
    return false;
  }
  if (a.size !== b.size) return false;
  if (
    a.durationSec == null ||
    b.durationSec == null ||
    !Number.isFinite(a.durationSec) ||
    !Number.isFinite(b.durationSec) ||
    a.durationSec <= 0 ||
    b.durationSec <= 0
  ) {
    return false;
  }
  return Math.abs(a.durationSec - b.durationSec) <= durationToleranceSec;
}

export type AutosaveLike = {
  version?: number;
  updatedAt?: number;
  videoId?: number;
  sourceVideoKey?: string;
  sourceVideoMeta?: SourceVideoMeta;
  lyricsText?: string;
  panelState?: unknown;
};

export type CrossResumeScanResult = {
  storageKey: string;
  raw: string;
  data: AutosaveLike;
  updatedAt: number;
  fromVideoId: number;
};

export function listVideoEditorAutosaveKeys(): string[] {
  if (typeof window === "undefined") return [];
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(VIDEO_EDITOR_AUTOSAVE_PREFIX)) keys.push(k);
    }
  } catch {
    /* ignore */
  }
  return keys;
}

export function parseAutosaveVideoId(key: string): number | null {
  if (!key.startsWith(VIDEO_EDITOR_AUTOSAVE_PREFIX)) return null;
  const id = Number(key.slice(VIDEO_EDITOR_AUTOSAVE_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * 別 videoId に保存された autosave のうち、現在の素材と一致・高一致する最新1件を返す。
 */
export function findBestCrossVideoResumeCandidate(
  currentVideoId: number,
  currentKey: string,
  currentMeta: SourceVideoMeta
): CrossResumeScanResult | null {
  let best: CrossResumeScanResult | null = null;
  let bestUpdated = -1;

  for (const storageKey of listVideoEditorAutosaveKeys()) {
    const fromVideoId = parseAutosaveVideoId(storageKey);
    if (fromVideoId == null || fromVideoId === currentVideoId) continue;

    let raw: string;
    try {
      raw = localStorage.getItem(storageKey) ?? "";
      if (!raw.trim()) continue;
    } catch {
      continue;
    }

    let data: AutosaveLike;
    try {
      data = JSON.parse(raw) as AutosaveLike;
    } catch {
      continue;
    }

    if (data.version !== 1) continue;
    if (!data.panelState || typeof data.lyricsText !== "string") continue;

    let match = false;
    if (data.sourceVideoKey && data.sourceVideoKey === currentKey) {
      match = true;
    } else if (
      data.sourceVideoMeta &&
      isHighConfidenceMetaMatch(currentMeta, data.sourceVideoMeta)
    ) {
      match = true;
    }

    if (!match) continue;

    const updatedAt =
      typeof data.updatedAt === "number" && Number.isFinite(data.updatedAt)
        ? data.updatedAt
        : 0;
    if (updatedAt >= bestUpdated) {
      bestUpdated = updatedAt;
      best = { storageKey, raw, data, updatedAt, fromVideoId };
    }
  }

  return best;
}

export function sessionDismissCrossResumeKey(videoId: number): string {
  return `videoCrossResumeDismissed:${videoId}`;
}
