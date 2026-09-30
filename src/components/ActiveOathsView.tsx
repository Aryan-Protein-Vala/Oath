"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { ChevronRight, User, Users, Upload, Eye, XCircle, Shield, AlertTriangle, X, CheckCircle, ThumbsUp, ThumbsDown, Loader2 } from "lucide-react";
import type { Oath } from "@/lib/types";
import { getTimeRemaining, padZero, formatCurrency as utilsFormatCurrency, formatRelativeTime } from "@/lib/utils";
import { useRegion } from "@/lib/region-context";
import ProofUploadModal from "./ProofUploadModal";
import { cancelDuoChallenge, forfeitOath, settleOath, castVote, acceptDuoChallenge, failSquadMember, getMyPrivateConsequenceDetails, useProofs } from "@/lib/data-hooks";
import { useAuth, isDemoSession } from "@/lib/auth-context";
import { showToast } from "./Toast";

interface ActiveOathsViewProps {
  oaths: Oath[];
  onProofSubmitted?: () => void;
  onCreateClick?: () => void;
}

export default function ActiveOathsView({ oaths, onProofSubmitted, onCreateClick }: ActiveOathsViewProps) {
  const { user } = useAuth();
  const [demoBanner, setDemoBanner] = useState(false);
  useEffect(() => { const frame = requestAnimationFrame(() => setDemoBanner(isDemoSession())); return () => cancelAnimationFrame(frame); }, []);
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
        <div className="text-center max-w-sm">
          <div className="text-6xl sm:text-8xl font-black text-zinc-300 dark:text-zinc-800 tracking-tighter leading-none mb-3">
            NO<br />OATHS
          </div>
          <p className="text-sm font-bold text-zinc-800 dark:text-zinc-400 font-mono tracking-wide">
            You have nothing at stake.
          </p>
          <p className="text-sm text-zinc-500 font-mono mt-1 mb-6">
            That&apos;s the problem.
          </p>
          {onCreateClick && (
            <button
              onClick={onCreateClick}
              className="px-6 py-3.5 bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 text-xs font-black uppercase tracking-wider hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all shadow-[4px_4px_0px_0px_rgba(9,9,11,1)] dark:shadow-none"
            >
              Swear Your First Oath
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`relative flex-1 min-h-0 flex flex-col sm:flex-row overflow-hidden ${demoBanner ? "pt-12" : ""}`} suppressHydrationWarning>
      {demoBanner && <div className="absolute z-20 top-2 left-2 right-2 border-2 border-amber-600 bg-amber-50 dark:bg-amber-950/90 px-3 py-2 text-[10px] font-mono font-bold text-amber-950 dark:text-amber-200">DEMO · local-only data; other accounts and devices cannot see these oaths.</div>}
      {/* Oath picker: horizontal and compact on phones, sidebar on larger screens. */}
      <div className="w-full max-h-32 sm:max-h-none sm:w-72 border-b-2 sm:border-b-0 sm:border-r-2 border-zinc-950 dark:border-zinc-800/60 flex flex-col overflow-hidden shrink-0 bg-white dark:bg-transparent">
        <div className="px-4 py-2 sm:py-3 border-b-2 border-zinc-950 dark:border-zinc-800/40 bg-zinc-100 dark:bg-zinc-900/50">
          <span className="text-[10px] font-mono font-bold text-zinc-700 dark:text-zinc-400 uppercase tracking-widest">
            Active Oaths ({oaths.length})
          </span>
        </div>
        <div className="flex flex-row sm:flex-col flex-1 min-h-0 overflow-x-auto sm:overflow-x-hidden overflow-y-hidden sm:overflow-y-auto">
          {oaths.map((oath) => (
            <OathListItem
              key={oath.id}
              oath={oath}
              isSelected={selectedOath?.id === oath.id}
              onClick={() => setSelectedOathId(oath.id)}
            />
          ))}
        </div>
      </div>

      {/* Main Countdown */}
      {selectedOath && (
        <div className="flex-1 min-h-0 flex flex-col overflow-y-auto">
          <OathCountdownCard
            oath={selectedOath}
            onSubmitProof={() => setShowProofModal(true)}
            onViewDetails={() => setShowDetailsModal(true)}
            onForfeit={() => setShowForfeitModal(true)}
            canCancelDuo={selectedOath.oath_type === "duo" && selectedOath.status === "pending" && selectedOath.creator_id === user?.id}
            canAcceptDuo={selectedOath.oath_type === "duo" && selectedOath.status === "pending" && selectedOath.opponent_id === user?.id}
            onAcceptDuo={async () => {
              const { error } = await acceptDuoChallenge(selectedOath.id);
              if (error) { showToast(error, "error"); return false; }
              showToast(selectedOath.consequence_type === "fiat" && selectedOath.stake_amount > 0 ? "Accepted. Your own virtual stake was locked after your confirmation." : "Accepted. No monetary stake was used.", "success");
              onProofSubmitted?.();
              return true;
            }}
            canForfeit={selectedOath.status === "active" && selectedOath.oath_type === "solo" && selectedOath.creator_id === user?.id}
            canFailDuo={selectedOath.status === "active" && selectedOath.oath_type === "duo" && Boolean(selectedOath.members?.some((member) => member.user_id === user?.id && member.status === "joined" && !member.proof_submitted))}
            onFailDuo={async () => {
              const { error } = await failSquadMember(selectedOath.id);
              if (error) { showToast(error, "error"); return false; }
              showToast("Your attempt was marked missed. Only your own virtual stake was affected.", "info");
              onProofSubmitted?.();
              return true;
            }}
            canResolve={Boolean(user && selectedOath.status === "active" && selectedOath.oath_type === "solo" && selectedOath.creator_id === user.id)}
            onResolve={async (verdict) => {
              const { error } = await settleOath(selectedOath.id, verdict);
              if (error) {
                showToast(error, "error");
                return false;
              }
              showToast(selectedOath.consequence_type === "fiat" && selectedOath.stake_amount > 0 ? (verdict === "success" ? "Success recorded; virtual stake settled." : "Failure recorded; virtual stake settled.") : (verdict === "success" ? "Success recorded. No monetary stake was involved." : "Failure recorded. No monetary stake was involved."), "success");
              onProofSubmitted?.();
              return true;
            }}
            onCancelDuo={async () => {
              const { error } = await cancelDuoChallenge(selectedOath.id);
              if (error) {
                showToast(error, "error");
                return false;
              }
              showToast(selectedOath.consequence_type === "fiat" && selectedOath.stake_amount > 0 ? "Invitation cancelled. Your own virtual stake was returned." : "Invitation cancelled. No monetary stake was used.", "success");
              onProofSubmitted?.();
              return true;
            }}
          />

          {selectedOath.oath_type === "duo" && selectedOath.status === "active" && (
            <DuoParticipantsPanel oath={selectedOath} currentUserId={user?.id ?? ""} onChanged={onProofSubmitted} />
          )}

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
        </div>
      )}
    </div>
  );
}

