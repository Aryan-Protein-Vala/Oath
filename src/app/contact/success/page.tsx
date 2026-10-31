"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  CheckCircle2,
  ArrowLeft,
  RotateCcw,
  Sun,
  Moon,
} from "lucide-react";

export default function ContactSuccessPage() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div className="min-h-[100dvh] w-full bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 flex flex-col font-sans transition-colors duration-200">
      {/* Top Bar with Clean Spacing */}
      <header className="w-full max-w-2xl mx-auto px-6 pt-8 pb-4 flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-mono font-bold text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-100 uppercase tracking-wider transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-red-600" />
          <span>Back to Dashboard</span>
        </Link>

        {mounted && (
          <button
            type="button"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="p-2 border-2 border-zinc-950 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
            aria-label="Toggle theme"
          >
            {resolvedTheme === "dark" ? (
              <Sun className="w-4 h-4 text-zinc-300" />
            ) : (
              <Moon className="w-4 h-4 text-zinc-800" />
            )}
          </button>
        )}
      </header>

      {/* Main Container */}
      <main className="flex-1 w-full max-w-2xl mx-auto px-6 pb-20 pt-8 flex flex-col justify-center">
        <div className="border-4 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-[#0c0c11] p-8 sm:p-12 shadow-[8px_8px_0px_0px_rgba(9,9,11,1)] dark:shadow-none text-left">
          
          {/* Header Icon + Title */}
          <div className="flex items-center gap-3.5 mb-6">
            <div className="w-12 h-12 bg-emerald-500 border-2 border-zinc-950 dark:border-zinc-700 flex items-center justify-center text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-none shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[10px] font-mono font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 block">
                DISPATCH CONFIRMED
              </span>
              <h1 className="text-2xl sm:text-3xl font-black uppercase text-zinc-950 dark:text-zinc-50 tracking-tight">
                MESSAGE DELIVERED.
              </h1>
            </div>
          </div>

          {/* Hilarious message */}
          <p className="text-sm font-mono text-zinc-700 dark:text-zinc-300 leading-relaxed mb-8">
            Your transmission landed right on our developer war board. If it&apos;s a legitimate
            bug, our caffeine-soaked engineers are already tearing into the code. If it&apos;s an
            excuse for why you couldn&apos;t finish your morning gym oath, we printed it out to
            read at standup.
          </p>

          {/* Clean Info Box */}
          <div className="border-2 border-zinc-950 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-4 mb-8 font-mono text-xs space-y-2">
            <div className="flex justify-between items-center text-zinc-600 dark:text-zinc-400">
              <span>Status:</span>
              <span className="font-bold text-zinc-950 dark:text-zinc-100 uppercase">Received & Queued</span>
            </div>
            <div className="flex justify-between items-center text-zinc-600 dark:text-zinc-400">
              <span>Response Time:</span>
              <span className="font-bold text-zinc-950 dark:text-zinc-100">Faster than your next failed streak</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <Link
              href="/"
              className="w-full sm:flex-1 py-4 px-6 bg-zinc-950 dark:bg-zinc-50 text-white dark:text-zinc-950 font-black text-xs sm:text-sm uppercase tracking-widest hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all border-2 sm:border-4 border-zinc-950 dark:border-transparent text-center shadow-[4px_4px_0px_0px_rgba(220,38,38,1)] dark:shadow-none flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Dashboard</span>
            </Link>

            <Link
              href="/contact"
              className="w-full sm:w-auto py-4 px-6 border-2 sm:border-4 border-zinc-950 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 font-mono font-bold text-xs sm:text-sm uppercase tracking-wider hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-center shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-none flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Send Another</span>
            </Link>
          </div>
        </div>

        {/* Small Bottom Joke */}
        <p className="mt-8 text-center text-xs font-mono text-zinc-500 uppercase tracking-wider">
          &ldquo;Excuses are like bugs: 99% could be prevented with basic discipline.&rdquo;
        </p>
      </main>
    </div>
  );
}
