"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, setToken } from "@/lib/api";

/** Load data on mount with loading/error state and a reload function. A 401 clears the stored token.
 * A reload keeps the last data on screen: only the first load shows the loading state, so a background
 * refresh never flashes a false empty (0 projects, "No projects yet") while the request is in flight. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hasData = useRef(false);

  const reload = useCallback(async () => {
    if (!hasData.current) setLoading(true);
    try { setData(await fn()); hasData.current = true; setError(null); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) { setToken(null); window.location.assign("/"); return; }
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}
