"use client";
import React from "react";

/** A single shimmer block — use width/height or className to size it. */
export function Skeleton({
  width,
  height,
  className = "",
  style,
}: {
  width?: string | number;
  height?: string | number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      className={`skeleton ${className}`}
      style={{
        display: "inline-block",
        width: width ?? "100%",
        height: height ?? "1em",
        borderRadius: 6,
        ...(style ?? {}),
      }}
      aria-hidden="true"
    />
  );
}

/** Multiple lines of shimmer text, last line shorter to look natural. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton-text" aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height="0.85em"
          width={i === lines - 1 ? "60%" : "100%"}
          style={{ display: "block", marginBottom: i < lines - 1 ? 8 : 0 }}
        />
      ))}
    </div>
  );
}

/** A card-shaped shimmer container. Pass children (Skeleton / SkeletonText) for a custom layout,
 *  or omit children to get a basic shimmer card. */
export function SkeletonCard({ children }: { children?: React.ReactNode }) {
  return (
    <div className="card skeleton-card" aria-hidden="true">
      {children ?? <SkeletonText lines={3} />}
    </div>
  );
}
