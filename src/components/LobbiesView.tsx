"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import {
  Users,
  Clock,
  DollarSign,
  Zap,
  UserPlus,
  Upload,
  ThumbsUp,
  ThumbsDown,
  Loader2,
} from "lucide-react";
import type { Oath, GroupMember, Wallet } from "@/lib/types";
import { formatCurrency as utilsFormatCurrency, getTimeRemaining, formatRelativeTime } from "@/lib/utils";
import { joinSquad, castVote, failSquadMember, acknowledgeSquadRecovery, completeSquadRecovery } from "@/lib/data-hooks";
import { showToast } from "./Toast";
import { useRegion } from "@/lib/region-context";
import { useAuth, isDemoSession } from "@/lib/auth-context";
import type { Proof } from "@/lib/types";

interface LobbiesViewProps {
  squads: Oath[];
  wallet: Wallet;
  onJoined?: () => void;
}

export default function LobbiesView({ squads, wallet, onJoined }: LobbiesViewProps) {
  const [selectedSquadId, setSelectedSquadId] = useState<string | null>(null);
  const [demoBanner, setDemoBanner] = useState(false);
  useEffect(() => { const frame = requestAnimationFrame(() => setDemoBanner(isDemoSession())); return () => cancelAnimationFrame(frame); }, []);

  const selectedSquad = squads.find((s) => s.id === selectedSquadId) || null;

  return (
    <div className={`relative flex-1 min-h-0 flex flex-col sm:flex-row overflow-hidden ${demoBanner ? "pt-12" : ""}`}>
      {demoBanner && <div className="absolute z-20 top-2 left-2 right-2 border-2 border-amber-600 bg-amber-50 dark:bg-amber-950/90 px-3 py-2 text-[10px] font-mono font-bold text-amber-950 dark:text-amber-200">DEMO · local-only sample lobbies. They are not shared with other accounts or devices.</div>}
      {/* On phones, opening a lobby replaces the list instead of squeezing both panes. */}
      <div className={`${selectedSquad ? "hidden sm:flex sm:w-96 sm:flex-none" : "flex flex-1"} min-h-0 w-full flex-col sm:border-r-2 border-zinc-950 dark:border-zinc-800/60 overflow-hidden transition-all bg-white dark:bg-transparent`}>
        <div className="px-5 py-4 border-b-2 border-zinc-950 dark:border-zinc-800/40 bg-zinc-100 dark:bg-zinc-900/50">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black tracking-tight text-zinc-950 dark:text-zinc-100">
                SQUAD POOLS
              </h2>
              <p className="text-[10px] font-mono text-zinc-600 dark:text-zinc-400 tracking-wide mt-0.5 font-bold">
                Each member is resolved independently; only financial squads use personal virtual stakes.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold text-zinc-700 dark:text-zinc-400 px-2 py-1 border border-zinc-400 dark:border-zinc-800">
                {squads.length} open
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {squads.map((squad, index) => (
            <SquadCard
              key={squad.id}
              squad={squad}
              index={index}
              isSelected={selectedSquad?.id === squad.id}
              onClick={() => setSelectedSquadId(squad.id)}
            />
          ))}

          {squads.length === 0 && (
            <div className="flex items-center justify-center h-64 p-6">
              <div className="text-center">
                <p className="text-zinc-800 dark:text-zinc-400 text-sm font-bold font-mono">No open lobbies</p>
                <p className="text-zinc-500 text-xs font-mono mt-1">Create one yourself in the Create tab</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Squad Detail */}
      {selectedSquad && (
        <SquadDetail
          squad={selectedSquad}
          wallet={wallet}
          onClose={() => setSelectedSquadId(null)}
          onJoined={onJoined}
        />
      )}
    </div>
  );
}

function SquadCard({
  squad,
  index,
  isSelected,
  onClick,
}: {
  squad: Oath;
  index: number;
  isSelected: boolean;
  onClick: () => void;
}) {
  const { region } = useRegion();
  const time = getTimeRemaining(squad.deadline);
  const memberCount = squad.members?.length ?? 0;
  const spotsLeft = Math.max(0, squad.max_players - memberCount);
  const financial = squad.consequence_type === "fiat";

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 border-b-2 border-zinc-200 dark:border-zinc-800/30 transition-all card-hover fade-in ${
        isSelected ? "bg-zinc-200 dark:bg-zinc-900/60 shadow-[inset_4px_0_0_0_rgba(220,38,38,1)]" : "hover:bg-zinc-100 dark:hover:bg-zinc-900/30"
      }`}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Statement */}
          <p className="text-sm font-bold text-zinc-900 dark:text-zinc-200 leading-tight mb-2">
            {squad.oath_statement}
          </p>

          {/* Meta row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Users className="w-3 h-3 text-zinc-500" />
              <span className="text-[10px] font-mono text-zinc-700 dark:text-zinc-400 font-bold">
                {memberCount}/{squad.max_players}
              </span>
              {spotsLeft > 0 && (
                <span className="text-[9px] font-mono text-zinc-500 ml-0.5">
                  ({spotsLeft} spots)
                </span>
              )}
            </div>

            {financial ? <div className="flex items-center gap-1.5"><DollarSign className="w-3 h-3 text-zinc-500" /><span className="text-[10px] font-mono font-black text-zinc-900 dark:text-zinc-300 stake-number">{utilsFormatCurrency(squad.stake_amount, region)} virtual/player</span></div> : <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">No monetary stake</span>}

            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-zinc-500" />
              <span
                className={`text-[10px] font-mono font-bold ${
                  time.isUrgent ? "text-red-600 dark:text-red-500" : "text-zinc-600 dark:text-zinc-400"
                }`}
              >
                {time.isExpired
                  ? "ENDED"
                  : time.days > 0
                  ? `${time.days}d left`
                  : `${time.hours}h left`}
              </span>
            </div>
          </div>

          {/* Player avatars */}
          {squad.members && squad.members.length > 0 && (
            <div className="flex items-center gap-1 mt-2.5">
              {squad.members.slice(0, 5).map((member) => (
                <div
                  key={member.id}
                  className="w-5 h-5 bg-zinc-200 dark:bg-zinc-800 border border-zinc-400 dark:border-zinc-700 flex items-center justify-center"
                  title={member.user?.username}
                >
                  <span className="text-[7px] font-mono font-bold text-zinc-800 dark:text-zinc-400 uppercase">
                    {member.user?.username?.substring(0, 2) ?? "?"}
                  </span>
                </div>
              ))}
              {memberCount > 5 && (
                <span className="text-[9px] font-mono text-zinc-500 ml-1">
                  +{memberCount - 5}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right — Combined virtual stakes & status */}
        <div className="flex flex-col items-end shrink-0">
          {financial ? <span className="max-w-20 text-right text-[9px] font-mono font-bold text-zinc-500">NO SHARED POOL · PERSONAL STAKES</span> : <span className="max-w-20 text-right text-[9px] font-mono font-bold text-zinc-500">NO MONEY AT STAKE</span>}
          <span
            className={`text-[9px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 border mt-2 ${
              squad.status === "pending"
                ? "border-zinc-400 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400"
                : squad.status === "active"
                ? "border-zinc-800 dark:border-zinc-600 text-zinc-900 dark:text-zinc-300"
                : "border-red-600 text-red-600"
            }`}
          >
            {squad.status}
          </span>
        </div>
      </div>
    </button>
  );
}

function SquadDetail({
  squad,
  wallet,
  onClose,
  onJoined,
}: {
  squad: Oath;
  wallet: Wallet;
  onClose: () => void;
  onJoined?: () => void;
}) {
  const { user } = useAuth();
  const { region } = useRegion();
  const [loading, setLoading] = useState(false);
  const memberCount = squad.members?.length ?? 0;
  const spotsLeft = Math.max(0, squad.max_players - memberCount);
  const financial = squad.consequence_type === "fiat";
  const personalStake = financial ? squad.stake_amount : 0;
  const deadlineExpired = getTimeRemaining(squad.deadline).isExpired;

  const handleJoin = async () => {
    if (personalStake > 0 && wallet.balance < personalStake) {
      showToast("Insufficient virtual balance to join this squad.", "error");
      return;
    }
    setLoading(true);
    try {
      const { error } = await joinSquad(squad.id, personalStake);
      if (error) {
        showToast(error, "error");
      } else {
        showToast(personalStake > 0 ? "Joined squad. Your virtual stake is locked in the sandbox ledger." : "Joined the no-stake recovery quest.", "success");
        onJoined?.();
      }
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Could not join this squad. Try again.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleFailMember = async () => {
    try {
      const { error } = await failSquadMember(squad.id);
      if (error) {
        showToast(error, "error");
      } else {
        showToast(personalStake > 0 ? "No-proof failure recorded; your individual virtual stake was settled." : "No-proof failure recorded. No monetary stake was involved.", "success");
        onJoined?.();
      }
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Could not resolve this squad entry.", "error");
    }
  };

  const handleRecoveryReflection = async (reflection: string) => {
    const { error } = await acknowledgeSquadRecovery(squad.id, reflection);
    if (error) showToast(error, "error");
    else { showToast("Reflection saved privately. Now set a check-in date.", "success"); onJoined?.(); }
  };

  const handleRecoveryCheckin = async (checkin: string) => {
    const { error } = await completeSquadRecovery(squad.id, checkin);
    if (error) showToast(error, "error");
    else { showToast("Recovery plan saved. The original failure remains in oath history.", "success"); onJoined?.(); }
  };

  const handleVote = async (memberId: string, vote: boolean) => {
    try {
      const { error } = await castVote(memberId, squad.id, vote);
      if (error) {
        showToast(error, "error");
      } else {
        showToast(vote ? "Vote recorded: proof approved" : "Vote recorded: proof rejected", "success");
        onJoined?.();
      }
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Could not record your vote. Try again.", "error");
    }
  };

  return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden fade-in bg-zinc-50 dark:bg-transparent">
      {/* Detail Header */}
      <div className="px-5 py-4 border-b-2 border-zinc-950 dark:border-zinc-800/40 bg-white dark:bg-transparent">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-widest">
            Squad Detail
          </span>
          <button
            onClick={onClose}
            className="text-[10px] font-mono font-bold text-zinc-700 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors px-2 py-1 border border-zinc-300 dark:border-zinc-800"
          >
            Close
          </button>
        </div>
        <h3 className="text-xl font-black tracking-tight text-zinc-950 dark:text-zinc-100 leading-tight">
          {squad.oath_statement}
        </h3>
        <p className="text-[11px] font-mono text-zinc-600 dark:text-zinc-400 mt-1 font-bold">
          Created by @{squad.creator?.username ?? "unknown"} · {formatRelativeTime(squad.created_at)}
        </p>
      </div>

      {/* Stats Row: never present personal stakes as a shared pool. */}
      <div className="grid grid-cols-2 border-b-2 border-zinc-200 dark:border-zinc-800/40 bg-white dark:bg-zinc-950/30">
        <div className="px-4 py-3 border-r-2 border-zinc-200 dark:border-zinc-800/40 text-center">
          {financial ? <><p className="text-2xl font-black stake-number text-zinc-950 dark:text-zinc-100">{utilsFormatCurrency(squad.stake_amount, region)}</p><p className="text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-widest mt-0.5">Personal virtual stake</p></> : <><p className="text-xs font-black uppercase text-zinc-600 dark:text-zinc-400">No monetary stake</p><p className="text-[9px] font-mono text-zinc-500 mt-1">Recovery quest</p></>}
        </div>
        <div className="px-4 py-3 text-center"><p className="text-2xl font-black text-zinc-950 dark:text-zinc-100">{spotsLeft}</p><p className="text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-widest mt-0.5">Spots left</p></div>
      </div>

      {/* Members List — Task Log Feed */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800/30 bg-zinc-100 dark:bg-transparent">
          <span className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">
            Squad Log & Proof Verifications
          </span>
        </div>

        {squad.members?.map((member, index) => (
          <MemberLogEntry
            key={member.id}
            member={member}
            index={index}
            currentUserId={user?.id}
            onVote={handleVote}
            canFail={deadlineExpired && member.user_id === user?.id && member.status === "joined" && !member.proof_submitted}
            onFail={handleFailMember}
            showStake={financial}
            onRecoveryReflection={handleRecoveryReflection}
            onRecoveryCheckin={handleRecoveryCheckin}
            proof={squad.proofs?.filter((proof) => proof.submitted_by === member.user_id).sort((a,b) => b.created_at.localeCompare(a.created_at))[0]}
          />
        ))}

        {/* Empty slots */}
        {Array.from({ length: spotsLeft }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="flex items-center gap-3 px-5 py-3 border-b border-zinc-200 dark:border-zinc-800/20"
          >
            <div className="w-6 h-6 border border-dashed border-zinc-400 dark:border-zinc-800 flex items-center justify-center">
              <UserPlus className="w-3 h-3 text-zinc-400 dark:text-zinc-600" />
            </div>
            <span className="text-[11px] font-mono text-zinc-500">Open spot</span>
          </div>
        ))}
      </div>

      {/* Join Button */}
      {spotsLeft > 0 && squad.status === "pending" && (
        <div className="px-5 py-4 border-t-2 border-zinc-950 dark:border-zinc-800/40 bg-white dark:bg-transparent">
          <button
            onClick={handleJoin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 text-sm font-black tracking-tight uppercase hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50 border-2 border-zinc-950 dark:border-transparent shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {loading ? "Joining…" : personalStake > 0 ? `Join squad — lock ${utilsFormatCurrency(personalStake, region)} virtual` : "Join recovery quest — no stake"}
          </button>
        </div>
      )}
    </div>
  );
}

function MemberLogEntry({
  member,
  index,
  currentUserId,
  onVote,
  canFail = false,
  onFail,
  showStake,
  onRecoveryReflection,
  onRecoveryCheckin,
  proof,
}: {
  member: GroupMember;
  proof?: Proof;
  index: number;
  currentUserId?: string;
  onVote: (memberId: string, vote: boolean) => Promise<void>;
  canFail?: boolean;
  onFail: () => Promise<void>;
  showStake: boolean;
  onRecoveryReflection: (reflection: string) => Promise<void>;
  onRecoveryCheckin: (checkin: string) => Promise<void>;
}) {
  const { region } = useRegion();
  const [voting, setVoting] = useState(false);
  const [confirmFailure, setConfirmFailure] = useState(false);
  const [failing, setFailing] = useState(false);
  const [reflection, setReflection] = useState("");
  const [checkin, setCheckin] = useState("");
  const [savingRecovery, setSavingRecovery] = useState(false);
  const isCurrentUser = Boolean(currentUserId && member.user_id === currentUserId);
  const hasVoted = Boolean(currentUserId && member.voted_by?.includes(currentUserId));
  const isConcluded = member.status === "completed" || member.status === "failed";
  const proofIsVisible = Boolean(proof && (proof.proof_text || proof.proof_url));

  return (
    <div
      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800/25 fade-in bg-white dark:bg-transparent hover:bg-zinc-50 dark:hover:bg-zinc-900/20"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="w-7 h-7 bg-zinc-200 dark:bg-zinc-800 border-2 border-zinc-950 dark:border-zinc-700 flex items-center justify-center shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
          <span className="text-[8px] font-mono font-black text-zinc-950 dark:text-zinc-300 uppercase">
            {member.user?.username?.substring(0, 2) ?? "??"}
          </span>
        </div>

        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-sm text-zinc-950 dark:text-zinc-200 font-bold">
              @{member.user?.username ?? "unknown"}
            </span>
            {isCurrentUser && (
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-400 dark:border-zinc-700">
                YOU
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {showStake && member.stake_amount > 0 && <span className="text-[10px] font-mono text-zinc-600 dark:text-zinc-400 stake-number font-bold">{utilsFormatCurrency(member.stake_amount, region)} virtual personal stake</span>}
            {member.proof_submitted && (
              <span className="text-[9px] font-mono text-zinc-600 dark:text-zinc-400 flex items-center gap-1 font-bold">
                <Upload className="w-2.5 h-2.5 text-zinc-500" /> Proof submitted
              </span>
            )}
          </div>
        </div>
      </div>
      {proof && <div className="w-full border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50 p-3">
        <p className="mb-1 text-[9px] font-mono font-black uppercase text-zinc-500">Submitted proof · {proof.proof_type}</p>
        {proof.proof_text && <p className="whitespace-pre-wrap break-words text-xs text-zinc-800 dark:text-zinc-200">{proof.proof_text}</p>}
        {proof.proof_url && proof.proof_type === "link" && <a href={proof.proof_url} target="_blank" rel="noreferrer" className="break-all text-xs font-bold text-blue-700 underline">Open proof link</a>}
        {proof.proof_url && (proof.proof_type === "photo" || proof.proof_type === "screenshot") && <a href={proof.proof_url} target="_blank" rel="noreferrer"><Image src={proof.proof_url} alt="Squad member proof" width={640} height={480} unoptimized className="max-h-52 max-w-full object-contain" /></a>}
        {proof.proof_url && proof.proof_type === "video" && <video src={proof.proof_url} controls className="max-h-52 max-w-full" />}
      </div>}

      {isCurrentUser && member.status === "failed" && !member.recovered_at && (
        <div className="w-full border border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/10 p-3">
          <p className="text-[10px] font-mono font-black uppercase text-amber-800 dark:text-amber-400">Recovery checklist · failure remains in history</p>
          {!member.recovery_acknowledged_at ? <>
            <label className="block mt-2 text-[10px] font-mono text-zinc-600 dark:text-zinc-400" htmlFor={`reflection-${member.id}`}>1. Write a brief, private reflection (10–500 characters).</label>
            <textarea id={`reflection-${member.id}`} value={reflection} maxLength={500} onChange={(event) => setReflection(event.target.value)} rows={2} className="mt-1 w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-2 text-xs" placeholder="What got in the way, and what will you change?" />
            <button type="button" disabled={savingRecovery || reflection.trim().length < 10} onClick={async () => { setSavingRecovery(true); try { await onRecoveryReflection(reflection); } finally { setSavingRecovery(false); } }} className="mt-2 min-h-11 border-2 border-zinc-700 px-3 text-[10px] font-black uppercase disabled:opacity-40">{savingRecovery ? "Saving…" : "Save reflection"}</button>
          </> : <>
            <label className="block mt-2 text-[10px] font-mono text-zinc-600 dark:text-zinc-400" htmlFor={`checkin-${member.id}`}>2. Set a future check-in (within 90 days).</label>
            <input id={`checkin-${member.id}`} type="datetime-local" value={checkin} onChange={(event) => setCheckin(event.target.value)} className="mt-1 min-h-11 max-w-full border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 p-2 text-xs" />
            <button type="button" disabled={savingRecovery || !checkin} onClick={async () => { setSavingRecovery(true); try { await onRecoveryCheckin(new Date(checkin).toISOString()); } finally { setSavingRecovery(false); } }} className="ml-2 mt-2 min-h-11 border-2 border-zinc-700 px-3 text-[10px] font-black uppercase disabled:opacity-40">{savingRecovery ? "Saving…" : "Set check-in & recover"}</button>
          </>}
        </div>
      )}
      {isCurrentUser && member.recovered_at && <p className="w-full text-[10px] font-mono font-bold text-emerald-700 dark:text-emerald-400">Recovery plan set on {new Date(member.recovered_at).toLocaleDateString()}. The original failure remains recorded.</p>}

      {/* Voting / Status */}
      <div className="w-full sm:w-auto flex items-center justify-end gap-2">
        {member.proof_submitted && !proofIsVisible && !isCurrentUser && !isConcluded && <span className="text-[9px] font-mono text-amber-700">Proof not available; refresh before reviewing</span>}
        {member.proof_submitted && proofIsVisible && !isConcluded && (
          <div className="flex items-center gap-1.5 mr-2">
            <span className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400">
              {member.votes_received}/{member.votes_needed}
            </span>
            {isCurrentUser ? (
              <span className="text-[9px] font-mono text-zinc-500 italic px-1">
                Your proof
              </span>
            ) : hasVoted ? (
              <span className="text-[9px] font-mono font-bold text-zinc-500 px-1.5 py-0.5 border border-zinc-300 dark:border-zinc-800">
                Voted
              </span>
            ) : (
              <>
                <button
                  type="button"
                  aria-label={`Approve proof from ${member.user?.username ?? "member"}`}
                  onClick={async () => {
                    setVoting(true);
                    try { await onVote(member.id, true); } finally { setVoting(false); }
                  }}
                  disabled={voting}
                  className="min-h-11 min-w-11 p-2 border border-zinc-400 dark:border-zinc-700 hover:border-zinc-950 dark:hover:border-zinc-300 text-zinc-700 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 transition-colors bg-zinc-100 dark:bg-zinc-800 disabled:opacity-50"
                  title="Approve proof"
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  aria-label={`Reject proof from ${member.user?.username ?? "member"}`}
                  onClick={async () => {
                    setVoting(true);
                    try { await onVote(member.id, false); } finally { setVoting(false); }
                  }}
                  disabled={voting}
                  className="min-h-11 min-w-11 p-2 border border-zinc-400 dark:border-zinc-700 hover:border-red-600 text-zinc-700 dark:text-zinc-400 hover:text-red-600 transition-colors bg-zinc-100 dark:bg-zinc-800 disabled:opacity-50"
                  title="Reject proof"
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        )}
        {canFail && (confirmFailure ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="w-full text-right text-[10px] font-mono text-red-600">No proof was submitted by the deadline. This cannot be undone.</span>
            <button type="button" disabled={failing} onClick={() => setConfirmFailure(false)} className="min-h-11 border-2 border-zinc-400 px-3 text-[10px] font-bold uppercase">Keep open</button>
            <button type="button" disabled={failing} onClick={async () => {
              setFailing(true);
              try { await onFail(); } finally { setFailing(false); setConfirmFailure(false); }
            }} className="min-h-11 border-2 border-red-600 bg-red-600 px-3 text-[10px] font-black uppercase text-white disabled:opacity-50">{failing ? "Recording…" : "Confirm failure"}</button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmFailure(true)} className="min-h-11 border-2 border-red-600 px-3 text-[10px] font-black uppercase text-red-600">Resolve no-proof failure</button>
        ))}
        <span
          className={`text-[9px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 border ${
            member.status === "joined"
              ? "border-zinc-400 dark:border-zinc-700 text-zinc-700 dark:text-zinc-400"
              : member.status === "completed"
              ? "border-zinc-800 bg-zinc-950 text-white dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
              : member.status === "failed" && member.recovered_at
              ? "border-emerald-700 bg-emerald-700 text-white"
              : member.status === "failed"
              ? "border-amber-600 text-amber-700 dark:text-amber-400"
              : "border-zinc-400 text-zinc-600"
          }`}
        >
          {member.status === "failed" && member.recovered_at ? "Cleared · failure kept in history" : member.status === "failed" && isCurrentUser ? "Recovery available" : member.status}
        </span>
      </div>
    </div>
  );
}
