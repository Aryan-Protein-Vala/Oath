"use client";

import { useState } from "react";
import {
  X,
  Plus,
  Minus,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Loader2,
  CheckCircle,
  AlertCircle,
} from "lucide-react";
import { depositFunds, withdrawFunds } from "@/lib/data-hooks";
import { mockTransactions } from "@/lib/mock-data";
import { formatCurrencyPrecise, formatRelativeTime } from "@/lib/utils";
import type { Wallet, Transaction } from "@/lib/types";
import { showToast } from "./Toast";
import { useRegion } from "@/lib/region-context";

interface WalletModalProps {
  wallet: Wallet;
  transactions?: Transaction[];
  onClose: () => void;
  onRefresh: () => void;
}

type ModalTab = "overview" | "deposit" | "withdraw";

const TX_ICON: Record<string, React.ReactNode> = {
  deposit: <TrendingUp className="w-3.5 h-3.5 text-zinc-500 dark:text-zinc-400" />,
  withdrawal: <TrendingDown className="w-3.5 h-3.5 text-red-600" />,
  escrow_lock: <DollarSign className="w-3.5 h-3.5 text-zinc-500" />,
  escrow_release: <DollarSign className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-300" />,
  penalty: <TrendingDown className="w-3.5 h-3.5 text-red-600" />,
  reward: <TrendingUp className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-200" />,
  house_cut: <DollarSign className="w-3.5 h-3.5 text-zinc-500" />,
};

const QUICK_AMOUNTS = [25, 50, 100, 250, 500, 1000];

