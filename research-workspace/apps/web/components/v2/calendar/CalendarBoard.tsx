"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Calendar,
  DotsHorizontal,
  DotsVertical,
  FilterLines,
  SearchMd,
} from "@untitledui/icons";
import {
  Add01Icon,
  Cancel01Icon,
  ChartLineData01Icon,
  Clock01Icon,
  Copy01Icon,
  Delete02Icon,
  Link01Icon,
  Location01Icon,
  Notification01Icon,
  TextAlignLeftIcon,
  Tick02Icon,
  UserGroupIcon,
  Video01Icon,
} from "@hugeicons/core-free-icons";
import { TEAM_MEMBERS } from "@/lib/v2/design/projectScreens";
import AvatarStack from "@/components/v2/dashboard/AvatarStack";
import Icon, { huge, untitled } from "@/components/v2/dashboard/Icon";
import { ProgressSlider, StageBar } from "@/components/v2/dashboard/ProjectUi";
import {
  INITIAL_EVENTS,
  REMINDERS,
  REPEATS,
  STATUSES,
  STATUS_STYLE,
  formatRange,
  monthLabel,
  toDate,
  toIso,
  type CalEvent,
  type EventStatus,
} from "@/lib/v2/design/events";
import { V2 } from "@/lib/v2/routes";

const STORE = "calendar:events:v2";
const load = (): CalEvent[] | null => {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as CalEvent[]) : null;
  } catch {
    return null;
  }
};
const save = (list: CalEvent[]) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(list));
  } catch {
    /* ignore */
  }
};

/* ---------------- shared bits ---------------- */

/** Figma "Attendee Avatars": 24px on big cards, 16px on small ones. */
function People({ more, size = 24 }: { more: number; size?: number }) {
  return <AvatarStack more={more} size={size} label="Attendees" />;
}

function StatusPill({
  status,
  badge = false,
}: {
  status: EventStatus;
  badge?: boolean;
}) {
  return (
    <span
      className={`inline-flex h-6 items-center whitespace-nowrap text-xs leading-[1.5] font-medium tracking-[-0.02em] ${
        badge
          ? "rounded-md px-2 py-[3px] shadow-[0_1px_5px_0_rgba(0,0,0,0.05)]"
          : "rounded-lg px-3 py-1"
      } ${STATUS_STYLE[status].pill}`}
    >
      {status}
    </span>
  );
}

/* Figma "align-vertical" icon on the Kanban toggle: two column bars */
function KanbanIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="2.5"
        y="2"
        width="4"
        height="12"
        rx="1.3"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <rect
        x="9.5"
        y="2"
        width="4"
        height="8.5"
        rx="1.3"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  );
}

/* Figma "black-left" / "black-right": 16 frame, arrow 13.33 x 7.11 at (1.33, 4.45) */
function PageArrow({ dir }: { dir: -1 | 1 }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      style={dir === 1 ? { transform: "scaleX(-1)" } : undefined}
    >
      <path
        d="M14.67 8H1.83M1.83 8l3.4-3.05M1.83 8l3.4 3.05"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DragHandle() {
  return (
    <svg
      width="12"
      height="16"
      viewBox="0 0 12 16"
      aria-hidden
      className="text-body"
    >
      {[3, 9].map((x) =>
        [3, 8, 13].map((y) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1.4" fill="currentColor" />
        )),
      )}
    </svg>
  );
}

