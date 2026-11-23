import { Suspense } from "react";
import TopBar from "@/components/v2/dashboard/TopBar";
import CalendarBoard from "@/components/v2/calendar/CalendarBoard";

/**
 * Figma frames "Calendar" (1440 x 1112) and "Kanban Calendar" (1440 x 1080):
 * the same page with a Kanban / Calendar view toggle (?view=kanban).
 * Title at (300, 104); card 1100 wide at (300, 160).
 */
export default function CalendarPage() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <TopBar current="Calendar" />
      <main className="flex flex-col gap-5 px-4 pt-10 pb-16 sm:px-6 lg:px-10">
        <h1 className="text-2xl leading-[1.2] font-semibold tracking-[-0.02em] text-[#101D37] sm:text-[30px]">
          Calendar
        </h1>
        <Suspense fallback={null}>
          <CalendarBoard />
        </Suspense>
      </main>
    </div>
  );
}
