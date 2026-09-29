import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/components/ThemeProvider";
import { RegionProvider } from "@/lib/region-context";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "OATH — Stake Everything",
  description:
    "Financial and social smart-contract platform where you wager real consequences against your own execution. No excuses.",
  openGraph: {
    title: "OATH — Stake Everything",
    description: "Wager real consequences against your own execution.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script src="https://checkout.razorpay.com/v1/checkout.js" async></script>
      </head>
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
