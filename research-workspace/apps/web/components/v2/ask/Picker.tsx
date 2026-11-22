"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import Icon, { huge, type AnyIcon } from "@/components/v2/dashboard/Icon";

export interface PickerOption<T extends string> { value: T; label: string; hint?: string }

/**
 * The design's "Evidence Sources ⌄" button (h-9, radius 10, border #EDEDF0) opening a list of choices.
 * The design has no open state, so the list uses the same card style. Closes on choice, outside click or Escape.
 */
export default function Picker<T extends string>({
  icon, label, value, options, onChange, disabled, emptyText = "Nothing to choose yet",
}: {
  icon: AnyIcon;
  /** button text; the chosen option's label is shown after it */
  label: string;
  value: T | null;
  options: PickerOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  const chosen = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  return (
    <div ref={box} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 max-w-full items-center gap-1 rounded-[10px] border border-[#EDEDF0] p-2.5 text-sm leading-[1.5] tracking-[-0.02em] text-body disabled:opacity-50"
      >
        <Icon icon={icon} size={16} className="shrink-0" />
        <span className="shrink-0">{label}</span>
        {chosen && <span className="min-w-0 truncate font-medium text-[#101D37]">· {chosen.label}</span>}
        <Icon icon={huge(ArrowDown01Icon)} size={16} className="shrink-0" />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className="absolute left-0 z-20 mt-1.5 max-h-72 w-72 max-w-[calc(100vw-48px)] overflow-y-auto rounded-[14px] border border-[#EDEDF0] bg-white p-1.5 shadow-[0_14px_30px_0_rgba(40,92,224,0.10)]"
        >
          {options.length === 0 && <li role="none" className="px-2.5 py-2 text-sm text-body">{emptyText}</li>}
          {options.map((o) => (
            <li key={o.value} role="none">
              <button
                type="button"
                role="option"
                aria-selected={o.value === value}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className="flex w-full items-start gap-2 rounded-[10px] px-2.5 py-2 text-left hover:bg-[#FAFAFA]"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm leading-[1.5] font-medium tracking-[-0.02em] text-[#101D37]">{o.label}</span>
                  {o.hint && <span className="block text-xs leading-[1.5] tracking-[-0.02em] text-body">{o.hint}</span>}
                </span>
                {o.value === value && <Icon icon={huge(Tick02Icon)} size={16} className="mt-0.5 shrink-0 text-blue" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
