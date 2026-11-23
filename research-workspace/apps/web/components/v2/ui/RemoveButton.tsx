"use client";

import { Trash01 } from "@untitledui/icons";
import Icon, { untitled } from "@/components/v2/dashboard/Icon";

/** The one style for removing or deleting something: a bin icon with its label, in red. */
export default function RemoveButton({ label = "Remove", onClick, disabled, title }: {
  label?: string; onClick: () => void; disabled?: boolean; title?: string;
}) {
  return <button type="button" onClick={onClick} disabled={disabled} title={title} aria-label={label}
    className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#B42318] disabled:opacity-40">
    <Icon icon={untitled(Trash01)} size={15} stroke={1.2} />
    {label}
  </button>;
}
