"use client";

import { useState, useEffect } from "react";
import { ChevronRight, User, Users, Upload, Eye, XCircle } from "lucide-react";
import type { Oath } from "@/lib/types";
import { getTimeRemaining, padZero, formatCurrency, formatRelativeTime } from "@/lib/utils";
import ProofUploadModal from "./ProofUploadModal";

interface ActiveOathsViewProps {
  oaths: Oath[];
  onProofSubmitted?: () => void;
}

export default function ActiveOathsView({ oaths, onProofSubmitted }: ActiveOathsViewProps) {
  const [selectedOath, setSelectedOath] = useState<Oath | null>(
    oaths.length > 0 ? oaths[0] : null
  );
  const [showProofModal, setShowProofModal] = useState(false);

  // Keep selectedOath in sync if oaths list refreshes
  useEffect(() => {
    if (selectedOath) {
      const updated = oaths.find((o) => o.id === selectedOath.id);
      if (updated) setSelectedOath(updated);
    } else if (oaths.length > 0) {
      setSelectedOath(oaths[0]);
    }
  }, [oaths, selectedOath]);

  if (oaths.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-6xl font-black text-zinc-300 dark:text-zinc-800 tracking-tighter leading-none mb-3">
            NO<br />OATHS
          </div>
          <p className="text-sm text-zinc-600 font-mono tracking-wide">
            You have nothing at stake.
          </p>
          <p className="text-sm text-zinc-700 font-mono">
            That&apos;s the problem.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar */}
      <div className="w-72 border-r-2 border-zinc-950 dark:border-zinc-800/60 flex flex-col overflow-y-auto shrink-0 bg-zinc-50 dark:bg-transparent">
        <div className="px-4 py-3 border-b-2 border-zinc-950 dark:border-zinc-800/40 bg-zinc-100 dark:bg-transparent">
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

      {/* Main Countdown */}
      {selectedOath && (
        <>
          <OathCountdownCard
            oath={selectedOath}
            onSubmitProof={() => setShowProofModal(true)}
          />
          {showProofModal && (
            <ProofUploadModal
              oath={selectedOath}
              onClose={() => setShowProofModal(false)}
              onSuccess={() => { setShowProofModal(false); onProofSubmitted?.(); }}
            />
          )}
        </>
      )}
    </div>
  );
}

function OathListItem({ oath, isSelected, onClick }: { oath: Oath; isSelected: boolean; onClick: () => void }) {
  const time = getTimeRemaining(oath.deadline);
  const typeIcon =
    oath.oath_type === "solo" ? <User className="w-3 h-3" /> : <Users className="w-3 h-3" />;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b-2 border-zinc-950 dark:border-zinc-800/30 transition-all ${
        isSelected ? "bg-zinc-200 dark:bg-zinc-900/80 shadow-[inset_4px_0_0_0_rgba(220,38,38,1)]" : "hover:bg-zinc-100 dark:hover:bg-zinc-900/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-zinc-200 truncate leading-tight">
            {oath.oath_statement}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-zinc-500">{typeIcon}</span>
            <span className="text-[10px] font-mono text-zinc-500 uppercase">{oath.oath_type}</span>
            <span className="text-zinc-700">·</span>
            <span className="text-[10px] font-mono font-bold text-zinc-400 stake-number">
              {formatCurrency(oath.stake_amount)}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end shrink-0">
          <span className={`text-[10px] font-mono font-bold stake-number ${time.isUrgent ? "text-red-500" : "text-zinc-400"}`}>
            {time.isExpired ? "DONE" : time.days > 0 ? `${time.days}d` : `${time.hours}h`}
          </span>
          <ChevronRight className={`w-3 h-3 mt-1 ${isSelected ? "text-zinc-400" : "text-zinc-700"}`} />
        </div>
      </div>
    </button>
  );
}

