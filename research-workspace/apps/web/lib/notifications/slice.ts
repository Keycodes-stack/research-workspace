import { createSelector, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AppNotification, NotifFilter, NotificationsState } from "./types";
import { SEED } from "./seed";

export const initialState = (): NotificationsState => ({
  items: SEED.map((n) => ({ ...n, a: [...n.a] })),
  dot: true,
  filter: "all",
});

const FILTERS: NotifFilter[] = ["all", "me", "mention", "agent"];
const isItem = (x: unknown): x is AppNotification =>
  !!x && typeof x === "object" && typeof (x as AppNotification).id === "string" &&
  typeof (x as AppNotification).h === "string" && Array.isArray((x as AppNotification).a);

/** Validate untrusted (persisted / cross-tab) state. Returns undefined when unusable. */
export const sanitize = (raw: unknown): NotificationsState | undefined => {
  const r = raw as Partial<NotificationsState> | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.items)) return undefined;
  const items = r.items.filter(isItem).map((n) => ({ ...n, u: (n.u ? 1 : 0) as 0 | 1 }));
  return { items, dot: !!r.dot, filter: FILTERS.includes(r.filter as NotifFilter) ? (r.filter as NotifFilter) : "all" };
};

const slice = createSlice({
  name: "notifications",
  initialState: initialState(),
  reducers: {
    /** Replace state wholesale (hydration from storage / another tab). */
    replaceState: (state, a: PayloadAction<NotificationsState>) => sanitize(a.payload) ?? state,
    /** A new notification arrives. Idempotent by id. */
    received: (state, a: PayloadAction<AppNotification>) => {
      if (state.items.some((n) => n.id === a.payload.id)) return;
      state.items.unshift({ ...a.payload, u: 1 });
      state.dot = true;
    },
    markRead: (state, a: PayloadAction<string>) => {
      const n = state.items.find((x) => x.id === a.payload);
      if (n) n.u = 0;
    },
    markAllRead: (state) => {
      state.items.forEach((n) => { n.u = 0; });
      state.dot = false;
    },
    /** The bell was opened: hide the dot, keep items unread. */
    dotSeen: (state) => { state.dot = false; },
    setFilter: (state, a: PayloadAction<NotifFilter>) => { state.filter = a.payload; },
  },
});

export const { replaceState, received, markRead, markAllRead, dotSeen, setFilter } = slice.actions;
export default slice.reducer;

type Root = { notifications: NotificationsState };
export const selectItems = (s: Root) => s.notifications.items;
export const selectFilter = (s: Root) => s.notifications.filter;
export const selectUnreadCount = (s: Root) => s.notifications.items.filter((n) => n.u).length;
export const selectShowDot = (s: Root) => s.notifications.dot && selectUnreadCount(s) > 0;
/** Memoized: returns the same array until items or filter change, so React components do not re-render needlessly. */
export const selectVisible = createSelector([selectItems, selectFilter], (items, f) =>
  items.filter((n) =>
    f === "all" || (f === "me" && n.u && n.a.length) || (f === "mention" && n.k === "mention") ||
    (f === "agent" && (n.k === "agent" || n.k === "system"))));
