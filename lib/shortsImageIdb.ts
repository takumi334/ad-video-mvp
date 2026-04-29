import { openDB } from "idb";

const DB_NAME = "shorts-editor-images";
const DB_VERSION = 1;
const STORE = "images";

type ShortsImageDB = {
  images: {
    key: string;
    value: Blob;
  };
};

async function getDb() {
  return await openDB<ShortsImageDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    },
  });
}

export async function putShortsImageBlob(imageId: string, blob: Blob): Promise<void> {
  const db = await getDb();
  await db.put(STORE, blob, imageId);
}

export async function getShortsImageBlob(imageId: string): Promise<Blob | null> {
  const db = await getDb();
  const found = await db.get(STORE, imageId);
  return found ?? null;
}

export async function deleteShortsImageBlob(imageId: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, imageId);
}

export async function clearShortsImageBlobs(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE);
}
