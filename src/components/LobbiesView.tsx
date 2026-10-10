"use client";

import { useState, useEffect } from "react";
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
  Eye,
  X,
  MessageSquare,
  ExternalLink,
  ArrowLeft,
  Calendar,
  AlertTriangle,
} from "lucide-react";
import type { Oath, GroupMember, Wallet } from "@/lib/types";
import { formatCurrency as utilsFormatCurrency, getTimeRemaining, formatRelativeTime } from "@/lib/utils";
import { joinSquad, castVote, requestMoreProof } from "@/lib/data-hooks";
import { showToast } from "./Toast";
import { confirmAction } from "./ConfirmationModal";
import { useRegion } from "@/lib/region-context";
import { useAuth } from "@/lib/auth-context";
import CreateLobbyModal from "./CreateLobbyModal";
import ChatRoom from "./ChatRoom";

interface LobbiesViewProps {
  squads: Oath[];
  wallet: Wallet;
  penaltyBoxUntil?: string | null;
  onJoined?: () => void;
  onCreateLobby?: () => void;
}

export default function LobbiesView({ squads, wallet, penaltyBoxUntil, onJoined, onCreateLobby }: LobbiesViewProps) {
  const [selectedSquadId, setSelectedSquadId] = useState<string | null>(null);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Strictly filter for public lobbies only (groups with oath_type === 'lobby')
  const lobbies = squads.filter((s) => s.oath_type === "lobby");

  const isPenaltyBoxActive = !!penaltyBoxUntil && new Date(penaltyBoxUntil).getTime() > Date.now();
  const selectedSquad = lobbies.find((s) => s.id === selectedSquadId) || null;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Lobby List — hidden on mobile when detail is shown */}
      <div className={`${
        mobileShowDetail ? "hidden sm:flex" : "flex"
      } ${selectedSquad ? "sm:w-96" : "flex-1"} w-full flex-col border-r-2 border-zinc-950 dark:border-zinc-800/60 overflow-hidden transition-all bg-white dark:bg-transparent`}>
        <div className="px-4 py-3 sm:px-5 sm:py-4 border-b-2 border-zinc-950 dark:border-zinc-800/40 bg-zinc-100 dark:bg-zinc-900/50">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0">
            <div className="pr-2 sm:pr-0">
              <h2 className="text-base sm:text-lg font-black tracking-tight text-zinc-950 dark:text-zinc-100">
                PUBLIC LOBBIES
              </h2>
              <p className="text-[9px] sm:text-[10px] font-mono text-zinc-600 dark:text-zinc-400 tracking-wide mt-0.5 font-bold leading-tight sm:leading-normal">
                Open accountability lobbies. If you fail, you forfeit your stake.
              </p>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <span className="text-[9px] sm:text-[10px] font-mono font-bold text-zinc-700 dark:text-zinc-400 px-1.5 py-0.5 sm:px-2 sm:py-1 border border-zinc-400 dark:border-zinc-800">
                {lobbies.length} open
              </span>
              {onCreateLobby && (
                <button
                  onClick={() => {
                    if (isPenaltyBoxActive) {
                      showToast(`Account locked in Penalty Box until ${new Date(penaltyBoxUntil!).toLocaleDateString()}. Creating lobbies is suspended.`, "error");
                      return;
                    }
                    setShowCreateModal(true);
                  }}
                  disabled={isPenaltyBoxActive}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono font-black uppercase tracking-widest transition-colors border-2 ${
                    isPenaltyBoxActive
                      ? "bg-red-100 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900 cursor-not-allowed opacity-75"
                      : "bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 border-zinc-950 dark:border-transparent shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                  }`}
                  title={isPenaltyBoxActive ? `Account locked in Penalty Box until ${new Date(penaltyBoxUntil!).toLocaleDateString()}` : "Create Lobby"}
                >
                  <UserPlus className="w-3 h-3" />
                  {isPenaltyBoxActive ? "Benched" : "Create"}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {lobbies.map((squad, index) => (
            <SquadCard
              key={squad.id}
              squad={squad}
              index={index}
              isSelected={selectedSquad?.id === squad.id}
              onClick={() => {
                setSelectedSquadId(squad.id);
                setMobileShowDetail(true);
              }}
            />
          ))}

          {lobbies.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 p-6 gap-4">
              <div className="text-center">
                <p className="text-zinc-800 dark:text-zinc-400 text-sm font-bold font-mono">No open lobbies</p>
                <p className="text-zinc-500 text-xs font-mono mt-1">Be the first to create a public lobby</p>
              </div>
              {onCreateLobby && (
                <button
                  onClick={() => {
                    if (isPenaltyBoxActive) {
                      showToast(`Account locked in Penalty Box until ${new Date(penaltyBoxUntil!).toLocaleDateString()}. Creating lobbies is suspended.`, "error");
                      return;
                    }
                    setShowCreateModal(true);
                  }}
                  disabled={isPenaltyBoxActive}
                  className={`flex items-center gap-2 px-5 py-2.5 text-xs font-black uppercase tracking-wider transition-colors border-2 ${
                    isPenaltyBoxActive
                      ? "bg-red-100 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900 cursor-not-allowed opacity-75"
                      : "bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 border-zinc-950 dark:border-transparent shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                  }`}
                >
                  <UserPlus className="w-4 h-4" />
                  {isPenaltyBoxActive ? "Benched in Penalty Box" : "Create a Lobby"}
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Squad Detail — mobile full screen when shown */}
      {selectedSquad && (
        <div className={`${
          mobileShowDetail ? "flex" : "hidden sm:flex"
        } flex-1 flex-col overflow-hidden`}>
          {/* Mobile back button */}
          <div className="flex sm:hidden items-center px-4 py-2.5 border-b-2 border-zinc-950 dark:border-zinc-800/60 bg-zinc-100 dark:bg-zinc-900/80 sticky top-0 z-10 shrink-0">
            <button
              onClick={() => { setMobileShowDetail(false); setSelectedSquadId(null); }}
              className="flex items-center gap-2 py-1.5 px-3 border border-zinc-950 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-xs font-mono font-black uppercase tracking-wider text-zinc-950 dark:text-zinc-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none min-h-[38px]"
            >
              <ArrowLeft className="w-4 h-4" />
              Back to Lobbies
            </button>
          </div>
          <SquadDetail
            squad={selectedSquad}
            wallet={wallet}
            penaltyBoxUntil={penaltyBoxUntil}
            onClose={() => { setSelectedSquadId(null); setMobileShowDetail(false); }}
            onJoined={onJoined}
          />
        </div>
      )}

      {showCreateModal && (
        <CreateLobbyModal
          walletBalance={wallet.balance}
          penaltyBoxUntil={penaltyBoxUntil}
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false);
            if (onJoined) onJoined();
          }}
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
  const poolTotal = memberCount * squad.stake_amount;

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

            <div className="flex items-center gap-1.5">
              <DollarSign className="w-3 h-3 text-zinc-500" />
              <span className="text-[10px] font-mono font-black text-zinc-900 dark:text-zinc-300 stake-number">
                {utilsFormatCurrency(squad.stake_amount, region)}/player
              </span>
            </div>

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

            {(squad.total_days ?? 1) > 1 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-mono px-1.5 py-0.5 bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 font-bold border border-amber-300 dark:border-amber-800">
                  Day {squad.current_day || 1}/{squad.total_days}
                </span>
              </div>
            )}
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

        {/* Right — Escrow total & status */}
        <div className="flex flex-col items-end shrink-0">
          <span className="text-lg font-black stake-number text-zinc-950 dark:text-zinc-200 tracking-tight">
            {utilsFormatCurrency(poolTotal, region)}
          </span>
          <span className="text-[9px] font-mono font-bold text-zinc-500 mt-0.5">ESCROW</span>
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
  penaltyBoxUntil,
  onClose,
  onJoined,
}: {
  squad: Oath;
  wallet: Wallet;
  penaltyBoxUntil?: string | null;
  onClose: () => void;
  onJoined?: () => void;
}) {
  const { user } = useAuth();
  const { region } = useRegion();
  const [loading, setLoading] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [inspectingMember, setInspectingMember] = useState<GroupMember | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const isPenaltyBoxActive = !!penaltyBoxUntil && new Date(penaltyBoxUntil).getTime() > Date.now();

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const memberCount = squad.members?.length ?? 0;
  const spotsLeft = Math.max(0, squad.max_players - memberCount);
  const poolTotal = memberCount * squad.stake_amount;
  const currentMember = squad.members?.find((m) => m.user_id === user?.id);
  const isUserMember = Boolean(currentMember) || squad.creator_id === user?.id;
  const dailyDeadline = currentMember?.daily_deadline || squad.daily_deadline || squad.deadline;
  const todayTime = getTimeRemaining(dailyDeadline);
  const joinedMembersCount = squad.members?.filter(m => m.status === 'joined').length ?? (squad.min_players ?? 2);
  const dynamicQuorum = Math.max(1, joinedMembersCount - 1);

  const handleJoin = async () => {
    if (isPenaltyBoxActive) {
      showToast(`Account locked in Penalty Box until ${new Date(penaltyBoxUntil!).toLocaleDateString()}. Joining lobbies is suspended.`, "error");
      return;
    }
    const isLobby = squad.oath_type === "lobby";
    const stake = squad.stake_amount;
    const fee = isLobby ? Math.round(stake * 0.10 * 100) / 100 : 0;
    const totalDeduction = stake + fee;

    const message = `Join this lobby challenge? Base buy-in stake is ${utilsFormatCurrency(stake, region)} + 10% platform protocol fee (${utilsFormatCurrency(fee, region)}) = Total ${utilsFormatCurrency(totalDeduction, region)} charged from your wallet. Your ${utilsFormatCurrency(stake, region)} stake is locked in escrow until deadline verification.`;

    const confirmed = await confirmAction({
      title: "Join Public Lobby?",
      message,
      confirmLabel: `Join & Pay ${utilsFormatCurrency(totalDeduction, region)}`,
      cancelLabel: "Cancel",
      variant: "default",
    });
    if (!confirmed) return;

    setLoading(true);
    const { error } = await joinSquad(squad.id, squad.stake_amount);
    setLoading(false);
    if (error) {
      showToast(error, "error");
    } else {
      showToast("Joined Lobby! Stake locked in escrow.", "success");
      onJoined?.();
    }
  };

  const handleVote = async (memberId: string, vote: boolean) => {
    const { error } = await castVote(memberId, squad.id, vote);
    if (error) {
      showToast(error, "error");
    } else {
      showToast(vote ? "Vote recorded: Proof approved" : "Vote recorded: Proof rejected", "info");
      onJoined?.();
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden fade-in bg-zinc-50 dark:bg-transparent">
      {/* Detail Header */}
      <div className="px-5 py-4 border-b-2 border-zinc-950 dark:border-zinc-800/40 bg-white dark:bg-transparent">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-widest">
            Lobby Detail
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

      {/* Stats Row */}
      <div className="grid grid-cols-3 border-b-2 border-zinc-200 dark:border-zinc-800/40 bg-white dark:bg-zinc-950/30">
        <div className="px-2 sm:px-4 py-2.5 sm:py-3 border-r-2 border-zinc-200 dark:border-zinc-800/40 text-center min-w-0">
          <p className="text-base sm:text-2xl font-black stake-number text-zinc-950 dark:text-zinc-100 truncate">{utilsFormatCurrency(poolTotal, region)}</p>
          <p className="text-[8px] sm:text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-widest mt-0.5 truncate">Total Escrow</p>
        </div>
        <div className="px-2 sm:px-4 py-2.5 sm:py-3 border-r-2 border-zinc-200 dark:border-zinc-800/40 text-center min-w-0">
          <p className="text-base sm:text-2xl font-black stake-number text-zinc-950 dark:text-zinc-100 truncate">{utilsFormatCurrency(squad.stake_amount, region)}</p>
          <p className="text-[8px] sm:text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-widest mt-0.5 truncate">Per Player</p>
        </div>
        <div className="px-2 sm:px-4 py-2.5 sm:py-3 text-center min-w-0">
          <p className="text-base sm:text-2xl font-black stake-number text-zinc-950 dark:text-zinc-100">{spotsLeft}</p>
          <p className="text-[8px] sm:text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-widest mt-0.5 truncate">Spots Left</p>
        </div>
      </div>

      {/* Daily Cadence & Streak Bar */}
      {(squad.total_days ?? 1) > 1 && (
        <div className="px-5 py-2.5 bg-zinc-100 dark:bg-zinc-900 border-b-2 border-zinc-200 dark:border-zinc-800 flex items-center justify-between text-xs font-mono">
          <span className="font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5" /> DAY {squad.current_day || 1} OF {squad.total_days} · STREAK: {squad.current_streak ?? 0} DAYS
          </span>
          <span className="text-[10px] text-zinc-600 dark:text-zinc-400 font-bold uppercase">
            Today&apos;s Proof Due in {todayTime.hours}h {todayTime.minutes}m
          </span>
        </div>
      )}

      {/* Members List — Task Log Feed */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-3 border-b border-zinc-200 dark:border-zinc-800/30 bg-zinc-100 dark:bg-transparent flex flex-wrap items-center justify-between gap-1">
          <span className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest">
            Lobby Log & Proof Verifications
          </span>
          <span className="text-[10px] font-mono font-bold text-zinc-500">
            Quorum: {dynamicQuorum} approval{dynamicQuorum === 1 ? '' : 's'} needed per proof
          </span>
        </div>

        {squad.members?.map((member, index) => (
          <MemberLogEntry
            key={member.id}
            member={member}
            index={index}
            currentUserId={user?.id}
            dynamicQuorum={dynamicQuorum}
            onVote={handleVote}
            onInspectProof={() => setInspectingMember(member)}
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

      {/* Joined Action Bar / Open Chat */}
      {isUserMember && (
        <div className="px-5 py-3 border-t-2 border-zinc-950 dark:border-zinc-800/40 bg-zinc-100 dark:bg-zinc-900/60 flex items-center justify-between gap-3 shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            <span className="text-[11px] font-mono font-bold text-zinc-900 dark:text-zinc-200 uppercase truncate">
              In this lobby
            </span>
          </div>
          <button
            onClick={() => setShowChat(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 text-xs font-mono font-black uppercase tracking-wider hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors border-2 border-zinc-950 dark:border-transparent shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none shrink-0"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            Open Chat
          </button>
        </div>
      )}

      {/* Join Button */}
      {spotsLeft > 0 && (squad.status === "pending" || squad.status === "active") && !isUserMember && (
        <div className="px-5 py-4 border-t-2 border-zinc-950 dark:border-zinc-800/40 bg-white dark:bg-transparent shrink-0 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {isPenaltyBoxActive ? (
            <div className="p-3 bg-red-500/10 border-2 border-red-500/30 text-center">
              <p className="text-xs font-mono font-bold text-red-500 uppercase tracking-wider flex items-center justify-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Benched in Penalty Box
              </p>
              <p className="text-[11px] font-mono text-zinc-500 mt-0.5">
                Account suspended until {new Date(penaltyBoxUntil!).toLocaleDateString()} {new Date(penaltyBoxUntil!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          ) : (
            <button
              onClick={handleJoin}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3.5 bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 text-sm font-black tracking-tight uppercase hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50 border-2 border-zinc-950 dark:border-transparent shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {loading ? "Joining..." : `Join Lobby (${utilsFormatCurrency(squad.stake_amount * 1.1, region)})`}
            </button>
          )}
        </div>
      )}

      {/* Proof Inspection Modal */}
      {inspectingMember && (() => {
        const memberProofs = (squad.proofs || []).filter((p) => p.submitted_by === inspectingMember.user_id);
        const proof =
          memberProofs.find((p) => p.status === "pending_review") ||
          [...memberProofs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
        const reviewDeadline =
          proof?.review_deadline ||
          (proof?.created_at
            ? new Date(new Date(proof.created_at).getTime() + 24 * 3600 * 1000).toISOString()
            : new Date().toISOString());
        const remainingMs = Math.max(0, new Date(reviewDeadline).getTime() - now);
        const hours = Math.floor(remainingMs / (1000 * 60 * 60));
        const mins = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
        const secs = Math.floor((remainingMs % (1000 * 60)) / 1000);

        const isImage =
          proof?.proof_type === "photo" ||
          proof?.proof_type === "screenshot" ||
          Boolean(proof?.proof_url && /\.(jpg|jpeg|png|webp|gif)/i.test(proof.proof_url));

        const isVideo =
          proof?.proof_type === "video" ||
          Boolean(proof?.proof_url && /\.(mp4|webm|mov)/i.test(proof.proof_url));

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-3 sm:p-4 overflow-y-auto">
            <div className="bg-white dark:bg-zinc-900 border-4 border-zinc-950 dark:border-zinc-700 max-w-lg w-full p-4 sm:p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] relative fade-in my-auto text-left max-h-[92dvh] overflow-y-auto">
              <button
                onClick={() => setInspectingMember(null)}
                aria-label="Close modal"
                className="absolute top-3 right-3 sm:top-4 sm:right-4 text-zinc-500 hover:text-zinc-950 dark:hover:text-white p-2 min-w-[36px] min-h-[36px] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
              <h4 className="text-base font-black uppercase tracking-tight text-zinc-950 dark:text-white mb-1 pr-8">
                Inspect Proof Submission
              </h4>
              <p className="text-xs font-mono text-zinc-600 dark:text-zinc-400 mb-3 font-bold">
                Submitted by @{inspectingMember.user?.username || "lobby_member"}{inspectingMember.stake_amount > 0 ? ` · Stake: ${utilsFormatCurrency(inspectingMember.stake_amount, region)}` : ''}
              </p>

              {/* 24-hour review timer */}
              <div className="p-2.5 bg-zinc-100 dark:bg-zinc-800 border-2 border-zinc-950 dark:border-zinc-700 flex items-center justify-between text-xs font-mono mb-3">
                <span className="text-zinc-900 dark:text-zinc-100 font-bold flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-red-600" />
                  24h Review Window: {hours}h {mins}m {secs}s remaining
                </span>
                <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                  Voting Window
                </span>
              </div>

              {/* Proof Verification Record */}
              <div className="p-3 sm:p-4 bg-zinc-100 dark:bg-zinc-950 border-2 border-zinc-300 dark:border-zinc-800 mb-4 text-xs font-mono">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-zinc-900 dark:text-zinc-100 uppercase text-[10px] tracking-wider">
                    Evidence ({proof?.proof_type || "Activity"}):
                  </span>
                  <span className="uppercase text-[9px] font-bold px-1.5 py-0.5 border border-zinc-400 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300">
                    {proof?.status || inspectingMember.status}
                  </span>
                </div>

                {isImage && proof?.proof_url && (
                  <div className="border border-zinc-300 dark:border-zinc-700 overflow-hidden bg-black flex items-center justify-center max-h-[40vh] sm:max-h-60 mb-2.5">
                    <img
                      src={proof.proof_url}
                      alt="Submitted proof evidence"
                      className="max-h-[40vh] sm:max-h-60 w-full object-contain"
                    />
                  </div>
                )}

                {isVideo && proof?.proof_url && (
                  <div className="border border-zinc-300 dark:border-zinc-700 overflow-hidden bg-black max-h-[40vh] sm:max-h-60 mb-2.5">
                    <video
                      src={proof.proof_url}
                      controls
                      className="max-h-[40vh] sm:max-h-60 w-full object-contain"
                    />
                  </div>
                )}

                {proof?.proof_text && (
                  <div className="p-2.5 bg-white dark:bg-zinc-900 border-l-4 border-amber-500 text-zinc-800 dark:text-zinc-200 text-xs italic mb-2 leading-relaxed">
                    &ldquo;{proof.proof_text}&rdquo;
                  </div>
                )}

                {proof?.proof_url && (
                  <div className="my-1">
                    <a
                      href={proof.proof_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-sky-500 dark:text-sky-400 underline font-bold hover:opacity-80"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> View Submitted Evidence Link &rarr;
                    </a>
                  </div>
                )}

                {!proof && (
                  <div className="p-3 border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 text-xs leading-relaxed font-mono">
                    Member verified task completion for &ldquo;{squad.oath_statement}&rdquo;. Evidence logged in immutable lobby registry.
                  </div>
                )}

                <div className="flex items-center justify-between mt-3 pt-2 border-t border-zinc-300 dark:border-zinc-800 text-[11px] text-zinc-500 font-bold">
                  <span>Quorum: {inspectingMember.votes_received} / {dynamicQuorum} votes ({dynamicQuorum} other member{dynamicQuorum === 1 ? '' : 's'})</span>
                  <span className="uppercase text-zinc-900 dark:text-zinc-200">{inspectingMember.status}</span>
                </div>
              </div>

              {!isUserMember ? (
                <div className="p-3 bg-zinc-100 dark:bg-zinc-800 border-2 border-zinc-950 dark:border-zinc-700 text-center font-mono text-xs text-zinc-600 dark:text-zinc-300">
                  Join this lobby to cast quorum verification votes on members.
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                  <button
                    onClick={() => {
                      handleVote(inspectingMember.id, true);
                      setInspectingMember(null);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 sm:py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black uppercase tracking-wider min-h-[44px] sm:min-h-0"
                  >
                    <ThumbsUp className="w-3.5 h-3.5" /> Pass Today&apos;s Work
                  </button>
                  <button
                    onClick={async () => {
                      const note = window.prompt("What additional proof is needed from this member? (e.g. clearer photo, timestamp, video)");
                      if (!note || !note.trim()) return;
                      const { error } = await requestMoreProof(squad.id, note.trim(), proof?.id);
                      if (error) {
                        showToast(error, "error");
                      } else {
                        showToast("Requested more proof from member.", "info");
                        setInspectingMember(null);
                        onJoined?.();
                      }
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 sm:py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-black uppercase tracking-wider min-h-[44px] sm:min-h-0"
                  >
                    <Zap className="w-3.5 h-3.5" /> Need More Proof
                  </button>
                  <button
                    onClick={() => {
                      handleVote(inspectingMember.id, false);
                      setInspectingMember(null);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 py-3 sm:py-2.5 border-2 border-red-600 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-black uppercase tracking-wider min-h-[44px] sm:min-h-0"
                  >
                    <ThumbsDown className="w-3.5 h-3.5" /> Reject (Fraud)
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {showChat && (
        <ChatRoom
          oath={squad}
          onClose={() => setShowChat(false)}
        />
      )}
    </div>
  );
}

function MemberLogEntry({
  member,
  index,
  currentUserId,
  dynamicQuorum = 1,
  onVote,
  onInspectProof,
}: {
  member: GroupMember;
  index: number;
  currentUserId?: string;
  dynamicQuorum?: number;
  onVote: (memberId: string, vote: boolean) => void;
  onInspectProof?: () => void;
}) {
  const { region } = useRegion();
  const isCurrentUser = Boolean(currentUserId && member.user_id === currentUserId);
  const hasVoted = Boolean(currentUserId && member.voted_by?.includes(currentUserId));
  const isConcluded = member.status === "completed" || member.status === "failed";

  return (
    <div
      className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-200 dark:border-zinc-800/25 fade-in bg-white dark:bg-transparent hover:bg-zinc-50 dark:hover:bg-zinc-900/20"
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
            <span className="text-[10px] font-mono text-zinc-600 dark:text-zinc-400 stake-number font-bold">
              {member.stake_amount > 0 ? `${utilsFormatCurrency(member.stake_amount, region)} staked` : "No financial stake"}
            </span>
            {member.proof_submitted && (
              <span className="text-[9px] font-mono text-zinc-600 dark:text-zinc-400 flex items-center gap-1 font-bold">
                <Upload className="w-2.5 h-2.5 text-zinc-500" /> Proof submitted
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Voting / Status */}
      <div className="flex items-center gap-2">
        {member.proof_submitted && !isConcluded && (
          <div className="flex items-center gap-1.5 mr-2">
            <span className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400">
              {member.votes_received}/{dynamicQuorum}
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
                  onClick={onInspectProof}
                  className="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center border border-zinc-400 dark:border-zinc-700 hover:border-zinc-950 dark:hover:border-zinc-300 text-zinc-700 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 transition-colors bg-zinc-100 dark:bg-zinc-800"
                  title="Inspect proof before voting"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onVote(member.id, true)}
                  className="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center border border-zinc-400 dark:border-zinc-700 hover:border-zinc-950 dark:hover:border-zinc-300 text-zinc-700 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 transition-colors bg-zinc-100 dark:bg-zinc-800"
                  title="Vote: Approve proof"
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onVote(member.id, false)}
                  className="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center border border-zinc-400 dark:border-zinc-700 hover:border-red-600 text-zinc-700 dark:text-zinc-400 hover:text-red-600 transition-colors bg-zinc-100 dark:bg-zinc-800"
                  title="Vote: Reject proof"
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        )}
        <span
          className={`text-[9px] font-mono font-bold uppercase tracking-widest px-2 py-0.5 border ${
            member.status === "joined"
              ? "border-zinc-400 dark:border-zinc-700 text-zinc-700 dark:text-zinc-400"
              : member.status === "completed"
              ? "border-zinc-800 bg-zinc-950 text-white dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200"
              : member.status === "failed"
              ? "border-red-600 bg-red-600 text-white"
              : "border-zinc-400 text-zinc-600"
          }`}
        >
          {member.status}
        </span>
      </div>
    </div>
  );
}
