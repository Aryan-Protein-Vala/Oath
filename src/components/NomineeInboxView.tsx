"use client";

import { useState } from "react";
import { Check, Clock, Loader2, Shield, ThumbsDown, ThumbsUp } from "lucide-react";
import type { NomineeRequest } from "@/lib/types";
import { resolveNomineeRequest } from "@/lib/data-hooks";
import { useRegion } from "@/lib/region-context";
import { formatCurrency, getTimeRemaining } from "@/lib/utils";
import { showToast } from "./Toast";

interface NomineeInboxViewProps {
  requests: NomineeRequest[];
  loading: boolean;
  onResolved?: () => void;
}

export default function NomineeInboxView({ requests, loading, onResolved }: NomineeInboxViewProps) {
  const { region } = useRegion();
  const [selected, setSelected] = useState<{ id: string; success: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submitVerdict = async () => {
    if (!selected) return;
    setSubmitting(true);
    try {
      const { error } = await resolveNomineeRequest(selected.id, selected.success);
      if (error) showToast(error, "error");
      else {
        showToast("Review recorded. The oath status was settled in the sandbox.", "success");
        setSelected(null);
        onResolved?.();
      }
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Could not submit this review.", "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="flex-1 min-h-0 overflow-y-auto px-4 py-6 sm:px-6 sm:py-10">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6 border-b-2 border-zinc-950 dark:border-zinc-800 pb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
            <h1 className="text-2xl font-black uppercase tracking-tight">Referee Inbox</h1>
          </div>
          <p className="mt-2 text-xs font-mono text-zinc-600 dark:text-zinc-400">
            Requests sent to your account. No email alert is sent in this build, so check this inbox. Approving or rejecting settles that oath immediately; stakes shown here are virtual sandbox amounts only.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-xs font-mono text-zinc-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading reviews…</div>
        ) : requests.length === 0 ? (
          <div className="border-2 border-dashed border-zinc-300 dark:border-zinc-800 px-5 py-12 text-center">
            <p className="font-mono text-sm font-bold">No pending reviews</p>
            <p className="mt-2 text-xs font-mono text-zinc-500">When someone selects your registered @username as a nominee, their oath will appear here.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {requests.map((request) => {
              const time = getTimeRemaining(request.deadline);
              return (
                <article key={request.nominee_id} className="border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 p-4 sm:p-5 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-mono uppercase tracking-widest text-zinc-500">From @{request.creator_username}</p>
                      <h2 className="mt-1 text-base font-black leading-snug">{request.oath_statement}</h2>
                    </div>
                    <div className={`flex items-center gap-1.5 text-[10px] font-mono font-bold ${time.isUrgent ? "text-red-600" : "text-zinc-500"}`}>
                      <Clock className="w-3.5 h-3.5" /> {time.isExpired ? "DEADLINE PASSED" : `${time.days ? `${time.days}d ` : ""}${time.hours}h left`}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-zinc-500">
                    {request.stake_amount > 0 && <span>Virtual stake: {formatCurrency(request.stake_amount, region)}</span>}
                    <span>Consequence: {request.consequence_type === "fiat" ? "sandbox stake" : "public shame"}</span>
                    <span>Due {new Date(request.deadline).toLocaleDateString()}</span>
                  </div>

                  {selected?.id === request.nominee_id ? (
                    <div className="mt-4 border-2 border-amber-500/70 bg-amber-50 dark:bg-amber-950/20 p-3">
                      <p className="text-xs font-bold">Confirm {selected.success ? "approval" : "rejection"}?</p>
                      <p className="mt-1 text-[10px] font-mono text-zinc-600 dark:text-zinc-400">This is the final referee verdict and cannot be changed. No real payment or donation is processed.</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" disabled={submitting} onClick={() => void submitVerdict()} className="min-h-11 px-4 bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 text-[10px] font-black uppercase disabled:opacity-50">
                          {submitting ? <Loader2 className="inline w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="inline w-3.5 h-3.5 mr-1" />}{submitting ? "Submitting…" : "Confirm verdict"}
                        </button>
                        <button type="button" disabled={submitting} onClick={() => setSelected(null)} className="min-h-11 px-4 border-2 border-zinc-300 dark:border-zinc-700 text-[10px] font-black uppercase">Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" onClick={() => setSelected({ id: request.nominee_id, success: true })} className="min-h-11 flex-1 sm:flex-none px-4 border-2 border-emerald-700 text-emerald-800 dark:text-emerald-400 text-[10px] font-black uppercase hover:bg-emerald-50 dark:hover:bg-emerald-950/30"><ThumbsUp className="inline w-3.5 h-3.5 mr-1" />Yes, completed</button>
                      <button type="button" onClick={() => setSelected({ id: request.nominee_id, success: false })} className="min-h-11 flex-1 sm:flex-none px-4 border-2 border-red-700 text-red-700 dark:text-red-400 text-[10px] font-black uppercase hover:bg-red-50 dark:hover:bg-red-950/30"><ThumbsDown className="inline w-3.5 h-3.5 mr-1" />No, not completed</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