export default function WalletModal({ wallet, transactions = [], onClose, onRefresh }: WalletModalProps) {
  const [tab, setTab] = useState<ModalTab>("overview");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const { region, formatCurrency: formatRegionCurrency } = useRegion();

  const QUICK_AMOUNTS = region === "in" ? [500, 1000, 2500, 5000, 10000, 25000] : [25, 50, 100, 250, 500, 1000];

  const amountNum = parseFloat(amount) || 0;
  const canWithdraw = amountNum > 0 && amountNum <= wallet.balance;
  const canDeposit = amountNum > 0 && amountNum <= 50000;

  const activeTransactions = transactions.length > 0 ? transactions : mockTransactions;

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
        tab === "deposit" ? `${formatRegionCurrency(amountNum)} deposited into available balance.` : `${formatRegionCurrency(amountNum)} withdrawn.`,
        "success"
      );
      onRefresh();
      setTimeout(() => { setDone(false); setAmount(""); setTab("overview"); }, 1200);
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 fade-in shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-zinc-950 dark:border-zinc-800">
          <h3 className="text-sm font-black text-zinc-950 dark:text-zinc-100 tracking-tight uppercase">ESCROW WALLET</h3>
          <button onClick={onClose} className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Balance Strip */}
        <div className="grid grid-cols-2 border-b-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-transparent">
          <div className="px-5 py-4 border-r-2 border-zinc-200 dark:border-zinc-800">
            <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold mb-1">Available</p>
            <p className="text-2xl font-black stake-number text-zinc-950 dark:text-zinc-100">
              {formatCurrencyPrecise(wallet.balance, region)}
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest font-bold mb-1">Locked in Escrow</p>
            <p className="text-2xl font-black stake-number text-zinc-500">
              {formatCurrencyPrecise(wallet.escrow_locked, region)}
            </p>
          </div>
        </div>

        {/* Tab Row */}
        <div className="flex border-b-2 border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-transparent">
          {(["overview", "deposit", "withdraw"] as ModalTab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setAmount(""); setDone(false); }}
              className={`flex-1 py-2.5 text-[10px] font-black uppercase tracking-wider transition-all ${
                tab === t
                  ? t === "withdraw"
                    ? "bg-red-600 text-white"
                    : "bg-zinc-950 text-white dark:bg-zinc-800 dark:text-zinc-100"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200"
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
              {activeTransactions.map((tx) => (
                <TxRow key={tx.id} tx={tx} />
              ))}
              {activeTransactions.length === 0 && (
                <p className="text-center text-zinc-500 text-xs font-mono py-8">
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
                  <CheckCircle className="w-10 h-10 text-zinc-800 dark:text-zinc-300 mb-3" />
                  <p className="text-sm font-bold text-zinc-900 dark:text-zinc-200">
                    {tab === "deposit" ? "Funds deposited" : "Withdrawal processed"}
                  </p>
                </div>
              ) : (
                <>
                  {/* Amount input */}
                  <div className="border-2 border-zinc-950 dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-950/50">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-black text-zinc-500">{region === "in" ? "₹" : "$"}</span>
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0"
                        min="1"
                        className="flex-1 text-3xl font-black text-zinc-950 dark:text-zinc-100 bg-transparent stake-number"
                        style={{ outline: "none", border: "none" }}
                        autoFocus
                      />
                    </div>
                    {tab === "withdraw" && amountNum > wallet.balance && (
                      <div className="flex items-center gap-1.5 mt-2 text-red-500 font-bold">
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
                        className={`py-1.5 text-[10px] font-mono font-bold border transition-colors ${
                          amountNum === a
                            ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-500 dark:text-zinc-200 dark:bg-zinc-800"
                            : "border-zinc-300 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-zinc-600 hover:text-zinc-900"
                        }`}
                      >
                        {formatRegionCurrency(a)}
                      </button>
                    ))}
                  </div>

                  {tab === "withdraw" && (
                    <button
                      onClick={() => setAmount(wallet.balance.toString())}
                      className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors"
                    >
                      Withdraw all ({formatCurrencyPrecise(wallet.balance)})
                    </button>
                  )}

                  {/* Confirm */}
                  <button
                    onClick={handleAction}
                    disabled={tab === "deposit" ? !canDeposit : !canWithdraw || loading}
                    className={`w-full flex items-center justify-center gap-2 py-3 text-sm font-black uppercase tracking-tight transition-all border-2 ${
                      (tab === "deposit" ? !canDeposit : !canWithdraw) || loading
                        ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 border-transparent cursor-not-allowed"
                        : tab === "withdraw"
                        ? "bg-red-600 text-white border-red-600 hover:bg-red-700 shadow-[2px_2px_0px_0px_rgba(220,38,38,1)] dark:shadow-none"
                        : "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 border-zinc-950 dark:border-transparent hover:bg-zinc-800 dark:hover:bg-zinc-200 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
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
                      : `${tab === "deposit" ? (region === "in" ? "Deposit via Razorpay" : "Deposit via PayPal") : "Withdraw"} ${amountNum > 0 ? formatRegionCurrency(amountNum) : ""}`}
                  </button>

                  <p className="text-[10px] font-mono text-zinc-500 text-center">
                    {tab === "deposit"
                      ? (region === "in" ? "Simulating secure payment via Razorpay. Funds update instantly." : "Simulating secure payment via PayPal. Funds update instantly.")
                      : "Withdrawals return to your linked account."}
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
    <div className="flex items-center justify-between py-3 border-b border-zinc-200 dark:border-zinc-800/30">
      <div className="flex items-center gap-3">
        <div className="w-6 h-6 flex items-center justify-center">
          {TX_ICON[tx.type] ?? <DollarSign className="w-3 h-3 text-zinc-500" />}
        </div>
        <div>
          <p className="text-[11px] text-zinc-900 dark:text-zinc-300 font-bold leading-tight">{tx.description}</p>
          <p className="text-[9px] font-mono text-zinc-500 mt-0.5">{formatRelativeTime(tx.created_at)}</p>
        </div>
      </div>
      <span className={`text-sm font-black stake-number ${isCredit ? "text-zinc-900 dark:text-zinc-200" : isDebit ? "text-red-600" : "text-zinc-500"}`}>
        {isCredit ? "+" : isDebit ? "-" : ""}${tx.amount.toFixed(0)}
      </span>
    </div>
  );
}
