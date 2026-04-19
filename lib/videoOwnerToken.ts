const STORAGE_PREFIX = "adVideoOwner:";

/** 新規動画用の所有者トークン（UUID） */
export function generateOwnerSecret(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `own-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function getVideoOwnerSecret(videoId: number): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(`${STORAGE_PREFIX}${videoId}`);
  } catch {
    return null;
  }
}

export function setVideoOwnerSecret(videoId: number, secret: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${videoId}`, secret);
  } catch {
    /* ignore */
  }
}

export function ownerAuthHeaders(videoId: number): HeadersInit {
  const s = getVideoOwnerSecret(videoId);
  if (!s) return {};
  return { Authorization: `Bearer ${s}` };
}
