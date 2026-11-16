"use client";
import { useState } from "react";
import { useAppDispatch, useAppSelector } from "@/lib/notifications/hooks";
import {
  dotSeen, markAllRead, markRead, selectUnreadCount, selectShowDot, selectVisible, selectFilter, setFilter,
} from "@/lib/notifications/slice";
import { resolveBody } from "@/lib/notifications/seed";
import type { NotifFilter } from "@/lib/notifications/types";

const FILTERS: [NotifFilter, string][] = [["all", "All"], ["me", "Needs you"], ["mention", "Mentions"], ["agent", "Agents"]];

/** Reads and writes the same notification slice the embedded Halden app uses, so both always agree. */
export default function NotificationBell() {
  const dispatch = useAppDispatch();
  const unread = useAppSelector(selectUnreadCount);
  const showDot = useAppSelector(selectShowDot);
  const items = useAppSelector(selectVisible);
  const filter = useAppSelector(selectFilter);
  const [open, setOpen] = useState(false);

  const toggle = () => {
    if (!open) dispatch(dotSeen());
    setOpen(!open);
  };

  return (
    <div className="nbell">
      <button type="button" className="secondary nbell-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open} onClick={toggle}>
        <span aria-hidden>🔔</span>
        {showDot && <i className="nbell-dot" data-testid="bell-dot" />}
        {unread > 0 && <span className="nbell-count" data-testid="bell-count">{unread}</span>}
      </button>
      {open && (
        <div className="nbell-pop card" role="dialog" aria-label="Notifications">
          <div className="nbell-head">
            <b>Notifications</b>
            <span className="muted">{unread ? `${unread} unread` : "All caught up"}</span>
            <button type="button" className="secondary" onClick={() => dispatch(markAllRead())}>Mark all read</button>
          </div>
          <div className="nbell-chips">
            {FILTERS.map(([k, label]) => (
              <button key={k} type="button" className={k === filter ? "" : "secondary"} aria-pressed={k === filter}
                onClick={() => dispatch(setFilter(k))}>{label}</button>
            ))}
          </div>
          {items.length === 0 && <p className="muted">Nothing here. You are all caught up.</p>}
          <ul className="nbell-list">
            {items.map((n) => (
              <li key={n.id} className={n.u ? "unread" : undefined}>
                <b>{n.h}</b>
                <div className="muted">{resolveBody(n)}</div>
                <div className="muted">{n.w}{n.u ? <button type="button" className="secondary" onClick={() => dispatch(markRead(n.id))}>Mark read</button> : null}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
