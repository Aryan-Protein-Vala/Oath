"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Swords, Check, Calendar, AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
import { formatCurrency, formatCurrencyPrecise } from "@/lib/utils";
import { isDemoSession, useAuth } from "@/lib/auth-context";
import { getMockOaths, acceptDuoChallenge } from "@/lib/data-hooks";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Oath } from "@/lib/types";
import { useRegion } from "@/lib/region-context";

export default function ChallengeAcceptPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const oathId = resolvedParams.id;
  const router = useRouter();
  const { user, wallet, refreshWallet } = useAuth();
  const { region } = useRegion();

  const [oath, setOath] = useState<Oath | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [clockNow, setClockNow] = useState<number | null>(null);
  const challengeDeadline = oath ? new Date(oath.deadline).getTime() : Number.POSITIVE_INFINITY;
  const challengeExpired = Boolean(oath && (!Number.isFinite(challengeDeadline) || (clockNow !== null && challengeDeadline <= clockNow)));

  useEffect(() => {
    const updateClock = () => setClockNow(Date.now());
    updateClock();
    const interval = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const fetchChallenge = async () => {
      setLoading(true);
      setError(null);
      setOath(null);

      if (isDemoSession()) {
        const local = getMockOaths().find((item) => item.id === oathId && item.oath_type === "duo");
        if (!cancelled) {
          setOath(local ?? null);
          if (!local) setError("This demo invitation is missing, expired, or no longer available.");
          setLoading(false);
        }
        return;
      }

      if (!isSupabaseConfigured()) {
        if (!cancelled) {
          setError("Challenge links are unavailable until the account backend is configured.");
          setLoading(false);
        }
        return;
      }

      try {
        const supabase = createClient();
        const { data, error: readError } = await supabase
          .from("oaths")
          .select("*, creator:profiles!oaths_creator_id_fkey(*)")
          .eq("id", oathId)
          .eq("oath_type", "duo")
          .single();

        if (cancelled) return;
        if (readError || !data) {
          setError("This invitation could not be found, has expired, or is no longer pending.");
        } else {
          setOath(data as Oath);
        }
      } catch {
        if (!cancelled) setError("Could not load this invitation. Check your connection and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchChallenge();
    return () => { cancelled = true; };
  }, [oathId]);

  const handleAccept = async () => {
    if (!oath) return;
    if (oath.status !== "pending" || !Number.isFinite(Date.parse(oath.deadline)) || Date.parse(oath.deadline) <= Date.now()) {
      setError("This invitation is no longer open or its deadline has passed.");
      return;
    }
    if (!user) {
      router.push(`/auth?redirect=/challenge/${oathId}`);
      return;
    }
    if (!wallet) {
      setError("Your sandbox wallet is still loading. Refresh the page and try again.");
      return;
    }

    setAccepting(true);
    setError(null);
    try {
      const { error: acceptErr } = await acceptDuoChallenge(oath.id);
      if (acceptErr) {
        setError(acceptErr);
        return;
      }
      setAccepted(true);
      await refreshWallet();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Challenge could not be accepted. Try again.");
    } finally {
      setAccepting(false);
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

  if (!oath) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#09090b] px-4 py-8 text-zinc-950 dark:text-zinc-50">
        <section className="w-full max-w-md border-4 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-[#0a0a0f] p-6 sm:p-8 text-center shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
          <AlertCircle className="mx-auto mb-4 h-8 w-8 text-red-600" />
          <h1 className="text-xl font-black uppercase">Invitation unavailable</h1>
          <p role="alert" className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{error ?? "This challenge does not exist or is no longer open."}</p>
          <Link href="/" className="mt-6 inline-flex min-h-11 w-full items-center justify-center bg-zinc-950 px-4 text-xs font-black uppercase text-white dark:bg-zinc-100 dark:text-zinc-950">Back to OATH</Link>
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 px-4 py-8 sm:px-6 sm:py-12 transition-colors duration-300">
      <div className="noise-overlay" aria-hidden="true" />
      <div className="scanline-overlay" aria-hidden="true" />

      <div className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 p-5 sm:p-8 fade-in shadow-[12px_12px_0px_0px_rgba(9,9,11,1)] dark:shadow-none text-left">
        {/* Navigation */}
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 transition-colors uppercase tracking-wider"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back
          </Link>
          <span className="px-2.5 py-1 text-[9px] font-mono font-black uppercase tracking-wider bg-red-50 dark:bg-red-950/20 text-red-600 border border-red-600/40">
            Sandbox challenge
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
              Your virtual stake of {formatCurrency(oath.stake_amount, region)} is locked in the sandbox ledger. No cash has moved.
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
                  <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block">Your Virtual Stake</span>
                  <span className="text-lg font-mono font-black text-zinc-950 dark:text-zinc-100">
                    {formatCurrency(oath.stake_amount, region)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block">Estimated Virtual Payout</span>
                  <span className="text-lg font-mono font-black text-red-600 dark:text-red-500">
                    {formatCurrency(oath.stake_amount * 2 * 0.9, region)}
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
              <p>• <strong>Leader Pays All:</strong> The challenger (@{oath?.creator?.username || "creator"}) has locked the entire stake upfront.</p>
              <p>• Joining this challenge is 100% free for you.</p>
              <p>• Submit your proof before deadline to win your share.</p>
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
                {user.id === oath?.creator_id ? (
                  <div className="p-4 bg-zinc-100 dark:bg-zinc-900 border-2 border-zinc-950 dark:border-zinc-800 text-xs font-mono text-center space-y-1">
                    <p className="font-bold text-zinc-950 dark:text-zinc-100">You created this challenge.</p>
                    <p className="text-zinc-600 dark:text-zinc-400">Share this link with your opponent so they can accept for free.</p>
                  </div>
                ) : oath.status !== "pending" || challengeExpired ? (
                  <div className="p-4 bg-zinc-100 dark:bg-zinc-900 border-2 border-zinc-500 text-xs font-mono text-center space-y-1">
                    <p className="font-bold text-zinc-800 dark:text-zinc-200">{challengeExpired ? "Invitation expired." : `Challenge is ${oath.status}.`}</p>
                    <p className="text-zinc-600 dark:text-zinc-400">Only a live pending invitation can be accepted.</p>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={handleAccept}
                      disabled={accepting || !wallet}
                      className={`w-full py-4 text-sm font-black uppercase tracking-tight transition-all border-2 ${
                        !wallet
                          ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 border-transparent cursor-not-allowed"
                          : "bg-red-600 text-white border-red-600 hover:bg-red-700 shadow-[4px_4px_0px_0px_rgba(220,38,38,1)] dark:shadow-none"
                      }`}
                    >
                      {accepting ? (
                        <span className="flex items-center justify-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" /> Accepting challenge...
                        </span>
                      ) : (
                        `Accept Challenge (Free — Funded by @${oath.creator?.username || "creator"})`
                      )}
                    </button>
                  </>
                )}
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
