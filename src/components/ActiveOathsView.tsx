"use client";

import { useState, useEffect } from "react";
import {
  Clock,
  Target,
  Users,
  User,
  AlertTriangle,
  Upload,
  CheckCircle,
  XCircle,
  ChevronRight,
  Eye,
} from "lucide-react";
import type { Oath } from "@/lib/types";
import { getTimeRemaining, padZero, formatCurrency, formatRelativeTime } from "@/lib/utils";

interface ActiveOathsViewProps {
  oaths: Oath[];
}

export default function ActiveOathsView({ oaths }: ActiveOathsViewProps) {
  const [selectedOath, setSelectedOath] = useState<Oath | null>(
    oaths.length > 0 ? oaths[0] : null
  );

  if (oaths.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl font-black text-zinc-800 tracking-tight mb-3">NO OATHS</div>
          <p className="text-sm text-zinc-600 tracking-wide">
            You have nothing at stake. That&apos;s the problem.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar — Oath List */}
      <div className="w-72 border-r border-zinc-800/60 flex flex-col overflow-y-auto">
        <div className="px-4 py-3 border-b border-zinc-800/40">
          <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
            Active Oaths ({oaths.length})
          </span>
        </div>
        {oaths.map((oath) => (
          <OathListItem
            key={oath.id}
            oath={oath}
            isSelected={selectedOath?.id === oath.id}
            onClick={() => setSelectedOath(oath)}
          />
        ))}
      </div>

      {/* Main — Countdown Card */}
      {selectedOath && <OathCountdownCard oath={selectedOath} />}
    </div>
  );
}

// ---- Sidebar Item ----
function OathListItem({
  oath,
  isSelected,
  onClick,
}: {
  oath: Oath;
  isSelected: boolean;
  onClick: () => void;
}) {
  const time = getTimeRemaining(oath.deadline);
  const typeIcon =
    oath.oath_type === "solo" ? (
      <User className="w-3 h-3" />
    ) : oath.oath_type === "duo" ? (
      <Users className="w-3 h-3" />
    ) : (
      <Users className="w-3 h-3" />
    );

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b border-zinc-800/30 transition-all card-hover ${
        isSelected ? "bg-zinc-900/80" : "hover:bg-zinc-900/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-200 truncate leading-tight">
            {oath.oath_statement}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-zinc-500">{typeIcon}</span>
            <span className="text-[10px] font-mono text-zinc-500 uppercase">
              {oath.oath_type}
            </span>
            <span className="text-zinc-700">·</span>
            <span className="text-[10px] font-mono font-bold text-zinc-400 stake-number">
              {formatCurrency(oath.stake_amount)}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end shrink-0">
          <span
            className={`text-[10px] font-mono font-bold stake-number ${
              time.isUrgent ? "text-red-500" : "text-zinc-400"
            }`}
          >
            {time.isExpired
              ? "EXPIRED"
              : time.days > 0
              ? `${time.days}d`
              : `${time.hours}h`}
          </span>
          <ChevronRight
            className={`w-3 h-3 mt-1 transition-colors ${
              isSelected ? "text-zinc-400" : "text-zinc-700"
            }`}
          />
        </div>
      </div>
    </button>
  );
}

