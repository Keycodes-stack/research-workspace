"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Cancel01Icon,
  Mic01Icon,
  PauseIcon,
  PlayIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import Icon, { huge } from "@/components/v2/dashboard/Icon";

/*
 * Voice notes, ChatGPT / Claude style: tap the mic, a live waveform follows your voice,
 * tap ✓ to attach the recording (or ✕ to throw it away). The note is kept as a data URL,
 * so it can be played back and saved with chat messages.
 * While recording, the browser's speech recognition (Web Speech API, Chrome / Edge) turns
 * what is said into English text live; on ✓ that text is handed to the composer's textbox.
 */

type SpeechResultList = ArrayLike<{
  isFinal: boolean;
  0: { transcript: string };
}>;
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult:
    ((e: { resultIndex: number; results: SpeechResultList }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};
const speechApi = (): (new () => Recognition) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};
/** Short UI sounds (Web Audio, no files): start = rising pip, stop = falling tick, cancel = soft low tick. */
let chimeCtx: AudioContext | null = null;
export function chime(kind: "start" | "stop" | "cancel") {
  try {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    chimeCtx ??= new Ctx();
    const ctx = chimeCtx;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const notes: [number, number][] =
      kind === "start"
        ? [
            [660, 0],
            [990, 0.09],
          ]
        : kind === "stop"
          ? [
              [880, 0],
              [587, 0.08],
            ]
          : [[392, 0]];
    for (const [freq, at] of notes) {
      const t = ctx.currentTime + at;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.12);
    }
  } catch {
    /* sound is optional */
  }
}

/** live speech-to-text is available in this browser */
export const canDictate = () => !!speechApi();

export type VoiceNote = {
  id: string;
  name: string;
  src: string;
  duration: number;
  mime: string;
  /** English text recognised live while recording (already put in the textbox) */
  text?: string;
};

type Status = "idle" | "starting" | "recording" | "saving";

