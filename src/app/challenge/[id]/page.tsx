"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Swords, Check, Calendar, AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { formatCurrency, formatCurrencyPrecise } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { getMockOaths, acceptDuoChallenge } from "@/lib/data-hooks";
import { createClient } from "@/lib/supabase/client";
import type { Oath } from "@/lib/types";

export default function ChallengeAcceptPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const oathId = resolvedParams.id;
  const router = useRouter();
  const { user, wallet, refreshWallet } = useAuth();

  const [oath, setOath] = useState<Oath | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    const fetchChallenge = async () => {
      setLoading(true);
      // First check local mock storage
      const mockOaths = getMockOaths();
      const local = mockOaths.find((o) => o.id === oathId);
      if (local) {
        setOath(local);
        setLoading(false);
        return;
      }

      // Check Supabase
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("oaths")
          .select("*, creator:profiles!oaths_creator_id_fkey(*)")
          .eq("id", oathId)
          .single();

        if (error || !data) {
          // Fallback to a default challenge representation
          setOath({
            id: oathId,
            creator_id: "creator-unknown",
            creator: {
              id: "creator-unknown",
              username: "Challenger",
              display_name: "Challenger",
              oaths_created: 1,
              oaths_completed: 0,
              oaths_failed: 0,
              total_staked: 100,
              total_lost: 0,
              total_won: 0,
              reputation_score: 100,
              created_at: new Date().toISOString(),
            },
            oath_statement: "High Stakes Duo Challenge",
            deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            oath_type: "duo",
            verification_method: "peer",
            consequence_type: "bounty_transfer",
            stake_amount: 100,
            house_cut_percent: 10,
            status: "pending",
            min_players: 2,
            max_players: 2,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        } else {
          setOath(data as Oath);
        }
      } catch {
        setError("Could not load challenge.");
      } finally {
        setLoading(false);
      }
    };

    fetchChallenge();
  }, [oathId]);

  const handleAccept = async () => {
    if (!oath) return;
    if (!user) {
      router.push(`/auth?redirect=/challenge/${oathId}`);
      return;
    }
    if (wallet && wallet.balance < oath.stake_amount) {
      setError("Insufficient wallet funds. Please deposit funds first.");
      return;
    }

    setAccepting(true);
    setError(null);
    const { error: acceptErr } = await acceptDuoChallenge(oath.id);
    setAccepting(false);

    if (acceptErr) {
      setError(acceptErr);
    } else {
      setAccepted(true);
      await refreshWallet();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-zinc-950 dark:border-zinc-800 animate-spin border-t-zinc-400 dark:border-t-zinc-500 rounded-full" />
          <span className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-500 uppercase tracking-widest">
            Loading Challenge
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 px-6 py-12 transition-colors duration-300">
      <div className="noise-overlay" aria-hidden="true" />
      <div className="scanline-overlay" aria-hidden="true" />

      <div className="w-full max-w-lg bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 p-8 fade-in shadow-[12px_12px_0px_0px_rgba(9,9,11,1)] dark:shadow-none text-left">
        {/* Navigation */}
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 transition-colors uppercase tracking-wider"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </Link>
          <span className="px-2.5 py-1 text-[9px] font-mono font-black uppercase tracking-wider bg-red-50 dark:bg-red-950/20 text-red-600 border border-red-600/40">
            Duo Wager
          </span>
        </div>

        {accepted ? (
          <div className="text-center py-8 fade-in">
            <div className="w-16 h-16 bg-red-50 dark:bg-red-950/30 border-2 border-red-600 text-red-600 mx-auto flex items-center justify-center mb-4">
              <Check className="w-8 h-8" />
            </div>
            <h2 className="text-2xl font-black uppercase tracking-tight text-zinc-950 dark:text-zinc-50 mb-2">
              Challenge Accepted
            </h2>
            <p className="text-sm font-bold text-zinc-700 dark:text-zinc-300 font-mono mb-6 leading-relaxed">
              Your stake of {oath ? formatCurrency(oath.stake_amount) : "$0"} has been locked in escrow. May the most disciplined rival win.
            </p>
            <Link
              href="/"
              className="inline-block w-full py-4 bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 text-sm font-black uppercase tracking-tight hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all border-2 border-zinc-950 dark:border-transparent shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
            >
              Enter Arena & Track Challenge
            </Link>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 border-2 border-red-600 flex items-center justify-center bg-red-50 dark:bg-red-950/20 text-red-600">
                <Swords className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-xl font-black uppercase tracking-tight text-zinc-950 dark:text-zinc-50">
                  Head-to-Head Challenge
                </h1>
                <p className="text-xs font-mono font-bold text-zinc-500">
                  Invited by @{oath?.creator?.username ?? "challenger"}
                </p>
              </div>
            </div>

            {/* Oath Details Card */}
            <div className="border-2 border-zinc-950 dark:border-zinc-800 p-5 bg-zinc-50 dark:bg-zinc-950/60 mb-6 space-y-4">
              <div>
                <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-500 block mb-1">
                  The Oath You Must Fulfill
                </span>
                <p className="text-xl font-black text-zinc-950 dark:text-zinc-50 leading-snug">
                  &ldquo;{oath?.oath_statement}&rdquo;
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t-2 border-zinc-200 dark:border-zinc-800 pt-3">
                <div>
                  <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block">Your Stake</span>
                  <span className="text-lg font-mono font-black text-zinc-950 dark:text-zinc-100">
                    {oath ? formatCurrency(oath.stake_amount) : "$0"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block">Winner Takes</span>
                  <span className="text-lg font-mono font-black text-red-600 dark:text-red-500">
                    {oath ? formatCurrency(oath.stake_amount * 2 * 0.9) : "$0"}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs font-mono text-zinc-600 dark:text-zinc-400">
                <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                <span>Deadline: {oath ? new Date(oath.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}</span>
              </div>
            </div>

            {/* Rules */}
            <div className="border border-zinc-300 dark:border-zinc-800 p-4 bg-zinc-100 dark:bg-zinc-900/30 text-xs font-mono space-y-1.5 mb-6 text-zinc-700 dark:text-zinc-400">
              <p>• Both players lock equal stakes in escrow.</p>
              <p>• Opponents peer-verify each other&apos;s proof at deadline.</p>
              <p>• Winner claims the entire pot minus a 10% house fee.</p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 text-red-500 text-xs font-mono font-bold mb-4">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Action Buttons */}
            {user ? (
              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs font-mono text-zinc-600 dark:text-zinc-400 px-1">
                  <span>Your Available Balance:</span>
                  <span className="font-bold text-zinc-950 dark:text-zinc-100">
                    {wallet ? formatCurrencyPrecise(wallet.balance) : "$0"}
                  </span>
                </div>
                <button
                  onClick={handleAccept}
                  disabled={accepting || (wallet ? wallet.balance < (oath?.stake_amount || 0) : false)}
                  className={`w-full py-4 text-sm font-black uppercase tracking-tight transition-all border-2 ${
                    wallet && wallet.balance < (oath?.stake_amount || 0)
                      ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 border-transparent cursor-not-allowed"
                      : "bg-red-600 text-white border-red-600 hover:bg-red-700 shadow-[4px_4px_0px_0px_rgba(220,38,38,1)] dark:shadow-none"
                  }`}
                >
                  {accepting ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Locking Escrow...
                    </span>
                  ) : (
                    `Accept & Lock ${oath ? formatCurrency(oath.stake_amount) : ""}`
                  )}
                </button>
              </div>
            ) : (
              <Link
                href={`/auth?redirect=/challenge/${oathId}`}
                className="block text-center w-full py-4 bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 text-sm font-black uppercase tracking-tight hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all border-2 border-zinc-950 dark:border-transparent shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
              >
                Sign In to Accept Challenge
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}
