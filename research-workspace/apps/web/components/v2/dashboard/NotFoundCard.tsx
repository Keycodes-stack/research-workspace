import Link from "next/link";
import { V2 } from "@/lib/v2/routes";
import { Folder01Icon } from "@hugeicons/core-free-icons";
import Icon, { huge } from "./Icon";

/** App-styled "not found" message (replaces Next's plain 404). The design's note about browser-only projects is
 *  left out: projects here are saved on the server. */
export default function NotFoundCard() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-24">
      <div className="flex w-full max-w-[420px] flex-col items-center gap-4 rounded-[20px] border border-[#EDEDF0] bg-white p-8 text-center shadow-[0_14px_30px_0_rgba(40,92,224,0.06)]">
        <span className="flex size-12 items-center justify-center rounded-full bg-blue/10 text-blue">
          <Icon icon={huge(Folder01Icon)} size={24} stroke={1.5} />
        </span>
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold tracking-[0.08em] text-blue uppercase">Error 404</p>
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-[#101D37]">Page not found</h1>
          <p className="text-sm leading-[1.6] text-body">
            The page you’re looking for doesn’t exist or has moved.
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href={`${V2}/projects`} className="flex h-9 items-center rounded-[10px] bg-blue px-4 text-sm font-semibold text-white">
            Go to Projects
          </Link>
          <Link href={`${V2}/home`} className="flex h-9 items-center rounded-[10px] border border-[#EDEDF0] px-4 text-sm font-semibold text-[#242C2C]">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
