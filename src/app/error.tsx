"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log error to console for debugging
    console.error("App boundary caught an error:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 p-4 transition-colors duration-300">
      <div className="max-w-md w-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 sm:p-8 text-center shadow-xl">
        <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto mb-4 border border-red-200 dark:border-red-900/50">
          <AlertTriangle className="w-6 h-6" />
        </div>

        <h1 className="text-xl font-bold font-mono tracking-tight mb-2">
          Something went wrong
        </h1>

        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6 font-mono text-balance">
          {error.message || "An unexpected error occurred while loading this view."}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => reset()}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 font-mono text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
          <button
            onClick={() => {
              window.location.href = "/";
            }}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 font-mono text-xs font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <Home className="w-4 h-4" />
            Return Home
          </button>
        </div>

        {error.digest && (
          <p className="mt-6 text-[10px] font-mono text-zinc-400 dark:text-zinc-600">
            Digest: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
