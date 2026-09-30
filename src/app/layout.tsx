import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/components/ThemeProvider";
import { RegionProvider } from "@/lib/region-context";

export const metadata: Metadata = {
  title: "OATH — Accountability Sandbox",
  description:
    "An accountability sandbox for personal goals, proof uploads, peer voting, and virtual stakes. No cash payments or external consequence integrations are enabled.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  openGraph: {
    title: "OATH — Accountability Sandbox",
    description: "Track goals with proof, peer review, and virtual sandbox stakes.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body suppressHydrationWarning className="h-full overflow-hidden bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 transition-colors duration-300">
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          <RegionProvider>
            {/* SVG Noise Grain Overlay — Global, fixed, non-interactive */}
            <div className="noise-overlay" aria-hidden="true" />
            <div className="scanline-overlay" aria-hidden="true" />

            <AuthProvider>
              {children}
            </AuthProvider>
          </RegionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
