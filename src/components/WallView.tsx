"use client";

import { useState } from "react";
import {
  Skull,
  Trophy,
  DollarSign,
  Ban,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import type { WallEntry } from "@/lib/types";
import { useRegion } from "@/lib/region-context";

interface WallViewProps {
  entries: WallEntry[];
  type: "shame" | "honor";
}

export default function WallView({ entries, type }: WallViewProps) {
  const isShame = type === "shame";

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-zinc-50 dark:bg-transparent">
      {/* Header */}
      <div
        className={`px-4 sm:px-6 py-4 sm:py-5 border-b-2 ${
          isShame ? "border-red-600/30 bg-red-50/50 dark:bg-red-950/10" : "border-zinc-200 dark:border-zinc-800/60 bg-white dark:bg-transparent"
        }`}
      >
        <div className="flex items-center gap-3 mb-1">
          {isShame ? (
            <Skull className="w-5 h-5 text-red-600" />
          ) : (
            <Trophy className="w-5 h-5 text-zinc-700 dark:text-zinc-400" />
          )}
          <h2
            className={`text-xl font-black tracking-tight ${
              isShame ? "text-red-600 dark:text-red-500" : "text-zinc-950 dark:text-zinc-100"
            }`}
          >
            {isShame ? "WALL OF SHAME" : "WALL OF HONOR"}
          </h2>
        </div>
        <p className="text-[11px] text-zinc-600 dark:text-zinc-400 font-mono tracking-wide font-bold">
          {isShame
            ? "The cowards who folded. Their excuses are public record."
            : "Those who kept their word. Proven under pressure."}
        </p>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        <div className="space-y-0">
          {entries.map((entry, index) => (
            <WallEntryCard key={entry.id} entry={entry} isShame={isShame} index={index} />
          ))}

          {entries.length === 0 && (
            <div className="text-center py-12">
              <p className="text-xs font-mono font-bold text-zinc-500">No entries recorded yet</p>
            </div>
          )}
        </div>

        {/* Bottom Sentinel */}
        {entries.length > 0 && (
          <div className="py-8 text-center">
            <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-600 tracking-widest uppercase font-bold">
              {isShame ? "— End of disgrace —" : "— End of record —"}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function WallEntryCard({
  entry,
  isShame,
  index,
}: {
  entry: WallEntry;
  isShame: boolean;
  index: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const { region } = useRegion();

  return (
    <div
      className={`fade-in border-b-2 ${
        isShame ? "border-red-200 dark:border-red-950/40" : "border-zinc-200 dark:border-zinc-800/40"
      } py-4 group`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        {/* Left content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span
              className={`text-[10px] sm:text-[11px] font-mono font-black ${
                isShame ? "text-red-700 dark:text-red-400" : "text-zinc-700 dark:text-zinc-400"
              }`}
            >
              @{entry.username}
            </span>
            <span className="text-zinc-400">·</span>
            <span className="text-[10px] font-mono text-zinc-500">
              {formatRelativeTime(entry.created_at)}
            </span>
          </div>

          <p
            className={`text-sm font-bold tracking-tight leading-snug break-words ${
              isShame ? "text-red-900 dark:text-red-300" : "text-zinc-950 dark:text-zinc-200"
            }`}
          >
            &ldquo;{entry.oath_statement}&rdquo;
          </p>

          {/* Excuse (Shame only) */}
          {isShame && entry.excuse && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1.5 mt-2 py-1 px-2 border border-red-200 dark:border-red-900/50 bg-red-50/60 dark:bg-red-950/20 text-left min-h-[36px] group/excuse transition-colors"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
              <span className="text-[10px] font-mono font-bold text-red-700 dark:text-red-400 group-hover/excuse:underline">
                {expanded ? "Hide excuse" : "View excuse"}
              </span>
              {expanded ? (
                <ChevronUp className="w-3 h-3 text-red-700 shrink-0" />
              ) : (
                <ChevronDown className="w-3 h-3 text-red-700 shrink-0" />
              )}
            </button>
          )}

          {expanded && entry.excuse && (
            <div className="mt-2 pl-3 border-l-2 border-red-600/60 bg-red-50/50 dark:bg-red-950/20 p-2.5">
              <p className="text-xs text-red-800 dark:text-red-300 italic font-medium leading-relaxed break-words">
                &ldquo;{entry.excuse}&rdquo;
              </p>
            </div>
          )}
        </div>

        {/* Right — stake amount */}
        <div className="flex flex-col items-end shrink-0 pl-2">
          <div className="flex items-center gap-1">
            {isShame ? (
              <Ban className="w-3.5 h-3.5 text-red-600" />
            ) : (
              <DollarSign className="w-3.5 h-3.5 text-zinc-500" />
            )}
            <span
              className={`text-base sm:text-lg font-black stake-number tracking-tight ${
                isShame ? "text-red-600 dark:text-red-500" : "text-zinc-950 dark:text-zinc-200"
              }`}
            >
              {isShame ? "-" : "+"}
              {formatCurrency(entry.stake_amount, region)}
            </span>
          </div>
          <span
            className={`text-[8px] sm:text-[9px] font-mono font-bold mt-0.5 ${
              isShame ? "text-red-700 dark:text-red-400" : "text-zinc-500"
            }`}
          >
            {isShame ? "LOST" : "EARNED"}
          </span>
        </div>
      </div>
    </div>
  );
}
