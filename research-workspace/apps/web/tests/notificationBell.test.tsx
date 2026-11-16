import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StoreProvider from "@/components/StoreProvider";
import NotificationBell from "@/components/NotificationBell";
import { makeStore } from "@/lib/notifications/store";
import { markAllRead, received, selectUnreadCount } from "@/lib/notifications/slice";
import { LIVE_QUEUE } from "@/lib/notifications/seed";

beforeEach(() => localStorage.clear());

describe("NotificationBell", () => {
  it("shows the unread count and dot, and opening the bell hides the dot", async () => {
    const store = makeStore();
    render(<StoreProvider store={store}><NotificationBell /></StoreProvider>);
    expect(screen.getByTestId("bell-count")).toHaveTextContent("3");
    expect(screen.getByTestId("bell-dot")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));
    expect(screen.queryByTestId("bell-dot")).toBeNull();
    expect(screen.getByTestId("bell-count")).toHaveTextContent("3");
  });

  it("mark all read updates the badge", async () => {
    const store = makeStore();
    render(<StoreProvider store={store}><NotificationBell /></StoreProvider>);
    await userEvent.click(screen.getByRole("button", { name: /notifications/i }));
    await userEvent.click(screen.getByRole("button", { name: /mark all read/i }));
    expect(screen.queryByTestId("bell-count")).toBeNull();
    expect(selectUnreadCount(store.getState())).toBe(0);
  });

  it("two bells on one store never disagree, and an outside change (other tab) shows up", async () => {
    const store = makeStore();
    render(<StoreProvider store={store}><NotificationBell /><NotificationBell /></StoreProvider>);
    await userEvent.click(screen.getAllByRole("button", { name: /notifications/i })[0]);
    await userEvent.click(screen.getByRole("button", { name: /mark all read/i }));
    expect(screen.queryAllByTestId("bell-count")).toHaveLength(0);

    // another document (e.g. the Halden iframe) changes storage -> storage event
    const other = makeStore();
    other.dispatch(markAllRead());
    other.dispatch(received(LIVE_QUEUE[0]));
    const value = JSON.stringify(other.getState().notifications);
    act(() => {
      localStorage.setItem("halden_notifs_v2", value);
      window.dispatchEvent(new StorageEvent("storage", { key: "halden_notifs_v2", newValue: value }));
    });
    expect(screen.getAllByTestId("bell-count").map((e) => e.textContent)).toEqual(["1", "1"]);
  });
});
