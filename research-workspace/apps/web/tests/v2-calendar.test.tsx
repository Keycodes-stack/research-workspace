import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let view: string | null = null;
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  useSearchParams: () => ({ get: (k: string) => (k === "view" ? view : null) }),
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <img alt={alt} /> }));

import CalendarBoard from "@/components/v2/calendar/CalendarBoard";

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); view = null; });

describe("Calendar (design sample, no backend)", () => {
  it("shows the design's month with its sample events and switches views under /v2", () => {
    render(<CalendarBoard />);
    expect(screen.getByText("Commercial Viability — Lead Review")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Kanban" }));
    expect(replace).toHaveBeenCalledWith("/calendar?view=kanban", expect.anything());
  });

  it("shows the Kanban columns when asked by the URL", () => {
    view = "kanban";
    render(<CalendarBoard />);
    for (const s of ["Draft", "Scheduled", "Active", "Ended"]) expect(screen.getAllByText(s).length).toBeGreaterThan(0);
  });
});
