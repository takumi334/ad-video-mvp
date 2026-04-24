const DB_NAME = "ad-video-mvp-home-pending";
const DB_VERSION = 1;
const STORE = "pending";
const KEY_HOME_IMAGE = "homeToEatingImage";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

/** トップで選択した画像を /demo/eating 用に一時保存（サーバーに送らない） */
export async function putPendingHomeImage(file: File): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("indexedDB transaction aborted"));
      tx.objectStore(STORE).put(file, KEY_HOME_IMAGE);
    });
  } finally {
    db.close();
  }
}

/** 取り出したらストアから削除する（一回限り） */
export async function takePendingHomeImage(): Promise<File | null> {
  const db = await openDb();
  try {
    return await new Promise<File | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const getReq = store.get(KEY_HOME_IMAGE);
      getReq.onerror = () => reject(getReq.error ?? new Error("indexedDB get failed"));
      getReq.onsuccess = () => {
        const val = getReq.result as File | Blob | undefined;
        store.delete(KEY_HOME_IMAGE);
        if (val == null) {
          resolve(null);
          return;
        }
        if (val instanceof File) {
          resolve(val);
          return;
        }
        resolve(
          new File([val], "image", {
            type: val.type && val.type !== "" ? val.type : "image/png",
          })
        );
      };
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB transaction failed"));
    });
  } finally {
    db.close();
  }
}
