import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./v2.css";

/*
 * Root layout of the new UI (design: github.com/EngrRehman-debug/artifexlabs-research).
 * It is a separate root layout from app/(classic), so the new styles never reach the current pages:
 * moving between the two loads a fresh page.
 */
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const jakarta = Plus_Jakarta_Sans({ variable: "--font-plus-jakarta", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Artifex Labs",
  description: "AI research workspace: projects, evidence, signals and team collaboration for R&D.",
};

export default function V2RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable}`}>
      {/* browser extensions add attributes to <body> before hydration */}
      <body className="font-sans antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
