"use client";

import {
  TrendingUp,
  TrendingDown,
  Zap,
  Award,
  Flame,
  BarChart2,
  DollarSign,
  Calendar,
  ChevronRight,
  LogOut,
} from "lucide-react";
import { formatCurrency, formatCurrencyPrecise, formatRelativeTime } from "@/lib/utils";
import type { Profile, Wallet, Transaction } from "@/lib/types";

interface ProfileViewProps {
  profile: Profile;
  wallet: Wallet;
  transactions: Transaction[];
  onSignOut: () => void;
}

export default function ProfileView({ profile, wallet, transactions, onSignOut }: ProfileViewProps) {
  const completionRate =
    profile.oaths_created > 0
      ? Math.round((profile.oaths_completed / profile.oaths_created) * 100)
      : 0;

  const repColor =
    profile.reputation_score >= 80
      ? "text-zinc-200"
      : profile.reputation_score >= 50
      ? "text-zinc-400"
      : "text-red-500";

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left — Profile stats */}
      <div className="w-72 border-r border-zinc-800/60 flex flex-col overflow-y-auto">
        {/* Identity */}
        <div className="p-5 border-b border-zinc-800/40">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0">
              <span className="text-sm font-mono font-black text-zinc-300 uppercase">
                {profile.username.substring(0, 2)}
              </span>
            </div>
            <div>
              <p className="text-base font-black text-zinc-100 tracking-tight">
                @{profile.username}
              </p>
              <p className="text-[10px] font-mono text-zinc-600">
                Member since {formatRelativeTime(profile.created_at)}
              </p>
            </div>
          </div>

          {/* Reputation */}
          <div className="mb-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest">
                Reputation
              </span>
              <span className={`text-sm font-black stake-number ${repColor}`}>
                {profile.reputation_score}/100
              </span>
            </div>
            <div className="progress-bar h-0.5 w-full">
              <div
                className={`h-full transition-all ${
                  profile.reputation_score < 40 ? "bg-red-600" : "bg-zinc-400"
                }`}
                style={{ width: `${profile.reputation_score}%` }}
              />
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 border-b border-zinc-800/40">
          <StatCell label="Created" value={profile.oaths_created} />
          <StatCell label="Completed" value={profile.oaths_completed} accent />
          <StatCell label="Failed" value={profile.oaths_failed} danger />
          <StatCell label="Rate" value={`${completionRate}%`} />
        </div>

        {/* Money stats */}
        <div className="p-4 border-b border-zinc-800/40 space-y-3">
          <MoneyRow label="Total Staked" value={profile.total_staked} />
          <MoneyRow label="Total Won" value={profile.total_won} positive />
          <MoneyRow label="Total Lost" value={profile.total_lost} negative />
        </div>

        {/* Wallet summary */}
        <div className="p-4 border-b border-zinc-800/40 space-y-2">
          <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mb-2">
            Wallet
          </p>
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-mono text-zinc-500">Available</span>
            <span className="text-sm font-black stake-number text-zinc-200">
              {formatCurrencyPrecise(wallet.balance)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-mono text-zinc-500">In Escrow</span>
            <span className="text-sm font-black stake-number text-zinc-500">
              {formatCurrencyPrecise(wallet.escrow_locked)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-mono text-zinc-500">All-time In</span>
            <span className="text-sm font-mono text-zinc-600 stake-number">
              {formatCurrencyPrecise(wallet.total_deposited)}
            </span>
          </div>
        </div>

        {/* Sign Out */}
        <div className="p-4 mt-auto">
          <button
            onClick={onSignOut}
            className="w-full flex items-center justify-center gap-2 py-2.5 border border-zinc-800 text-xs font-mono text-zinc-600 hover:text-red-400 hover:border-red-900/50 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Right — Transaction History */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800/40">
          <h3 className="text-base font-black tracking-tight text-zinc-100">
            TRANSACTION LEDGER
          </h3>
          <p className="text-[10px] font-mono text-zinc-600 mt-0.5">
            Full financial record of your oaths.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {transactions.length === 0 ? (
            <div className="flex items-center justify-center h-48">
              <p className="text-xs font-mono text-zinc-700">No transactions yet</p>
            </div>
          ) : (
            transactions.map((tx, i) => <LedgerRow key={tx.id} tx={tx} index={i} />)
          )}
        </div>
      </div>
    </div>
  );
}

function StatCell({
  label,
  value,
  accent,
  danger,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="px-4 py-3 border-b border-r border-zinc-800/30 last:border-r-0">
      <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mb-0.5">{label}</p>
      <p
        className={`text-xl font-black stake-number ${
          danger ? "text-red-500" : accent ? "text-zinc-200" : "text-zinc-400"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function MoneyRow({
  label,
  value,
  positive,
  negative,
}: {
  label: string;
  value: number;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        {positive && <TrendingUp className="w-3 h-3 text-zinc-500" />}
        {negative && <TrendingDown className="w-3 h-3 text-red-700" />}
        {!positive && !negative && <DollarSign className="w-3 h-3 text-zinc-700" />}
        <span className="text-[11px] font-mono text-zinc-500">{label}</span>
      </div>
      <span
        className={`text-sm font-black stake-number ${
          positive ? "text-zinc-300" : negative ? "text-red-500" : "text-zinc-400"
        }`}
      >
        {formatCurrency(value)}
      </span>
    </div>
  );
}

const TX_COLORS: Record<string, string> = {
  deposit: "text-zinc-300",
  withdrawal: "text-red-500",
  escrow_lock: "text-zinc-500",
  escrow_release: "text-zinc-200",
  penalty: "text-red-500",
  reward: "text-zinc-200",
  house_cut: "text-zinc-700",
};

const TX_PREFIX: Record<string, string> = {
  deposit: "+",
  withdrawal: "-",
  escrow_lock: "⊂",
  escrow_release: "⊃",
  penalty: "-",
  reward: "+",
  house_cut: "-",
};

function LedgerRow({ tx, index }: { tx: Transaction; index: number }) {
  return (
    <div
      className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800/25 hover:bg-zinc-900/30 transition-colors fade-in"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-zinc-300 font-medium truncate">{tx.description}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-wider">
            {tx.type.replace(/_/g, " ")}
          </span>
          <span className="text-zinc-800">·</span>
          <span className="text-[9px] font-mono text-zinc-700">
            {formatRelativeTime(tx.created_at)}
          </span>
        </div>
      </div>
      <span className={`text-sm font-black stake-number ml-4 shrink-0 ${TX_COLORS[tx.type] ?? "text-zinc-500"}`}>
        {TX_PREFIX[tx.type]}${tx.amount.toFixed(0)}
      </span>
    </div>
  );
}
