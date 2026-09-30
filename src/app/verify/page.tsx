"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Shield, CheckCircle, XCircle, AlertTriangle, ArrowLeft, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { getMockOaths, verifyNominee } from "@/lib/data-hooks";
import { createClient } from "@/lib/supabase/client";
import type { Oath } from "@/lib/types";
import { useRegion } from "@/lib/region-context";

function VerifyContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || searchParams.get("id") || "demo-token";
  const { region } = useRegion();

  const [verdict, setVerdict] = useState<"success" | "penalty" | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [oath, setOath] = useState<Oath | null>(null);

  useEffect(() => {
    const fetchOath = async () => {
      setLoading(true);
      const mockOaths = getMockOaths();
      const local = mockOaths.find((o) => o.id === token || o.nominee_email);
      if (local) {
        setOath(local);
        setLoading(false);
        return;
      }

      try {
        const supabase = createClient();
        const { data } = await supabase
          .from("oaths")
          .select("*, creator:profiles!oaths_creator_id_fkey(*)")
          .eq("id", token)
          .single();

        if (data) {
          setOath(data as Oath);
        } else {
          setOath(mockOaths[0] || null);
        }
      } catch {
        setOath(mockOaths[0] || null);
      } finally {
        setLoading(false);
      }
    };

    fetchOath();
  }, [token]);

  const handleSubmit = async () => {
    if (!verdict) return;
    setSubmitting(true);
    await verifyNominee(token, verdict, note.trim() || undefined);
    setSubmitting(false);
    setSubmitted(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-zinc-950 dark:border-zinc-800 animate-spin border-t-zinc-400 dark:border-t-zinc-500 rounded-full" />
          <span className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-500 uppercase tracking-widest">
            Loading Verification
          </span>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#09090b] px-6 py-12 transition-colors duration-300">
        <div className="noise-overlay" aria-hidden="true" />
        <div className="w-full max-w-md text-center bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 p-8 shadow-[12px_12px_0px_0px_rgba(9,9,11,1)] dark:shadow-none fade-in">
          <div
            className={`w-16 h-16 mx-auto mb-6 flex items-center justify-center border-4 ${
              verdict === "success"
                ? "border-zinc-950 dark:border-zinc-500 text-zinc-950 dark:text-zinc-200 bg-zinc-100 dark:bg-zinc-900"
                : "border-red-600 text-red-600 bg-red-50 dark:bg-red-950/20"
            }`}
          >
            {verdict === "success" ? (
              <CheckCircle className="w-8 h-8" />
            ) : (
              <XCircle className="w-8 h-8" />
            )}
          </div>
          <h1 className="text-2xl font-black uppercase text-zinc-950 dark:text-zinc-50 tracking-tight mb-2">
            {verdict === "success" ? "VERIFIED SUCCESS" : "PENALTY ENFORCED"}
          </h1>
          <p className="text-sm font-bold text-zinc-700 dark:text-zinc-300 font-mono mb-6 leading-relaxed">
            {verdict === "success"
              ? `Oath has been verified. ${oath ? formatCurrency(oath.stake_amount, region) : (region === "in" ? "₹0" : "$0")} released from escrow.`
              : `Oath marked as failed. ${oath ? formatCurrency(oath.stake_amount, region) : (region === "in" ? "₹0" : "$0")} forfeited to penalty ledger.`}
          </p>
          <Link
            href="/"
            className="inline-block w-full py-4 bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 text-sm font-black uppercase tracking-tight hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all border-2 border-zinc-950 dark:border-transparent shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
          >
            Go to Oath Arena
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 px-6 py-12 transition-colors duration-300">
      <div className="noise-overlay" aria-hidden="true" />
      <div className="w-full max-w-lg bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 p-8 shadow-[12px_12px_0px_0px_rgba(9,9,11,1)] dark:shadow-none fade-in text-left">
        {/* Navigation */}
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 transition-colors uppercase tracking-wider"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Home
          </Link>
          <span className="px-2 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700">
            Referee Link
          </span>
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 border-2 border-zinc-950 dark:border-zinc-700 flex items-center justify-center bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-black uppercase text-zinc-950 dark:text-zinc-100 tracking-tight">
              Nominee Verification
            </h1>
            <p className="text-[11px] font-mono text-zinc-600 dark:text-zinc-400 font-bold">
              You were chosen to confirm if this oath was fulfilled.
            </p>
          </div>
        </div>

        {/* Oath Details */}
        <div className="border-2 border-zinc-950 dark:border-zinc-800 p-5 mb-6 bg-zinc-50 dark:bg-zinc-950/50">
          <p className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-[0.2em] mb-2">
            The Oath
          </p>
          <p className="text-lg font-black text-zinc-950 dark:text-zinc-100 leading-snug mb-3">
            &ldquo;{oath?.oath_statement || "Run 5km every morning for 30 days"}&rdquo;
          </p>
          <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 font-bold flex-wrap">
            <span>Sworn by @{oath?.creator?.username || "user"}</span>
            <span>·</span>
            <span className="font-black text-red-600 dark:text-red-500 stake-number">
              {oath ? formatCurrency(oath.stake_amount, region) : (region === "in" ? "₹500" : "$500")} at stake
            </span>
          </div>
        </div>

        {/* Verdict Selection */}
        <div className="space-y-3 mb-6">
          <p className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.2em]">
            Your Verdict
          </p>

          <button
            onClick={() => setVerdict("success")}
            className={`w-full flex items-center gap-3.5 p-4 border-2 transition-all text-left ${
              verdict === "success"
                ? "border-zinc-950 bg-zinc-100 dark:border-zinc-400 dark:bg-zinc-800/60 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                : "border-zinc-300 dark:border-zinc-800 hover:border-zinc-500"
            }`}
          >
            <CheckCircle
              className={`w-5 h-5 ${
                verdict === "success" ? "text-zinc-950 dark:text-zinc-100" : "text-zinc-400"
              }`}
            />
            <div>
              <p className="text-sm font-black text-zinc-950 dark:text-zinc-100">Verify Success</p>
              <p className="text-[11px] font-mono text-zinc-600 dark:text-zinc-400 mt-0.5">
                They proved completion. Release funds back to them.
              </p>
            </div>
          </button>

          <button
            onClick={() => setVerdict("penalty")}
            className={`w-full flex items-center gap-3.5 p-4 border-2 transition-all text-left ${
              verdict === "penalty"
                ? "border-red-600 bg-red-50 dark:bg-red-950/30 shadow-[2px_2px_0px_0px_rgba(220,38,38,1)] dark:shadow-none"
                : "border-zinc-300 dark:border-zinc-800 hover:border-red-500"
            }`}
          >
            <XCircle
              className={`w-5 h-5 ${
                verdict === "penalty" ? "text-red-600" : "text-zinc-400"
              }`}
            />
            <div>
              <p className="text-sm font-black text-red-600 dark:text-red-400">Enforce Penalty</p>
              <p className="text-[11px] font-mono text-zinc-600 dark:text-zinc-400 mt-0.5">
                They failed or flaked. Forfeit their stake.
              </p>
            </div>
          </button>
        </div>

        {/* Optional Note */}
        <div className="mb-6">
          <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.2em] mb-2 block">
            Note or Reason (Optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add any comments on their proof or lack thereof..."
            className="w-full px-3 py-2 text-sm border-2 border-zinc-950 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 resize-none font-medium"
            rows={2}
          />
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!verdict || submitting}
          className={`w-full py-4 text-sm font-black tracking-tight uppercase transition-all border-2 ${
            !verdict || submitting
              ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600 border-transparent cursor-not-allowed"
              : verdict === "penalty"
              ? "bg-red-600 text-white border-red-600 hover:bg-red-700 shadow-[4px_4px_0px_0px_rgba(220,38,38,1)] dark:shadow-none"
              : "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 border-zinc-950 dark:border-transparent hover:bg-zinc-800 dark:hover:bg-zinc-200 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
          }`}
        >
          {submitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Submitting Verdict...
            </span>
          ) : verdict === "penalty" ? (
            "Enforce Penalty"
          ) : (
            "Verify Success & Release Escrow"
          )}
        </button>

        {/* Warning */}
        <div className="flex items-center gap-2 mt-4 text-zinc-500">
          <AlertTriangle className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[10px] font-mono">
            This verification is permanent and cannot be undone.
          </span>
        </div>
      </div>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#09090b]">
          <div className="w-8 h-8 border-2 border-zinc-950 dark:border-zinc-800 animate-spin border-t-zinc-400 rounded-full" />
        </div>
      }
    >
      <VerifyContent />
    </Suspense>
  );
}
