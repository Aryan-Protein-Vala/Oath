"use client";

import { useState } from "react";
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
} from "lucide-react";
import type { Oath, GroupMember, Wallet } from "@/lib/types";
import { formatCurrency as utilsFormatCurrency, getTimeRemaining, formatRelativeTime } from "@/lib/utils";
import { joinSquad, castVote } from "@/lib/data-hooks";
import { showToast } from "./Toast";
import { useRegion } from "@/lib/region-context";
import { useAuth } from "@/lib/auth-context";
import CreateLobbyModal from "./CreateLobbyModal";

interface LobbiesViewProps {
  squads: Oath[];
  wallet: Wallet;
  onJoined?: () => void;
  onCreateLobby?: () => void;
}

export default function LobbiesView({ squads, wallet, onJoined, onCreateLobby }: LobbiesViewProps) {
  const [selectedSquadId, setSelectedSquadId] = useState<string | null>(null);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const selectedSquad = squads.find((s) => s.id === selectedSquadId) || null;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Lobby List — hidden on mobile when detail is shown */}
      <div className={`${
        mobileShowDetail ? "hidden sm:flex" : "flex"
      } ${selectedSquad ? "sm:w-96" : "flex-1"} w-full flex-col border-r-2 border-zinc-950 dark:border-zinc-800/60 overflow-hidden transition-all bg-white dark:bg-transparent`}>
        <div className="px-5 py-4 border-b-2 border-zinc-950 dark:border-zinc-800/40 bg-zinc-100 dark:bg-zinc-900/50">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black tracking-tight text-zinc-950 dark:text-zinc-100">
                ACCOUNTABILITY SQUADS
              </h2>
              <p className="text-[10px] font-mono text-zinc-600 dark:text-zinc-400 tracking-wide mt-0.5 font-bold">
                Shared accountability. If you fail, you forfeit your stake.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono font-bold text-zinc-700 dark:text-zinc-400 px-2 py-1 border border-zinc-400 dark:border-zinc-800">
                {squads.length} open
              </span>
              {onCreateLobby && (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 text-[10px] font-mono font-black uppercase tracking-widest hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors border-2 border-zinc-950 dark:border-transparent shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                >
                  <UserPlus className="w-3 h-3" />
                  Create
                </button>
              )}
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
              onClick={() => {
                setSelectedSquadId(squad.id);
                setMobileShowDetail(true);
              }}
            />
          ))}

          {squads.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 p-6 gap-4">
              <div className="text-center">
                <p className="text-zinc-800 dark:text-zinc-400 text-sm font-bold font-mono">No open lobbies</p>
                <p className="text-zinc-500 text-xs font-mono mt-1">Be the first to create a Squad oath</p>
              </div>
              {onCreateLobby && (
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs font-black uppercase tracking-wider hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors border-2 border-zinc-950 dark:border-transparent shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                >
                  <UserPlus className="w-4 h-4" />
                  Create a Lobby
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
          <div className="flex sm:hidden items-center px-4 py-2 border-b-2 border-zinc-950 dark:border-zinc-800/60 bg-zinc-100 dark:bg-zinc-900/50">
            <button
              onClick={() => { setMobileShowDetail(false); setSelectedSquadId(null); }}
              className="flex items-center gap-1.5 text-[10px] font-mono font-black uppercase tracking-widest text-zinc-700 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200"
            >
              <UserPlus className="w-3 h-3 rotate-180" />
              All Lobbies
            </button>
          </div>
          <SquadDetail
            squad={selectedSquad}
            wallet={wallet}
            onClose={() => { setSelectedSquadId(null); setMobileShowDetail(false); }}
            onJoined={onJoined}
          />
        </div>
      )}

      {showCreateModal && (
        <CreateLobbyModal
          walletBalance={wallet.balance}
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
  const [inspectingMember, setInspectingMember] = useState<GroupMember | null>(null);
  const memberCount = squad.members?.length ?? 0;
  const spotsLeft = Math.max(0, squad.max_players - memberCount);
  const poolTotal = memberCount * squad.stake_amount;

  const handleJoin = async () => {
    setLoading(true);
    const { error } = await joinSquad(squad.id, squad.stake_amount);
    setLoading(false);
    if (error) {
      showToast(error, "error");
    } else {
      showToast(squad.oath_type === "lobby" ? "Joined Lobby! Stake locked in escrow." : "Joined accountability squad! Stake covered by squad leader.", "success");
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

      {/* Stats Row */}
      <div className="grid grid-cols-3 border-b-2 border-zinc-200 dark:border-zinc-800/40 bg-white dark:bg-zinc-950/30">
        <div className="px-4 py-3 border-r-2 border-zinc-200 dark:border-zinc-800/40 text-center">
          <p className="text-2xl font-black stake-number text-zinc-950 dark:text-zinc-100">{utilsFormatCurrency(poolTotal, region)}</p>
          <p className="text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-widest mt-0.5">Total Escrow</p>
        </div>
        <div className="px-4 py-3 border-r-2 border-zinc-200 dark:border-zinc-800/40 text-center">
          <p className="text-2xl font-black stake-number text-zinc-950 dark:text-zinc-100">{utilsFormatCurrency(squad.stake_amount, region)}</p>
          <p className="text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-widest mt-0.5">Per Player</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-2xl font-black stake-number text-zinc-950 dark:text-zinc-100">{spotsLeft}</p>
          <p className="text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-widest mt-0.5">Spots Left</p>
        </div>
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

      {/* Join Button */}
      {spotsLeft > 0 && (squad.status === "pending" || squad.status === "active") && !squad.members?.some((m) => m.user_id === user?.id) && (
        <div className="px-5 py-4 border-t-2 border-zinc-950 dark:border-zinc-800/40 bg-white dark:bg-transparent">
          <button
            onClick={handleJoin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 text-sm font-black tracking-tight uppercase hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50 border-2 border-zinc-950 dark:border-transparent shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {loading ? "Joining..." : squad.oath_type === "lobby" ? `Join Lobby (${utilsFormatCurrency(squad.stake_amount, region)})` : "Join Squad (Free — Covered by Leader)"}
          </button>
        </div>
      )}

      {/* Proof Inspection Modal */}
      {inspectingMember && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-zinc-900 border-4 border-zinc-950 dark:border-zinc-700 max-w-md w-full p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] relative fade-in">
            <button
              onClick={() => setInspectingMember(null)}
              className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-950 dark:hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
            <h4 className="text-base font-black uppercase tracking-tight text-zinc-950 dark:text-white mb-1">
              Inspect Proof Submission
            </h4>
            <p className="text-xs font-mono text-zinc-600 dark:text-zinc-400 mb-4 font-bold">
              Submitted by @{inspectingMember.user?.username || "squad_member"}{inspectingMember.stake_amount > 0 ? ` · Stake: ${utilsFormatCurrency(inspectingMember.stake_amount, region)}` : ''}
            </p>

            <div className="p-4 bg-zinc-100 dark:bg-zinc-950 border-2 border-zinc-300 dark:border-zinc-800 mb-4 text-xs font-mono">
              <p className="font-bold text-zinc-900 dark:text-zinc-100 mb-2">Proof Verification Record:</p>
              <div className="p-3 border border-zinc-300 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 text-xs leading-relaxed font-mono">
                📸 Verified Activity for &ldquo;{squad.oath_statement}&rdquo;: Submitted by @{inspectingMember.user?.username || "squad_member"}. Evidence logged in immutable squad registry.
              </div>
              <div className="flex items-center justify-between mt-3 text-[11px] text-zinc-500 font-bold">
                <span>Quorum: {inspectingMember.votes_received} / {inspectingMember.votes_needed} votes</span>
                <span className="uppercase text-zinc-900 dark:text-zinc-200">{inspectingMember.status}</span>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  handleVote(inspectingMember.id, true);
                  setInspectingMember(null);
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 text-xs font-black uppercase tracking-wider hover:bg-zinc-800"
              >
                <ThumbsUp className="w-3.5 h-3.5" /> Approve Proof
              </button>
              <button
                onClick={() => {
                  handleVote(inspectingMember.id, false);
                  setInspectingMember(null);
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 border-2 border-red-600 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-black uppercase tracking-wider"
              >
                <ThumbsDown className="w-3.5 h-3.5" /> Reject (Fraud)
              </button>
            </div>
          </div>
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
  onInspectProof,
}: {
  member: GroupMember;
  index: number;
  currentUserId?: string;
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
            {member.user?.duffer_debt ? member.user.duffer_debt > 0 && (
              <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 border-2 border-red-600 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 uppercase tracking-widest shadow-[2px_2px_0px_0px_rgba(220,38,38,1)] dark:shadow-none ml-1">
                DUFFER
              </span>
            ) : null}
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
                  onClick={onInspectProof}
                  className="p-1.5 border border-zinc-400 dark:border-zinc-700 hover:border-zinc-950 dark:hover:border-zinc-300 text-zinc-700 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 transition-colors bg-zinc-100 dark:bg-zinc-800"
                  title="Inspect proof before voting"
                >
                  <Eye className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onVote(member.id, true)}
                  className="p-1.5 border border-zinc-400 dark:border-zinc-700 hover:border-zinc-950 dark:hover:border-zinc-300 text-zinc-700 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 transition-colors bg-zinc-100 dark:bg-zinc-800"
                  title="Vote: Approve proof"
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onVote(member.id, false)}
                  className="p-1.5 border border-zinc-400 dark:border-zinc-700 hover:border-red-600 text-zinc-700 dark:text-zinc-400 hover:text-red-600 transition-colors bg-zinc-100 dark:bg-zinc-800"
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