function OathCountdownCard({ oath, onSubmitProof }: { oath: Oath; onSubmitProof: () => void }) {
  const [timeState, setTimeState] = useState(getTimeRemaining(oath.deadline));

  useEffect(() => {
    const interval = setInterval(() => setTimeState(getTimeRemaining(oath.deadline)), 1000);
    return () => clearInterval(interval);
  }, [oath.deadline]);

  const progressTotal = new Date(oath.deadline).getTime() - new Date(oath.created_at).getTime();
  const progressElapsed = Date.now() - new Date(oath.created_at).getTime();
  const progressPercent = Math.min(100, Math.max(0, (progressElapsed / progressTotal) * 100));

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 relative overflow-hidden">
      {/* Crimson glow when urgent */}
      {timeState.isUrgent && (
        <div className="absolute inset-0 pointer-events-none crimson-glow" />
      )}

      {/* Status badges */}
      <div className="absolute top-5 right-5 flex items-center gap-2">
        <span className={`text-[9px] font-mono uppercase tracking-widest px-2.5 py-1 border ${
          oath.status === "active" ? "border-zinc-700 text-zinc-400" : "border-red-800 text-red-500"
        }`}>
          {oath.status}
        </span>
        <span className="text-[9px] font-mono uppercase tracking-widest text-zinc-600 px-2.5 py-1 border border-zinc-800">
          {oath.verification_method.replace(/_/g, " ")}
        </span>
      </div>

      {/* Oath text */}
      <div className="text-center mb-8 max-w-xl">
        <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-[0.2em] mb-3">I swore to</p>
        <h1 className="text-2xl sm:text-3xl font-black text-zinc-100 tracking-tight leading-tight">
          {oath.oath_statement}
        </h1>
        {oath.opponent && (
          <p className="text-xs text-zinc-500 mt-2 font-mono">vs @{oath.opponent.username}</p>
        )}
      </div>

      {/* Countdown */}
      <div className="mb-8">
        {timeState.isExpired ? (
          <p className="text-7xl sm:text-8xl font-black text-red-600 timer-display urgent-pulse tracking-tighter">
            EXPIRED
          </p>
        ) : (
          <div className="flex items-baseline gap-1 sm:gap-2">
            {timeState.days > 0 && (
              <>
                <TimeUnit value={timeState.days} label="DAYS" large />
                <Sep urgent={timeState.isUrgent} large />
              </>
            )}
            <TimeUnit value={timeState.hours} label="HRS" large={timeState.days === 0} urgent={timeState.isUrgent && timeState.days === 0} />
            <Sep urgent={timeState.isUrgent} large={timeState.days === 0} />
            <TimeUnit value={timeState.minutes} label="MIN" large={timeState.days === 0} urgent={timeState.isUrgent && timeState.days === 0} />
            <Sep urgent={timeState.isUrgent} large={timeState.days === 0} />
            <TimeUnit value={timeState.seconds} label="SEC" large={timeState.days === 0} urgent={timeState.isUrgent && timeState.days === 0} />
          </div>
        )}
      </div>

      {/* Stake */}
      <div className="text-center mb-6">
        <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-[0.2em] mb-1">At stake</p>
        <p className="text-4xl sm:text-5xl font-black text-zinc-100 stake-number tracking-tight">
          {formatCurrency(oath.stake_amount)}
        </p>
        <p className="text-[10px] font-mono text-zinc-600 mt-1">
          {oath.house_cut_percent}% house cut on failure
        </p>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-md mb-6">
        <div className="progress-bar h-[2px] w-full">
          <div
            className={`h-full ${timeState.isUrgent ? "progress-fill-danger" : "progress-fill"}`}
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

      {/* Actions */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={onSubmitProof}
          className="flex items-center gap-2 px-5 py-2.5 bg-zinc-50 text-zinc-950 text-sm font-bold tracking-tight hover:bg-zinc-200 transition-colors"
        >
          <Upload className="w-3.5 h-3.5" />
          Submit Proof
        </button>
        <button className="flex items-center gap-2 px-5 py-2.5 border border-zinc-700 text-zinc-300 text-sm font-medium tracking-tight hover:bg-zinc-900 transition-colors">
          <Eye className="w-3.5 h-3.5" />
          Details
        </button>
        <button className="flex items-center gap-2 px-4 py-2.5 border border-red-900/50 text-red-500 text-xs font-medium tracking-tight hover:bg-red-950/30 transition-colors">
          <XCircle className="w-3.5 h-3.5" />
          Forfeit
        </button>
      </div>
    </div>
  );
}

function TimeUnit({ value, label, large, urgent }: { value: number; label: string; large?: boolean; urgent?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className={`font-black timer-display ${large ? "text-6xl sm:text-7xl" : "text-5xl sm:text-6xl"} ${urgent ? "text-red-500" : "text-zinc-50"}`}>
        {padZero(value)}
      </span>
      <span className={`text-[8px] font-mono tracking-[0.3em] mt-1 ${urgent ? "text-red-600/60" : "text-zinc-600"}`}>
        {label}
      </span>
    </div>
  );
}

function Sep({ urgent, large }: { urgent?: boolean; large?: boolean }) {
  return (
    <span className={`${large ? "text-5xl sm:text-6xl" : "text-4xl sm:text-5xl"} font-black mb-6 ${urgent ? "text-red-800 urgent-pulse" : "text-zinc-700"}`}>
      :
    </span>
  );
}
