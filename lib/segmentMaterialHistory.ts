"use client";

export type SegmentMaterialEditSettings = {
  cropRect?: { x: number; y: number; w: number; h: number };
  ratio?: "1:1" | "9:16" | "16:9" | "free";
  fitMode?: "cover" | "contain";
  zoom?: number;
  rotation?: number;
  panX?: number;
  panY?: number;
  applyMode?: "background" | "overlay";
};

export type SegmentMaterialHistoryEntry = {
  imageId: string;
  imageUrl?: string;
  blobId?: string;
  title?: string;
  editSettings?: SegmentMaterialEditSettings;
  favorite?: boolean;
  chorusSaved?: boolean;
  lastUsedAt: string;
};

const DB_NAME = "ad-video-mvp-segment-material-history";
const DB_VERSION = 1;
const BLOB_STORE = "blobs";
const META_KEY = "ad-video-mvp-segment-material-history-meta-v1";
const MAX_META = 120;

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `mh-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readMeta(): SegmentMaterialHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(META_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => x && typeof x === "object") as SegmentMaterialHistoryEntry[];
  } catch {
    return [];
  }
}

function writeMeta(rows: SegmentMaterialHistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(META_KEY, JSON.stringify(rows.slice(0, MAX_META)));
  } catch {
    /* ignore quota / private mode */
  }
}

async function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return null;
  return await new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(BLOB_STORE)) {
          db.createObjectStore(BLOB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbPutBlob(blobId: string, blob: Blob): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(BLOB_STORE, "readwrite");
    tx.objectStore(BLOB_STORE).put(blob, blobId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  db.close();
}

async function idbGetBlob(blobId: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  const out = await new Promise<Blob | null>((resolve) => {
    const tx = db.transaction(BLOB_STORE, "readonly");
    const req = tx.objectStore(BLOB_STORE).get(blobId);
    req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
    req.onerror = () => resolve(null);
  });
  db.close();
  return out;
}

export async function upsertSegmentMaterialHistory(input: {
  imageUrl?: string;
  imageBlob?: Blob;
  title?: string;
  editSettings?: SegmentMaterialEditSettings;
  favorite?: boolean;
  chorusSaved?: boolean;
  imageId?: string;
}): Promise<SegmentMaterialHistoryEntry | null> {
  const imageId = input.imageId ?? newId();
  let blobId: string | undefined;
  if (input.imageBlob) {
    blobId = `blob:${imageId}`;
    await idbPutBlob(blobId, input.imageBlob);
  }
  const next: SegmentMaterialHistoryEntry = {
    imageId,
    imageUrl: input.imageUrl,
    blobId,
    title: input.title,
    editSettings: input.editSettings,
    favorite: Boolean(input.favorite),
    chorusSaved: Boolean(input.chorusSaved),
    lastUsedAt: nowIso(),
  };
  const rows = readMeta().filter((x) => x.imageId !== imageId);
  rows.unshift(next);
  writeMeta(rows);
  return next;
}

export function listSegmentMaterialHistory(): SegmentMaterialHistoryEntry[] {
  return readMeta().sort((a, b) => (a.lastUsedAt < b.lastUsedAt ? 1 : -1));
}

export function patchSegmentMaterialHistory(
  imageId: string,
  patch: Partial<Pick<SegmentMaterialHistoryEntry, "favorite" | "chorusSaved" | "title" | "editSettings">>
): void {
  const rows = readMeta();
  const idx = rows.findIndex((x) => x.imageId === imageId);
  if (idx < 0) return;
  rows[idx] = {
    ...rows[idx],
    ...patch,
    lastUsedAt: nowIso(),
  };
  writeMeta(rows);
}

export async function resolveSegmentMaterialHistoryUrl(row: SegmentMaterialHistoryEntry): Promise<string | null> {
  if (row.imageUrl && row.imageUrl.trim() !== "") return row.imageUrl;
  if (!row.blobId) return null;
  const blob = await idbGetBlob(row.blobId);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