function ProofEvidence({ proof }: { proof: import("@/lib/types").Proof }) {
  return <div className="mt-2 border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 p-2">
    {proof.proof_text && <p className="whitespace-pre-wrap break-words text-xs text-zinc-800 dark:text-zinc-200">{proof.proof_text}</p>}
    {proof.proof_url && proof.proof_type === "link" && <a href={proof.proof_url} target="_blank" rel="noreferrer" className="break-all text-xs font-bold text-blue-700 underline">Open proof link</a>}
    {proof.proof_url && (proof.proof_type === "photo" || proof.proof_type === "screenshot") && <a href={proof.proof_url} target="_blank" rel="noreferrer"><Image src={proof.proof_url} alt="Participant proof" width={640} height={480} unoptimized className="max-h-52 max-w-full object-contain" /></a>}
    {proof.proof_url && proof.proof_type === "video" && <video src={proof.proof_url} controls className="max-h-52 max-w-full" />}
    {!proof.proof_text && !proof.proof_url && <p className="text-[10px] font-mono text-zinc-500">Proof is not available to display.</p>}
  </div>;
}

function DuoParticipantsPanel({ oath, currentUserId, onChanged }: { oath: Oath; currentUserId: string; onChanged?: () => void }) {
  const [busyMember, setBusyMember] = useState<string | null>(null);
  const { proofs } = useProofs(oath.id);
  const members = oath.members ?? [];
  const vote = async (memberId: string, approve: boolean) => {
    setBusyMember(memberId);
    const { error } = await castVote(memberId, oath.id, approve);
    setBusyMember(null);
    if (error) showToast(error, "error");
    else {
      showToast(approve ? "Proof approved; that participant’s own stake is returned if applicable." : "Proof marked incomplete; only that participant’s own stake is affected.", "success");
      onChanged?.();
    }
  };

  return (
    <section aria-label="Duo participants" className="w-full max-w-2xl mt-4 border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-950/70 p-4">
      <h2 className="text-xs font-black uppercase tracking-wider">Same goal · separate progress</h2>
      <p className="mt-1 text-[10px] font-mono text-zinc-500">Each person submits their own proof. The other person reviews it; outcomes and virtual stakes are per person.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {members.map((member) => {
          const isMe = member.user_id === currentUserId;
          const proof = proofs.find((item) => item.submitted_by === member.user_id);
          const proofIsVisible = Boolean(proof && (proof.proof_text || proof.proof_url));
          const canReview = !isMe && member.status === "joined" && member.proof_submitted && proofIsVisible && !(member.voted_by ?? []).includes(currentUserId);
          const isBusy = busyMember === member.id;
          return (
            <div key={member.id} className="border border-zinc-300 dark:border-zinc-700 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold">{isMe ? "You" : `@${member.user?.username ?? "participant"}`}</span>
                <span className={`text-[9px] font-mono font-black uppercase ${member.status === "completed" ? "text-emerald-700 dark:text-emerald-400" : member.status === "failed" ? "text-red-600" : "text-zinc-500"}`}>{member.status}</span>
              </div>
              <p className="mt-1 text-[10px] font-mono text-zinc-500">{member.proof_submitted ? `${member.votes_received}/${member.votes_needed} approval${member.votes_needed === 1 ? "" : "s"}` : "Proof not submitted yet"}</p>
              {proof && <ProofEvidence proof={proof} />}
              {canReview && <div className="mt-2 flex gap-2">
                <button type="button" disabled={isBusy} onClick={() => void vote(member.id, true)} className="min-h-10 flex-1 border-2 border-emerald-700 px-2 text-[10px] font-black uppercase text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"><span className="inline-flex items-center gap-1">{isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ThumbsUp className="h-3 w-3" />}Approve</span></button>
                <button type="button" disabled={isBusy} onClick={() => void vote(member.id, false)} className="min-h-10 flex-1 border-2 border-red-600 px-2 text-[10px] font-black uppercase text-red-700 hover:bg-red-50 disabled:opacity-50"><span className="inline-flex items-center gap-1"><ThumbsDown className="h-3 w-3" />Not yet</span></button>
              </div>}
            </div>
          );
        })}
        {members.length === 0 && <p className="text-[10px] font-mono text-zinc-500">Participant records are loading. Refresh shortly.</p>}
      </div>
    </section>
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
      className={`w-[82vw] max-w-[280px] sm:max-w-none sm:w-full min-w-[220px] sm:min-w-0 shrink-0 text-left px-3 sm:px-4 py-2.5 sm:py-3.5 border-r-2 sm:border-r-0 border-b-0 sm:border-b-2 border-zinc-200 dark:border-zinc-800/30 transition-all ${
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
              {oath.consequence_type === "fiat" && oath.stake_amount > 0 ? `${utilsFormatCurrency(oath.stake_amount, region)} virtual` : "No monetary stake"}
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
  canSubmitProof = true,
  onViewDetails,
  onForfeit,
  canCancelDuo = false,
  canAcceptDuo = false,
  onAcceptDuo,
  canFailDuo = false,
  onFailDuo,
  canForfeit = false,
  canResolve = false,
  onResolve,
  onCancelDuo,
}: {
  oath: Oath;
  onSubmitProof: () => void;
  canSubmitProof?: boolean;
  onViewDetails: () => void;
  onForfeit: () => void;
  canCancelDuo?: boolean;
  canAcceptDuo?: boolean;
  onAcceptDuo?: () => Promise<boolean>;
  canFailDuo?: boolean;
  onFailDuo?: () => Promise<boolean>;
  canForfeit?: boolean;
  canResolve?: boolean;
  onResolve: (verdict: "success" | "penalty") => Promise<boolean>;
  onCancelDuo?: () => Promise<boolean>;
}) {
  const { region } = useRegion();
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [showAcceptConfirm, setShowAcceptConfirm] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [showFailDuoConfirm, setShowFailDuoConfirm] = useState(false);
  const [failingDuo, setFailingDuo] = useState(false);
  const [showResolveConfirm, setShowResolveConfirm] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const timeState = getTimeRemaining(oath.deadline, now);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const progressTotal = new Date(oath.deadline).getTime() - new Date(oath.created_at).getTime();
  const progressElapsed = now - new Date(oath.created_at).getTime();
  const progressPercent = Math.min(100, Math.max(0, (progressElapsed / (progressTotal || 1)) * 100));

  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-start sm:justify-center gap-0 px-4 sm:px-8 py-12 sm:py-0 relative overflow-y-auto bg-zinc-50 dark:bg-transparent" suppressHydrationWarning>
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

      {/* Show money only when this oath actually has a financial stake. */}
      <div className="text-center mb-6">
        {oath.consequence_type === "fiat" && oath.stake_amount > 0 ? <>
          <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-500 uppercase tracking-[0.2em] font-bold mb-1">Virtual stake</p>
          <p className="text-4xl sm:text-5xl font-black text-zinc-950 dark:text-zinc-50 stake-number tracking-tight">{utilsFormatCurrency(oath.stake_amount, region)}</p>
          <p className="text-[10px] font-mono text-zinc-600 dark:text-zinc-500 mt-1">{oath.oath_type === "duo" ? "Each participant is reviewed separately; success returns their own stake" : "Your virtual stake is forfeited on failure"}</p>
        </> : <p className="text-sm font-mono font-bold uppercase tracking-wider text-zinc-500">No monetary stake</p>}
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
      {(() => {
        const isActionable = oath.status === "active" && !timeState.isExpired;
        return (
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            {canAcceptDuo && <button type="button" onClick={() => setShowAcceptConfirm(true)} className="min-h-11 border-2 border-emerald-700 bg-emerald-700 px-4 text-xs font-black uppercase text-white hover:bg-emerald-800">Accept invitation</button>}
            {canFailDuo && timeState.isExpired && <button type="button" onClick={() => setShowFailDuoConfirm(true)} className="min-h-11 border-2 border-red-600 px-4 text-xs font-black uppercase text-red-700 hover:bg-red-50">Mark my attempt missed</button>}
            <button
              onClick={onSubmitProof}
              disabled={!isActionable || !canSubmitProof}
              className={`flex items-center gap-2 px-5 py-2.5 text-sm font-black tracking-tight uppercase transition-colors border-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none ${
                isActionable && canSubmitProof
                  ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 border-zinc-950 dark:border-transparent"
                  : "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 border-zinc-300 dark:border-zinc-800 cursor-not-allowed shadow-none"
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              {canSubmitProof ? "Submit Proof" : "Proof Submitted"}
            </button>
            <button
              onClick={onViewDetails}
              className="flex items-center gap-2 px-5 py-2.5 border-2 border-zinc-950 dark:border-zinc-700 text-zinc-900 dark:text-zinc-300 text-sm font-bold tracking-tight hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
            >
              <Eye className="w-3.5 h-3.5" />
              Details
            </button>
            {canForfeit && oath.status === "active" && (
              <button
                type="button"
                onClick={onForfeit}
                className="min-h-11 flex items-center gap-2 px-4 py-2.5 border-2 border-red-600 text-xs font-black uppercase tracking-tight text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                <XCircle className="w-3.5 h-3.5" />
                Forfeit
              </button>
            )}
            {canResolve && timeState.isExpired && (
              <button
                type="button"
                onClick={() => setShowResolveConfirm(true)}
                className="min-h-11 flex items-center gap-2 px-4 py-2.5 border-2 border-zinc-950 bg-zinc-950 text-xs font-black uppercase tracking-tight text-white hover:bg-zinc-800 dark:border-zinc-300 dark:bg-zinc-100 dark:text-zinc-950"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                Resolve oath
              </button>
            )}
            {canCancelDuo && (
              <button
                type="button"
                onClick={() => setShowCancelConfirm(true)}
                className="min-h-11 px-4 py-2 border-2 border-zinc-500 text-xs font-black uppercase tracking-tight text-zinc-700 dark:text-zinc-300 hover:border-red-600 hover:text-red-600"
              >
                Cancel invite
              </button>
            )}
          </div>
        );
      })()}

      {showFailDuoConfirm && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="duo-fail-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md border-4 border-red-600 bg-white dark:bg-zinc-950 p-5">
            <h2 id="duo-fail-title" className="text-base font-black uppercase">Mark your attempt missed?</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">This affects only your participant record and your own virtual stake. It does not mark your partner as failed or take their stake.</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" disabled={failingDuo} onClick={async () => { setFailingDuo(true); try { if (onFailDuo && await onFailDuo()) setShowFailDuoConfirm(false); } finally { setFailingDuo(false); } }} className="min-h-11 border-2 border-red-600 bg-red-600 px-2 text-xs font-black uppercase text-white disabled:opacity-50">{failingDuo ? "Recording…" : "Mark missed"}</button>
              <button type="button" disabled={failingDuo} onClick={() => setShowFailDuoConfirm(false)} className="min-h-11 border-2 border-zinc-500 px-2 text-xs font-bold uppercase">Not now</button>
            </div>
          </div>
        </div>
      )}

      {showAcceptConfirm && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="accept-duo-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md border-4 border-zinc-950 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-5">
            <h2 id="accept-duo-title" className="text-base font-black uppercase">Accept shared challenge?</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">You and the inviter share this goal and submit separate proof. {oath.consequence_type === "fiat" && oath.stake_amount > 0 ? <>Confirming locks <strong>{utilsFormatCurrency(oath.stake_amount, region)}</strong> from your own virtual balance. Your balance is not touched unless you accept. If your proof is approved, your own stake is returned; there is no winner-takes-pot payout.</> : "This is a no-money challenge; no virtual balance will be locked."}</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" disabled={accepting} onClick={async () => { setAccepting(true); try { if (onAcceptDuo && await onAcceptDuo()) setShowAcceptConfirm(false); } finally { setAccepting(false); } }} className="min-h-11 border-2 border-emerald-700 bg-emerald-700 px-2 text-xs font-black uppercase text-white disabled:opacity-50">{accepting ? "Accepting…" : oath.consequence_type === "fiat" && oath.stake_amount > 0 ? "Accept & lock my stake" : "Accept without a stake"}</button>
              <button type="button" disabled={accepting} onClick={() => setShowAcceptConfirm(false)} className="min-h-11 border-2 border-zinc-500 px-2 text-xs font-bold uppercase">Not now</button>
            </div>
          </div>
        </div>
      )}

      {showCancelConfirm && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="cancel-duo-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm border-4 border-zinc-950 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-5 shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
            <h2 id="cancel-duo-title" className="text-base font-black uppercase">Cancel this invitation?</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">This ends the pending challenge and returns your virtual stake. The invitation link will stop working.</p>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setShowCancelConfirm(false)} disabled={canceling} className="min-h-11 flex-1 border-2 border-zinc-500 px-3 text-xs font-bold uppercase">Keep invite</button>
              <button type="button" disabled={canceling} onClick={async () => {
                if (!onCancelDuo) return;
                setCanceling(true);
                try {
                  if (await onCancelDuo()) setShowCancelConfirm(false);
                } catch (error) {
                  showToast(error instanceof Error ? error.message : "Could not cancel invitation.", "error");
                } finally {
                  setCanceling(false);
                }
              }} className="min-h-11 flex-1 bg-red-600 px-3 text-xs font-black uppercase text-white disabled:opacity-60">
                {canceling ? "Cancelling…" : "Cancel invite"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showResolveConfirm && (
        <div role="alertdialog" aria-modal="true" aria-labelledby="resolve-oath-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto border-4 border-zinc-950 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-5 sm:p-6 shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
            <h2 id="resolve-oath-title" className="text-base font-black uppercase">Resolve this oath</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">This permanently records the outcome and settles the virtual stake. {oath.oath_type === "solo" ? "Solo completion is self-reported." : "As the assigned peer, your verdict is final."} No cash moves.</p>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button type="button" disabled={resolving} onClick={async () => {
                setResolving(true);
                try {
                  if (await onResolve("success")) setShowResolveConfirm(false);
                } catch (error) {
                  showToast(error instanceof Error ? error.message : "Could not resolve this oath.", "error");
                } finally {
                  setResolving(false);
                }
              }} className="min-h-11 border-2 border-zinc-950 bg-zinc-950 px-3 text-xs font-black uppercase text-white disabled:opacity-50 dark:border-zinc-200 dark:bg-zinc-100 dark:text-zinc-950">{resolving ? "Recording…" : "Mark complete"}</button>
              <button type="button" disabled={resolving} onClick={async () => {
                setResolving(true);
                try {
                  if (await onResolve("penalty")) setShowResolveConfirm(false);
                } catch (error) {
                  showToast(error instanceof Error ? error.message : "Could not resolve this oath.", "error");
                } finally {
                  setResolving(false);
                }
              }} className="min-h-11 border-2 border-red-600 bg-red-600 px-3 text-xs font-black uppercase text-white disabled:opacity-50">{resolving ? "Recording…" : "Mark failed"}</button>
            </div>
            <button type="button" disabled={resolving} onClick={() => setShowResolveConfirm(false)} className="mt-3 min-h-11 w-full border-2 border-zinc-500 px-3 text-xs font-bold uppercase disabled:opacity-50">Not now</button>
          </div>
        </div>
      )}
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
  const { region } = useRegion();
  const [privateDetails, setPrivateDetails] = useState<{ phone: string | null; message: string | null } | null>(null);

  useEffect(() => {
    let active = true;
    if (oath.consequence_type === "social_ransom") void getMyPrivateConsequenceDetails(oath.id).then((details) => { if (active) setPrivateDetails(details); });
    return () => { active = false; };
  }, [oath.id, oath.consequence_type]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="details-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 p-6 fade-in shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
        <div className="flex items-center justify-between border-b-2 border-zinc-950 dark:border-zinc-800 pb-4 mb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-600" />
            <h3 id="details-modal-title" className="text-base font-black text-zinc-950 dark:text-zinc-50 uppercase tracking-tight">Oath Details</h3>
          </div>
          <button onClick={onClose} aria-label="Close details" className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
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
            {oath.consequence_type === "fiat" && oath.stake_amount > 0 && <div>
              <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block">Individual virtual stake</span>
              <span className="text-sm font-mono font-black text-zinc-900 dark:text-zinc-200">{utilsFormatCurrency(oath.stake_amount, region)}</span>
            </div>}
            {oath.oath_type === "duo" && <div>
              <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block">Duo settlement</span>
              <span className="text-sm font-mono font-black text-zinc-900 dark:text-zinc-200">Individual; no pot or fee</span>
            </div>}
          </div>

          {oath.consequence_type === "social_ransom" && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-500/50 text-xs font-mono text-amber-950 dark:text-amber-200">
              <span className="font-bold">Manual Social Ransom details (private to you):</span>
              {privateDetails ? <><p className="mt-1">Contact: {privateDetails.phone || "Not provided"}</p><p className="mt-1 italic">&ldquo;{privateDetails.message || "No message saved"}&rdquo;</p></> : <p className="mt-1">No private details available for this account.</p>}
              <p className="mt-2 text-[10px]">OATH does not send this message.</p>
            </div>
          )}
          {oath.consequence_type === "anti_charity" && oath.anti_charity_destination && <div className="p-3 border border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 text-xs font-mono"><span className="font-bold">Manual destination:</span> {oath.anti_charity_destination}<p className="mt-1 text-[10px]">No donation is sent by OATH.</p></div>}

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
  const [privateDetails, setPrivateDetails] = useState<{ phone: string | null; message: string | null } | null>(null);

  useEffect(() => {
    let active = true;
    if (oath.consequence_type === "social_ransom") {
      void getMyPrivateConsequenceDetails(oath.id).then((details) => { if (active) setPrivateDetails(details); });
    }
    return () => { active = false; };
  }, [oath.id, oath.consequence_type]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleForfeit = async () => {
    setLoading(true);
    try {
      const { error } = await forfeitOath(oath.id, excuse.trim() || undefined);
      if (error) {
        showToast(error, "error");
      } else {
        showToast("Oath forfeited. The virtual sandbox stake was updated; no cash moved.", "error", 6000);
        onForfeited();
      }
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Could not forfeit this oath. Try again.", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="forfeit-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain bg-white dark:bg-[#0a0a0f] border-4 border-red-600 p-6 fade-in shadow-[12px_12px_0px_0px_rgba(220,38,38,1)] dark:shadow-none text-left">
        <div className="flex items-center gap-2 mb-3 text-red-600">
          <AlertTriangle className="w-6 h-6" />
          <h3 id="forfeit-modal-title" className="text-lg font-black uppercase tracking-tight">Forfeit Oath</h3>
        </div>

        <p className="text-sm font-bold text-zinc-800 dark:text-zinc-300 mb-2">
          Are you conceding defeat?
        </p>
        <p className="text-xs font-mono text-zinc-600 dark:text-zinc-400 mb-4 leading-relaxed">
          Forfeiting immediately terminates this oath. {oath.consequence_type === "fiat" && oath.stake_amount > 0 ? <>Its virtual stake of <strong className="text-red-600 dark:text-red-500 font-bold">{utilsFormatCurrency(oath.stake_amount, region)}</strong> will be forfeited in the sandbox; no cash moves.</> : "This oath has no monetary consequence."} {oath.consequence_type === "public_shame" ? "This oath opted into the public wall, so the failure note will be posted there." : "This oath did not opt into the public wall, so no wall entry will be created."}
        </p>

        {oath.consequence_type === "social_ransom" && <div className="mb-4 break-words border border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs font-mono">
          <p className="font-bold">Manual message details</p>
          {privateDetails ? <><p className="mt-1">Recipient: {privateDetails.phone || "Not provided"}</p><p className="mt-2 whitespace-pre-wrap">Message to send yourself: “{privateDetails.message || "No message saved"}”</p></> : <p className="mt-1">Private message details are not available for this account.</p>}
          <p className="mt-2 text-[10px]">OATH will not send this message.</p>
        </div>}
        {oath.consequence_type === "anti_charity" && <div className="mb-4 break-words border border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 p-3 text-xs font-mono">
          <p className="font-bold">Manual destination: {oath.anti_charity_destination || "Not saved"}</p>
          <p className="mt-1 text-[10px]">No donation or payment is made by OATH.</p>
        </div>}

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
            {loading ? "Processing..." : oath.consequence_type === "fiat" && oath.stake_amount > 0 ? `Forfeit ${utilsFormatCurrency(oath.stake_amount, region)}` : "Forfeit oath"}
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
