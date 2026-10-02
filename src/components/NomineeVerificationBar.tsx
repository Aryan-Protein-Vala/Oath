"use client";

import { useState, useEffect } from "react";
import { Shield, Check, X, Loader2, ExternalLink } from "lucide-react";
import { useOaths, settleOath } from "@/lib/data-hooks";
import { useAuth } from "@/lib/auth-context";
import { showToast } from "./Toast";

export default function NomineeVerificationBar() {
  const { user, profile } = useAuth();
  const { oaths, refresh } = useOaths();
  const [loading, setLoading] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!user || !profile) return null;

  // Find oaths where the current user is the nominee, and the oath is active and has proofs pending review
  const pendingNomineeOaths = oaths.filter((o) => {
    const isNominee =
      o.nominees?.some(
        (n) =>
          n.nominee_user_id === user.id ||
          n.email === user.email ||
          n.email === `@${profile.username}` ||
          n.email === profile.username
      ) ||
      o.nominee_email === user.email ||
      o.nominee_email === `@${profile.username}` ||
      o.nominee_email === profile.username;

    if (!isNominee || o.status !== "active") return false;
    
    // Check if there are any proofs that need review
    const pendingProofs = o.proofs?.filter(p => p.status === "pending_review") || [];
    return pendingProofs.length > 0;
  });

  if (pendingNomineeOaths.length === 0) return null;

  const oath = pendingNomineeOaths[0];
  const proofToVerify = oath.proofs?.find(p => p.status === "pending_review");

  if (!proofToVerify) return null;

  const reviewDeadline =
    proofToVerify.review_deadline ||
    new Date(new Date(proofToVerify.created_at).getTime() + 24 * 3600 * 1000).toISOString();
  const remainingMs = Math.max(0, new Date(reviewDeadline).getTime() - now);
  const hoursRemaining = Math.floor(remainingMs / (1000 * 60 * 60));
  const minsRemaining = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));

  const handleVerify = async (success: boolean) => {
    setLoading(oath.id);
    try {
      const { error } = await settleOath(
        oath.id,
        success ? "success" : "penalty",
        success ? "Verified by Nominee" : "Rejected by Nominee"
      );

      if (error) throw new Error(error);
      
      showToast(success ? "Oath verified successfully!" : "Oath rejected.", "success");
      refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to verify oath";
      showToast(message, "error");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 animate-in slide-in-from-bottom-10 pointer-events-none">
      <div className="max-w-2xl mx-auto bg-zinc-950 dark:bg-zinc-100 border-2 border-zinc-950 dark:border-white p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_0px_rgba(255,255,255,0.2)] pointer-events-auto flex flex-col sm:flex-row items-start sm:items-center gap-4 justify-between">
        
        <div className="flex-1 min-w-0">
          <div className="flex items-start sm:items-center gap-3">
            <div className="p-2 bg-white dark:bg-zinc-950 rounded-none border border-zinc-800 shrink-0">
              <Shield className="w-5 h-5 text-zinc-900 dark:text-zinc-100" />
            </div>
            <div>
              <p className="text-[10px] font-mono font-bold text-zinc-400 dark:text-zinc-600 uppercase tracking-widest mb-0.5">
                Nominee Verification Required
              </p>
              <p className="text-sm font-semibold text-zinc-100 dark:text-zinc-900">
                <span className="font-black text-white dark:text-black">@{oath.creator?.username}</span>: &ldquo;{oath.oath_statement}&rdquo;
              </p>
            </div>
          </div>

          {/* Submitted Evidence preview */}
          <div className="mt-2.5 pt-2 border-t border-zinc-800 dark:border-zinc-300 text-xs font-mono text-zinc-300 dark:text-zinc-700">
            <span className="text-[9px] uppercase font-bold tracking-wider text-zinc-400 dark:text-zinc-500">
              Submitted Evidence ({proofToVerify.proof_type}):
            </span>
            {proofToVerify.proof_text && (
              <p className="italic mt-0.5 text-zinc-200 dark:text-zinc-800">&ldquo;{proofToVerify.proof_text}&rdquo;</p>
            )}
            {proofToVerify.proof_url && (
              <div className="mt-1">
                <a
                  href={proofToVerify.proof_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sky-400 dark:text-sky-600 underline text-xs hover:opacity-80"
                >
                  <ExternalLink className="w-3 h-3" /> View Submitted Evidence Link &rarr;
                </a>
              </div>
            )}
            {/* 24-hour countdown timer */}
            <div className="mt-1.5 flex items-center gap-1.5 text-[11px] font-mono font-bold text-amber-400 dark:text-amber-600">
              <span>⏳ 24h Review Window: {hoursRemaining} hours {minsRemaining} mins remaining before auto-approval</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 mt-2 sm:mt-0">
          <button
            onClick={() => handleVerify(true)}
            disabled={loading !== null}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-white text-zinc-950 dark:bg-zinc-950 dark:text-white border-2 border-transparent font-black uppercase text-xs hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
          >
            {loading === oath.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Verify
          </button>
          <button
            onClick={() => handleVerify(false)}
            disabled={loading !== null}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 bg-red-600 text-white border-2 border-transparent font-black uppercase text-xs hover:bg-red-700 transition-colors"
          >
            {loading === oath.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
            Reject
          </button>
        </div>

      </div>
    </div>
  );
}
