"use client";

import { useState, useEffect } from "react";
import {
  X,
  Users,
  DollarSign,
  Zap,
  UserCheck,
  Swords,
  Loader2,
  CheckCircle,
  Copy,
  Check,
} from "lucide-react";
import { createDuoChallenge, cancelDuoChallenge } from "@/lib/data-hooks";
import { isDemoSession } from "@/lib/auth-context";
import { convertToUSD } from "@/lib/utils";
import { showToast } from "./Toast";
import type { Wallet } from "@/lib/types";
import { useRegion } from "@/lib/region-context";

interface DuoChallengeModalProps {
  wallet: Wallet;
  onClose: () => void;
  onSuccess: () => void;
  onCreateSharedAlternative?: () => void;
}

export default function DuoChallengeModal({ wallet, onClose, onSuccess, onCreateSharedAlternative }: DuoChallengeModalProps) {
  const [step, setStep] = useState<"setup" | "invite" | "done">("setup");
  const [statement, setStatement] = useState("");
  const [deadline, setDeadline] = useState("");
  const [stake, setStake] = useState("");
  const [consequence, setConsequence] = useState<"fiat" | "mutual_destruction">("fiat");
  const [opponentUsername, setOpponentUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [oathId, setOathId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { region, formatCurrency: formatRegionCurrency } = useRegion();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const stakeNum = parseFloat(stake) || 0;
  const stakeUsd = Math.round(convertToUSD(stakeNum, region) * 100) / 100;
  const isFinancial = consequence === "fiat";
  const individualStake = isFinancial ? stakeUsd : 0;
  const isOverBudget = individualStake > wallet.balance;
  const inviteLink = oathId ? `${typeof window !== "undefined" ? window.location.origin : ""}/challenge/${oathId}` : "";

  const handleCreate = async () => {
    if (!statement.trim() || statement.trim().length > 500 || (isFinancial && (stakeNum <= 0 || individualStake <= 0)) || !deadline) {
      showToast(isFinancial ? "Add a statement, positive virtual stake, and deadline." : "Add a statement and deadline.", "error");
      return;
    }
    const deadlineDate = new Date(deadline);
    if (!deadline.includes("T")) deadlineDate.setHours(23, 59, 59, 999);
    if (!Number.isFinite(deadlineDate.getTime()) || deadlineDate.getTime() <= Date.now()) {
      showToast("Deadline must be in the future.", "error");
      return;
    }
    if (isOverBudget) {
      showToast("Insufficient virtual balance.", "error");
      return;
    }

    setLoading(true);
    try {
      const { oath, error } = await createDuoChallenge({
        oath_statement: statement,
        deadline: deadlineDate.toISOString(),
        stake_amount: individualStake,
        consequence_type: consequence,
        opponent_username: opponentUsername.trim() || undefined,
      });

      if (error || !oath) {
        showToast(error ?? "Failed to create challenge.", "error");
        return;
      }

      setOathId(oath.id);
      setStep("invite");
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Could not create challenge. Check your connection and try again.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast("Could not access clipboard. Copy the invitation link manually.", "error");
    }
  };

  const handleCancel = async () => {
    if (!oathId) return;
    setLoading(true);
    try {
      const { error } = await cancelDuoChallenge(oathId);
      if (error) {
        showToast(error, "error");
        return;
      }
      showToast(stakeUsd > 0 ? "Invitation cancelled; your own virtual stake was returned." : "Invitation cancelled. No monetary stake was used.", "success");
      onSuccess();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Unable to cancel invitation.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="duo-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 shadow-[10px_10px_0px_0px_rgba(9,9,11,1)] dark:shadow-none fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Swords className="w-5 h-5 text-red-500" />
            <h3 id="duo-modal-title" className="text-sm font-black text-zinc-950 dark:text-zinc-100 tracking-tight">DUO CHALLENGE</h3>
          </div>
          <button onClick={onClose} aria-label="Close modal" className="text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step: Setup */}
        {step === "setup" && (
          <div className="p-5 space-y-4">
            {isDemoSession() && <div className="border-2 border-amber-600/60 bg-amber-50 dark:bg-amber-950/20 p-3 text-[10px] font-mono text-amber-950 dark:text-amber-200">DEMO ONLY: this invite and ledger exist in this browser only. Another person/device cannot see or accept it. No money or message is sent.</div>}
            {/* Oath Statement */}
            <div>
              <label className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 uppercase tracking-[0.15em] mb-1.5 block font-bold">
                Challenge Statement
              </label>
              <textarea
                maxLength={500}
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                placeholder="One goal you will both work on, e.g. go to the gym 3 times this week..."
                className="w-full px-3.5 py-3 text-sm border-2 border-zinc-900 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:border-zinc-950 dark:focus:border-zinc-400 resize-none transition-colors outline-none"
                rows={2}
              />
            </div>

            {/* Opponent (optional) */}
            <div>
              <label className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 uppercase tracking-[0.15em] mb-1.5 block font-bold">
                Invite a participant by username (optional)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-zinc-500 dark:text-zinc-400 font-mono text-sm font-bold">@</span>
                <input
                  type="text"
                  value={opponentUsername}
                  onChange={(e) => setOpponentUsername(e.target.value)}
                  placeholder="their_username"
                  className="flex-1 px-3 py-2.5 text-sm border-2 border-zinc-900 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:border-zinc-950 dark:focus:border-zinc-400 transition-colors outline-none"
                />
              </div>
              <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-500 mt-1">
                Username invites are account-addressed; otherwise share the invite link. The invited person sees the same goal and must accept it before their own virtual stake is locked.
              </p>
            </div>

            {/* Shared consequence choice */}
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setConsequence("fiat")} className={`border-2 p-3 text-left ${isFinancial ? "border-zinc-950 bg-zinc-100 dark:border-zinc-300 dark:bg-zinc-900" : "border-zinc-300 dark:border-zinc-800"}`}>
                <span className="block text-xs font-black uppercase">Individual virtual stake</span><span className="mt-1 block text-[9px] font-mono text-zinc-500">Only your own virtual sandbox stake may be lost</span>
              </button>
              <button type="button" onClick={() => { setConsequence("mutual_destruction"); setStake(""); }} className={`border-2 p-3 text-left ${!isFinancial ? "border-emerald-700 bg-emerald-50 dark:border-emerald-500 dark:bg-emerald-950/20" : "border-zinc-300 dark:border-zinc-800"}`}>
                <span className="block text-xs font-black uppercase">No-money team promise</span><span className="mt-1 block text-[9px] font-mono text-zinc-500">Recovery check-in; no stake</span>
              </button>
            </div>

            {/* Stake + Deadline */}
            <div className={`grid grid-cols-1 ${isFinancial ? "grid-cols-2" : "grid-cols-1"} gap-3`}>
              {isFinancial && <div className="border-2 border-zinc-900 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/50">
                <label className="text-[9px] font-mono text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-1.5 block font-bold">
                  Each virtual stake
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-500 dark:text-zinc-400 font-black text-lg">{region === "in" ? "₹" : "$"}</span>
                  <input
                    type="number"
                    value={stake}
                    onChange={(e) => setStake(e.target.value)}
                    placeholder="0"
                    className="flex-1 text-2xl font-black text-zinc-950 dark:text-zinc-100 bg-transparent stake-number outline-none border-none"
                  />
                </div>
                {isOverBudget && (
                  <p className="text-[9px] font-mono text-red-500 font-bold mt-1">Over budget</p>
                )}
              </div>}
              <div className="border-2 border-zinc-900 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/50">
                <label className="text-[9px] font-mono text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-1.5 block font-bold">
                  Deadline
                </label>
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full text-sm bg-transparent text-zinc-900 dark:text-zinc-100 outline-none border-none"
                />
              </div>
            </div>

            {!isFinancial && <div className="border-2 border-emerald-700/50 bg-emerald-50/60 dark:bg-emerald-950/20 p-3">
              <p className="text-[10px] font-mono font-bold text-emerald-900 dark:text-emerald-300">A lightweight shared alternative</p>
              <p className="mt-1 text-[10px] font-mono text-zinc-600 dark:text-zinc-400">If one person misses the goal, OATH records that person&apos;s outcome. You can agree on a fresh shared goal; no chore, message, or payment is enforced by the app.</p>
              {onCreateSharedAlternative && <button type="button" onClick={onCreateSharedAlternative} className="mt-2 min-h-11 px-3 border-2 border-emerald-700 text-[10px] font-black uppercase text-emerald-900 dark:text-emerald-300">Need 4–8 people? Make it a Squad quest</button>}
            </div>}

            {/* How it works */}
            <div className="border-2 border-zinc-200 dark:border-zinc-800/80 p-3 bg-zinc-50 dark:bg-zinc-950/30 space-y-1.5">
              <p className="text-[9px] font-mono text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-2 font-bold">
                How Duo Works
              </p>
              <Rule icon={<UserCheck className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-300" />} text={isFinancial ? "The creator locks their own virtual stake now; the invitee locks theirs only after accepting" : "No virtual stake is locked for this shared promise"} />
              <Rule icon={<Users className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-300" />} text="You both work on the same goal, submit separate proof, and review each other" />
              <Rule icon={<DollarSign className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-300" />} text={isFinancial ? "Each successful person gets their own virtual stake back; no winner takes the other stake" : "This is a sandbox record only; no messages, payments, or donations happen"} />
            </div>

            {/* Preview */}
            {statement && isFinancial && stakeNum > 0 && (
              <div className="border-2 border-zinc-900 dark:border-zinc-800 p-3 bg-zinc-100 dark:bg-zinc-950/80 fade-in">
                <p className="text-[9px] font-mono text-zinc-600 dark:text-zinc-400 uppercase tracking-widest mb-1.5 font-bold">Preview</p>
                <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed font-mono">
                  Each person opts in only for their own virtual sandbox stake of{" "}
                  <span className="font-bold text-zinc-950 dark:text-zinc-100">{formatRegionCurrency(individualStake)}</span>.
                  If their proof is approved, they get their own stake back; no stake transfers to the other participant.
                </p>
              </div>
            )}

            <button
              onClick={handleCreate}
              disabled={!statement || (isFinancial && (stakeNum <= 0 || individualStake <= 0)) || isOverBudget || loading}
              className={`w-full flex items-center justify-center gap-2 py-3 text-sm font-black uppercase transition-all shadow-[4px_4px_0px_0px_rgba(9,9,11,1)] dark:shadow-none ${
                !statement || (isFinancial && (stakeNum <= 0 || individualStake <= 0)) || isOverBudget || loading
                  ? "bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600 cursor-not-allowed shadow-none"
                  : "bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
              }`}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {loading ? "Creating..." : isFinancial ? `Create & lock my ${formatRegionCurrency(individualStake)} virtual stake` : "Create no-stake shared goal"}
            </button>
          </div>
        )}

        {/* Step: Invite */}
        {step === "invite" && (
          <div className="p-5 space-y-4 fade-in">
            <div className="flex flex-col items-center text-center py-4">
              <CheckCircle className="w-10 h-10 text-emerald-500 mb-3" />
              <h3 className="text-base font-black text-zinc-950 dark:text-zinc-100">Challenge Created</h3>
              <p className="text-[11px] font-mono text-zinc-600 dark:text-zinc-400 mt-1">
                {isFinancial ? "Your own virtual stake is locked. The other person must explicitly accept before their own matching virtual stake is locked." : "No virtual stake was locked. Your invitee must accept before you can begin the shared goal."}
              </p>
            </div>

            {!isDemoSession() ? <div className="border-2 border-zinc-900 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 p-3 flex items-center gap-3">
              <p className="flex-1 text-[11px] font-mono text-zinc-800 dark:text-zinc-300 truncate">{inviteLink}</p>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 border-2 border-zinc-900 dark:border-zinc-700 text-xs font-mono font-bold text-zinc-950 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div> : <div className="border-2 border-amber-600/60 bg-amber-50 dark:bg-amber-950/20 p-3 text-[10px] font-mono text-amber-950 dark:text-amber-200">This link is a local demo record and cannot be opened by another account or device. Use authenticated shared mode to invite a friend.</div>}

            <div className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 space-y-1">
              <p>→ {isFinancial ? "Your own virtual stake was locked when the challenge was created." : "No monetary stake was used."}</p>
              <p>→ The invitee chooses whether to accept; their balance is untouched before acceptance.</p>
              <p>→ Each participant submits their own proof; the other participant reviews it.</p>
            </div>

            <button
              onClick={handleCancel}
              disabled={loading}
              className="w-full py-2.5 border-2 border-red-600 text-red-700 dark:text-red-400 text-xs font-black uppercase hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
            >
              {loading ? "Cancelling..." : isFinancial ? "Cancel invitation & return stake" : "Cancel invitation"}
            </button>
            <button
              onClick={() => { onSuccess(); onClose(); }}
              className="w-full py-3 bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 text-sm font-black uppercase shadow-[4px_4px_0px_0px_rgba(9,9,11,1)] dark:shadow-none transition-all"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Rule({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-zinc-600 dark:text-zinc-400">{icon}</span>
      <span className="text-[10px] font-mono text-zinc-600 dark:text-zinc-400">{text}</span>
    </div>
  );
}
