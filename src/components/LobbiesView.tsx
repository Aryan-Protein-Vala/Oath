"use client";

import { useState } from "react";
import {
  Users,
  Clock,
  DollarSign,
  ChevronRight,
  Zap,
  Shield,
  UserPlus,
  Eye,
  Upload,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import type { Oath, GroupMember } from "@/lib/types";
import { formatCurrency, getTimeRemaining, formatRelativeTime } from "@/lib/utils";

interface LobbiesViewProps {
  squads: Oath[];
}

export default function LobbiesView({ squads }: LobbiesViewProps) {
  const [selectedSquad, setSelectedSquad] = useState<Oath | null>(null);

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Lobby List */}
      <div className={`${selectedSquad ? "w-96" : "flex-1"} flex flex-col border-r border-zinc-800/60 overflow-hidden transition-all`}>
        <div className="px-5 py-4 border-b border-zinc-800/40">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black tracking-tight text-zinc-100">
                SQUAD POOLS
              </h2>
              <p className="text-[10px] font-mono text-zinc-600 tracking-wide mt-0.5">
                Winner takes all. Losers fund the victor.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-zinc-600 px-2 py-1 border border-zinc-800">
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
              onClick={() => setSelectedSquad(squad)}
            />
          ))}

          {squads.length === 0 && (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <p className="text-zinc-700 text-sm font-mono">No open lobbies</p>
                <p className="text-zinc-800 text-xs font-mono mt-1">Create one yourself</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Squad Detail */}
      {selectedSquad && (
        <SquadDetail
          squad={selectedSquad}
          onClose={() => setSelectedSquad(null)}
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
  const time = getTimeRemaining(squad.deadline);
  const memberCount = squad.members?.length ?? 0;
  const spotsLeft = squad.max_players - memberCount;
  const poolTotal = memberCount * squad.stake_amount;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 border-b border-zinc-800/30 transition-all card-hover fade-in ${
        isSelected ? "bg-zinc-900/60" : "hover:bg-zinc-900/30"
      }`}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Statement */}
          <p className="text-sm font-semibold text-zinc-200 leading-tight mb-2">
            {squad.oath_statement}
          </p>

          {/* Meta row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <Users className="w-3 h-3 text-zinc-600" />
              <span className="text-[10px] font-mono text-zinc-400">
                {memberCount}/{squad.max_players}
              </span>
              {spotsLeft > 0 && (
                <span className="text-[9px] font-mono text-zinc-600 ml-0.5">
                  ({spotsLeft} spots)
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <DollarSign className="w-3 h-3 text-zinc-600" />
              <span className="text-[10px] font-mono font-bold text-zinc-300 stake-number">
                {formatCurrency(squad.stake_amount)}/player
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-zinc-600" />
              <span
                className={`text-[10px] font-mono ${
                  time.isUrgent ? "text-red-500" : "text-zinc-500"
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
                  className="w-5 h-5 bg-zinc-800 border border-zinc-700 flex items-center justify-center"
                  title={member.user?.username}
                >
                  <span className="text-[7px] font-mono font-bold text-zinc-500 uppercase">
                    {member.user?.username?.substring(0, 2) ?? "?"}
                  </span>
                </div>
              ))}
              {memberCount > 5 && (
                <span className="text-[9px] font-mono text-zinc-600 ml-1">
                  +{memberCount - 5}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right — Pool total & status */}
        <div className="flex flex-col items-end shrink-0">
          <span className="text-lg font-black stake-number text-zinc-200 tracking-tight">
            {formatCurrency(poolTotal)}
          </span>
          <span className="text-[9px] font-mono text-zinc-600 mt-0.5">POOL</span>
          <span
            className={`text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 border mt-2 ${
              squad.status === "pending"
                ? "border-zinc-700 text-zinc-500"
                : squad.status === "active"
                ? "border-zinc-600 text-zinc-300"
                : "border-red-900 text-red-600"
            }`}
          >
            {squad.status}
          </span>
        </div>
      </div>
    </button>
  );
}

