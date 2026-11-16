export type NotifKind = "agent" | "mention" | "claim" | "blocker" | "approval" | "system";
export type NotifFilter = "all" | "me" | "mention" | "agent";

export interface AppNotification {
  id: string;
  k: NotifKind;
  /** person key (see halden.html P) that triggered it */
  who?: string;
  /** task id it relates to; `{title}` in `b` is resolved from it at render time */
  t?: string;
  h: string;
  /** body text; may contain a `{title}` placeholder */
  b: string;
  w: string;
  g: "Today" | "Earlier";
  /** 1 = unread */
  u: 0 | 1;
  a: string[];
}

export interface NotificationsState {
  items: AppNotification[];
  /** bell dot has not been acknowledged yet */
  dot: boolean;
  filter: NotifFilter;
}
