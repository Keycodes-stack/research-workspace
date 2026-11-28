"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";

/** Load data on mount with loading/error state and a reload function.
 * Testing build: a 401 is shown as an error instead of bouncing back to
 * the sign-in page (there is no sign-in page right now). */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setError(null); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) { setError("Not signed in — the server needs an access token"); }
      else setError(e instanceof Error ? e.message : "Something went wrong");
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { void reload(); }, [reload]);
  return { data, error, loading, reload };
}