// ---- Main Countdown Card ----
function OathCountdownCard({ oath }: { oath: Oath }) {
  const [timeState, setTimeState] = useState(getTimeRemaining(oath.deadline));

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeState(getTimeRemaining(oath.deadline));
    }, 1000);
    return () => clearInterval(interval);
  }, [oath.deadline]);

  const progressTotal =
    new Date(oath.deadline).getTime() - new Date(oath.created_at).getTime();
  const progressElapsed = Date.now() - new Date(oath.created_at).getTime();
  const progressPercent = Math.min(100, Math.max(0, (progressElapsed / progressTotal) * 100));

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 relative">
      {/* Status Badge */}
      <div className="absolute top-6 right-6 flex items-center gap-2">
        <span
          className={`text-[9px] font-mono uppercase tracking-widest px-2.5 py-1 border ${
            oath.status === "active"
              ? "border-zinc-700 text-zinc-400"
              : oath.status === "failed"
              ? "border-red-800 text-red-500"
              : "border-zinc-700 text-zinc-500"
          }`}
        >
          {oath.status}
        </span>
        <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 px-2.5 py-1 border border-zinc-800">
          {oath.verification_method.replace("_", " ")}
        </span>
      </div>

      {/* Oath Statement */}
      <div className="text-center mb-8 max-w-xl">
        <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-[0.2em] mb-3">
          I swore to
        </p>
        <h1 className="text-2xl sm:text-3xl font-black text-zinc-100 tracking-tight leading-tight">
          {oath.oath_statement}
        </h1>
        {oath.opponent && (
          <p className="text-xs text-zinc-500 mt-2 font-mono">
            vs @{oath.opponent.username}
          </p>
        )}
      </div>

      {/* MASSIVE COUNTDOWN */}
      <div className="mb-8">
        {timeState.isExpired ? (
          <div className="text-center">
            <p className="text-7xl sm:text-8xl font-black text-red-600 timer-display urgent-pulse tracking-tighter">
              EXPIRED
            </p>
          </div>
        ) : (
          <div className="flex items-baseline gap-1 sm:gap-2">
            {timeState.days > 0 && (
              <>
                <TimeUnit value={timeState.days} label="DAYS" large />
                <span className="text-4xl sm:text-5xl font-black text-zinc-700 mb-6">:</span>
              </>
            )}
            <TimeUnit value={timeState.hours} label="HRS" large={timeState.days === 0} />
            <span
              className={`${
                timeState.days === 0 ? "text-5xl sm:text-6xl" : "text-4xl sm:text-5xl"
              } font-black text-zinc-700 ${timeState.days === 0 ? "mb-7" : "mb-6"} ${
                timeState.isUrgent ? "urgent-pulse text-red-800" : ""
              }`}
            >
              :
            </span>
            <TimeUnit
              value={timeState.minutes}
              label="MIN"
              large={timeState.days === 0}
              urgent={timeState.isUrgent}
            />
            <span
              className={`${
                timeState.days === 0 ? "text-5xl sm:text-6xl" : "text-4xl sm:text-5xl"
              } font-black text-zinc-700 ${timeState.days === 0 ? "mb-7" : "mb-6"} ${
                timeState.isUrgent ? "urgent-pulse text-red-800" : ""
              }`}
            >
              :
            </span>
            <TimeUnit
              value={timeState.seconds}
              label="SEC"
              large={timeState.days === 0}
              urgent={timeState.isUrgent}
            />
          </div>
        )}
      </div>

      {/* Stake Amount */}
      <div className="text-center mb-6">
        <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-[0.2em] mb-1">
          At stake
        </p>
        <p className="text-4xl sm:text-5xl font-black text-zinc-100 stake-number tracking-tight">
          {formatCurrency(oath.stake_amount)}
        </p>
        <p className="text-[10px] font-mono text-zinc-600 mt-1">
          {oath.house_cut_percent}% house cut on failure
        </p>
      </div>

      {/* Progress Bar */}
      <div className="w-full max-w-md mb-6">
        <div className="progress-bar h-1 w-full">
          <div
            className={`h-full ${
              timeState.isUrgent ? "progress-fill-danger" : "progress-fill"
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[9px] font-mono text-zinc-600">
            Started {formatRelativeTime(oath.created_at)}
          </span>
          <span className="text-[9px] font-mono text-zinc-600">
            {Math.round(progressPercent)}% elapsed
          </span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3">
        <button className="flex items-center gap-2 px-5 py-2.5 bg-zinc-50 text-zinc-950 text-sm font-bold tracking-tight hover:bg-zinc-200 transition-colors">
          <Upload className="w-3.5 h-3.5" />
          Submit Proof
        </button>
        <button className="flex items-center gap-2 px-5 py-2.5 border border-zinc-700 text-zinc-300 text-sm font-medium tracking-tight hover:bg-zinc-900 transition-colors">
          <Eye className="w-3.5 h-3.5" />
          View Details
        </button>
        <button className="flex items-center gap-2 px-4 py-2.5 border border-red-900/50 text-red-500 text-xs font-medium tracking-tight hover:bg-red-950/30 transition-colors">
          <XCircle className="w-3.5 h-3.5" />
          Forfeit
        </button>
      </div>
    </div>
  );
}

// ---- Time Unit Block ----
function TimeUnit({
  value,
  label,
  large,
  urgent,
}: {
  value: number;
  label: string;
  large?: boolean;
  urgent?: boolean;
}) {
  return (
    <div className="flex flex-col items-center">
      <span
        className={`font-black timer-display ${
          large ? "text-6xl sm:text-7xl" : "text-5xl sm:text-6xl"
        } ${urgent ? "text-red-500" : "text-zinc-50"}`}
      >
        {padZero(value)}
      </span>
      <span
        className={`text-[8px] font-mono tracking-[0.3em] mt-1 ${
          urgent ? "text-red-600/60" : "text-zinc-600"
        }`}
      >
        {label}
      </span>
    </div>
  );
}
