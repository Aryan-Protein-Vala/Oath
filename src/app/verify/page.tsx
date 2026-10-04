"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Shield, CheckCircle, XCircle, AlertTriangle, ArrowLeft, Loader2, ExternalLink } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { getMockOaths, verifyNominee } from "@/lib/data-hooks";
import { isDemoSession } from "@/lib/auth-context";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Oath } from "@/lib/types";
import { useRegion } from "@/lib/region-context";
import { showToast } from "@/components/Toast";
import { confirmAction } from "@/components/ConfirmationModal";

function VerifyContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || searchParams.get("id") || "";
  const { region } = useRegion();

  const [verdict, setVerdict] = useState<"success" | "penalty" | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [oath, setOath] = useState<Oath | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchOath = async () => {
      setLoading(true);
      setError(null);
      setOath(null);
      if (!token) {
        setError("This verification link is missing its secure token. Ask the oath creator to send a fresh link.");
        setLoading(false);
        return;
      }

      if (isDemoSession()) {
        const local = getMockOaths().find((candidate) => candidate.id === token);
        if (!cancelled) {
          setOath(local ?? null);
          if (!local) setError("This demo verification link is invalid or has already been used.");
          setLoading(false);
        }
        return;
      }

      if (!isSupabaseConfigured()) {
        if (!cancelled) {
          setError("Verification is unavailable because the account backend is not configured.");
          setLoading(false);
        }
        return;
      }

      try {
        const { data, error: lookupError } = await createClient().rpc("get_nominee_challenge", { p_token: token });
        if (cancelled) return;
        const row = Array.isArray(data) ? data[0] : null;
        if (lookupError || !row) {
          setError("This verification link is invalid, expired, or has already been used.");
          return;
        }
        const now = new Date().toISOString();
        const hasProof = Boolean(row.proof_type || row.proof_url || row.proof_text);
        setOath({
          id: row.oath_id,
          creator_id: "",
          creator: { username: row.creator_username } as Oath["creator"],
          oath_statement: row.oath_statement,
          deadline: row.deadline,
          oath_type: row.oath_type,
          verification_method: "nominee",
          consequence_type: "fiat",
          stake_amount: Number(row.stake_amount),
          status: row.challenge_status,
          min_players: 1,
          max_players: 1,
          proofs: hasProof ? [{
            id: `proof-${row.oath_id}`,
            oath_id: row.oath_id,
            submitted_by: "",
            proof_type: row.proof_type || "photo",
            proof_url: row.proof_url,
            proof_text: row.proof_text,
            status: "pending_review",
            created_at: row.proof_created_at || now,
          }] : [],
          created_at: now,
          updated_at: now,
        } as Oath);
      } catch {
        if (!cancelled) setError("Could not load this verification. Check your connection and try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchOath();
    return () => { cancelled = true; };
  }, [token]);

  const handleSubmit = async () => {
    if (!verdict || !oath || submitting) return;

    const isPenalty = verdict === "penalty";
    const confirmed = await confirmAction({
      title: isPenalty ? "Confirm Oath Failure Verdict" : "Confirm Oath Completion",
      message: isPenalty
        ? `Are you sure you want to fail this oath? The swearer's locked stake of ${formatCurrency(oath.stake_amount, region)} will be forfeited.`
        : `Are you sure you want to approve this oath as completed? The swearer's locked stake will be safely returned to them.`,
      confirmLabel: isPenalty ? "Confirm Failure (Slash Stake)" : "Approve Oath (Release Escrow)",
      cancelLabel: "Review Again",
      variant: isPenalty ? "danger" : "default",
      dangerWarning: isPenalty ? "This decision is final and will penalize the swearer." : undefined,
    });
    if (!confirmed) return;

    setSubmitting(true);
    setError(null);
    try {
      const result = await verifyNominee(token, verdict, note.trim() || undefined);
      if (result?.error) {
        setError(result.error);
        showToast(result.error, "error");
        return;
      }
      showToast(
        isPenalty ? "Verdict recorded: Oath marked as failed." : "Verdict recorded: Oath verified successfully!",
        isPenalty ? "error" : "success"
      );
      setSubmitted(true);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : "Your verification could not be recorded. Try again.";
      setError(msg);
      showToast(msg, "error");
    } finally {
      setSubmitting(false);
    }
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

  if (!oath) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#09090b] px-4 py-8 text-zinc-950 dark:text-zinc-50">
        <section className="w-full max-w-md border-4 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-[#0a0a0f] p-6 sm:p-8 text-center shadow-[8px_8px_0_0_rgba(0,0,0,1)]">
          <AlertTriangle className="mx-auto mb-4 h-8 w-8 text-red-600" />
          <h1 className="text-xl font-black uppercase">Verification unavailable</h1>
          <p role="alert" className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{error ?? "This verification link is invalid or expired."}</p>
          <Link href="/" className="mt-6 inline-flex min-h-11 w-full items-center justify-center bg-zinc-950 px-4 text-xs font-black uppercase text-white dark:bg-zinc-100 dark:text-zinc-950">Back to OATH</Link>
        </section>
      </main>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#09090b] px-4 py-8 sm:px-6 sm:py-12 transition-colors duration-300">
        <div className="noise-overlay" aria-hidden="true" />
        <div className="w-full max-w-md text-center bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 p-5 sm:p-8 shadow-[12px_12px_0px_0px_rgba(9,9,11,1)] dark:shadow-none fade-in">
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
            {verdict === "success" ? "SUCCESS VERIFIED" : "FAILURE VERIFIED"}
          </h1>
          <p className="text-sm font-bold text-zinc-700 dark:text-zinc-300 font-mono mb-6 leading-relaxed">
            {verdict === "success"
              ? `The oath has been marked complete. The recorded virtual stake was ${formatCurrency(oath.stake_amount, region)}.`
              : `The oath has been marked failed. The recorded virtual stake was ${formatCurrency(oath.stake_amount, region)}.`}
          </p>
          <p className="mb-6 text-[11px] font-mono text-zinc-500">This updates OATH&apos;s virtual sandbox ledger only; no cash transfer is made.</p>
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
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 px-4 py-8 sm:px-6 sm:py-12 transition-colors duration-300">
      <div className="noise-overlay" aria-hidden="true" />
      <div className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 p-5 sm:p-8 shadow-[12px_12px_0px_0px_rgba(9,9,11,1)] dark:shadow-none fade-in text-left">
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
            &ldquo;{oath.oath_statement}&rdquo;
          </p>
          <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-600 dark:text-zinc-400 font-bold flex-wrap">
            <span>Sworn by @{oath.creator?.username ?? "OATH member"}</span>
            <span>·</span>
            <span className="font-black text-red-600 dark:text-red-500 stake-number">
              {formatCurrency(oath.stake_amount, region)} virtual stake
            </span>
          </div>
        </div>

        {/* Submitted Proof / Evidence */}
        {oath.proofs && oath.proofs.length > 0 && (
          <div className="border-2 border-zinc-950 dark:border-zinc-800 p-4 mb-6 bg-zinc-50 dark:bg-zinc-900/60">
            <p className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-[0.2em] mb-2">
              Submitted Proof Evidence
            </p>
            {oath.proofs.map((proof, idx) => (
              <div key={proof.id || idx} className="space-y-1.5 text-xs font-mono">
                <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">
                  Type: {proof.proof_type} · Status: {proof.status}
                </span>
                {proof.proof_text && (
                  <p className="p-3 border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-200 italic leading-relaxed">
                    &ldquo;{proof.proof_text}&rdquo;
                  </p>
                )}
                {proof.proof_url && (
                  <div className="pt-1">
                    <a
                      href={proof.proof_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-600 dark:text-sky-400 underline hover:opacity-80"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> View Uploaded Evidence &rarr;
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Verdict Selection */}
        <div className="space-y-3 mb-6">
          <p className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.2em]">
            Your Verdict
          </p>

          <button
            type="button"
            aria-pressed={verdict === "success"}
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
                They proved completion. Record a success and settle the virtual stake now.
              </p>
            </div>
          </button>

          <button
            type="button"
            aria-pressed={verdict === "penalty"}
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
                They did not complete it. Record failure and settle the virtual stake now.
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
            className="w-full px-3 py-2 text-base sm:text-sm border-2 border-zinc-950 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/50 resize-none font-medium"
            rows={2}
          />
        </div>

        {error && <p role="alert" className="mb-4 border-2 border-red-600 bg-red-50 p-3 text-xs font-mono text-red-700 dark:bg-red-950/20 dark:text-red-300">{error}</p>}

        {/* Submission immediately records the selected verdict and settles the sandbox ledger. */}
        <button
          type="button"
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
            "Record Failure & Settle Virtual Stake"
          ) : (
            "Record Success & Settle Virtual Stake"
          )}
        </button>

        {/* Warning */}
        <div className="flex items-center gap-2 mt-4 text-zinc-500">
          <AlertTriangle className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[10px] font-mono">
            Selecting the button records an irreversible verdict. Virtual ledger only; no cash payout.
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
