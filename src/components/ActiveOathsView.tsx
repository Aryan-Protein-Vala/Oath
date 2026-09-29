"use client";

import { useState, useEffect } from "react";
import { ChevronRight, User, Users, Upload, Eye, XCircle, Shield, AlertTriangle, X } from "lucide-react";
import type { Oath } from "@/lib/types";
import { getTimeRemaining, padZero, formatCurrency as utilsFormatCurrency, formatRelativeTime } from "@/lib/utils";
import { useRegion } from "@/lib/region-context";
import ProofUploadModal from "./ProofUploadModal";
import { forfeitOath } from "@/lib/data-hooks";
import { showToast } from "./Toast";

interface ActiveOathsViewProps {
  oaths: Oath[];
  onProofSubmitted?: () => void;
}

export default function ActiveOathsView({ oaths, onProofSubmitted }: ActiveOathsViewProps) {
  const [selectedOathId, setSelectedOathId] = useState<string | null>(
    oaths.length > 0 ? oaths[0].id : null
  );
  const [showProofModal, setShowProofModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showForfeitModal, setShowForfeitModal] = useState(false);

  // Selected oath lookup
  const selectedOath = oaths.find((o) => o.id === selectedOathId) || oaths[0] || null;

  if (oaths.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="text-6xl sm:text-8xl font-black text-zinc-300 dark:text-zinc-800 tracking-tighter leading-none mb-3">
            NO<br />OATHS
          </div>
          <p className="text-sm font-bold text-zinc-800 dark:text-zinc-400 font-mono tracking-wide">
            You have nothing at stake.
          </p>
          <p className="text-sm text-zinc-500 font-mono mt-1">
            That&apos;s the problem.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden" suppressHydrationWarning>
      {/* Sidebar */}
      <div className="w-72 border-r-2 border-zinc-950 dark:border-zinc-800/60 flex flex-col overflow-y-auto shrink-0 bg-white dark:bg-transparent">
        <div className="px-4 py-3 border-b-2 border-zinc-950 dark:border-zinc-800/40 bg-zinc-100 dark:bg-zinc-900/50">
          <span className="text-[10px] font-mono font-bold text-zinc-700 dark:text-zinc-400 uppercase tracking-widest">
            Active Oaths ({oaths.length})
          </span>
        </div>
        {oaths.map((oath) => (
          <OathListItem
            key={oath.id}
            oath={oath}
            isSelected={selectedOath?.id === oath.id}
            onClick={() => setSelectedOathId(oath.id)}
          />
        ))}
      </div>

      {/* Main Countdown */}
      {selectedOath && (
        <>
          <OathCountdownCard
            oath={selectedOath}
            onSubmitProof={() => setShowProofModal(true)}
            onViewDetails={() => setShowDetailsModal(true)}
            onForfeit={() => setShowForfeitModal(true)}
          />

          {showProofModal && (
            <ProofUploadModal
              oath={selectedOath}
              onClose={() => setShowProofModal(false)}
              onSuccess={() => { setShowProofModal(false); onProofSubmitted?.(); }}
            />
          )}

          {showDetailsModal && (
            <OathDetailsModal
              oath={selectedOath}
              onClose={() => setShowDetailsModal(false)}
            />
          )}

          {showForfeitModal && (
            <ForfeitModal
              oath={selectedOath}
              onClose={() => setShowForfeitModal(false)}
              onForfeited={() => {
                setShowForfeitModal(false);
                onProofSubmitted?.();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}

function OathListItem({ oath, isSelected, onClick }: { oath: Oath; isSelected: boolean; onClick: () => void }) {
  const { region } = useRegion();
  const time = getTimeRemaining(oath.deadline);
  const typeIcon =
    oath.oath_type === "solo" ? <User className="w-3 h-3" /> : <Users className="w-3 h-3" />;

  return (
    <button
      onClick={onClick}
      suppressHydrationWarning
      className={`w-full text-left px-4 py-3.5 border-b-2 border-zinc-200 dark:border-zinc-800/30 transition-all ${
        isSelected
          ? "bg-zinc-200 dark:bg-zinc-900/80 shadow-[inset_4px_0_0_0_rgba(220,38,38,1)]"
          : "hover:bg-zinc-100 dark:hover:bg-zinc-900/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate leading-tight">
            {oath.oath_statement}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-zinc-500">{typeIcon}</span>
            <span className="text-[10px] font-mono text-zinc-600 dark:text-zinc-400 uppercase font-semibold">{oath.oath_type}</span>
            <span className="text-zinc-400">·</span>
            <span className="text-[10px] font-mono font-black text-zinc-800 dark:text-zinc-300 stake-number">
              {utilsFormatCurrency(oath.stake_amount, region)}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end shrink-0">
          <span className={`text-[10px] font-mono font-black stake-number ${time.isUrgent ? "text-red-600 dark:text-red-500" : "text-zinc-600 dark:text-zinc-400"}`}>
            {time.isExpired ? "DONE" : time.days > 0 ? `${time.days}d` : `${time.hours}h`}
          </span>
          <ChevronRight className={`w-3 h-3 mt-1 ${isSelected ? "text-zinc-800 dark:text-zinc-300" : "text-zinc-400 dark:text-zinc-600"}`} />
        </div>
      </div>
    </button>
  );
}

function OathCountdownCard({
  oath,
  onSubmitProof,
  onViewDetails,
  onForfeit,
}: {
  oath: Oath;
  onSubmitProof: () => void;
  onViewDetails: () => void;
  onForfeit: () => void;
}) {
  const { region } = useRegion();
  const [now, setNow] = useState(() => Date.now());
  const [timeState, setTimeState] = useState(() => getTimeRemaining(oath.deadline));

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
      setTimeState(getTimeRemaining(oath.deadline));
    }, 1000);
    return () => clearInterval(interval);
  }, [oath.deadline]);

  const progressTotal = new Date(oath.deadline).getTime() - new Date(oath.created_at).getTime();
  const progressElapsed = now - new Date(oath.created_at).getTime();
  const progressPercent = Math.min(100, Math.max(0, (progressElapsed / (progressTotal || 1)) * 100));

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 relative overflow-hidden bg-zinc-50 dark:bg-transparent" suppressHydrationWarning>
      {/* Crimson glow when urgent */}
      {timeState.isUrgent && (
        <div className="absolute inset-0 pointer-events-none crimson-glow" />
      )}

      {/* Status badges */}
      <div className="absolute top-5 right-5 flex items-center gap-2">
        <span className={`text-[9px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 border ${
          oath.status === "active" ? "border-zinc-400 dark:border-zinc-700 text-zinc-700 dark:text-zinc-400" : "border-red-600 text-red-600"
        }`}>
          {oath.status}
        </span>
        <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-500 px-2.5 py-1 border border-zinc-300 dark:border-zinc-800">
          {oath.verification_method.replace(/_/g, " ")}
        </span>
      </div>

      {/* Oath text */}
      <div className="text-center mb-8 max-w-xl">
        <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-500 uppercase tracking-[0.2em] font-bold mb-3">I swore to</p>
        <h1 className="text-2xl sm:text-3xl font-black text-zinc-950 dark:text-zinc-50 tracking-tight leading-tight">
          {oath.oath_statement}
        </h1>
        {oath.opponent && (
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-2 font-mono font-bold">vs @{oath.opponent.username}</p>
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
        <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-500 uppercase tracking-[0.2em] font-bold mb-1">At stake</p>
        <p className="text-4xl sm:text-5xl font-black text-zinc-950 dark:text-zinc-50 stake-number tracking-tight">
          {formatCurrency(oath.stake_amount)}
        </p>
        <p className="text-[10px] font-mono text-zinc-600 dark:text-zinc-500 mt-1">
          {oath.house_cut_percent}% house cut on failure
        </p>
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-md mb-6">
        <div className="progress-bar h-[3px] w-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className={`h-full ${timeState.isUrgent ? "progress-fill-danger" : "progress-fill bg-zinc-900 dark:bg-zinc-100"}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[9px] font-mono text-zinc-600 dark:text-zinc-500">
            Started {formatRelativeTime(oath.created_at)}
          </span>
          <span className="text-[9px] font-mono text-zinc-600 dark:text-zinc-500">
            {Math.round(progressPercent)}% elapsed
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2.5">
        <button
          onClick={onSubmitProof}
          className="flex items-center gap-2 px-5 py-2.5 bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 text-sm font-black tracking-tight uppercase hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors border-2 border-zinc-950 dark:border-transparent shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
        >
          <Upload className="w-3.5 h-3.5" />
          Submit Proof
        </button>
        <button
          onClick={onViewDetails}
          className="flex items-center gap-2 px-5 py-2.5 border-2 border-zinc-950 dark:border-zinc-700 text-zinc-900 dark:text-zinc-300 text-sm font-bold tracking-tight hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
        >
          <Eye className="w-3.5 h-3.5" />
          Details
        </button>
        <button
          onClick={onForfeit}
          className="flex items-center gap-2 px-4 py-2.5 border-2 border-red-600 text-red-600 text-xs font-black uppercase tracking-tight hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors shadow-[2px_2px_0px_0px_rgba(220,38,38,1)] dark:shadow-none"
        >
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
      <span className={`font-black timer-display ${large ? "text-6xl sm:text-7xl" : "text-5xl sm:text-6xl"} ${urgent ? "text-red-600 dark:text-red-500" : "text-zinc-950 dark:text-zinc-50"}`}>
        {padZero(value)}
      </span>
      <span className={`text-[8px] font-mono tracking-[0.3em] mt-1 font-bold ${urgent ? "text-red-600" : "text-zinc-500 dark:text-zinc-500"}`}>
        {label}
      </span>
    </div>
  );
}

function Sep({ urgent, large }: { urgent?: boolean; large?: boolean }) {
  return (
    <span className={`${large ? "text-5xl sm:text-6xl" : "text-4xl sm:text-5xl"} font-black mb-6 ${urgent ? "text-red-600 urgent-pulse" : "text-zinc-400 dark:text-zinc-700"}`}>
      :
    </span>
  );
}

function OathDetailsModal({ oath, onClose }: { oath: Oath; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 p-6 fade-in shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
        <div className="flex items-center justify-between border-b-2 border-zinc-950 dark:border-zinc-800 pb-4 mb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-600" />
            <h3 className="text-base font-black text-zinc-950 dark:text-zinc-50 uppercase tracking-tight">Oath Details</h3>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 text-left">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 font-bold block mb-1">Statement</span>
            <p className="text-lg font-black text-zinc-900 dark:text-zinc-100 leading-snug">&ldquo;{oath.oath_statement}&rdquo;</p>
          </div>

          <div className="grid grid-cols-2 gap-3 border-y-2 border-zinc-200 dark:border-zinc-800 py-3">
            <div>
              <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block">Type</span>
              <span className="text-sm font-mono font-black text-zinc-900 dark:text-zinc-200 uppercase">{oath.oath_type}</span>
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block">Consequence</span>
              <span className="text-sm font-mono font-black text-zinc-900 dark:text-zinc-200 uppercase">{oath.consequence_type.replace(/_/g, " ")}</span>
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block">Stake Locked</span>
              <span className="text-sm font-mono font-black text-zinc-900 dark:text-zinc-200">{formatCurrency(oath.stake_amount)}</span>
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block">House Cut</span>
              <span className="text-sm font-mono font-black text-zinc-900 dark:text-zinc-200">{oath.house_cut_percent}% ({formatCurrency(oath.stake_amount * 0.1)})</span>
            </div>
          </div>

          {oath.social_ransom_phone && (
            <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-300 dark:border-red-900 text-xs font-mono text-red-700 dark:text-red-400">
              <span className="font-bold">Social Ransom Target:</span> {oath.social_ransom_phone}
              {oath.social_ransom_message && <p className="mt-1 italic">&ldquo;{oath.social_ransom_message}&rdquo;</p>}
            </div>
          )}

          {oath.nominee_email && (
            <div className="p-3 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 text-xs font-mono">
              <span className="font-bold text-zinc-700 dark:text-zinc-300">Nominee Referee:</span> {oath.nominee_email}
            </div>
          )}

          <div className="text-[11px] font-mono text-zinc-500">
            Deadline: {new Date(oath.deadline).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-6 py-3 bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 text-xs font-black uppercase tracking-wider hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function ForfeitModal({ oath, onClose, onForfeited }: { oath: Oath; onClose: () => void; onForfeited: () => void }) {
  const { region } = useRegion();
  const [excuse, setExcuse] = useState("");
  const [loading, setLoading] = useState(false);

  const handleForfeit = async () => {
    setLoading(true);
    const { error } = await forfeitOath(oath.id, excuse.trim() || undefined);
    setLoading(false);
    if (error) {
      showToast(error, "error");
    } else {
      showToast("Oath forfeited. Stake forfeited to penalty escrow.", "error", 6000);
      onForfeited();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#0a0a0f] border-4 border-red-600 p-6 fade-in shadow-[12px_12px_0px_0px_rgba(220,38,38,1)] dark:shadow-none text-left">
        <div className="flex items-center gap-2 mb-3 text-red-600">
          <AlertTriangle className="w-6 h-6" />
          <h3 className="text-lg font-black uppercase tracking-tight">Forfeit Oath</h3>
        </div>

        <p className="text-sm font-bold text-zinc-800 dark:text-zinc-300 mb-2">
          Are you conceding defeat?
        </p>
        <p className="text-xs font-mono text-zinc-600 dark:text-zinc-400 mb-4 leading-relaxed">
          Forfeiting immediately terminates this oath. Your locked stake of{" "}
          <strong className="text-red-600 dark:text-red-500 font-bold">{utilsFormatCurrency(oath.stake_amount, region)}</strong> will be permanently forfeited, and your excuse will be posted to the Wall of Shame.
        </p>

        <div className="mb-4">
          <label className="text-[10px] font-mono uppercase font-bold text-zinc-600 dark:text-zinc-400 block mb-1.5">
            What is your excuse?
          </label>
          <textarea
            value={excuse}
            onChange={(e) => setExcuse(e.target.value)}
            placeholder="I gave up because..."
            className="w-full px-3 py-2 text-sm border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950/50 resize-none font-medium"
            rows={2}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleForfeit}
            disabled={loading}
            className="flex-1 py-3 bg-red-600 text-white font-black text-xs uppercase tracking-wider hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {loading ? "Processing..." : `Forfeit ${utilsFormatCurrency(oath.stake_amount, region)}`}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-3 border-2 border-zinc-950 dark:border-zinc-700 font-mono text-xs font-bold uppercase hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