function SquadDetail({ squad, onClose }: { squad: Oath; onClose: () => void }) {
  const memberCount = squad.members?.length ?? 0;
  const spotsLeft = squad.max_players - memberCount;
  const poolTotal = memberCount * squad.stake_amount;

  return (
    <div className="flex-1 flex flex-col overflow-hidden fade-in">
      {/* Detail Header */}
      <div className="px-5 py-4 border-b border-zinc-800/40">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
            Squad Detail
          </span>
          <button
            onClick={onClose}
            className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors px-2 py-1 border border-zinc-800"
          >
            Close
          </button>
        </div>
        <h3 className="text-xl font-black tracking-tight text-zinc-100 leading-tight">
          {squad.oath_statement}
        </h3>
        <p className="text-[11px] font-mono text-zinc-500 mt-1">
          Created by @{squad.creator?.username ?? "unknown"} · {formatRelativeTime(squad.created_at)}
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-3 border-b border-zinc-800/40">
        <div className="px-4 py-3 border-r border-zinc-800/40 text-center">
          <p className="text-2xl font-black stake-number text-zinc-100">{formatCurrency(poolTotal)}</p>
          <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mt-0.5">Total Pool</p>
        </div>
        <div className="px-4 py-3 border-r border-zinc-800/40 text-center">
          <p className="text-2xl font-black stake-number text-zinc-100">{formatCurrency(squad.stake_amount)}</p>
          <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mt-0.5">Per Player</p>
        </div>
        <div className="px-4 py-3 text-center">
          <p className="text-2xl font-black stake-number text-zinc-100">{spotsLeft}</p>
          <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mt-0.5">Spots Left</p>
        </div>
      </div>

      {/* Members List — Task Log Feed style, NO CHAT */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 py-3 border-b border-zinc-800/30">
          <span className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
            Squad Log
          </span>
        </div>

        {squad.members?.map((member, index) => (
          <MemberLogEntry key={member.id} member={member} index={index} />
        ))}

        {/* Empty slots */}
        {Array.from({ length: spotsLeft }).map((_, i) => (
          <div
            key={`empty-${i}`}
            className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800/20"
          >
            <div className="w-6 h-6 border border-dashed border-zinc-800 flex items-center justify-center">
              <UserPlus className="w-3 h-3 text-zinc-800" />
            </div>
            <span className="text-[11px] font-mono text-zinc-700">Open spot</span>
          </div>
        ))}
      </div>

      {/* Join Button */}
      {spotsLeft > 0 && squad.status === "pending" && (
        <div className="px-5 py-4 border-t border-zinc-800/40">
          <button className="w-full flex items-center justify-center gap-2 py-3 bg-zinc-50 text-zinc-950 text-sm font-black tracking-tight uppercase hover:bg-zinc-200 transition-colors">
            <Zap className="w-4 h-4" />
            Join Pool — Lock {formatCurrency(squad.stake_amount)}
          </button>
        </div>
      )}
    </div>
  );
}

function MemberLogEntry({ member, index }: { member: GroupMember; index: number }) {
  return (
    <div
      className="flex items-center justify-between px-5 py-3 border-b border-zinc-800/20 fade-in"
      style={{ animationDelay: `${index * 50}ms` }}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="w-6 h-6 bg-zinc-800 border border-zinc-700 flex items-center justify-center">
          <span className="text-[8px] font-mono font-bold text-zinc-400 uppercase">
            {member.user?.username?.substring(0, 2) ?? "??"}
          </span>
        </div>

        <div>
          <span className="text-sm text-zinc-300 font-medium">
            @{member.user?.username ?? "unknown"}
          </span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] font-mono text-zinc-600 stake-number">
              {formatCurrency(member.stake_amount)} staked
            </span>
            {member.proof_submitted && (
              <span className="text-[9px] font-mono text-zinc-500 flex items-center gap-1">
                <Upload className="w-2.5 h-2.5" /> Proof submitted
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Voting / Status */}
      <div className="flex items-center gap-2">
        {member.proof_submitted && (
          <div className="flex items-center gap-1">
            <span className="text-[9px] font-mono text-zinc-500">
              {member.votes_received}/{member.votes_needed}
            </span>
            <button className="p-1 border border-zinc-800 hover:border-zinc-600 text-zinc-500 hover:text-zinc-300 transition-colors">
              <ThumbsUp className="w-3 h-3" />
            </button>
            <button className="p-1 border border-zinc-800 hover:border-red-800 text-zinc-500 hover:text-red-500 transition-colors">
              <ThumbsDown className="w-3 h-3" />
            </button>
          </div>
        )}
        <span
          className={`text-[9px] font-mono uppercase tracking-widest px-2 py-0.5 border ${
            member.status === "joined"
              ? "border-zinc-700 text-zinc-500"
              : member.status === "completed"
              ? "border-zinc-600 text-zinc-300"
              : member.status === "failed"
              ? "border-red-900 text-red-600"
              : "border-zinc-800 text-zinc-700"
          }`}
        >
          {member.status}
        </span>
      </div>
    </div>
  );
}
