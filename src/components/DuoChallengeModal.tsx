"use client";

import { useState } from "react";
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
import { createDuoChallenge } from "@/lib/data-hooks";
import { formatCurrency } from "@/lib/utils";
import { showToast } from "./Toast";
import type { Wallet } from "@/lib/types";

interface DuoChallengeModalProps {
  wallet: Wallet;
  onClose: () => void;
  onSuccess: () => void;
}

export default function DuoChallengeModal({ wallet, onClose, onSuccess }: DuoChallengeModalProps) {
  const [step, setStep] = useState<"setup" | "invite" | "done">("setup");
  const [statement, setStatement] = useState("");
  const [deadline, setDeadline] = useState("");
  const [stake, setStake] = useState("");
  const [opponentUsername, setOpponentUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [oathId, setOathId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const stakeNum = parseFloat(stake) || 0;
  const isOverBudget = stakeNum > wallet.balance;
  const inviteLink = oathId ? `${typeof window !== "undefined" ? window.location.origin : ""}/challenge/${oathId}` : "";

  const handleCreate = async () => {
    if (!statement.trim() || stakeNum <= 0 || !deadline) {
      showToast("Fill in all fields first.", "error");
      return;
    }
    if (isOverBudget) {
      showToast("Insufficient funds.", "error");
      return;
    }

    setLoading(true);
    const { oath, error } = await createDuoChallenge({
      oath_statement: statement,
      deadline: new Date(deadline).toISOString(),
      stake_amount: stakeNum,
      opponent_username: opponentUsername.trim() || undefined,
    });

    if (error || !oath) {
      showToast(error ?? "Failed to create challenge.", "error");
      setLoading(false);
      return;
    }

    setOathId(oath.id);
    setStep("invite");
    setLoading(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 shadow-[10px_10px_0px_0px_rgba(9,9,11,1)] dark:shadow-none fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Swords className="w-5 h-5 text-red-500" />
            <h3 className="text-sm font-black text-zinc-950 dark:text-zinc-100 tracking-tight">DUO CHALLENGE</h3>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Step: Setup */}
        {step === "setup" && (
          <div className="p-5 space-y-4">
            {/* Oath Statement */}
            <div>
              <label className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 uppercase tracking-[0.15em] mb-1.5 block font-bold">
                The Shared Oath
              </label>
              <textarea
                value={statement}
                onChange={(e) => setStatement(e.target.value)}
                placeholder="Both of you swear to..."
                className="w-full px-3.5 py-3 text-sm border-2 border-zinc-900 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 focus:border-zinc-950 dark:focus:border-zinc-400 resize-none transition-colors outline-none"
                rows={2}
              />
            </div>

            {/* Opponent (optional) */}
            <div>
              <label className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 uppercase tracking-[0.15em] mb-1.5 block font-bold">
                Opponent username (optional)
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
                Leave empty to send an invite link instead.
              </p>
            </div>

            {/* Stake + Deadline */}
            <div className="grid grid-cols-2 gap-3">
              <div className="border-2 border-zinc-900 dark:border-zinc-800 p-3 bg-zinc-50 dark:bg-zinc-950/50">
                <label className="text-[9px] font-mono text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-1.5 block font-bold">
                  Each wagers
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-500 dark:text-zinc-400 font-black text-lg">$</span>
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
              </div>
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

            {/* How it works */}
            <div className="border-2 border-zinc-200 dark:border-zinc-800/80 p-3 bg-zinc-50 dark:bg-zinc-950/30 space-y-1.5">
              <p className="text-[9px] font-mono text-zinc-500 dark:text-zinc-400 uppercase tracking-widest mb-2 font-bold">
                How Duo Works
              </p>
              <Rule icon={<UserCheck className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-300" />} text="Both players lock equal stakes in escrow" />
              <Rule icon={<Users className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-300" />} text="At deadline, the opponent verifies your proof" />
              <Rule icon={<DollarSign className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-300" />} text="Winner takes both stakes minus 10% house cut" />
            </div>

            {/* Preview */}
            {statement && stakeNum > 0 && (
              <div className="border-2 border-zinc-900 dark:border-zinc-800 p-3 bg-zinc-100 dark:bg-zinc-950/80 fade-in">
                <p className="text-[9px] font-mono text-zinc-600 dark:text-zinc-400 uppercase tracking-widest mb-1.5 font-bold">Preview</p>
                <p className="text-xs text-zinc-700 dark:text-zinc-300 leading-relaxed font-mono">
                  Both players stake{" "}
                  <span className="font-bold text-zinc-950 dark:text-zinc-100">{formatCurrency(stakeNum)}</span>.
                  Winner gets{" "}
                  <span className="font-bold text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(stakeNum * 2 * 0.9)}
                  </span>{" "}
                  (10% house cut).
                </p>
              </div>
            )}

            <button
              onClick={handleCreate}
              disabled={!statement || stakeNum <= 0 || isOverBudget || loading}
              className={`w-full flex items-center justify-center gap-2 py-3 text-sm font-black uppercase transition-all shadow-[4px_4px_0px_0px_rgba(9,9,11,1)] dark:shadow-none ${
                !statement || stakeNum <= 0 || isOverBudget || loading
                  ? "bg-zinc-200 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-600 cursor-not-allowed shadow-none"
                  : "bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
              }`}
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {loading ? "Creating..." : "Create Challenge"}
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
                Share this link with your opponent. They must accept + lock their stake for it to begin.
              </p>
            </div>

            <div className="border-2 border-zinc-900 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 p-3 flex items-center gap-3">
              <p className="flex-1 text-[11px] font-mono text-zinc-800 dark:text-zinc-300 truncate">{inviteLink}</p>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 border-2 border-zinc-900 dark:border-zinc-700 text-xs font-mono font-bold text-zinc-950 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <div className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 space-y-1">
              <p>→ Your stake is locked once you share this link.</p>
              <p>→ Challenge expires if not accepted within 48 hours.</p>
              <p>→ Peer verification required at deadline.</p>
            </div>

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
