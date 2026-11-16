/**
 * Entry bundled (esbuild, `npm run build:notif`) to public/notif-store.js so the static halden.html page
 * uses the very same Redux slice, selectors and persistence as the React app. Do not edit the output.
 */
import { getStore } from "./store";
import { startPersistence } from "./persist";
import * as slice from "./slice";
import { LIVE_QUEUE, resolveBody } from "./seed";

const store = getStore();
startPersistence(store);

const { received, markRead, markAllRead, dotSeen, setFilter } = slice;
const { selectItems, selectFilter, selectUnreadCount, selectShowDot, selectVisible } = slice;

(window as unknown as Record<string, unknown>).HaldenNotifications = {
  store,
  actions: { received, markRead, markAllRead, dotSeen, setFilter },
  selectors: { selectItems, selectFilter, selectUnreadCount, selectShowDot, selectVisible },
  LIVE_QUEUE,
  resolveBody,
};
