import { describe, it, expect, beforeEach } from "vitest";
import { makeStore } from "@/lib/notifications/store";
import {
  received, markRead, markAllRead, dotSeen, setFilter, replaceState,
  selectUnreadCount, selectShowDot, selectVisible, selectFilter,
} from "@/lib/notifications/slice";
import { SEED, LIVE_QUEUE } from "@/lib/notifications/seed";
import { STORAGE_KEY, LEGACY_KEY, loadPersisted, startPersistence } from "@/lib/notifications/persist";

const unread = (s: ReturnType<typeof makeStore>) => selectUnreadCount(s.getState());

beforeEach(() => localStorage.clear());

describe("slice", () => {
  it("starts from the seed with unread items and the bell dot on", () => {
    const s = makeStore();
    expect(unread(s)).toBe(SEED.filter((n) => n.u).length);
    expect(selectShowDot(s.getState())).toBe(true);
  });

  it("markRead clears a single item only", () => {
    const s = makeStore();
    const id = SEED.find((n) => n.u)!.id;
    s.dispatch(markRead(id));
    expect(unread(s)).toBe(SEED.filter((n) => n.u).length - 1);
  });

  it("markAllRead clears everything and the dot", () => {
    const s = makeStore();
    s.dispatch(markAllRead());
    expect(unread(s)).toBe(0);
    expect(selectShowDot(s.getState())).toBe(false);
  });

  it("received adds on top, unread, raises the dot, and ignores duplicates", () => {
    const s = makeStore();
    s.dispatch(markAllRead());
    s.dispatch(received(LIVE_QUEUE[0]));
    s.dispatch(received(LIVE_QUEUE[0]));
    expect(s.getState().notifications.items[0].id).toBe(LIVE_QUEUE[0].id);
    expect(s.getState().notifications.items.filter((n) => n.id === LIVE_QUEUE[0].id)).toHaveLength(1);
    expect(unread(s)).toBe(1);
    expect(selectShowDot(s.getState())).toBe(true);
  });

  it("opening the bell hides the dot but keeps items unread", () => {
    const s = makeStore();
    s.dispatch(dotSeen());
    expect(selectShowDot(s.getState())).toBe(false);
    expect(unread(s)).toBeGreaterThan(0);
  });

  it("selectVisible is memoized: same state gives the same array reference", () => {
    const s = makeStore();
    expect(selectVisible(s.getState())).toBe(selectVisible(s.getState()));
    const before = selectVisible(s.getState());
    s.dispatch(markRead(SEED.find((n) => n.u)!.id));
    expect(selectVisible(s.getState())).not.toBe(before);
  });

  it("filters", () => {
    const s = makeStore();
    s.dispatch(setFilter("mention"));
    expect(selectFilter(s.getState())).toBe("mention");
    expect(selectVisible(s.getState()).every((n) => n.k === "mention")).toBe(true);
    s.dispatch(setFilter("me"));
    expect(selectVisible(s.getState()).every((n) => n.u && n.a.length)).toBe(true);
  });
});

describe("persistence", () => {
  it("survives a reload (new store, same storage)", () => {
    const a = makeStore();
    startPersistence(a, window);
    a.dispatch(received(LIVE_QUEUE[0]));
    a.dispatch(markRead(SEED.find((n) => n.u)!.id));
    a.dispatch(setFilter("agent"));

    const b = makeStore();
    startPersistence(b, window);
    expect(b.getState().notifications).toEqual(a.getState().notifications);
  });

  it("does not re-deliver the live notification after reload", () => {
    const a = makeStore();
    startPersistence(a, window);
    a.dispatch(received(LIVE_QUEUE[0]));
    const b = makeStore();
    startPersistence(b, window);
    b.dispatch(received(LIVE_QUEUE[0]));
    expect(b.getState().notifications.items.filter((n) => n.id === LIVE_QUEUE[0].id)).toHaveLength(1);
  });

  it("ignores corrupt storage and falls back to the seed", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadPersisted(window.localStorage)).toBeUndefined();
    const s = makeStore();
    startPersistence(s, window);
    expect(unread(s)).toBe(SEED.filter((n) => n.u).length);
  });

  it("migrates the legacy v1 read flags", () => {
    const id = SEED.find((n) => n.u)!.id;
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ read: { [id]: 1 }, extra: [], dot: false, f: "mention" }));
    const s = makeStore();
    startPersistence(s, window);
    expect(s.getState().notifications.items.find((n) => n.id === id)!.u).toBe(0);
    expect(selectFilter(s.getState())).toBe("mention");
  });

  it("syncs another document's change through storage events", () => {
    const a = makeStore();
    startPersistence(a, window);
    const other = makeStore();
    other.dispatch(markAllRead());
    const value = JSON.stringify(other.getState().notifications);
    localStorage.setItem(STORAGE_KEY, value);
    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: value }));
    expect(unread(a)).toBe(0);
    expect(selectShowDot(a.getState())).toBe(false);
  });

  it("replaceState rejects malformed payloads", () => {
    const s = makeStore();
    s.dispatch(replaceState({ items: "nope" } as never));
    expect(unread(s)).toBe(SEED.filter((n) => n.u).length);
  });
});
