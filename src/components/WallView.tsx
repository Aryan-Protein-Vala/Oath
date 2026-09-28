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

interface WallViewProps {
  entries: WallEntry[];
  type: "shame" | "honor";
}

export default function WallView({ entries, type }: WallViewProps) {
  const isShame = type === "shame";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div
        className={`px-6 py-5 border-b ${
          isShame ? "border-red-900/30" : "border-zinc-800/60"
        }`}
      >
        <div className="flex items-center gap-3 mb-1">
          {isShame ? (
            <Skull className="w-5 h-5 text-red-600" />
          ) : (
            <Trophy className="w-5 h-5 text-zinc-400" />
          )}
          <h2
            className={`text-xl font-black tracking-tight ${
              isShame ? "text-red-500" : "text-zinc-100"
            }`}
          >
            {isShame ? "WALL OF SHAME" : "WALL OF HONOR"}
          </h2>
        </div>
        <p className="text-[11px] text-zinc-600 font-mono tracking-wide">
          {isShame
            ? "The cowards who folded. Their excuses are public record."
            : "Those who kept their word. Proven under pressure."}
        </p>
      </div>

      {/* Feed */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="space-y-0">
          {entries.map((entry, index) => (
            <WallEntryCard key={entry.id} entry={entry} isShame={isShame} index={index} />
          ))}
        </div>

        {/* Bottom Sentinel */}
        <div className="py-8 text-center">
          <span className="text-[10px] font-mono text-zinc-700 tracking-widest uppercase">
            {isShame ? "— End of disgrace —" : "— End of record —"}
          </span>
        </div>
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

  return (
    <div
      className={`fade-in border-b ${
        isShame ? "border-red-950/40" : "border-zinc-800/40"
      } py-4 group`}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className={`text-[10px] font-mono font-bold ${
                isShame ? "text-red-600/80" : "text-zinc-500"
              }`}
            >
              @{entry.username}
            </span>
            <span className="text-zinc-800">·</span>
            <span className="text-[10px] font-mono text-zinc-700">
              {formatRelativeTime(entry.created_at)}
            </span>
          </div>

          <p
            className={`text-sm font-semibold tracking-tight leading-snug ${
              isShame ? "text-red-300/90" : "text-zinc-200"
            }`}
          >
            &ldquo;{entry.oath_statement}&rdquo;
          </p>

          {/* Excuse (Shame only) */}
          {isShame && entry.excuse && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1.5 mt-2 group/excuse"
            >
              <AlertTriangle className="w-3 h-3 text-red-700" />
              <span className="text-[10px] font-mono text-red-700 group-hover/excuse:text-red-500 transition-colors">
                {expanded ? "Hide excuse" : "View pathetic excuse"}
              </span>
              {expanded ? (
                <ChevronUp className="w-3 h-3 text-red-800" />
              ) : (
                <ChevronDown className="w-3 h-3 text-red-800" />
              )}
            </button>
          )}

          {expanded && entry.excuse && (
            <div className="mt-2 pl-4 border-l-2 border-red-900/40">
              <p className="text-xs text-red-400/70 italic leading-relaxed">
                &ldquo;{entry.excuse}&rdquo;
              </p>
            </div>
          )}
        </div>

        {/* Right — stake amount */}
        <div className="flex flex-col items-end shrink-0">
          <div className="flex items-center gap-1">
            {isShame ? (
              <Ban className="w-3 h-3 text-red-700" />
            ) : (
              <DollarSign className="w-3 h-3 text-zinc-600" />
            )}
            <span
              className={`text-lg font-black stake-number tracking-tight ${
                isShame ? "text-red-500" : "text-zinc-200"
              }`}
            >
              {isShame ? "-" : "+"}
              {formatCurrency(entry.stake_amount)}
            </span>
          </div>
          <span
            className={`text-[9px] font-mono mt-0.5 ${
              isShame ? "text-red-800" : "text-zinc-700"
            }`}
          >
            {isShame ? "LOST" : "EARNED"}
          </span>
        </div>
      </div>
    </div>
  );
}
