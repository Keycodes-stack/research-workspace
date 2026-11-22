"use client";

import { useEffect, useRef, useState } from "react";

/* Minimal typings for the browser speech API (not in every TypeScript DOM lib). */
type SpeechResult = { isFinal: boolean; 0: { transcript: string } };
type SpeechEvent = { resultIndex: number; results: ArrayLike<SpeechResult> };
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: SpeechEvent) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null;
  start: () => void; stop: () => void;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Dictate into a text box with the browser's own speech recognition (free, no server call).
 * Hidden where the browser has no speech recognition (e.g. Firefox): typing still works.
 */
export default function DictateButton({ onText, label = "Dictate" }: { onText: (text: string) => void; label?: string }) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const active = useRef<Recognition | null>(null);

  useEffect(() => {
    setSupported(recognitionCtor() !== null);
    return () => { active.current?.stop(); active.current = null; };
  }, []);

  if (!supported) return null;

  const toggle = () => {
    if (listening) { active.current?.stop(); return; }
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (e) => {
      const text = Array.from(e.results).slice(e.resultIndex)
        .filter((r) => r.isFinal !== false).map((r) => r[0]?.transcript ?? "").join(" ").trim();
      if (text) onText(text);
    };
    rec.onend = () => { setListening(false); active.current = null; };
    rec.onerror = () => { setListening(false); active.current = null; };
    active.current = rec;
    rec.start();
    setListening(true);
  };

  return <button type="button" onClick={toggle} aria-pressed={listening}
    className={`inline-flex items-center gap-2 rounded-[10px] border px-3 py-1.5 text-sm font-medium ${listening ? "border-[#B42318] bg-[#FEF3F2] text-[#B42318]" : "border-[#EDEDF0] bg-white text-[#344054]"}`}>
    <span aria-hidden="true" className={`size-2 rounded-full ${listening ? "animate-pulse bg-[#B42318]" : "bg-[#98A2B3]"}`} />
    {listening ? "Stop dictation" : label}
  </button>;
}
