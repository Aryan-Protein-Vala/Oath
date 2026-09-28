"use client";

import { useState } from "react";
import {
  X,
  Plus,
  Minus,
  DollarSign,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  Loader2,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { depositFunds, withdrawFunds } from "@/lib/data-hooks";
import { mockTransactions } from "@/lib/mock-data";
import { formatCurrencyPrecise, formatRelativeTime } from "@/lib/utils";
import type { Wallet, Transaction } from "@/lib/types";
import { showToast } from "./Toast";

interface WalletModalProps {
  wallet: Wallet;
  onClose: () => void;
  onRefresh: () => void;
}

type ModalTab = "overview" | "deposit" | "withdraw";

const TX_ICON: Record<string, React.ReactNode> = {
  deposit: <TrendingUp className="w-3 h-3 text-zinc-400" />,
  withdrawal: <TrendingDown className="w-3 h-3 text-red-500" />,
  escrow_lock: <DollarSign className="w-3 h-3 text-zinc-600" />,
  escrow_release: <DollarSign className="w-3 h-3 text-zinc-300" />,
  penalty: <TrendingDown className="w-3 h-3 text-red-600" />,
  reward: <TrendingUp className="w-3 h-3 text-zinc-200" />,
  house_cut: <DollarSign className="w-3 h-3 text-zinc-700" />,
};

const QUICK_AMOUNTS = [25, 50, 100, 250, 500, 1000];

export default function WalletModal({ wallet, onClose, onRefresh }: WalletModalProps) {
  const [tab, setTab] = useState<ModalTab>("overview");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const amountNum = parseFloat(amount) || 0;
  const canWithdraw = amountNum > 0 && amountNum <= wallet.balance;
  const canDeposit = amountNum > 0 && amountNum <= 50000;

  const handleAction = async () => {
    if (amountNum <= 0) return;
    setLoading(true);

    const { error } =
      tab === "deposit"
        ? await depositFunds(amountNum)
        : await withdrawFunds(amountNum);

    if (error) {
      showToast(error, "error");
    } else {
      setDone(true);
      showToast(
        tab === "deposit" ? `$${amountNum} deposited.` : `$${amountNum} withdrawn.`,
        "success"
      );
      onRefresh();
      setTimeout(() => { setDone(false); setAmount(""); setTab("overview"); }, 1500);
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-[#0a0a0f] border border-zinc-800 fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
          <h3 className="text-sm font-black text-zinc-100 tracking-tight">ESCROW WALLET</h3>
          <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Balance Strip */}
        <div className="grid grid-cols-2 border-b border-zinc-800">
          <div className="px-5 py-4 border-r border-zinc-800">
            <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mb-1">Available</p>
            <p className="text-2xl font-black stake-number text-zinc-100">
              {formatCurrencyPrecise(wallet.balance)}
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mb-1">Locked</p>
            <p className="text-2xl font-black stake-number text-zinc-500">
              {formatCurrencyPrecise(wallet.escrow_locked)}
            </p>
          </div>
        </div>

        {/* Tab Row */}
        <div className="flex border-b border-zinc-800">
          {(["overview", "deposit", "withdraw"] as ModalTab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setAmount(""); setDone(false); }}
              className={`flex-1 py-2.5 text-[10px] font-medium uppercase tracking-wide transition-all ${
                tab === t
                  ? t === "withdraw"
                    ? "bg-red-950/30 text-red-400"
                    : "bg-zinc-800/50 text-zinc-100"
                  : "text-zinc-600 hover:text-zinc-400"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-5">
          {/* OVERVIEW — Transaction History */}
          {tab === "overview" && (
            <div className="space-y-0 max-h-72 overflow-y-auto">
              {mockTransactions.map((tx) => (
                <TxRow key={tx.id} tx={tx} />
              ))}
              {mockTransactions.length === 0 && (
                <p className="text-center text-zinc-700 text-xs font-mono py-8">
                  No transactions yet
                </p>
              )}
            </div>
          )}

          {/* DEPOSIT / WITHDRAW */}
          {(tab === "deposit" || tab === "withdraw") && (
            <div className="space-y-4">
              {done ? (
                <div className="flex flex-col items-center py-10 fade-in">
                  <CheckCircle className="w-10 h-10 text-zinc-300 mb-3" />
                  <p className="text-sm font-bold text-zinc-200">
                    {tab === "deposit" ? "Funds deposited" : "Withdrawal sent"}
                  </p>
                </div>
              ) : (
                <>
                  {/* Amount input */}
                  <div className="border border-zinc-800 p-4 bg-zinc-950/50">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-black text-zinc-600">$</span>
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0"
                        min="1"
                        className="flex-1 text-3xl font-black text-zinc-100 bg-transparent stake-number"
                        style={{ outline: "none", border: "none" }}
                        autoFocus
                      />
                    </div>
                    {tab === "withdraw" && amountNum > wallet.balance && (
                      <div className="flex items-center gap-1.5 mt-2 text-red-500">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span className="text-[10px] font-mono">Exceeds available balance</span>
                      </div>
                    )}
                  </div>

                  {/* Quick amounts */}
                  <div className="grid grid-cols-6 gap-1.5">
                    {QUICK_AMOUNTS.map((a) => (
                      <button
                        key={a}
                        onClick={() => setAmount(a.toString())}
                        className={`py-1.5 text-[10px] font-mono border transition-colors ${
                          amountNum === a
                            ? "border-zinc-500 text-zinc-200 bg-zinc-800"
                            : "border-zinc-800 text-zinc-600 hover:border-zinc-700 hover:text-zinc-400"
                        }`}
                      >
                        ${a}
                      </button>
                    ))}
                  </div>

                  {tab === "withdraw" && (
                    <button
                      onClick={() => setAmount(wallet.balance.toString())}
                      className="text-[10px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
                    >
                      Withdraw all ({formatCurrencyPrecise(wallet.balance)})
                    </button>
                  )}

                  {/* Confirm */}
                  <button
                    onClick={handleAction}
                    disabled={tab === "deposit" ? !canDeposit : !canWithdraw || loading}
                    className={`w-full flex items-center justify-center gap-2 py-3 text-sm font-black uppercase tracking-tight transition-all ${
                      (tab === "deposit" ? !canDeposit : !canWithdraw) || loading
                        ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                        : tab === "withdraw"
                        ? "bg-red-700 text-white hover:bg-red-600"
                        : "bg-zinc-50 text-zinc-950 hover:bg-zinc-200"
                    }`}
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : tab === "deposit" ? (
                      <Plus className="w-4 h-4" />
                    ) : (
                      <Minus className="w-4 h-4" />
                    )}
                    {loading
                      ? "Processing..."
                      : `${tab === "deposit" ? "Deposit" : "Withdraw"} ${amountNum > 0 ? `$${amountNum}` : ""}`}
                  </button>

                  <p className="text-[10px] font-mono text-zinc-700 text-center">
                    {tab === "deposit"
                      ? "Simulated deposit — no real money is moved in development."
                      : "Withdrawals return to your linked payment method."}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TxRow({ tx }: { tx: Transaction }) {
  const isCredit = ["deposit", "escrow_release", "reward"].includes(tx.type);
  const isDebit = ["withdrawal", "penalty", "escrow_lock", "house_cut"].includes(tx.type);

  return (
    <div className="flex items-center justify-between py-3 border-b border-zinc-800/30">
      <div className="flex items-center gap-3">
        <div className="w-6 h-6 flex items-center justify-center">
          {TX_ICON[tx.type] ?? <DollarSign className="w-3 h-3 text-zinc-600" />}
        </div>
        <div>
          <p className="text-[11px] text-zinc-300 font-medium leading-tight">{tx.description}</p>
          <p className="text-[9px] font-mono text-zinc-600 mt-0.5">{formatRelativeTime(tx.created_at)}</p>
        </div>
      </div>
      <span className={`text-sm font-black stake-number ${isCredit ? "text-zinc-200" : isDebit ? "text-red-500" : "text-zinc-500"}`}>
        {isCredit ? "+" : isDebit ? "-" : ""}${tx.amount.toFixed(0)}
      </span>
    </div>
  );
}
