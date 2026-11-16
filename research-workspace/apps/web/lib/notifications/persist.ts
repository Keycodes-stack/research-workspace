import type { AppStore } from "./store";
import { replaceState, sanitize } from "./slice";
import { SEED } from "./seed";
import type { NotificationsState } from "./types";

export const STORAGE_KEY = "halden_notifs_v2";
export const LEGACY_KEY = "halden_notifs_v1";

const read = (storage: Storage, key: string): unknown => {
  try { const v = storage.getItem(key); return v ? JSON.parse(v) : undefined; } catch { return undefined; }
};

/** Persisted state, with seed items it does not know yet appended; v1 data migrated once. */
export function loadPersisted(storage: Storage): NotificationsState | undefined {
  const cur = sanitize(read(storage, STORAGE_KEY));
  if (cur) {
    const known = new Set(cur.items.map((n) => n.id));
    return { ...cur, items: [...cur.items, ...SEED.filter((n) => !known.has(n.id))] };
  }
  const old = read(storage, LEGACY_KEY) as { read?: Record<string, number>; extra?: unknown[]; dot?: boolean; f?: string } | undefined;
  if (old && typeof old === "object") {
    const extra = (Array.isArray(old.extra) ? old.extra : []).map((x) => {
      const e = x as Record<string, unknown>;
      return { ...e, b: typeof e.bt === "string" ? e.bt : "" };
    });
    const migrated = sanitize({ items: [...extra, ...SEED], dot: old.dot ?? true, filter: old.f });
    if (migrated) {
      migrated.items = migrated.items.map((n) => (old.read?.[n.id] ? { ...n, u: 0 as const } : n));
      return migrated;
    }
  }
  return undefined;
}

const parse = (s: string | null): unknown => { try { return JSON.parse(s ?? ""); } catch { return undefined; } };

/**
 * Hydrate `store` from storage, then keep storage and store in step:
 * store changes are written, and `storage` events from other documents (tabs, the iframe, the React shell) are applied.
 * Returns a detach function.
 */
export function startPersistence(store: AppStore, win: Window = window): () => void {
  let storage: Storage;
  try { storage = win.localStorage; } catch { return () => {}; }

  let last = "";
  const save = () => {
    const json = JSON.stringify(store.getState().notifications);
    if (json === last) return;
    last = json;
    try { storage.setItem(STORAGE_KEY, json); } catch { /* storage blocked: stay in-memory */ }
  };

  const loaded = loadPersisted(storage);
  if (loaded) store.dispatch(replaceState(loaded));
  save();

  const unsub = store.subscribe(save);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY || e.newValue === last) return;
    const incoming = sanitize(parse(e.newValue));
    if (!incoming) return;
    store.dispatch(replaceState(incoming));
    last = JSON.stringify(store.getState().notifications);
  };
  win.addEventListener("storage", onStorage);
  return () => { unsub(); win.removeEventListener("storage", onStorage); };
}
