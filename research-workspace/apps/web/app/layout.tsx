import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Keycodes AI Research Workspace",
  description: "Citation-verified research assistant for pharma and engineering R&D.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
