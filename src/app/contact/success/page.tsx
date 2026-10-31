"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  CheckCircle2,
  ArrowLeft,
  Flame,
  Bug,
  Sun,
  Moon,
  Sparkles,
  RotateCcw,
  ShieldCheck,
  Terminal,
} from "lucide-react";

export default function ContactSuccessPage() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [ticketId, setTicketId] = useState("OATH-BETA-7701");

  useEffect(() => {
    setMounted(true);
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    setTicketId(`OATH-BETA-${randomNum}`);
  }, []);

  return (
    <div className="min-h-[100dvh] w-full bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 overflow-y-auto selection:bg-red-500/30 font-sans transition-colors duration-300">
      {/* Top Navbar */}
      <nav className="w-full border-b-2 sm:border-b-4 border-zinc-950 dark:border-zinc-800 bg-white/95 dark:bg-[#09090b]/95 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center justify-between h-14 sm:h-18 px-4 sm:px-6 max-w-5xl mx-auto w-full">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 border-2 border-zinc-950 dark:border-zinc-800 text-xs sm:text-sm font-mono font-black uppercase tracking-wider text-zinc-950 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none hover:-translate-y-0.5 active:translate-y-0 transition-all"
          >
            <ArrowLeft className="w-4 h-4 text-red-600" />
            <span>Back to Dashboard</span>
          </Link>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-xl font-black tracking-tighter text-zinc-950 dark:text-zinc-50">
                OATH
              </span>
              <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-widest bg-emerald-600 text-white border border-emerald-700">
                DELIVERED
              </span>
            </div>

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
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-16">
        <div className="border-4 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-[#0a0a0f] p-6 sm:p-10 md:p-12 shadow-[10px_10px_0px_0px_rgba(9,9,11,1)] dark:shadow-none text-center sm:text-left">
          
          {/* Header Status */}
          <div className="flex flex-col sm:flex-row items-center sm:items-start justify-between gap-4 border-b-2 border-zinc-950 dark:border-zinc-800 pb-6 mb-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-emerald-500 border-2 border-zinc-950 dark:border-zinc-700 flex items-center justify-center text-white shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-none shrink-0">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div>
                <span className="text-[10px] font-mono font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 block">
                  TRANSMISSION RECEIVED
                </span>
                <h1 className="text-2xl sm:text-4xl font-black uppercase text-zinc-950 dark:text-zinc-50 tracking-tight">
                  TICKET LOGGED IN BLOOD.
                </h1>
              </div>
            </div>

            <div className="px-3 py-1.5 border-2 border-zinc-950 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 font-mono text-xs font-black uppercase tracking-wider">
              {ticketId}
            </div>
          </div>

          {/* Body Narrative */}
          <p className="text-sm sm:text-base font-mono font-medium text-zinc-800 dark:text-zinc-200 leading-relaxed mb-6">
            Your feedback and bug telemetry just touched down in our developer war room. We’ve
            routed it straight to the engineers. If this was a legitimate bug, we are already
            hunting down the stack trace. If this was an emotional roast about failing your 5 AM gym oath, our team will read it out loud for morale.
          </p>

          {/* Ticket Receipt Box */}
          <div className="border-2 border-zinc-950 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950 p-4 sm:p-6 mb-8 font-mono text-xs space-y-2.5 text-left shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
            <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-zinc-500 font-bold uppercase">Ticket Ref</span>
              <span className="font-black text-red-600 dark:text-red-400">{ticketId}</span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-zinc-500 font-bold uppercase">Queue Status</span>
              <span className="font-bold text-zinc-900 dark:text-zinc-100 uppercase">
                Dispatched to Developers
              </span>
            </div>
            <div className="flex items-center justify-between pb-2 border-b border-zinc-200 dark:border-zinc-800">
              <span className="text-zinc-500 font-bold uppercase">Estimated Response</span>
              <span className="font-bold text-zinc-900 dark:text-zinc-100">
                Faster than your next broken promise
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500 font-bold uppercase">Survival Rate</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">99.7%</span>
            </div>
          </div>

          {/* Primary Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3">
            <Link
              href="/"
              className="w-full sm:flex-1 py-4 px-6 bg-zinc-950 dark:bg-zinc-50 text-white dark:text-zinc-950 font-black text-xs sm:text-sm uppercase tracking-widest hover:bg-zinc-800 dark:hover:bg-zinc-200 hover:-translate-y-0.5 active:translate-y-0 transition-all border-2 sm:border-4 border-zinc-950 dark:border-transparent text-center shadow-[4px_4px_0px_0px_rgba(220,38,38,1)] dark:shadow-none flex items-center justify-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Dashboard</span>
            </Link>

            <Link
              href="/contact"
              className="w-full sm:w-auto py-4 px-6 border-2 sm:border-4 border-zinc-950 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 font-mono font-bold text-xs sm:text-sm uppercase tracking-wider hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-center shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-none flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Submit Another Ticket</span>
            </Link>
          </div>
        </div>

        {/* Humorous Footer Quote */}
        <div className="mt-8 text-center">
          <p className="text-xs font-mono font-bold text-zinc-500 dark:text-zinc-400 uppercase tracking-widest">
            &ldquo;99% of reported bugs are actually just people trying to escape their own deadlines.&rdquo;
          </p>
          <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500 block mt-1">
            — Chief Excuses Officer, Oath Beta
          </span>
        </div>
      </main>
    </div>
  );
}
