"use client";

import { useState } from "react";
import { Shield, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

// This page simulates the public verification link a nominee receives.
// URL: /verify/[token]

export default function VerifyPage() {
  const [verdict, setVerdict] = useState<"success" | "penalty" | null>(null);
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // Mock oath data for the nominee view
  const oath = {
    statement: "Run 5km every morning for 30 days",
    creator: "reaper_exe",
    stake: 500,
    deadline: "October 15, 2026",
  };

  const handleSubmit = () => {
    if (!verdict) return;
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#09090b] px-6">
        <div className="noise-overlay" aria-hidden="true" />
        <div className="text-center fade-in max-w-md">
          <div
            className={`w-16 h-16 mx-auto mb-6 flex items-center justify-center border ${
              verdict === "success"
                ? "border-zinc-600"
                : "border-red-800"
            }`}
          >
            {verdict === "success" ? (
              <CheckCircle className="w-8 h-8 text-zinc-300" />
            ) : (
              <XCircle className="w-8 h-8 text-red-500" />
            )}
          </div>
          <h1 className="text-2xl font-black text-zinc-100 tracking-tight mb-2">
            {verdict === "success" ? "VERIFIED" : "PENALTY ENFORCED"}
          </h1>
          <p className="text-sm text-zinc-500 font-mono">
            {verdict === "success"
              ? `@${oath.creator}'s oath has been verified. ${formatCurrency(oath.stake)} released from escrow.`
              : `@${oath.creator} has been penalized. ${formatCurrency(oath.stake)} forfeited.`}
          </p>
          <p className="text-xs text-zinc-700 font-mono mt-6">
            This link is now expired.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex items-center justify-center bg-[#09090b] px-6">
      <div className="noise-overlay" aria-hidden="true" />
      <div className="w-full max-w-lg fade-in">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Shield className="w-5 h-5 text-zinc-500" />
          <div>
            <h1 className="text-xl font-black text-zinc-100 tracking-tight">
              NOMINEE VERIFICATION
            </h1>
            <p className="text-[11px] font-mono text-zinc-600">
              You&apos;ve been nominated to verify this oath.
            </p>
          </div>
        </div>

        {/* Oath Details */}
        <div className="border border-zinc-800 p-5 mb-6 bg-zinc-950/50">
          <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-[0.2em] mb-2">
            The Oath
          </p>
          <p className="text-lg font-bold text-zinc-200 leading-relaxed mb-3">
            &ldquo;{oath.statement}&rdquo;
          </p>
          <div className="flex items-center gap-4 text-[11px] font-mono text-zinc-500">
            <span>by @{oath.creator}</span>
            <span className="text-zinc-800">·</span>
            <span>Due {oath.deadline}</span>
            <span className="text-zinc-800">·</span>
            <span className="font-bold text-zinc-300 stake-number">
              {formatCurrency(oath.stake)} at stake
            </span>
          </div>
        </div>

        {/* Verdict Selection */}
        <div className="space-y-3 mb-6">
          <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-[0.2em]">
            Your Verdict
          </p>

          <button
            onClick={() => setVerdict("success")}
            className={`w-full flex items-center gap-3 p-4 border transition-all text-left ${
              verdict === "success"
                ? "border-zinc-500 bg-zinc-800/40"
                : "border-zinc-800 hover:border-zinc-700"
            }`}
          >
            <CheckCircle
              className={`w-5 h-5 ${
                verdict === "success" ? "text-zinc-200" : "text-zinc-600"
              }`}
            />
            <div>
              <p className="text-sm font-bold text-zinc-200">Verify Success</p>
              <p className="text-[11px] font-mono text-zinc-500 mt-0.5">
                They completed the oath. Release their funds.
              </p>
            </div>
          </button>

          <button
            onClick={() => setVerdict("penalty")}
            className={`w-full flex items-center gap-3 p-4 border transition-all text-left ${
              verdict === "penalty"
                ? "border-red-800 bg-red-950/30"
                : "border-zinc-800 hover:border-zinc-700"
            }`}
          >
            <XCircle
              className={`w-5 h-5 ${
                verdict === "penalty" ? "text-red-500" : "text-zinc-600"
              }`}
            />
            <div>
              <p className="text-sm font-bold text-red-300">Enforce Penalty</p>
              <p className="text-[11px] font-mono text-zinc-500 mt-0.5">
                They failed. Forfeit their stake.
              </p>
            </div>
          </button>
        </div>

        {/* Optional Note */}
        <div className="mb-6">
          <label className="text-[10px] font-mono text-zinc-600 uppercase tracking-[0.2em] mb-2 block">
            Note (Optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add context to your verdict..."
            className="w-full px-3 py-2 text-sm border border-zinc-800 bg-transparent resize-none"
            rows={2}
          />
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={!verdict}
          className={`w-full py-3.5 text-sm font-black tracking-tight uppercase transition-all ${
            !verdict
              ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
              : verdict === "penalty"
              ? "bg-red-700 text-white hover:bg-red-600"
              : "bg-zinc-50 text-zinc-950 hover:bg-zinc-200"
          }`}
        >
          {verdict === "penalty"
            ? "Enforce Penalty"
            : verdict === "success"
            ? "Verify Success"
            : "Select a Verdict"}
        </button>

        {/* Warning */}
        <div className="flex items-center gap-2 mt-4 text-zinc-600">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span className="text-[10px] font-mono">
            This action is irreversible. Choose carefully.
          </span>
        </div>
      </div>
    </div>
  );
}
