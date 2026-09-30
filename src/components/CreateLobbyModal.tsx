import { useState } from "react";
import { X, Users, DollarSign, Calendar, Target, Plus, Shield } from "lucide-react";
import { createOath } from "@/lib/data-hooks";
import { showToast } from "./Toast";
import { formatCurrency, convertToUSD, convertToLocal } from "@/lib/utils";
import { useRegion } from "@/lib/region-context";

interface CreateLobbyModalProps {
  walletBalance: number;
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateLobbyModal({ walletBalance, onClose, onCreated }: CreateLobbyModalProps) {
  const [statement, setStatement] = useState("");
  const [stakeAmount, setStakeAmount] = useState("");
  const [deadline, setDeadline] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const { region } = useRegion();

  const walletInLocal = convertToLocal(walletBalance, region);
  const stakeNum = parseFloat(stakeAmount) || 0;
  const stakeUsd = convertToUSD(stakeNum, region);
  const isOverBudget = stakeNum > walletInLocal;

  const handleSubmit = async () => {
    if (!statement.trim()) {
      showToast("Lobby needs a goal.", "error");
      return;
    }
    if (stakeNum <= 0) {
      showToast("A stake is required.", "error");
      return;
    }
    if (isOverBudget) {
      showToast("Insufficient funds for this stake.", "error");
      return;
    }
    if (!deadline) {
      showToast("Set a deadline.", "error");
      return;
    }
    const deadlineDate = new Date(deadline);
    if (!deadline.includes("T")) deadlineDate.setHours(23, 59, 59, 999);
    if (deadlineDate.getTime() <= Date.now()) {
      showToast("Deadline must be in the future.", "error");
      return;
    }

    setSubmitting(true);
    const { error } = await createOath({
      oath_statement: statement.trim(),
      deadline: deadlineDate.toISOString(),
      oath_type: "lobby",
      verification_method: "peer",
      consequence_type: "fiat",
      stake_amount: stakeUsd,
      min_players: 2,
      max_players: maxPlayers,
    });
    setSubmitting(false);

    if (error) {
      showToast(error, "error");
    } else {
      showToast("Lobby created! Waiting for challengers.", "success");
      onCreated();
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white dark:bg-[#0a0a0f] w-full max-w-md border-2 border-zinc-950 dark:border-zinc-800 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:shadow-none flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b-2 border-zinc-950 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900/50">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            <h2 className="text-xl font-black uppercase tracking-tight">Create Lobby</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-6">
          <div>
            <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
              <Target className="w-3.5 h-3.5" />
              Lobby Goal
            </label>
            <input
              type="text"
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="E.g., Read 20 pages a day"
              className="w-full border-b-2 border-zinc-300 dark:border-zinc-800 focus:border-zinc-950 dark:focus:border-zinc-500 bg-transparent text-sm font-bold p-2 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                <DollarSign className="w-3.5 h-3.5" />
                Stake
              </label>
              <div className="relative">
                <span className="absolute left-0 top-1/2 -translate-y-1/2 text-sm font-black pl-2">
                  {formatCurrency(0, region).charAt(0)}
                </span>
                <input
                  type="number"
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(e.target.value)}
                  placeholder="50"
                  className="w-full border-b-2 border-zinc-300 dark:border-zinc-800 focus:border-zinc-950 dark:focus:border-zinc-500 bg-transparent text-sm font-bold py-2 pl-6 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
                <Users className="w-3.5 h-3.5" />
                Max Players
              </label>
              <select
                value={maxPlayers}
                onChange={(e) => setMaxPlayers(parseInt(e.target.value))}
                className="w-full border-b-2 border-zinc-300 dark:border-zinc-800 focus:border-zinc-950 dark:focus:border-zinc-500 bg-transparent text-sm font-bold p-2 focus:outline-none"
              >
                {[5, 10, 20, 50, 100].map(n => (
                  <option key={n} value={n}>{n} Players</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
              <Calendar className="w-3.5 h-3.5" />
              Deadline
            </label>
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full border-b-2 border-zinc-300 dark:border-zinc-800 focus:border-zinc-950 dark:focus:border-zinc-500 bg-transparent text-sm font-bold p-2 focus:outline-none"
            />
          </div>
          
          {isOverBudget && (
            <p className="text-[10px] font-mono text-red-600 dark:text-red-500">
              Insufficient balance. You need {formatCurrency(stakeUsd, region)}.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t-2 border-zinc-950 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
          <button
            onClick={handleSubmit}
            disabled={submitting || isOverBudget || !statement || stakeNum <= 0 || !deadline}
            className="w-full py-3 bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 font-black uppercase tracking-widest text-xs hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? "Opening Lobby..." : (
              <>
                <Plus className="w-4 h-4" />
                Launch Lobby
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
