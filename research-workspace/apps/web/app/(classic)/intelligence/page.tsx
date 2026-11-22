"use client";
import { HALDEN_SRC } from "@/lib/api";

export default function IntelligencePage() {
  return (
    <div style={{ width: "100vw", height: "100vh", margin: 0, padding: 0, overflow: "hidden" }}>
      <iframe
        src={HALDEN_SRC}
        style={{
          width: "100%",
          height: "100%",
          border: "none",
          display: "block",
        }}
        title="Halden R&D Intelligence"
      />
    </div>
  );
}