const BARS = 48;
const pickMime = () => {
  if (typeof MediaRecorder === "undefined") return "";
  return (
    ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"].find(
      (t) => MediaRecorder.isTypeSupported(t),
    ) ?? ""
  );
};
export const fmtTime = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function useVoiceRecorder({
  onDone,
  onText,
  maxSeconds = 180,
}: {
  onDone: (note: VoiceNote) => void;
  /** the recognised text, when the recording is kept (✓) */
  onText?: (text: string) => void;
  maxSeconds?: number;
}) {
  /** what has been recognised so far (final + the words still being heard) */
  const [caption, setCaption] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const r = useRef<{
    rec?: MediaRecorder;
    stream?: MediaStream;
    ctx?: AudioContext;
    raf?: number;
    chunks: Blob[];
    startedAt: number;
    cancelled: boolean;
    lastPush: number;
    sr?: Recognition;
    finals: string;
    interim: string;
    listening: boolean;
    /* the note waits until recognition has delivered its last words */
    note?: VoiceNote;
    speechEnded: boolean;
  }>({
    chunks: [],
    startedAt: 0,
    cancelled: false,
    lastPush: 0,
    finals: "",
    interim: "",
    listening: false,
    speechEnded: true,
  });
  const done = useRef(onDone);
  done.current = onDone;
  const text = useRef(onText);
  text.current = onText;

  /** hand over the note (and its text) once both the recording and recognition are finished */
  const deliver = useCallback(() => {
    const s = r.current;
    if (!s.note || !s.speechEnded) return;
    const said = `${s.finals} ${s.interim}`.replace(/\s+/g, " ").trim();
    const note = said ? { ...s.note, text: said } : s.note;
    s.note = undefined;
    if (said) text.current?.(said);
    done.current(note);
    setCaption("");
    setStatus("idle");
  }, []);

  const cleanup = useCallback(() => {
    const s = r.current;
    if (s.raf) cancelAnimationFrame(s.raf);
    s.stream?.getTracks().forEach((t) => t.stop());
    s.ctx?.close().catch(() => {});
    s.raf = undefined;
    s.stream = undefined;
    s.ctx = undefined;
  }, []);

  const stopListening = useCallback(
    (discard: boolean) => {
      const s = r.current;
      s.listening = false;
      if (!s.sr) {
        s.speechEnded = true;
        return;
      }
      try {
        if (discard) s.sr.abort();
        else s.sr.stop();
      } catch {
        s.speechEnded = true;
      }
      /* recognition normally ends within a moment; don't wait forever */
      setTimeout(() => {
        if (!s.speechEnded) {
          s.speechEnded = true;
          deliver();
        }
      }, 1500);
    },
    [deliver],
  );

  useEffect(
    () => () => {
      r.current.cancelled = true;
      r.current.listening = false;
      r.current.sr?.abort();
      if (r.current.rec?.state === "recording") r.current.rec.stop();
      cleanup();
    },
    [cleanup],
  );

  const stop = useCallback(() => {
    const rec = r.current.rec;
    if (rec && rec.state === "recording") {
      chime("stop");
      setStatus("saving");
      stopListening(false);
      rec.stop();
    }
  }, [stopListening]);

  const cancel = useCallback(() => {
    if (r.current.rec?.state === "recording") chime("cancel");
    r.current.cancelled = true;
    stopListening(true);
    if (r.current.rec?.state === "recording") r.current.rec.stop();
    cleanup();
    setStatus("idle");
    setCaption("");
    setLevels(Array(BARS).fill(0));
    setElapsed(0);
  }, [cleanup, stopListening]);

  const start = useCallback(async () => {
    setError(null);
    if (
      typeof window === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError("Voice recording isn't supported in this browser.");
      return;
    }
    setStatus("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      const name = (e as DOMException)?.name;
      setError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Microphone access is blocked. Allow it from the icon in the address bar, then try again."
          : name === "NotFoundError"
            ? "No microphone was found."
            : "Couldn't start the microphone.",
      );
      setStatus("idle");
      return;
    }
    const mime = pickMime();
    const rec = new MediaRecorder(
      stream,
      /* 32 kbps is plenty for speech and keeps notes small enough to store */
      mime
        ? { mimeType: mime, audioBitsPerSecond: 32000 }
        : { audioBitsPerSecond: 32000 },
    );
    const s = r.current;
    s.rec = rec;
    s.stream = stream;
    s.chunks = [];
    s.cancelled = false;
    s.startedAt = performance.now();
    s.lastPush = 0;
    rec.ondataavailable = (ev) => ev.data.size && s.chunks.push(ev.data);
    rec.onstop = () => {
      const duration = (performance.now() - s.startedAt) / 1000;
      const type = rec.mimeType || mime || "audio/webm";
      cleanup();
      setLevels(Array(BARS).fill(0));
      setElapsed(0);
      if (s.cancelled || !s.chunks.length) {
        setCaption("");
        setStatus("idle");
        return;
      }
      const blob = new Blob(s.chunks, { type });
      const reader = new FileReader();
      reader.onload = () => {
        const ext = type.includes("mp4")
          ? "m4a"
          : type.includes("ogg")
            ? "ogg"
            : "webm";
        const stamp = new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        });
        s.note = {
          id: `v${Date.now()}`,
          name: `Voice note ${stamp}.${ext}`,
          src: String(reader.result),
          duration,
          mime: type,
        };
        deliver();
      };
      reader.onerror = () => {
        setError("Couldn't save the recording.");
        setStatus("idle");
      };
      reader.readAsDataURL(blob);
    };

    /* live level meter for the waveform */
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(analyser);
      s.ctx = ctx;
      const buf = new Uint8Array(analyser.fftSize);
      const tick = (t: number) => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        const level = Math.min(1, rms * 4.5);
        if (t - s.lastPush > 70) {
          s.lastPush = t;
          setLevels((l) => [...l.slice(1), level]);
        }
        const secs = (performance.now() - s.startedAt) / 1000;
        setElapsed(secs);
        if (secs >= maxSeconds && rec.state === "recording") {
          setStatus("saving");
          stopListening(false);
          rec.stop();
          return;
        }
        s.raf = requestAnimationFrame(tick);
      };
      s.raf = requestAnimationFrame(tick);
    } catch {
      /* no meter – recording still works */
    }

    /* live speech-to-text (English) alongside the recording */
    s.finals = "";
    s.interim = "";
    s.speechEnded = true;
    setCaption("");
    const SR = speechApi();
    if (SR) {
      try {
        const sr = new SR();
        sr.lang = "en-US";
        sr.continuous = true;
        sr.interimResults = true;
        sr.onresult = (e) => {
          let interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            if (res.isFinal) s.finals = `${s.finals} ${res[0].transcript}`;
            else interim += res[0].transcript;
          }
          s.interim = interim;
          setCaption(`${s.finals} ${interim}`.replace(/\s+/g, " ").trim());
        };
        sr.onerror = (e) => {
          if (e.error === "not-allowed" || e.error === "service-not-allowed")
            s.listening = false;
        };
        sr.onend = () => {
          /* Chrome stops after a pause: keep listening while still recording */
          if (s.listening) {
            try {
              sr.start();
              return;
            } catch {
              /* fall through */
            }
          }
          s.speechEnded = true;
          deliver();
        };
        s.sr = sr;
        s.listening = true;
        s.speechEnded = false;
        sr.start();
      } catch {
        s.sr = undefined;
        s.listening = false;
        s.speechEnded = true;
      }
    } else s.sr = undefined;

    rec.start(250);
    chime("start");
    setStatus("recording");
  }, [cleanup, maxSeconds, deliver, stopListening]);

  return {
    status,
    levels,
    elapsed,
    error,
    start,
    stop,
    cancel,
    clearError: () => setError(null),
    active: status !== "idle",
    caption,
  };
}

