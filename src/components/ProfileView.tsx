"use client";

import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  LogOut,
  AlertTriangle,
} from "lucide-react";
import { formatCurrency as utilsFormatCurrency, formatCurrencyPrecise as utilsFormatCurrencyPrecise, formatRelativeTime } from "@/lib/utils";
import type { Profile, Wallet, Transaction } from "@/lib/types";
import { useRegion, type Region } from "@/lib/region-context";

interface ProfileViewProps {
  profile: Profile;
  wallet: Wallet;
  transactions: Transaction[];
  onSignOut: () => void;
}

export default function ProfileView({ profile, wallet, transactions, onSignOut }: ProfileViewProps) {
  const { region } = useRegion();
  const isPenaltyBoxActive = !!profile.penalty_box_until && new Date(profile.penalty_box_until).getTime() > Date.now();
  const lossStreak = profile.loss_streak ?? 0;

  const resolvedOaths = profile.oaths_completed + profile.oaths_failed;
  const completionRate = resolvedOaths > 0
    ? Math.round((profile.oaths_completed / resolvedOaths) * 100)
    : 0;

  const winLossRatio = profile.oaths_failed > 0
    ? (profile.oaths_completed / profile.oaths_failed).toFixed(1)
    : profile.oaths_completed > 0
    ? `${profile.oaths_completed}.0`
    : "0.0";

  const reputationTier =
    profile.reputation_score >= 80
      ? "STALWART"
      : profile.reputation_score >= 50
      ? "RELIABLE"
      : "PARIAH";

  const repColor =
    profile.reputation_score >= 80
      ? "text-zinc-950 dark:text-zinc-200"
      : profile.reputation_score >= 50
      ? "text-zinc-700 dark:text-zinc-400"
      : "text-red-600 dark:text-red-500";

  return (
    <div className="flex-1 min-h-0 flex flex-col sm:flex-row overflow-y-auto sm:overflow-hidden bg-zinc-50 dark:bg-transparent">
      {/* Profile summary */}
      <div className="w-full sm:w-72 shrink-0 border-b-2 sm:border-b-0 sm:border-r-2 border-zinc-950 dark:border-zinc-800/60 flex flex-col sm:overflow-y-auto bg-white dark:bg-transparent">
        {/* Penalty Box Alert if benched */}
        {isPenaltyBoxActive && (
          <div className="p-4 bg-red-600 text-white font-mono border-b-2 border-zinc-950">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 shrink-0 animate-bounce" />
              <span className="text-xs font-black uppercase tracking-widest">PENALTY BOX LOCKOUT</span>
            </div>
            <p className="text-[11px] mt-1.5 text-red-100 font-bold leading-snug">
              Benched for 3 consecutive failures. Creating oaths and joining squads/lobbies is disabled.
            </p>
            <div className="mt-2 text-[10px] font-black bg-red-950/70 p-2 border border-red-400/50 flex justify-between items-center">
              <span>UNBENCH AT:</span>
              <span>
                {new Date(profile.penalty_box_until!).toLocaleDateString()} {new Date(profile.penalty_box_until!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        )}

        {/* Identity */}
        <div className="p-5 border-b-2 border-zinc-200 dark:border-zinc-800/40">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-zinc-200 dark:bg-zinc-800 border-2 border-zinc-950 dark:border-zinc-700 flex items-center justify-center shrink-0 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
              <span className="text-sm font-mono font-black text-zinc-950 dark:text-zinc-300 uppercase">
                {profile.username.substring(0, 2)}
              </span>
            </div>
            <div>
              <p className="text-base font-black text-zinc-950 dark:text-zinc-100 tracking-tight">
                @{profile.username}
              </p>
              <p className="text-[10px] font-mono text-zinc-500">
                Member since {formatRelativeTime(profile.created_at)}
              </p>
            </div>
          </div>

          {/* Reputation */}
          <div className="mb-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-widest">
                Reputation
              </span>
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] font-mono font-bold px-1 py-0.5 border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 uppercase tracking-wider">
                  {reputationTier}
                </span>
                <span className={`text-sm font-black stake-number ${repColor}`}>
                  {profile.reputation_score}/100
                </span>
              </div>
            </div>
            <div className="progress-bar h-1 w-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className={`h-full transition-all ${
                  profile.reputation_score < 40 ? "bg-red-600" : "bg-zinc-900 dark:bg-zinc-300"
                }`}
                style={{ width: `${profile.reputation_score}%` }}
              />
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 border-b-2 border-zinc-200 dark:border-zinc-800/40">
          <StatCell label="Created" value={profile.oaths_created} />
          <StatCell label="Completed" value={profile.oaths_completed} accent />
          <StatCell label="Failed" value={profile.oaths_failed} danger />
          <StatCell 
            label="Loss Streak" 
            value={`${lossStreak} / 3`} 
            danger={lossStreak >= 2} 
          />
          <StatCell label="Win/Loss" value={`${profile.oaths_completed}W / ${profile.oaths_failed}L`} />
          <StatCell label="Success" value={`${completionRate}%`} />
        </div>

        {/* Loss streak warning if approaching lockout */}
        {lossStreak > 0 && !isPenaltyBoxActive && (
          <div className="px-4 py-2 bg-amber-500/10 border-b-2 border-zinc-200 dark:border-zinc-800/40 flex items-center justify-between text-[10px] font-mono font-bold text-amber-600 dark:text-amber-400">
            <span>⚠️ {lossStreak} consecutive fail{lossStreak > 1 ? "s" : ""}</span>
            <span>{3 - lossStreak} more to Penalty Box</span>
          </div>
        )}

        {/* Money stats */}
        <div className="p-4 border-b-2 border-zinc-200 dark:border-zinc-800/40 space-y-3">
          <MoneyRow label="Virtual Staked" value={profile.total_staked} region={region} />
          <MoneyRow label="Virtual Won" value={profile.total_won} positive region={region} />
          <MoneyRow label="Virtual Lost" value={profile.total_lost} negative region={region} />
        </div>

        {/* Wallet summary */}
        <div className="p-4 border-b-2 border-zinc-200 dark:border-zinc-800/40 space-y-2">
          <p className="text-[9px] font-mono font-bold text-zinc-500 uppercase tracking-widest mb-2">
            Sandbox Wallet
          </p>
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-mono text-zinc-500 font-bold">Available</span>
            <span className="text-sm font-black stake-number text-zinc-950 dark:text-zinc-200">
              {utilsFormatCurrencyPrecise(wallet.balance, region)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-mono text-zinc-500 font-bold">Locked in active oaths</span>
            <span className="text-sm font-black stake-number text-zinc-500">
              {utilsFormatCurrencyPrecise(wallet.escrow_locked, region)}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[11px] font-mono text-zinc-500 font-bold">Virtual In</span>
            <span className="text-sm font-mono font-bold text-zinc-600 dark:text-zinc-400 stake-number">
              {utilsFormatCurrencyPrecise(wallet.total_deposited, region)}
            </span>
          </div>
        </div>

        {/* Sign Out */}
        <div className="p-4 mt-auto">
          <button
            onClick={onSignOut}
            className="w-full flex items-center justify-center gap-2 py-3 border-2 border-zinc-950 dark:border-zinc-800 text-xs font-mono font-bold text-zinc-700 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 hover:border-red-600 dark:hover:border-red-600/50 transition-colors uppercase tracking-wider"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </div>

      {/* Right — Transaction History */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-white dark:bg-transparent">
        <div className="px-5 py-4 border-b-2 border-zinc-200 dark:border-zinc-800/40 bg-zinc-100 dark:bg-zinc-900/40">
          <h3 className="text-base font-black tracking-tight text-zinc-950 dark:text-zinc-100 uppercase">
            SANDBOX ACTIVITY
          </h3>
          <p className="text-[10px] font-mono text-zinc-600 dark:text-zinc-400 mt-0.5 font-bold">
            Virtual balance changes only; no cash is collected or paid out.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {transactions.length === 0 ? (
            <div className="flex items-center justify-center h-48">
              <p className="text-xs font-mono font-bold text-zinc-500">No transactions recorded yet</p>
            </div>
          ) : (
            transactions.map((tx, i) => <LedgerRow key={tx.id} tx={tx} index={i} region={region} />)
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
    <div className="px-4 py-3 border-b-2 border-zinc-200 dark:border-zinc-800/30 odd:border-r-2">
      <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest mb-0.5 font-bold">{label}</p>
      <p
        className={`text-xl font-black stake-number ${
          danger ? "text-red-600" : accent ? "text-zinc-950 dark:text-zinc-200" : "text-zinc-700 dark:text-zinc-400"
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
  region,
}: {
  label: string;
  value: number;
  positive?: boolean;
  negative?: boolean;
  region: Region;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        {positive && <TrendingUp className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400" />}
        {negative && <TrendingDown className="w-3.5 h-3.5 text-red-600" />}
        {!positive && !negative && <DollarSign className="w-3.5 h-3.5 text-zinc-500" />}
        <span className="text-[11px] font-mono text-zinc-600 dark:text-zinc-400 font-bold">{label}</span>
      </div>
      <span
        className={`text-sm font-black stake-number ${
          positive ? "text-zinc-950 dark:text-zinc-300" : negative ? "text-red-600" : "text-zinc-700 dark:text-zinc-400"
        }`}
      >
        {utilsFormatCurrency(value, region)}
      </span>
    </div>
  );
}

const TX_COLORS: Record<string, string> = {
  deposit: "text-zinc-950 dark:text-zinc-300",
  withdrawal: "text-red-600",
  escrow_lock: "text-zinc-600 dark:text-zinc-400",
  escrow_release: "text-zinc-950 dark:text-zinc-200",
  penalty: "text-red-600",
  reward: "text-zinc-950 dark:text-zinc-200",
  house_cut: "text-zinc-500",
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

function LedgerRow({ tx, index, region }: { tx: Transaction; index: number; region: Region }) {
  return (
    <div
      className="flex items-center justify-between px-5 py-3.5 border-b-2 border-zinc-200 dark:border-zinc-800/25 hover:bg-zinc-100 dark:hover:bg-zinc-900/30 transition-colors fade-in"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-zinc-900 dark:text-zinc-300 font-bold truncate">{tx.description}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider font-bold">
            {tx.type === "house_cut" ? "platform fee" : tx.type.replace(/_/g, " ")}
          </span>
          <span className="text-zinc-400">·</span>
          <span className="text-[9px] font-mono text-zinc-500">
            {formatRelativeTime(tx.created_at)}
          </span>
        </div>
      </div>
      <span className={`text-sm font-black stake-number ml-4 shrink-0 ${TX_COLORS[tx.type] ?? "text-zinc-500"}`}>
        {TX_PREFIX[tx.type]}{utilsFormatCurrency(tx.amount, region)}
      </span>
    </div>
  );
}
