"use client";
import { useEffect } from "react";
import { Provider } from "react-redux";
import { getStore, type AppStore } from "@/lib/notifications/store";
import { startPersistence } from "@/lib/notifications/persist";

/**
 * Single Redux store for the React app. Server and first client render use the seed (so markup matches);
 * after mount it hydrates from localStorage and stays in sync with other tabs and the embedded Halden iframe.
 */
export default function StoreProvider({ children, store = getStore() }: { children: React.ReactNode; store?: AppStore }) {
  useEffect(() => startPersistence(store), [store]);
  return <Provider store={store}>{children}</Provider>;
}