export type VoiceRecorder = ReturnType<typeof useVoiceRecorder>;

/**
 * Dictation, like Claude / ChatGPT: record with a live waveform while the browser's own
 * speech recognition (free, no API key – Chrome and Edge) turns the words into English text;
 * on ✓ the text is written into the message box.
 */
export function useDictation(onText: (text: string) => void) {
  const [err, setErr] = useState<string | null>(null);
  const cb = useRef(onText);
  cb.current = onText;
  const rec = useVoiceRecorder({
    onDone: (note) => {
      const text = note.text?.trim() ?? "";
      if (text) cb.current(text);
      else
        setErr(
          "I couldn't hear anything. Try again and speak a little closer to the mic.",
        );
    },
  });
  const start = async () => {
    if (!canDictate()) {
      setErr(
        "Speech to text works in Chrome and Edge (it uses the browser's free speech recognition).",
      );
      return;
    }
    setErr(null);
    await rec.start();
  };
  return {
    ...rec,
    start,
    /* no server step: the text is ready as soon as recording stops */
    transcribing: false,
    error: rec.error ?? err,
    clearError: () => {
      rec.clearError();
      setErr(null);
    },
  };
}

/** Puts dictated text at the end of a message, with a space between. */
export const appendText = (prev: string, text: string) =>
  prev.trim() ? `${prev.replace(/\s+$/, "")} ${text}` : text;

/** The box's text while dictating: what was already there + the words being spoken now. */
export const withLive = (
  text: string,
  rec: { active: boolean; caption: string },
) => (rec.active && rec.caption ? appendText(text, rec.caption) : text);

/** Mic button (36px or 32px) */
export function MicButton({
  rec,
  size = 36,
  className = "",
}: {
  rec: VoiceRecorder;
  size?: 32 | 36;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label="Speak to type"
      title="Speak to type"
      onClick={() => (rec.active ? rec.stop() : rec.start())}
      disabled={rec.status === "starting" || rec.status === "saving"}
      className={`flex shrink-0 items-center justify-center rounded-[10px] border transition-colors disabled:opacity-60 ${
        rec.active
          ? "border-[#F04438]/30 bg-[#FEF3F2] text-[#F04438]"
          : "border-[#EDEDF0] bg-white text-body hover:text-[#101D37]"
      } ${className}`}
      style={{ width: size, height: size }}
    >
      <Icon icon={huge(Mic01Icon)} size={size === 36 ? 16 : 15} stroke={1.5} />
    </button>
  );
}

