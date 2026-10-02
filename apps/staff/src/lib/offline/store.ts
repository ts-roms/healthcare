import { open, seal, sessionKey } from "./crypto";
import type { OfflineAction } from "./outbox";

/**
 * The outbox at rest: one encrypted record in IndexedDB (database `healthcare-offline`), plus an unencrypted count
 * so the banner can show "N waiting" on every page without the key. Browser only.
 */
const DB = "healthcare-offline";
const STORE = "outbox";
const RECORD = "actions";
export const COUNT_SLOT = "healthcare-offline-count";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = run(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

export function offlineStorageAvailable(): boolean {
  return typeof indexedDB !== "undefined" && typeof sessionStorage !== "undefined" && typeof crypto !== "undefined" && "subtle" in crypto;
}

/** Everything in the outbox; empty when nothing was captured, or when it was captured in another browser session. */
export async function loadActions(): Promise<OfflineAction[]> {
  if (!offlineStorageAvailable()) return [];
  const key = await sessionKey();
  if (!key) return [];
  const sealed = await withStore<string | undefined>("readonly", (store) => store.get(RECORD) as IDBRequest<string | undefined>);
  if (!sealed) return [];
  return (await open<OfflineAction[]>(key, sealed)) ?? [];
}

export async function saveActions(actions: OfflineAction[]): Promise<void> {
  if (!offlineStorageAvailable()) return;
  const key = await sessionKey();
  if (!key) return;
  const sealed = await seal(key, actions);
  await withStore("readwrite", (store) => store.put(sealed, RECORD));
  localStorage.setItem(COUNT_SLOT, String(actions.filter((a) => a.status === "waiting" || a.status === "replaying" || a.status === "parked").length));
  window.dispatchEvent(new Event("healthcare-offline-changed"));
}

export async function clearActions(): Promise<void> {
  if (!offlineStorageAvailable()) return;
  await withStore("readwrite", (store) => store.delete(RECORD));
  localStorage.setItem(COUNT_SLOT, "0");
  window.dispatchEvent(new Event("healthcare-offline-changed"));
}

/** The unencrypted count for the banner. */
export function pendingCount(): number {
  if (typeof localStorage === "undefined") return 0;
  return Number(localStorage.getItem(COUNT_SLOT) ?? 0) || 0;
}
