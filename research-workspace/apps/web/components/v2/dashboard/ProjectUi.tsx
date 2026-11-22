import type { Status } from "@/lib/v2/design/projects";

/*
 * Figma stage group (101 x 22.28): solid filled line up to the knob, dotted remainder
 * (3.3px, dashes 0.66 / 4.62) and a 22.28px knob with the percentage (Inter 500 7.13px).
 * The knob and fill follow the value; the whole bar takes one colour that shifts smoothly
 * with it (42% is Figma's orange).
 */
/* colour follows progress smoothly: red → Figma orange (42%) → amber → green */
const STOPS: [number, [number, number, number]][] = [
  [0, [240, 68, 56]],
  [42, [255, 103, 32]],
  [70, [245, 165, 36]],
  [100, [43, 203, 35]],
];
function stageRgb(v: number): [number, number, number] {
  for (let i = 1; i < STOPS.length; i++) {
    const [p1, c1] = STOPS[i];
    const [p0, c0] = STOPS[i - 1];
    if (v <= p1) {
      const t = (v - p0) / (p1 - p0);
      return [0, 1, 2].map((k) => Math.round(c0[k] + (c1[k] - c0[k]) * t)) as [
        number,
        number,
        number,
      ];
    }
  }
  return STOPS[STOPS.length - 1][1];
}
const rgb = (c: [number, number, number], dim = 1) =>
  `rgb(${c.map((x) => Math.round(x * dim)).join(",")})`;

export function StageBar({
  value,
  scale = 1,
}: {
  value: number;
  scale?: number;
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const knob = 22.28;
  const left = (v / 100) * (101 - knob);
  const fill = left + knob / 2;
  const c = stageRgb(v);
  return (
    <div
      className="relative shrink-0"
      style={{ width: 101 * scale, height: 22.28 * scale }}
      role="img"
      aria-label={`${v}% complete`}
    >
      <div
        className="absolute top-0 left-0 h-[22.28px] w-[101px] origin-top-left"
        style={scale === 1 ? undefined : { transform: `scale(${scale})` }}
      >
        <svg
          className="absolute top-1/2 left-0 -translate-y-1/2"
          width="101"
          height="3.3"
          aria-hidden
        >
          <line
            x1={fill}
            x2="101"
            y1="1.65"
            y2="1.65"
            stroke={rgb(c)}
            strokeOpacity="0.55"
            strokeWidth="3.3"
            strokeDasharray="0.66 4.62"
          />
        </svg>
        <div
          className="absolute top-1/2 left-0 h-[3.96px] -translate-y-1/2 rounded-[33px] transition-[width] duration-300"
          style={{ width: fill, background: rgb(c) }}
        />
        <div
          className="absolute top-0 flex size-[22.28px] items-center justify-center rounded-full text-[7.13px] leading-none font-medium text-white transition-[left] duration-300"
          style={{ left, background: rgb(c, 0.93) }}
        >
          {v}%
        </div>
      </div>
    </div>
  );
}

/** Same bar, full width and draggable: the knob is the slider thumb (keyboard works too). */
export function ProgressSlider({
  value,
  onChange,
  label = "Progress",
}: {
  value: number;
  onChange: (v: number) => void;
  label?: string;
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const c = stageRgb(v);
  const K = 26;
  return (
    <div className="relative w-full" style={{ height: K }}>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={v}
        aria-label={label}
        aria-valuetext={`${v}%`}
        onChange={(e) => onChange(Number(e.target.value))}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
      />
      {/* track: dotted remainder + solid fill, from knob centre to knob centre */}
      <div
        className="absolute top-1/2 -translate-y-1/2"
        style={{ left: K / 2, right: K / 2, height: 4 }}
      >
        <div
          className="absolute inset-0 opacity-55"
          style={{
            backgroundImage: `repeating-linear-gradient(90deg, ${rgb(c)} 0 1px, transparent 1px 6px)`,
          }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${v}%`, background: rgb(c) }}
        />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 flex items-center justify-center rounded-full text-[8px] leading-none font-semibold text-white shadow-[0_2px_6px_rgba(16,29,55,0.18)] ring-blue/40 peer-focus-visible:ring-4"
        style={{
          width: K,
          height: K,
          left: `calc((100% - ${K}px) * ${v / 100})`,
          background: rgb(c, 0.93),
        }}
      >
        {v}%
      </div>
    </div>
  );
}

/* Figma "complete": 88.29 x 32, padding 12.64, text Inter 500 12px.
 * Projects table uses radius 8, the overview Work Packages table radius 10. */
export function StatusBadge({
  status,
  radius = 8,
}: {
  status: Status;
  radius?: 8 | 10;
}) {
  const styles =
    status === "Pending"
      ? "bg-[#2054FF]/10 text-[#2054FF]"
      : "bg-[#ED5735]/10 text-[#FF6720]";
  return (
    <span
      className={`inline-flex h-8 min-w-[88.29px] items-center justify-center px-[12.64px] text-xs leading-[1.5] font-medium tracking-[-0.02em] whitespace-nowrap ${
        radius === 10 ? "rounded-[10px]" : "rounded-lg"
      } ${styles}`}
    >
      {status}
    </span>
  );
}