/** Replaces the input while recording: ● live waveform 0:07  ✕ ✓ */
export function RecordingBar({
  rec,
  className = "",
  caption = true,
}: {
  rec: VoiceRecorder;
  className?: string;
  /** show the live words under the bar (off when they are typed into the textbox) */
  caption?: boolean;
}) {
  return (
    <div className={`flex min-w-0 flex-1 flex-col gap-1.5 ${className}`}>
      <div
        className="flex min-w-0 items-center gap-3"
        role="status"
        aria-live="polite"
      >
        <span className="relative flex size-2.5 shrink-0">
          <span className="absolute inset-0 animate-ping rounded-full bg-[#F04438]/60" />
          <span className="relative size-2.5 rounded-full bg-[#F04438]" />
        </span>
        <span className="sr-only">
          {rec.status === "starting"
            ? "Starting the microphone"
            : rec.status === "saving"
              ? "Saving the recording"
              : "Recording"}
        </span>
        <div
          className="flex h-7 min-w-0 flex-1 items-center justify-end gap-[3px] overflow-hidden"
          aria-hidden
        >
          {rec.levels.map((l, i) => (
            <span
              key={i}
              className="w-[3px] shrink-0 rounded-full bg-blue transition-[height] duration-75"
              style={{
                height: `${Math.max(3, Math.round(l * 28))}px`,
                opacity: l > 0.02 ? 1 : 0.35,
              }}
            />
          ))}
        </div>
        <span className="w-10 shrink-0 text-right text-sm font-medium text-[#101D37] tabular-nums">
          {rec.status === "saving" ? "…" : fmtTime(rec.elapsed)}
        </span>
        <button
          type="button"
          onClick={rec.cancel}
          aria-label="Discard recording"
          title="Discard"
          className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-[#EDEDF0] bg-white text-body hover:text-[#F04438]"
        >
          <Icon icon={huge(Cancel01Icon)} size={15} stroke={1.7} />
        </button>
        <button
          type="button"
          onClick={rec.stop}
          disabled={rec.status !== "recording"}
          aria-label="Stop and attach recording"
          title="Stop and attach"
          className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-blue text-white disabled:opacity-60"
        >
          <Icon icon={huge(Tick02Icon)} size={16} stroke={2} />
        </button>
      </div>
      {caption && canDictate() && (
        <p
          aria-live="polite"
          className={`line-clamp-2 text-sm leading-[1.5] ${rec.caption ? "text-[#101D37]" : "text-body italic"}`}
        >
          {rec.caption ||
            "Listening… speak in English, the text goes into the message box."}
        </p>
      )}
    </div>
  );
}

/* deterministic bar heights for a note's static waveform */
const shape = (id: string, n: number) => {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: n }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0;
    const wave = Math.sin(i / 2.2) * 0.25 + 0.55;
    return Math.max(0.18, Math.min(1, wave + ((h % 100) / 100 - 0.5) * 0.6));
  });
};

/** Playable voice note: ▶ waveform 0:12  (✕ when removable) */
export function VoiceChip({
  note,
  onRemove,
  compact,
}: {
  note: VoiceNote;
  onRemove?: () => void;
  compact?: boolean;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const bars = shape(note.id, compact ? 22 : 30);
  const total = note.duration || 0;
  const progress = total ? Math.min(1, pos / total) : 0;
  return (
    <span
      className={`flex max-w-full items-center gap-2 rounded-[12px] border border-[#EDEDF0] bg-white ${compact ? "h-9 pr-2 pl-1" : "h-11 pr-2.5 pl-1.5"}`}
    >
      <button
        type="button"
        onClick={() => {
          const a = audio.current;
          if (!a) return;
          if (a.paused) a.play().catch(() => {});
          else a.pause();
        }}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className={`flex shrink-0 items-center justify-center rounded-full bg-blue text-white ${compact ? "size-7" : "size-8"}`}
      >
        <Icon
          icon={huge(playing ? PauseIcon : PlayIcon)}
          size={compact ? 13 : 15}
          stroke={2}
        />
      </button>
      <span className="flex h-6 items-center gap-[2px]" aria-hidden>
        {bars.map((b, i) => (
          <span
            key={i}
            className={`w-[3px] rounded-full ${i / bars.length < progress ? "bg-blue" : "bg-[#C5D3F6]"}`}
            style={{ height: `${Math.round(b * (compact ? 18 : 22))}px` }}
          />
        ))}
      </span>
      <span className="shrink-0 text-xs font-medium text-body tabular-nums">
        {fmtTime(playing || pos ? pos : total)}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove voice note"
          className="shrink-0 text-body hover:text-[#F04438]"
        >
          <Icon icon={huge(Cancel01Icon)} size={14} stroke={1.6} />
        </button>
      )}
      <audio
        ref={audio}
        src={note.src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPos(0);
        }}
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
      />
    </span>
  );
}

/** Small red line for recorder errors */
export function VoiceError({ rec }: { rec: VoiceRecorder }) {
  if (!rec.error) return null;
  return (
    <p role="alert" className="flex items-center gap-2 text-xs text-[#F04438]">
      {rec.error}
      <button
        type="button"
        onClick={rec.clearError}
        className="font-semibold text-body hover:text-[#101D37]"
      >
        Dismiss
      </button>
    </p>
  );
}
