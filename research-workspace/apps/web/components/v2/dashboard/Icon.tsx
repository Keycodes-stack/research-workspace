import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import type { ComponentType, SVGProps } from "react";

/**
 * Icons in the Figma file come from two sets:
 *  - Untitled UI (e.g. home-line, settings-02, log-out-01, chevron-left-double)
 *  - Hugeicons stroke-rounded (search-list, calendar-03, notification, mic …)
 * Both are drawn on a 24px grid. Figma uses them at 20px with a 1.5px stroke
 * and at 16px with a ~1.3px stroke, so we convert the *rendered* stroke width
 * back to the 24px grid: strokeWidth = px * 24 / size.
 */
type UntitledIcon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

export type AnyIcon =
  | { kind: "huge"; icon: IconSvgElement }
  | { kind: "untitled"; icon: UntitledIcon };

export const huge = (icon: IconSvgElement): AnyIcon => ({ kind: "huge", icon });
export const untitled = (icon: UntitledIcon): AnyIcon => ({
  kind: "untitled",
  icon,
});

export default function Icon({
  icon,
  size = 20,
  stroke,
  className,
}: {
  icon: AnyIcon;
  size?: number;
  /** rendered stroke in px (defaults: 1.5 at ≥20px, 1.3 below) */
  stroke?: number;
  className?: string;
}) {
  const px = stroke ?? (size >= 20 ? 1.5 : 1.3);
  const strokeWidth = (px * 24) / size;
  if (icon.kind === "huge") {
    return (
      <HugeiconsIcon
        icon={icon.icon}
        size={size}
        strokeWidth={strokeWidth}
        className={className}
      />
    );
  }
  const C = icon.icon;
  return <C size={size} strokeWidth={strokeWidth} className={className} />;
}