function ToolbarButton({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex h-[33px] items-center gap-2 rounded-md border border-[#EDEDF0] px-3 py-1.5 text-sm leading-[1.5] tracking-[-0.02em] transition-colors ${
        active
          ? "bg-[#FAFAFA] font-medium text-[#101D37]"
          : "bg-white text-body hover:text-[#101D37]"
      }`}
    >
      {children}
    </button>
  );
}

/* ---------------- Kanban ---------------- */

/** Figma Kanban card: 239 wide, radius 12, padding 12, gap 10, shadow 0 1 5 #000 5% */
function KanbanCard({
  ev,
  onDragStart,
  onOpen,
}: {
  ev: CalEvent;
  onDragStart: (id: string) => void;
  onOpen: (ev: CalEvent) => void;
}) {
  return (
    <article
      draggable
      onClick={() => onOpen(ev)}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", ev.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart(ev.id);
      }}
      className="flex cursor-grab flex-col gap-2.5 rounded-xl border border-[#EDEDF0] bg-white p-3 shadow-[0_1px_5px_0_rgba(0,0,0,0.05)] active:cursor-grabbing"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h3 className="truncate text-sm leading-[1.4] font-medium tracking-[-0.02em] text-[#101D37]">
            {ev.title}
          </h3>
          <p className="text-xs leading-[1.5] font-medium tracking-[-0.02em] text-body">
            {formatRange(ev.start, ev.end)}
            {!ev.allDay && ev.startTime ? ` · ${ev.startTime}` : ""}
          </p>
        </div>
        <button
          type="button"
          aria-label="Edit event"
          className="shrink-0 rounded text-[#101D37] hover:bg-[#F2F4F7]"
        >
          <Icon icon={untitled(DotsVertical)} size={16} />
        </button>
      </div>
      <div className="flex items-center justify-between">
        <People more={ev.more} />
        <StageBar value={ev.progress} scale={0.93} />
      </div>
    </article>
  );
}

function Kanban({
  events,
  onMove,
  onOpen,
}: {
  events: CalEvent[];
  onMove: (id: string, status: EventStatus) => void;
  onOpen: (ev: CalEvent) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<EventStatus | null>(null);

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1">
      <div className="grid min-w-[900px] grid-cols-4 gap-4">
        {STATUSES.map((status) => {
          const list = events.filter((e) => e.status === status);
          return (
            <section
              key={status}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(status);
              }}
              onDragLeave={() => setOver((o) => (o === status ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain") || dragId;
                if (id) onMove(id, status);
                setOver(null);
                setDragId(null);
              }}
              className={`flex flex-col gap-4 self-start rounded-xl border bg-[#FAFAFA] p-3 transition-colors ${
                over === status
                  ? "border-blue/40 bg-blue/[0.03]"
                  : "border-[#EDEDF0]"
              }`}
            >
              <header className="flex items-center justify-between">
                <div className="flex items-center gap-[13px]">
                  <DragHandle />
                  <StatusPill status={status} />
                  <span className="text-xs leading-[1.5] font-semibold tracking-[-0.02em] text-body">
                    {list.length}
                  </span>
                </div>
                <button
                  type="button"
                  aria-label={`${status} options`}
                  className="text-[#101D37]"
                >
                  <Icon icon={untitled(DotsHorizontal)} size={16} />
                </button>
              </header>
              {list.map((ev) => (
                <KanbanCard
                  key={ev.id}
                  ev={ev}
                  onDragStart={setDragId}
                  onOpen={onOpen}
                />
              ))}
              {list.length === 0 && (
                <p className="rounded-xl border border-dashed border-[#EDEDF0] py-6 text-center text-xs text-body">
                  Drop events here
                </p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Month calendar ---------------- */

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

type Segment = { ev: CalEvent; col: number; span: number; lane: number };

function buildWeeks(year: number, month: number) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday = 0
  const start = new Date(year, month, 1 - offset);
  const last = new Date(year, month + 1, 0);
  const totalDays = offset + last.getDate();
  const weeks = Math.ceil(totalDays / 7);
  return Array.from({ length: weeks }, (_, w) =>
    Array.from(
      { length: 7 },
      (_, d) =>
        new Date(
          start.getFullYear(),
          start.getMonth(),
          start.getDate() + w * 7 + d,
        ),
    ),
  );
}

function layoutWeek(week: Date[], events: CalEvent[]): Segment[] {
  const ws = toIso(week[0]);
  const we = toIso(week[6]);
  const segs = events
    .filter((e) => e.start <= we && e.end >= ws)
    .sort(
      (a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end),
    )
    .map((ev) => {
      const s = ev.start < ws ? ws : ev.start;
      const e = ev.end > we ? we : ev.end;
      const col = week.findIndex((d) => toIso(d) === s);
      const endCol = week.findIndex((d) => toIso(d) === e);
      return { ev, col, span: endCol - col + 1, lane: 0 };
    });
  const lanes: number[] = []; // last occupied column per lane
  for (const seg of segs) {
    let lane = lanes.findIndex((lastCol) => lastCol < seg.col);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(-1);
    }
    lanes[lane] = seg.col + seg.span - 1;
    seg.lane = lane;
  }
  return segs;
}

const CARD =
  "w-full cursor-pointer rounded-xl border border-[#EDEDF0] bg-white text-left shadow-[0_1px_5px_0_rgba(0,0,0,0.05)] transition-shadow hover:shadow-[0_6px_16px_0_rgba(16,29,55,0.10)]";

function EventCard({
  seg,
  onOpen,
}: {
  seg: Segment;
  onOpen: (ev: CalEvent) => void;
}) {
  const { ev, span } = seg;
  const bar = STATUS_STYLE[ev.status].bar;
  const label = `${ev.title}, ${formatRange(ev.start, ev.end)}, ${ev.status}`;
  if (span >= 2) {
    /* Figma big card: 2 days wide, radius 12, padding 12, gap 20 */
    return (
      <button
        type="button"
        onClick={() => onOpen(ev)}
        aria-label={label}
        title={ev.title}
        className={`flex flex-col gap-5 p-3 ${CARD}`}
      >
        <span className="flex w-full items-start justify-between gap-2">
          <span className="flex min-w-0 items-stretch gap-2">
            <span
              className="w-1 shrink-0 rounded-full"
              style={{ background: bar }}
            />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm leading-[1.4] font-medium tracking-[-0.02em] text-[#101D37]">
                {ev.title}
              </span>
              <span className="text-xs leading-[1.5] font-medium tracking-[-0.02em] text-body">
                {formatRange(ev.start, ev.end)}
                {!ev.allDay && ev.startTime ? ` · ${ev.startTime}` : ""}
              </span>
            </span>
          </span>
          <Icon
            icon={untitled(DotsVertical)}
            size={16}
            className="shrink-0 text-[#101D37]"
          />
        </span>
        <span className="flex w-full items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-3">
            <People more={ev.more} />
            <StatusPill status={ev.status} badge />
          </span>
          <span className="flex min-w-0 flex-1 overflow-hidden">
            <span className="ml-auto">
              <StageBar value={ev.progress} scale={0.93} />
            </span>
          </span>
        </span>
      </button>
    );
  }
  /* Figma small card: 128 wide, padding 12, container gap 8; title Inter 500 12/140 (2 lines), date 10;
   * attendee row 104 x 15.86 with gap 7.83 */
  return (
    <button
      type="button"
      onClick={() => onOpen(ev)}
      aria-label={label}
      title={ev.title}
      className={`flex flex-col gap-2 p-2.5 min-[1400px]:p-3 ${CARD}`}
    >
      <span className="flex items-stretch gap-2">
        <span
          className="w-1 shrink-0 rounded-full"
          style={{ background: bar }}
        />
        <span className="line-clamp-2 text-xs leading-[1.4] font-medium tracking-[-0.02em] text-[#101D37]">
          {ev.title}
        </span>
      </span>
      <span className="text-[10px] leading-[1.5] font-medium tracking-[-0.02em] text-body">
        {formatRange(ev.start, ev.end)}
        {!ev.allDay && ev.startTime ? ` · ${ev.startTime}` : ""}
      </span>
      <span className="flex items-center gap-[7.83px]">
        <People more={ev.more} size={16} />
        <span className="flex min-w-0 flex-1 overflow-hidden">
          <StageBar value={ev.progress} scale={0.6} />
        </span>
      </span>
    </button>
  );
}

function MonthView({
  year,
  month,
  events,
  selected,
  onSelect,
  onPrev,
  onNext,
  onOpen,
  onAddOn,
}: {
  year: number;
  month: number;
  events: CalEvent[];
  selected: string;
  onSelect: (iso: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onOpen: (ev: CalEvent) => void;
  onAddOn: (iso: string) => void;
}) {
  const weeks = useMemo(() => buildWeeks(year, month), [year, month]);

  return (
    <div className="flex flex-col gap-4">
      <div className="-mx-4 overflow-x-auto px-4">
        <div className="min-w-[900px]">
          {/* Figma "Day" header cells: 152.57 x 44, border #EDEDF0, Inter 500 14 #101D37 */}
          <div className="grid grid-cols-7">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                className="-ml-px flex h-11 items-center justify-center border border-[#EDEDF0] bg-white text-sm leading-[1.5] font-medium tracking-[-0.02em] text-[#101D37] first:ml-0"
              >
                {d}
              </div>
            ))}
          </div>

          {weeks.map((week) => {
            const segs = layoutWeek(week, events);
            const lanes = segs.reduce((m, s) => Math.max(m, s.lane + 1), 0);
            const isSelectedWeek = week.some((d) => toIso(d) === selected);
            return (
              <div key={toIso(week[0])} className="relative -mt-px">
                {/* day cells: 148.4 tall, #FAFAFA, border #EDEDF0, padding 4/12 */}
                <div className="absolute inset-0 grid grid-cols-7">
                  {week.map((d) => {
                    const iso = toIso(d);
                    return (
                      <button
                        key={iso}
                        type="button"
                        onClick={() => onSelect(iso)}
                        onDoubleClick={() => onAddOn(iso)}
                        aria-label={`${iso} (double-click to add an event)`}
                        title="Double-click to add an event"
                        className="-ml-px border border-[#EDEDF0] bg-[#FAFAFA] first:ml-0"
                        style={
                          isSelectedWeek
                            ? {
                                backgroundColor: "#F3F4F6",
                                backgroundImage:
                                  "repeating-linear-gradient(135deg, #EDEDF0 0 1.4px, transparent 1.4px 6px)",
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
                <div
                  className="pointer-events-none relative grid grid-cols-7 gap-y-2 px-0 pb-3"
                  style={{
                    minHeight: 148.4,
                    gridTemplateRows: `29px repeat(${Math.max(lanes, 1)}, auto)`,
                  }}
                >
                  {week.map((d, i) => {
                    const iso = toIso(d);
                    const inMonth = d.getMonth() === month;
                    return (
                      <span
                        key={iso}
                        className="px-3 pt-1 text-sm leading-[1.5] font-medium tracking-[-0.02em]"
                        style={{
                          gridColumn: i + 1,
                          gridRow: 1,
                          color:
                            iso === selected
                              ? "#285CE0"
                              : inMonth
                                ? "#667085"
                                : "#B4BAC6",
                        }}
                      >
                        {d.getDate()}
                      </span>
                    );
                  })}
                  {segs.map((seg) => (
                    <div
                      key={`${seg.ev.id}-${toIso(week[0])}`}
                      className="pointer-events-auto px-2 min-[1400px]:px-3"
                      style={{
                        gridColumn: `${seg.col + 1} / span ${seg.span}`,
                        gridRow: seg.lane + 2,
                      }}
                    >
                      <EventCard seg={seg} onOpen={onOpen} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Figma "Pagination": hug 68 x 30, gap 8. Each "item": 30 x 30, radius 4, white, border #EDEDF0,
       * Shadow/01; icon "black-left/right" 16 frame with a 13.33 x 7.11 arrow in #667085 (Body Fonts). */}
      <div className="flex items-center justify-center gap-2">
        {(
          [
            {
              dir: -1,
              onClick: onPrev,
              label: `Previous month (${monthLabel(month === 0 ? year - 1 : year, (month + 11) % 12)})`,
            },
            {
              dir: 1,
              onClick: onNext,
              label: `Next month (${monthLabel(month === 11 ? year + 1 : year, (month + 1) % 12)})`,
            },
          ] as const
        ).map(({ dir, onClick, label }) => (
          <button
            key={dir}
            type="button"
            onClick={(e) => {
              onClick();
              if (e.detail > 0) e.currentTarget.blur(); // mouse click: no lingering focus ring
            }}
            aria-label={label}
            title={label}
            className="flex size-[30px] items-center justify-center rounded-[4px] border border-[#EDEDF0] bg-white text-[#667085] shadow-[0_1px_5px_0_rgba(0,0,0,0.05)] transition-colors hover:border-[#D0D5DD] hover:bg-[#F9FAFB] hover:text-[#101D37]"
          >
            <PageArrow dir={dir} />
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Add / edit event dialog (Google Calendar style) ---------------- */

type Draft = Omit<CalEvent, "id">;

const PEOPLE = TEAM_MEMBERS;
const personOf = (g: string) =>
  PEOPLE.find((p) => p.name === g || p.email === g);
const initials = (s: string) =>
  s
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

function GuestAvatar({ g, size = 28 }: { g: string; size?: number }) {
  const p = personOf(g);
  if (p?.avatar)
    return (
      <Image
        src={p.avatar}
        alt=""
        width={size * 2}
        height={size * 2}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full bg-blue/10 text-[11px] font-semibold text-blue"
      style={{ width: size, height: size }}
    >
      {initials(p?.name ?? g)}
    </span>
  );
}

/** One detail row: 20px icon column + content (Google Calendar layout) */
function Row({
  icon,
  children,
  label,
}: {
  icon: Parameters<typeof huge>[0];
  children: ReactNode;
  label: string;
}) {
  return (
    <div className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-x-3">
      <span className="mt-[10px] text-body" aria-hidden title={label}>
        <Icon icon={huge(icon)} size={18} stroke={1.5} />
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

const FIELD_BASE =
  "h-10 min-w-0 rounded-[10px] border border-[#EDEDF0] bg-white px-3 text-sm text-[#101D37] outline-none placeholder:text-body hover:border-[#D0D5DD] focus:border-blue";
const FIELD = `${FIELD_BASE} w-full`;
const SELECT = `${FIELD_BASE} cursor-pointer appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8`;
const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23667085' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")";

function EventDialog({
  initial,
  defaultDate,
  onClose,
  onSave,
  onDelete,
}: {
  initial?: CalEvent;
  defaultDate: string;
  onClose: () => void;
  onSave: (ev: Draft) => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [start, setStart] = useState(initial?.start ?? defaultDate);
  const [end, setEnd] = useState(initial?.end ?? defaultDate);
  const [allDay, setAllDay] = useState(initial?.allDay ?? !initial?.startTime);
  const [startTime, setStartTime] = useState(initial?.startTime ?? "10:00");
  const [endTime, setEndTime] = useState(initial?.endTime ?? "11:00");
  const [repeat, setRepeat] = useState(initial?.repeat ?? REPEATS[0]);
  const [guests, setGuests] = useState<string[]>(initial?.guests ?? []);
  const [guestText, setGuestText] = useState("");
  const [meetLink, setMeetLink] = useState(initial?.meetLink ?? "");
  const [location, setLocation] = useState(initial?.location ?? "");
  const [agenda, setAgenda] = useState(initial?.agenda ?? "");
  const [reminder, setReminder] = useState(initial?.reminder ?? REMINDERS[2]);
  const [status, setStatus] = useState<EventStatus>(
    initial?.status ?? "Scheduled",
  );
  const [progress, setProgress] = useState(initial?.progress ?? 0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const downOnBackdrop = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const q = guestText.trim().toLowerCase();
  const suggestions = q
    ? PEOPLE.filter(
        (p) =>
          !guests.includes(p.name) &&
          (p.name.toLowerCase().includes(q) || p.email.includes(q)),
      ).slice(0, 5)
    : [];

  const addGuest = (g: string) => {
    const v = g.trim();
    if (!v) return;
    const isEmail = /^\S+@\S+\.\S+$/.test(v);
    const match = PEOPLE.find(
      (p) =>
        p.name.toLowerCase() === v.toLowerCase() || p.email === v.toLowerCase(),
    );
    if (!match && !isEmail) {
      setError("Pick someone from the list or enter a full email address.");
      return;
    }
    const id = match?.name ?? v.toLowerCase();
    if (!guests.includes(id)) setGuests((l) => [...l, id]);
    setGuestText("");
    setError(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setError("Add a title for the event.");
    if (end < start)
      return setError("The end date can't be before the start date.");
    if (!allDay && start === end && endTime <= startTime)
      return setError("The end time must be after the start time.");
    onSave({
      title: title.trim(),
      start,
      end,
      status,
      progress,
      more: Math.max(guests.length - 2, initial?.more ?? 0),
      allDay,
      startTime: allDay ? undefined : startTime,
      endTime: allDay ? undefined : endTime,
      repeat,
      guests,
      meetLink: meetLink.trim() || undefined,
      location: location.trim() || undefined,
      agenda: agenda.trim() || undefined,
      reminder,
    });
  };

  const bar = STATUS_STYLE[status].bar;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#101D37]/40 p-4"
      /* close only when the click starts and ends on the backdrop (not after a drag) */
      onMouseDown={(e) => {
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (downOnBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        noValidate
        role="dialog"
        aria-modal="true"
        aria-label={initial ? "Edit event" : "Add event"}
        className="flex max-h-[calc(100dvh-32px)] w-full max-w-[560px] flex-col overflow-hidden rounded-[20px] border border-[#EDEDF0] bg-white shadow-[0_14px_30px_0_rgba(40,92,224,0.10)]"
      >
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-[#EDEDF0] px-5 py-3">
          <span className="text-sm font-semibold text-body">
            {initial ? "Edit Event" : "New Event"}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-[10px] text-body hover:bg-[#F2F4F7] hover:text-[#101D37]"
          >
            <Icon icon={huge(Cancel01Icon)} size={18} stroke={1.6} />
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 py-4">
          {/* title */}
          <div className="flex items-stretch gap-3">
            <span
              className="w-1 shrink-0 rounded-full"
              style={{ background: bar }}
            />
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Add title"
              aria-label="Title"
              className="w-full min-w-0 border-b-2 border-[#EDEDF0] bg-transparent pb-1.5 text-xl leading-[1.3] font-semibold tracking-[-0.02em] text-[#101D37] outline-none placeholder:font-medium placeholder:text-body focus:border-blue"
            />
          </div>

          {/* date & time */}
          <Row icon={Clock01Icon} label="Date and time">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  aria-label="Start date"
                  value={start}
                  onChange={(e) => {
                    setStart(e.target.value);
                    if (e.target.value > end) setEnd(e.target.value);
                  }}
                  className={`${FIELD_BASE} w-auto`}
                />
                {!allDay && (
                  <input
                    type="time"
                    aria-label="Start time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className={`${FIELD_BASE} w-auto`}
                  />
                )}
                <span className="text-sm text-body">to</span>
                {!allDay && (
                  <input
                    type="time"
                    aria-label="End time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className={`${FIELD_BASE} w-auto`}
                  />
                )}
                <input
                  type="date"
                  aria-label="End date"
                  value={end}
                  min={start}
                  onChange={(e) => setEnd(e.target.value)}
                  className={`${FIELD_BASE} w-auto`}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-[#101D37]">
                  <input
                    type="checkbox"
                    checked={allDay}
                    onChange={(e) => setAllDay(e.target.checked)}
                    className="size-4 cursor-pointer accent-blue"
                  />
                  All day
                </label>
                <select
                  aria-label="Repeat"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  className={`${SELECT} h-9 w-auto`}
                  style={{ backgroundImage: CHEVRON }}
                >
                  {REPEATS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </div>
            </div>
          </Row>

          {/* guests */}
          <Row icon={UserGroupIcon} label="Guests">
            <div className="flex flex-col gap-2">
              <div className="relative">
                <input
                  value={guestText}
                  onChange={(e) => setGuestText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addGuest(suggestions[0]?.name ?? guestText);
                    }
                  }}
                  placeholder="Add guests by name or email"
                  aria-label="Add guests"
                  className={FIELD}
                />
                {suggestions.length > 0 && (
                  <ul className="absolute top-11 right-0 left-0 z-10 flex flex-col overflow-hidden rounded-[10px] border border-[#EDEDF0] bg-white py-1 shadow-[0_14px_30px_0_rgba(16,29,55,0.12)]">
                    {suggestions.map((p) => (
                      <li key={p.email}>
                        <button
                          type="button"
                          onClick={() => addGuest(p.name)}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-[#F8F9FC]"
                        >
                          <GuestAvatar g={p.name} size={26} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-[#101D37]">
                              {p.name}
                            </span>
                            <span className="block truncate text-xs text-body">
                              {p.email}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {guests.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-body">
                    {guests.length} {guests.length === 1 ? "guest" : "guests"}
                  </span>
                  <ul className="flex flex-col">
                    {guests.map((g) => {
                      const p = personOf(g);
                      return (
                        <li
                          key={g}
                          className="group flex items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 hover:bg-[#F8F9FC]"
                        >
                          <GuestAvatar g={g} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-[#101D37]">
                              {p?.name ?? g}
                            </span>
                            {p && (
                              <span className="block truncate text-xs text-body">
                                {p.designation}
                              </span>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setGuests((l) => l.filter((x) => x !== g))
                            }
                            aria-label={`Remove ${p?.name ?? g}`}
                            className="flex size-7 items-center justify-center rounded-md text-body opacity-60 hover:bg-white hover:text-[#F04438] group-hover:opacity-100"
                          >
                            <Icon
                              icon={huge(Cancel01Icon)}
                              size={14}
                              stroke={1.6}
                            />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </Row>

          {/* video call */}
          <Row icon={Video01Icon} label="Video call">
            {meetLink ? (
              <div className="flex items-center gap-2">
                <input
                  value={meetLink}
                  onChange={(e) => setMeetLink(e.target.value)}
                  aria-label="Meeting link"
                  className={FIELD}
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(meetLink).catch(() => {});
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  }}
                  aria-label="Copy meeting link"
                  className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-[#EDEDF0] text-body hover:text-[#101D37]"
                >
                  <Icon
                    icon={huge(copied ? Tick02Icon : Copy01Icon)}
                    size={16}
                    stroke={1.6}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => setMeetLink("")}
                  aria-label="Remove meeting link"
                  className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-[#EDEDF0] text-body hover:text-[#F04438]"
                >
                  <Icon icon={huge(Cancel01Icon)} size={16} stroke={1.6} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setMeetLink(
                    `https://meet.artifexlabs.com/${Math.random().toString(36).slice(2, 5)}-${Math.random().toString(36).slice(2, 6)}`,
                  )
                }
                className="flex h-10 items-center gap-1.5 rounded-[10px] bg-blue/[0.08] px-3 text-sm font-semibold text-blue hover:bg-blue/[0.14]"
              >
                <Icon icon={huge(Link01Icon)} size={16} stroke={1.6} />
                Add video call link
              </button>
            )}
          </Row>

          {/* location */}
          <Row icon={Location01Icon} label="Location">
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Add location"
              aria-label="Location"
              className={FIELD}
            />
          </Row>

          {/* agenda */}
          <Row icon={TextAlignLeftIcon} label="Agenda">
            <textarea
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              placeholder="Add agenda or description"
              aria-label="Agenda"
              rows={3}
              className={`${FIELD} h-auto min-h-[84px] resize-y py-2.5 leading-[1.5]`}
            />
          </Row>

          {/* reminder */}
          <Row icon={Notification01Icon} label="Reminder">
            <select
              aria-label="Reminder"
              value={reminder}
              onChange={(e) => setReminder(e.target.value)}
              className={`${SELECT} w-full`}
              style={{ backgroundImage: CHEVRON }}
            >
              {REMINDERS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Row>

          {/* status + progress (what the event card shows) */}
          <Row icon={ChartLineData01Icon} label="Status and progress">
            <div className="flex flex-col gap-3 rounded-[14px] border border-[#EDEDF0] bg-[#FAFAFA] p-3">
              <div className="flex flex-wrap gap-2">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={status === s}
                    onClick={() => setStatus(s)}
                    className={`rounded-lg ring-offset-1 ${status === s ? "ring-2 ring-blue" : "opacity-70 hover:opacity-100"}`}
                  >
                    <StatusPill status={s} />
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 text-sm text-[#101D37]">
                <span className="shrink-0 font-medium">Progress</span>
                <ProgressSlider value={progress} onChange={setProgress} />
              </div>
            </div>
          </Row>
        </div>

        {/* footer */}
        <div className="flex flex-col gap-2 border-t border-[#EDEDF0] px-5 py-3">
          {error && (
            <p role="alert" className="text-sm text-[#F04438]">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-2">
            {onDelete ? (
              confirmDelete ? (
                <span className="flex items-center gap-2 text-xs font-medium text-body">
                  Delete this event?
                  <button
                    type="button"
                    onClick={onDelete}
                    className="h-8 rounded-[8px] bg-[#D92D20] px-2.5 text-xs font-semibold text-white hover:bg-[#B42318]"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="text-xs font-semibold text-[#242C2C] hover:text-blue"
                  >
                    Keep
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="flex h-9 items-center gap-1.5 rounded-[10px] px-2 text-sm font-semibold text-[#D92D20] hover:bg-[#FEF3F2]"
                >
                  <Icon icon={huge(Delete02Icon)} size={16} stroke={1.6} />
                  Delete
                </button>
              )
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-[10px] border border-[#EDEDF0] px-3 text-sm font-semibold text-[#242C2C]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-9 rounded-[10px] bg-blue px-4 text-sm font-semibold text-white"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ---------------- Board (header + views) ---------------- */

export default function CalendarBoard() {
  const router = useRouter();
  const params = useSearchParams();
  const view = params.get("view") === "kanban" ? "kanban" : "calendar";

  const [events, setEvents] = useState<CalEvent[]>(INITIAL_EVENTS);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<EventStatus[]>([...STATUSES]);
  const [filterOpen, setFilterOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CalEvent | null>(null);
  const [ym, setYm] = useState({ y: 2025, m: 6 }); // July 2025 – the month shown in Figma
  const [selected, setSelected] = useState("2025-07-15");

  useEffect(() => {
    const saved = load();
    if (saved) setEvents(saved);
  }, []);

  /* Filter menu closes on a click outside it or on Escape */
  const filterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!filterOpen) return;
    const down = (e: MouseEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false);
    };
    const key = (e: KeyboardEvent) =>
      e.key === "Escape" && setFilterOpen(false);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [filterOpen]);

  const update = (fn: (l: CalEvent[]) => CalEvent[]) =>
    setEvents((prev) => {
      const next = fn(prev);
      save(next);
      return next;
    });

  const visible = events.filter(
    (e) =>
      filter.includes(e.status) &&
      e.title.toLowerCase().includes(query.toLowerCase()),
  );

  const setView = (v: "kanban" | "calendar") =>
    router.replace(v === "kanban" ? `${V2}/calendar?view=kanban` : `${V2}/calendar`, {
      scroll: false,
    });

  const shiftMonth = (d: number) =>
    setYm(({ y, m }) => {
      const t = new Date(y, m + d, 1);
      return { y: t.getFullYear(), m: t.getMonth() };
    });

  return (
    /* Figma "Calender" card: 1100 wide, radius 12, padding 16, gap 16, white, border */
    <section className="flex w-full flex-col gap-4 rounded-xl border border-[#EDEDF0] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base leading-[1.5] font-semibold tracking-[-0.02em] text-[#101D37]">
          Deadlines, Reviews, Meetings..
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <ToolbarButton
            active={view === "kanban"}
            onClick={() => setView("kanban")}
          >
            <KanbanIcon />
            Kanban
          </ToolbarButton>
          <ToolbarButton
            active={view === "calendar"}
            onClick={() => setView("calendar")}
          >
            <Icon icon={untitled(Calendar)} size={16} />
            Calendar
          </ToolbarButton>
          <div ref={filterRef} className="relative">
            <ToolbarButton
              active={filter.length !== STATUSES.length}
              onClick={() => setFilterOpen((o) => !o)}
            >
              <Icon icon={untitled(FilterLines)} size={16} />
              Filter
            </ToolbarButton>
            {filterOpen && (
              <div className="absolute top-10 right-0 z-30 flex w-44 flex-col gap-1 rounded-[10px] border border-[#EDEDF0] bg-white p-2 shadow-[0_14px_30px_0_rgba(16,29,55,0.12)]">
                {STATUSES.map((s) => (
                  <label
                    key={s}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[#F8F9FC]"
                  >
                    <input
                      type="checkbox"
                      checked={filter.includes(s)}
                      onChange={() =>
                        setFilter((f) =>
                          f.includes(s) ? f.filter((x) => x !== s) : [...f, s],
                        )
                      }
                      className="accent-blue"
                    />
                    <StatusPill status={s} />
                  </label>
                ))}
              </div>
            )}
          </div>
          <label className="flex h-[33px] w-[228px] items-center gap-2 rounded-md border border-[#EDEDF0] bg-[#FAFAFA] px-3">
            <Icon
              icon={untitled(SearchMd)}
              size={16}
              className="shrink-0 text-body"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-full min-w-0 bg-transparent text-sm leading-[1.5] tracking-[-0.02em] text-[#101D37] outline-none placeholder:text-body"
            />
          </label>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-[33px] items-center gap-[4.83px] rounded-[8.06px] bg-blue px-[9.67px] py-[6.44px] text-xs leading-[1.5] font-semibold tracking-[-0.02em] text-white"
          >
            <Icon icon={huge(Add01Icon)} size={14} stroke={1.3} />
            Add Event
          </button>
        </div>
      </div>

      {view === "kanban" ? (
        <Kanban
          events={visible}
          onOpen={setEditing}
          onMove={(id, status) =>
            update((l) => l.map((e) => (e.id === id ? { ...e, status } : e)))
          }
        />
      ) : (
        <MonthView
          year={ym.y}
          month={ym.m}
          events={visible}
          selected={selected}
          onSelect={setSelected}
          onPrev={() => shiftMonth(-1)}
          onNext={() => shiftMonth(1)}
          onOpen={setEditing}
          onAddOn={(iso) => {
            setSelected(iso);
            setAdding(true);
          }}
        />
      )}

      {adding && (
        <EventDialog
          defaultDate={selected}
          onClose={() => setAdding(false)}
          onSave={(ev) => {
            update((l) => [...l, { ...ev, id: `e${Date.now()}` }]);
            setAdding(false);
            const d = toDate(ev.start);
            setYm({ y: d.getFullYear(), m: d.getMonth() });
          }}
        />
      )}
      {editing && (
        <EventDialog
          initial={editing}
          defaultDate={editing.start}
          onClose={() => setEditing(null)}
          onSave={(ev) => {
            update((l) =>
              l.map((e) =>
                e.id === editing.id ? { ...ev, id: editing.id } : e,
              ),
            );
            setEditing(null);
          }}
          onDelete={() => {
            update((l) => l.filter((e) => e.id !== editing.id));
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}
