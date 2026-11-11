"use client";
import { useEffect, useRef } from "react";
import { API_URL, getToken } from "./api";
import { SseParser, type SseFrame } from "./sse";

/** Subscribe to a concept's live event stream; reconnects with backoff. Events carry ids only: refetch to see content. */
export function useConceptEvents(conceptId: string, onEvent: (f: SseFrame) => void, onState?: (live: boolean) => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const state = useRef(onState);
  state.current = onState;

  useEffect(() => {
    const ctl = new AbortController();
    let delay = 1000;
    (async () => {
      while (!ctl.signal.aborted) {
        try {
          const token = getToken();
          const res = await fetch(`${API_URL}/concepts/${conceptId}/events`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: ctl.signal,
          });
          if (!res.ok || !res.body) throw new Error(`status ${res.status}`);
          state.current?.(true); delay = 1000;
          const reader = res.body.getReader(), dec = new TextDecoder(), parser = new SseParser();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            for (const f of parser.push(dec.decode(value, { stream: true }))) handler.current(f);
          }
        } catch { /* fall through to reconnect */ }
        state.current?.(false);
        if (ctl.signal.aborted) return;
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 15000);
        handler.current({ event: "resync", data: "{}" });      // we may have missed events while disconnected
      }
    })();
    return () => ctl.abort();
  }, [conceptId]);
}
