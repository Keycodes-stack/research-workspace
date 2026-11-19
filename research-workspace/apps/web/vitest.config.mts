import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname) } },
  // lib/api.ts refuses to load without NEXT_PUBLIC_API_URL; tests get a local default (CI sets it only for build).
  test: { environment: "jsdom", setupFiles: ["./tests/setup.ts"], globals: true,
          env: { NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080" } },
});
