import { useId } from "react";

/**
 * Re-creation of the Figma "Sales Performance Overview" area chart.
 * Chart box 434 x 228 (card 474 wide minus 20px padding each side).
 * Plot area: x 28.63 → 433.63 (405 wide), value 25 at y 9, value 0 at y 186.
 * Line #285CE0, fill linear-gradient #285CE0 40% → 0% at 70% opacity.
 */
const W = 434;
const H = 228;
const X0 = 28.63;
const PW = 405;
const Y_TOP = 9;
const Y_ZERO = 186;
const MAX = 25;

const x = (f: number) => X0 + f * PW;
const y = (v: number) => Y_ZERO - (v / MAX) * (Y_ZERO - Y_TOP);

// Points traced from the Figma chart (x as fraction of plot width, value)
const DATA: [number, number][] = [
  [0, 6],
  [0.075, 6],
  [0.15, 13.4],
  [0.18, 14],
  [0.215, 11.9],
  [0.283, 15],
  [0.34, 16.2],
  [0.396, 12.3],
  [0.479, 19.2],
  [0.517, 18.5],
  [0.566, 17.5],
  [0.623, 16.2],
  [0.698, 12.7],
  [0.79, 20],
  [0.83, 17.9],
  [0.868, 17.2],
  [0.925, 20.3],
  [0.962, 19.9],
  [1, 16.2],
];

const MARKER = 13; // index of the highlighted point (14 Jun, 20 items)

/** Monotone cubic interpolation → smooth SVG path */
function smoothPath(pts: [number, number][]) {
  const n = pts.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1][0] - pts[i][0]);
    m.push((pts[i + 1][1] - pts[i][1]) / dx[i]);
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) {
    t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  }
  t.push(m[n - 2]);
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const h = dx[i] / 3;
    d += ` C${x0 + h},${y0 + t[i] * h} ${x1 - h},${y1 - t[i + 1] * h} ${x1},${y1}`;
  }
  return d;
}

const Y_TICKS = [25, 20, 15, 10, 5, 0];
const X_TICKS = ["1 Jun", "7 Jun", "14 Jun", "21 Jun", "28 Jun"];

export default function AreaChart() {
  const id = useId().replace(/:/g, "");
  const pts = DATA.map(([f, v]) => [x(f), y(v)] as [number, number]);
  const line = smoothPath(pts);
  const area = `${line} L${x(1)},${Y_ZERO} L${x(0)},${Y_ZERO} Z`;
  const [mx, my] = pts[MARKER];
  const tipW = 148;
  const tipH = 63;
  const tipX = mx - tipW - 8;
  const tipY = 100;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label="Research items created over time"
    >
      <defs>
        <linearGradient id={`g${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#285CE0" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#285CE0" stopOpacity="0" />
        </linearGradient>
        <filter id={`s${id}`} x="-20%" y="-20%" width="140%" height="160%">
          <feDropShadow
            dx="0"
            dy="4"
            stdDeviation="6"
            floodColor="#101D37"
            floodOpacity="0.08"
          />
        </filter>
      </defs>

      {/* Y axis labels */}
      {Y_TICKS.map((v) => (
        <text
          key={v}
          x="0"
          y={y(v) + 4}
          fontSize="11.72"
          letterSpacing="-0.02em"
          fill="#667085"
        >
          {v}
        </text>
      ))}

      {/* Dashed grid lines (Figma) */}
      {Y_TICKS.map((v) => (
        <line
          key={`g${v}`}
          x1={X0}
          x2={X0 + PW}
          y1={y(v)}
          y2={y(v)}
          stroke="#EDEDF0"
          strokeWidth="0.84"
          strokeDasharray="4 4"
        />
      ))}

      {/* Area + line */}
      <path d={area} fill={`url(#g${id})`} opacity="0.7" />
      <path d={line} fill="none" stroke="#285CE0" strokeWidth="1.5" />

      {/* Marker */}
      <line x1={mx} y1={my} x2={mx} y2={Y_ZERO} stroke="#101D37" strokeWidth="1" />
      <circle cx={mx} cy={my} r="3.5" fill="#101D37" stroke="#fff" strokeWidth="1.5" />

      {/* Tooltip */}
      <g filter={`url(#s${id})`}>
        <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="6" fill="#fff" />
      </g>
      <rect
        x={tipX}
        y={tipY}
        width={tipW}
        height={tipH}
        rx="6"
        fill="none"
        stroke="#EDEDF0"
        strokeWidth="0.84"
      />
      <text x={tipX + 10} y={tipY + 19} fontSize="10.04" fontWeight="500" fill="#242C2C">
        14 Juni 2025
      </text>
      <line
        x1={tipX}
        x2={tipX + tipW}
        y1={tipY + 29}
        y2={tipY + 29}
        stroke="#EDEDF0"
        strokeWidth="0.84"
      />
      <text x={tipX + 10} y={tipY + 48} fontSize="10.04" fontWeight="500" fill="#667085">
        Research Items
      </text>
      <text
        x={tipX + tipW - 10}
        y={tipY + 48}
        fontSize="10.04"
        fontWeight="600"
        fill="#242C2C"
        textAnchor="end"
      >
        20
      </text>

      {/* X axis labels */}
      {X_TICKS.map((label, i) => (
        <text
          key={label}
          x={X0 + 18 + i * ((PW - 36) / 4)}
          y={H - 6}
          fontSize="11.72"
          letterSpacing="-0.02em"
          fill="#667085"
          textAnchor="middle"
        >
          {label}
        </text>
      ))}
    </svg>
  );
}
