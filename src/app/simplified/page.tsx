"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Shield,
  Zap,
  Flame,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Camera,
  MessageSquare,
  MoreVertical,
  Users,
  Swords,
  User,
  Globe,
  Sparkles,
  Check,
  X,
  ExternalLink,
  ChevronRight,
  Lock,
  Loader2,
  Info,
  DollarSign,
  TrendingUp,
  Skull,
  Repeat
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  useOaths,
  useSquadLobbies,
  useWall,
  useTransactions,
  isMockMode,
  passDailyWork,
  requestMoreProof,
  peerReviewProof,
  submitProof,
  createOath
} from "@/lib/data-hooks";
import { Oath, Proof, ProofStatus } from "@/lib/types";
import { formatCurrency, getTimeRemaining } from "@/lib/utils";
import { showToast } from "@/components/Toast";
import { confirmAction } from "@/components/ConfirmationModal";
import ChatRoom from "@/components/ChatRoom";
import WalletModal from "@/components/WalletModal";

type SimplifiedTab = "dashboard" | "create" | "community";

export default function SimplifiedPage() {
  const router = useRouter();
  const { user, profile, wallet, refreshWallet } = useAuth();
  const { oaths, refresh: refreshOaths } = useOaths();
  const { lobbies, refresh: refreshLobbies } = useSquadLobbies();
  const { entries: shameEntries } = useWall("shame");
  const { entries: honorEntries } = useWall("honor");
  const { transactions } = useTransactions();

  const [activeTab, setActiveTab] = useState<SimplifiedTab>("dashboard");
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [chatOath, setChatOath] = useState<Oath | null>(null);
  const [proofOath, setProofOath] = useState<Oath | null>(null);

  // Review modal state
  const [reviewModal, setReviewModal] = useState<{
    oath: Oath;
    type: "need_more_proof" | "reject";
  } | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  // Community sub-tab
  const [communityTab, setCommunityTab] = useState<"lobbies" | "shame" | "honor">("lobbies");

  // Filter oaths by role
  const isRefereeForOath = (oath: Oath): boolean => {
    if (!user) return false;
    if (oath.creator_id === user.id) return false;
    if (oath.oath_type === "solo") {
      const cleanUserEmail = user.email?.toLowerCase();
      const cleanUsername = profile?.username?.toLowerCase();
      const byNominees = oath.nominees?.some((n) => {
        if (n.nominee_user_id === user.id) return true;
        if (cleanUserEmail && n.email && n.email.toLowerCase() === cleanUserEmail) return true;
        if (cleanUsername && n.email) {
          const cleanNomineeEmail = n.email.toLowerCase();
          return cleanNomineeEmail === "@" + cleanUsername || cleanNomineeEmail === cleanUsername;
        }
        return false;
      });
      if (byNominees) return true;
      if (cleanUserEmail && oath.nominee_email && oath.nominee_email.toLowerCase() === cleanUserEmail) return true;
      if (cleanUsername && oath.nominee_email) {
        const cleanNominee = oath.nominee_email.toLowerCase();
        return cleanNominee === "@" + cleanUsername || cleanNominee === cleanUsername;
      }
      return false;
    }
    if (oath.oath_type === "duo" && oath.opponent_id === user.id) return true;
    return false;
  };

  // Categorize oaths into Two Lanes:
  // Lane 1: Action Required (Your Turn)
  // Lane 2: In Flight (Watching / Passive)
  const { actionRequiredOaths, inFlightOaths } = useMemo(() => {
    const actionRequired: Array<{ oath: Oath; role: "challenger" | "referee" | "member"; reason: string }> = [];
    const inFlight: Array<{ oath: Oath; role: "challenger" | "referee" | "member"; statusText: string }> = [];

    oaths.forEach((oath) => {
      if (oath.status !== "active") return;

      const isReferee = isRefereeForOath(oath);
      const isCreator = oath.creator_id === user?.id;
      const pendingProof = oath.proofs?.find((p) => p.status === "pending_review");
      const latestProof = pendingProof || (oath.proofs && [...oath.proofs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0]);

      if (isReferee) {
        // As a referee, action is required IF there is a pending proof
        if (latestProof && latestProof.status === "pending_review") {
          actionRequired.push({
            oath,
            role: "referee",
            reason: "Review submitted proof from challenger"
          });
        } else {
          inFlight.push({
            oath,
            role: "referee",
            statusText: "Waiting for challenger to submit proof"
          });
        }
      } else if (isCreator) {
        // As the creator/challenger
        if (latestProof?.status === "needs_more_proof") {
          actionRequired.push({
            oath,
            role: "challenger",
            reason: "Referee requested changes on your proof"
          });
        } else if (latestProof?.status === "pending_review") {
          inFlight.push({
            oath,
            role: "challenger",
            statusText: "Proof in review (24h countdown)"
          });
        } else if (latestProof?.status === "verified") {
          inFlight.push({
            oath,
            role: "challenger",
            statusText: "Today's milestone verified. Next opens tomorrow"
          });
        } else {
          // Proof due today!
          actionRequired.push({
            oath,
            role: "challenger",
            reason: "Daily proof due before deadline"
          });
        }
      } else {
        // Group member
        inFlight.push({
          oath,
          role: "member",
          statusText: "Squad oath in progress"
        });
      }
    });

    return { actionRequiredOaths: actionRequired, inFlightOaths: inFlight };
  }, [oaths, user]);

  // Handle pass work
  const handlePassTodayWork = async (oath: Oath) => {
    const confirmed = await confirmAction({
      title: "Pass Today's Work?",
      message: `Verify and approve today's proof for this oath? This will advance the streak.`,
      confirmLabel: "Pass Work",
      cancelLabel: "Cancel",
      variant: "default"
    });
    if (!confirmed) return;

    setActionLoading(true);
    const { error } = await passDailyWork(oath.id, "Verified by referee via Simplified Dashboard");
    setActionLoading(false);

    if (error) {
      showToast(error, "error");
    } else {
      showToast("Work approved! Streak advanced.", "success");
      refreshOaths();
    }
  };

  // Handle reject / need more proof
  const handleConfirmReview = async () => {
    if (!reviewModal || !reviewNote.trim()) {
      showToast("Please enter a note / reason", "error");
      return;
    }

    setActionLoading(true);
    if (reviewModal.type === "need_more_proof") {
      const { error } = await requestMoreProof(reviewModal.oath.id, reviewNote.trim());
      setActionLoading(false);
      if (error) {
        showToast(error, "error");
      } else {
        showToast("Requested clearer proof from challenger.", "info");
        setReviewModal(null);
        setReviewNote("");
        refreshOaths();
      }
    } else {
      const { error } = await peerReviewProof(reviewModal.oath.id, false, reviewNote.trim());
      setActionLoading(false);
      if (error) {
        showToast(error, "error");
      } else {
        showToast("Proof rejected.", "error");
        setReviewModal(null);
        setReviewNote("");
        refreshOaths();
      }
    }
  };

  return (
    <div className="min-h-[100dvh] bg-zinc-50 dark:bg-[#070709] text-zinc-950 dark:text-zinc-100 flex flex-col font-sans selection:bg-zinc-900 selection:text-white dark:selection:bg-zinc-100 dark:selection:text-zinc-900">
      {/* Top Banner comparing Simplified vs Original */}
      <div className="bg-zinc-950 dark:bg-zinc-900 text-white border-b-2 border-zinc-800 px-4 py-2.5 flex items-center justify-between text-xs font-mono">
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 bg-amber-400 text-zinc-950 font-black text-[10px] tracking-wider uppercase">
            SIMPLIFIED PREVIEW
          </span>
          <span className="hidden sm:inline text-zinc-400 font-medium">
            Single-Action Two-Lane Experience (No Backend Changes)
          </span>
        </div>
        <Link
          href="/"
          className="flex items-center gap-1.5 px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-[11px] font-bold uppercase tracking-wider transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Return to Original (/)
        </Link>
      </div>

      {/* Main App Bar */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-[#070709]/95 backdrop-blur-md border-b-2 border-zinc-950 dark:border-zinc-800 px-4 sm:px-8 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="text-xl sm:text-2xl font-black tracking-tighter uppercase font-mono">
              OATH<span className="text-amber-500">.</span>
            </span>
          </div>

          {/* 3 Core Tabs */}
          <nav className="hidden md:flex items-center gap-1 bg-zinc-100 dark:bg-zinc-900/60 p-1 border border-zinc-300 dark:border-zinc-800">
            <button
              onClick={() => setActiveTab("dashboard")}
              className={`px-4 py-1.5 text-xs font-black uppercase tracking-wider transition-all ${
                activeTab === "dashboard"
                  ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 shadow-sm"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100"
              }`}
            >
              Dashboard ({actionRequiredOaths.length > 0 ? actionRequiredOaths.length : "0"})
            </button>
            <button
              onClick={() => setActiveTab("create")}
              className={`px-4 py-1.5 text-xs font-black uppercase tracking-wider transition-all ${
                activeTab === "create"
                  ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 shadow-sm"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100"
              }`}
            >
              New Oath
            </button>
            <button
              onClick={() => setActiveTab("community")}
              className={`px-4 py-1.5 text-xs font-black uppercase tracking-wider transition-all ${
                activeTab === "community"
                  ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 shadow-sm"
                  : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100"
              }`}
            >
              Community & Lobbies
            </button>
          </nav>
        </div>

        {/* Right actions: Wallet & Profile */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowWalletModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-100 dark:bg-zinc-900 border-2 border-zinc-950 dark:border-zinc-800 text-xs font-mono font-bold hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors"
          >
            <span className="text-zinc-500">WALLET:</span>
            <span className="text-emerald-600 dark:text-emerald-400 font-black">
              {formatCurrency(wallet?.balance ?? 0, "global")}
            </span>
          </button>
          {profile?.username && (
            <span className="hidden sm:inline-block text-xs font-mono font-bold text-zinc-600 dark:text-zinc-400 border border-zinc-300 dark:border-zinc-800 px-2.5 py-1">
              @{profile.username}
            </span>
          )}
        </div>
      </header>

      {/* Mobile Tab Bar */}
      <div className="md:hidden flex items-center border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#070709] px-2 py-1.5">
        <button
          onClick={() => setActiveTab("dashboard")}
          className={`flex-1 py-2 text-center text-xs font-black uppercase tracking-wider ${
            activeTab === "dashboard"
              ? "border-b-2 border-zinc-950 dark:border-zinc-100 text-zinc-950 dark:text-zinc-100"
              : "text-zinc-500"
          }`}
        >
          Dashboard {actionRequiredOaths.length > 0 && `(${actionRequiredOaths.length})`}
        </button>
        <button
          onClick={() => setActiveTab("create")}
          className={`flex-1 py-2 text-center text-xs font-black uppercase tracking-wider ${
            activeTab === "create"
              ? "border-b-2 border-zinc-950 dark:border-zinc-100 text-zinc-950 dark:text-zinc-100"
              : "text-zinc-500"
          }`}
        >
          New Oath
        </button>
        <button
          onClick={() => setActiveTab("community")}
          className={`flex-1 py-2 text-center text-xs font-black uppercase tracking-wider ${
            activeTab === "community"
              ? "border-b-2 border-zinc-950 dark:border-zinc-100 text-zinc-950 dark:text-zinc-100"
              : "text-zinc-500"
          }`}
        >
          Lobbies
        </button>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 md:p-8">
        {activeTab === "dashboard" && (
          <div className="space-y-8">
            {/* Quick Metrics Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div className="p-3.5 bg-white dark:bg-zinc-900 border-2 border-zinc-950 dark:border-zinc-800 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
                <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block mb-1">
                  Active Oaths
                </span>
                <span className="text-xl sm:text-2xl font-black font-mono">
                  {oaths.filter((o) => o.status === "active").length}
                </span>
              </div>
              <div className="p-3.5 bg-white dark:bg-zinc-900 border-2 border-zinc-950 dark:border-zinc-800 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
                <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block mb-1">
                  Action Required
                </span>
                <span className={`text-xl sm:text-2xl font-black font-mono flex items-center gap-1.5 ${actionRequiredOaths.length > 0 ? "text-amber-500" : "text-emerald-500"}`}>
                  {actionRequiredOaths.length > 0 ? (
                    <>
                      <span className="w-2.5 h-2.5 rounded-full bg-red-600 inline-block animate-pulse" />
                      {actionRequiredOaths.length}
                    </>
                  ) : (
                    <>
                      <Check className="w-5 h-5 text-emerald-500 inline-block" />
                      None
                    </>
                  )}
                </span>
              </div>
              <div className="col-span-2 sm:col-span-1 p-3.5 bg-white dark:bg-zinc-900 border-2 border-zinc-950 dark:border-zinc-800 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
                <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block mb-1">
                  Locked Escrow
                </span>
                <span className="text-xl sm:text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(wallet?.escrow_locked ?? 0, "global")}
                </span>
              </div>
            </div>

            {/* ============================================================ */}
            {/* LANE 1: ACTION REQUIRED (YOUR TURN) */}
            {/* ============================================================ */}
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b-2 border-zinc-950 dark:border-zinc-800 pb-2">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-red-600 animate-pulse" />
                  <h2 className="text-base sm:text-lg font-black uppercase tracking-tight font-mono">
                    YOUR TURN ({actionRequiredOaths.length})
                  </h2>
                </div>
                <span className="text-xs font-mono font-bold text-zinc-500">
                  Action Required Today
                </span>
              </div>

              {actionRequiredOaths.length === 0 ? (
                <div className="p-8 text-center bg-white dark:bg-zinc-900/40 border-2 border-dashed border-zinc-300 dark:border-zinc-800">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2 opacity-80" />
                  <p className="text-sm font-bold font-mono text-zinc-700 dark:text-zinc-300 uppercase">
                    You are completely caught up!
                  </p>
                  <p className="text-xs text-zinc-500 font-mono mt-1">
                    No proofs are due from you right now, and no challenger is waiting on your review.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {actionRequiredOaths.map(({ oath, role, reason }) => {
                    const totalDays = oath.total_days ?? 1;
                    const currentDay = oath.current_day ?? 1;
                    const timeRem = getTimeRemaining(oath.daily_deadline || oath.deadline);

                    return (
                      <div
                        key={oath.id}
                        className="bg-white dark:bg-zinc-900 border-2 sm:border-4 border-zinc-950 dark:border-zinc-800 p-4 sm:p-5 shadow-[6px_6px_0px_0px_rgba(9,9,11,1)] dark:shadow-none space-y-4"
                      >
                        {/* Header Badge */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="px-2 py-0.5 bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 text-[10px] font-mono font-black uppercase tracking-widest">
                              {oath.oath_type}
                            </span>
                            <span className="px-2 py-0.5 bg-red-100 dark:bg-red-950 text-red-800 dark:text-red-300 border border-red-300 dark:border-red-800 text-[10px] font-mono font-black uppercase tracking-wider">
                              {reason}
                            </span>
                          </div>
                          <button
                            onClick={() => setChatOath(oath)}
                            className="p-1.5 border border-zinc-950 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-mono font-bold flex items-center gap-1 shrink-0"
                            title="Open Chat"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Chat</span>
                          </button>
                        </div>

                        {/* Statement */}
                        <div>
                          <h3 className="text-base sm:text-lg font-black text-zinc-950 dark:text-zinc-100 uppercase tracking-tight">
                            &ldquo;{oath.oath_statement}&rdquo;
                          </h3>
                          <div className="flex items-center gap-3 text-xs font-mono text-zinc-500 mt-1">
                            <span>Stake: <strong>{formatCurrency(oath.stake_amount, "global")}</strong></span>
                            <span>•</span>
                            <span className="text-red-600 dark:text-red-400 font-bold">
                              ⏳ Due in {timeRem.hours}h {timeRem.minutes}m
                            </span>
                          </div>
                        </div>

                        {/* Mechanical Streak Punch-Card (for multi-day oaths) */}
                        {totalDays > 1 && (
                          <div className="bg-zinc-100 dark:bg-zinc-950 p-3 border border-zinc-200 dark:border-zinc-800">
                            <div className="text-[10px] font-mono uppercase text-zinc-500 font-bold mb-2 flex justify-between">
                              <span>Accountability Punch-Card</span>
                              <span className="text-zinc-900 dark:text-zinc-100 font-bold">
                                Day {currentDay} of {totalDays}
                              </span>
                            </div>
                            <div className="grid grid-cols-7 gap-1 sm:gap-2">
                              {Array.from({ length: Math.min(totalDays, 14) }).map((_, idx) => {
                                const dayNum = idx + 1;
                                const isPassed = dayNum < currentDay;
                                const isToday = dayNum === currentDay;
                                return (
                                  <div
                                    key={dayNum}
                                    className={`py-1.5 text-center border font-mono text-[10px] font-bold ${
                                      isPassed
                                        ? "bg-emerald-600 text-white border-emerald-700"
                                        : isToday
                                        ? "bg-amber-400 text-zinc-950 border-amber-500 font-black animate-pulse"
                                        : "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 border-zinc-300 dark:border-zinc-700"
                                    }`}
                                  >
                                    {isPassed ? (
                                      <span className="flex items-center justify-center gap-0.5">
                                        <Check className="w-2.5 h-2.5 inline" /> D{dayNum}
                                      </span>
                                    ) : isToday ? (
                                      <span className="flex items-center justify-center gap-0.5">
                                        <Zap className="w-2.5 h-2.5 inline" /> D{dayNum}
                                      </span>
                                    ) : (
                                      <span>D{dayNum}</span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* SINGLE PRIMARY ACTION BUTTON */}
                        <div className="pt-2">
                          {role === "referee" ? (
                            <div className="flex flex-col sm:flex-row items-center gap-2">
                              <button
                                onClick={() => handlePassTodayWork(oath)}
                                disabled={actionLoading}
                                className="w-full sm:flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-xs tracking-wider transition-colors flex items-center justify-center gap-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                              >
                                <Check className="w-4 h-4" /> Pass Today&apos;s Work
                              </button>
                              <button
                                onClick={() => {
                                  setReviewModal({ oath, type: "need_more_proof" });
                                  setReviewNote("");
                                }}
                                disabled={actionLoading}
                                className="w-full sm:w-auto px-4 py-3 bg-amber-400 hover:bg-amber-500 text-zinc-950 font-black uppercase text-xs tracking-wider transition-colors flex items-center justify-center gap-1.5"
                              >
                                <AlertTriangle className="w-4 h-4" /> Need More Proof
                              </button>
                              <button
                                onClick={() => {
                                  setReviewModal({ oath, type: "reject" });
                                  setReviewNote("");
                                }}
                                disabled={actionLoading}
                                className="w-full sm:w-auto px-4 py-3 bg-red-600 hover:bg-red-700 text-white font-black uppercase text-xs tracking-wider transition-colors flex items-center justify-center gap-1.5"
                              >
                                <X className="w-4 h-4" /> Reject
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setChatOath(oath)}
                              className="w-full py-3.5 bg-zinc-950 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-white dark:text-zinc-950 font-black uppercase text-xs tracking-wider transition-colors flex items-center justify-center gap-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                            >
                              <Camera className="w-4 h-4" /> Submit Today&apos;s Proof in Chat
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ============================================================ */}
            {/* LANE 2: IN FLIGHT (WATCHING / WAITING) */}
            {/* ============================================================ */}
            <section className="space-y-4">
              <div className="flex items-center justify-between border-b-2 border-zinc-950 dark:border-zinc-800 pb-2">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-zinc-400" />
                  <h2 className="text-base sm:text-lg font-black uppercase tracking-tight font-mono">
                    IN FLIGHT ({inFlightOaths.length})
                  </h2>
                </div>
                <span className="text-xs font-mono font-bold text-zinc-500">
                  Passive Progress & Waiting
                </span>
              </div>

              {inFlightOaths.length === 0 ? (
                <div className="p-6 text-center bg-white dark:bg-zinc-900/20 border border-zinc-200 dark:border-zinc-800">
                  <p className="text-xs text-zinc-500 font-mono">No passive oaths currently in flight.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {inFlightOaths.map(({ oath, statusText }) => (
                    <div
                      key={oath.id}
                      className="bg-white dark:bg-zinc-900/60 border-2 border-zinc-200 dark:border-zinc-800 p-4 flex flex-col justify-between space-y-3"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-[10px] font-mono font-bold uppercase">
                            {oath.oath_type}
                          </span>
                          <span className="text-[10px] font-mono text-zinc-500 font-bold">
                            {statusText}
                          </span>
                        </div>
                        <h4 className="text-sm font-bold line-clamp-2">
                          &ldquo;{oath.oath_statement}&rdquo;
                        </h4>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800">
                        <span className="text-xs font-mono font-bold text-zinc-600 dark:text-zinc-400">
                          {formatCurrency(oath.stake_amount, "global")}
                        </span>
                        <button
                          onClick={() => setChatOath(oath)}
                          className="px-3 py-1.5 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-xs font-mono font-bold uppercase transition-colors flex items-center gap-1.5"
                        >
                          <MessageSquare className="w-3.5 h-3.5" /> Open Chat
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}

        {/* 3-Step Creation Wizard */}
        {activeTab === "create" && (
          <SimplifiedCreationWizard
            onSuccess={() => {
              setActiveTab("dashboard");
              refreshOaths();
              refreshWallet();
            }}
          />
        )}

        {/* Community & Lobbies */}
        {activeTab === "community" && (
          <div className="space-y-6">
            <div className="flex items-center gap-2 border-b-2 border-zinc-950 dark:border-zinc-800 pb-2">
              <button
                onClick={() => setCommunityTab("lobbies")}
                className={`px-4 py-1.5 text-xs font-mono font-black uppercase ${
                  communityTab === "lobbies"
                    ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-100"
                }`}
              >
                Public Lobbies ({lobbies.filter((l) => l.oath_type === "lobby").length})
              </button>
              <button
                onClick={() => setCommunityTab("shame")}
                className={`px-4 py-1.5 text-xs font-mono font-black uppercase ${
                  communityTab === "shame"
                    ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-100"
                }`}
              >
                Wall of Shame ({shameEntries.length})
              </button>
              <button
                onClick={() => setCommunityTab("honor")}
                className={`px-4 py-1.5 text-xs font-mono font-black uppercase ${
                  communityTab === "honor"
                    ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-100"
                }`}
              >
                Wall of Honor ({honorEntries.length})
              </button>
            </div>

            {communityTab === "lobbies" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {lobbies.filter((l) => l.oath_type === "lobby").map((lobby) => (
                  <div
                    key={lobby.id}
                    className="p-5 bg-white dark:bg-zinc-900 border-2 border-zinc-950 dark:border-zinc-800 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-mono font-black uppercase">
                        GLOBAL LOBBY
                      </span>
                      <span className="text-xs font-mono font-bold text-zinc-500">
                        {lobby.members?.length ?? 1}/{lobby.max_players ?? 10} Players
                      </span>
                    </div>
                    <h3 className="text-base font-black uppercase">
                      &ldquo;{lobby.oath_statement}&rdquo;
                    </h3>
                    <div className="flex items-center justify-between pt-2 border-t border-zinc-200 dark:border-zinc-800">
                      <span className="text-xs font-mono font-bold">
                        Buy-in: {formatCurrency(lobby.stake_amount, "global")}
                      </span>
                      <button
                        onClick={() => setChatOath(lobby)}
                        className="px-3 py-1.5 bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 text-xs font-black uppercase tracking-wider"
                      >
                        View & Chat
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {communityTab === "shame" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {shameEntries.map((e) => (
                  <div key={e.id} className="p-4 bg-red-50 dark:bg-red-950/20 border-2 border-red-300 dark:border-red-900 space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="font-black text-red-700 dark:text-red-400">@{e.username}</span>
                      <span className="text-zinc-500">Lost {formatCurrency(e.stake_amount, "global")}</span>
                    </div>
                    <p className="text-sm font-bold">&ldquo;{e.oath_statement}&rdquo;</p>
                    {e.excuse && (
                      <p className="text-xs font-mono italic text-red-800 dark:text-red-300 bg-red-100 dark:bg-red-950/40 p-2 border border-red-200 dark:border-red-900">
                        Excuse: &ldquo;{e.excuse}&rdquo;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {communityTab === "honor" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {honorEntries.map((e) => (
                  <div key={e.id} className="p-4 bg-emerald-50 dark:bg-emerald-950/20 border-2 border-emerald-300 dark:border-emerald-900 space-y-2">
                    <div className="flex items-center justify-between text-xs font-mono">
                      <span className="font-black text-emerald-700 dark:text-emerald-400">@{e.username}</span>
                      <span className="text-zinc-500">Saved {formatCurrency(e.stake_amount, "global")}</span>
                    </div>
                    <p className="text-sm font-bold">&ldquo;{e.oath_statement}&rdquo;</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Review Modal (Need More Proof / Reject) */}
      {reviewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-zinc-900 border-4 border-zinc-950 dark:border-zinc-800 p-6 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
            <h3 className="text-base font-black uppercase mb-2">
              {reviewModal.type === "need_more_proof" ? "Request More Proof" : "Reject Proof as Fraud"}
            </h3>
            <p className="text-xs font-mono text-zinc-500 mb-4">
              {reviewModal.type === "need_more_proof"
                ? "Specify what clearer evidence is needed from the challenger:"
                : "Specify the exact reason for rejecting this oath:"}
            </p>
            <textarea
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="Enter note..."
              className="w-full p-3 border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm font-mono mb-4 focus:outline-none"
              rows={3}
              autoFocus
            />
            <div className="flex items-center gap-3">
              <button
                onClick={handleConfirmReview}
                disabled={actionLoading}
                className={`flex-1 py-3 text-xs font-black uppercase tracking-wider ${
                  reviewModal.type === "need_more_proof"
                    ? "bg-amber-400 hover:bg-amber-500 text-zinc-950"
                    : "bg-red-600 hover:bg-red-700 text-white"
                }`}
              >
                {actionLoading ? "Submitting..." : "Confirm Verdict"}
              </button>
              <button
                onClick={() => setReviewModal(null)}
                className="px-4 py-3 border-2 border-zinc-950 dark:border-zinc-700 text-xs font-mono font-bold uppercase"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Embedded Chat Modal */}
      {chatOath && (
        <ChatRoom oath={chatOath} onClose={() => { setChatOath(null); refreshOaths(); }} />
      )}

      {/* Embedded Wallet Modal */}
      {showWalletModal && wallet && (
        <WalletModal
          wallet={wallet}
          transactions={transactions}
          onRefresh={refreshWallet}
          onClose={() => { setShowWalletModal(false); refreshWallet(); }}
        />
      )}
    </div>
  );
}

// -------------------------------------------------------------
// Progressive 3-Step Creation Wizard Component
// -------------------------------------------------------------
function SimplifiedCreationWizard({ onSuccess }: { onSuccess: () => void }) {
  const { wallet } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [submitting, setSubmitting] = useState(false);

  // Form State
  const [statement, setStatement] = useState("");
  const [cadence, setCadence] = useState<"single" | "daily">("single");
  const [daysCount, setDaysCount] = useState(7);
  const [mode, setMode] = useState<"solo" | "duo" | "squad" | "lobby">("solo");
  const [nominee, setNominee] = useState("");
  const [opponent, setOpponent] = useState("");
  const [stake, setStake] = useState(25);
  const [consequence, setConsequence] = useState<"fiat" | "public_shame" | "social_ransom" | "anti_charity">("fiat");

  // Fee calculation (10% upfront protocol fee)
  const baseStake = stake;
  const protocolFee = Math.round(baseStake * 0.1 * 100) / 100;
  const totalCharged = baseStake + protocolFee;

  const handleCreate = async () => {
    if (!statement.trim()) {
      showToast("Please enter an oath statement", "error");
      return;
    }

    setSubmitting(true);
    const deadline = new Date(Date.now() + daysCount * 24 * 3600 * 1000).toISOString();

    const payload = {
      oath_statement: statement.trim(),
      deadline,
      oath_type: mode,
      verification_method: mode === "solo" ? "nominee" : mode === "duo" ? "peer" : "quorum",
      consequence_type: consequence,
      stake_amount: stake,
      nominee_email: mode === "solo" ? nominee.trim() : undefined,
      opponent_id: undefined,
      total_days: cadence === "daily" ? daysCount : 1,
      current_day: 1
    };

    const { error } = await createOath(payload as any);
    setSubmitting(false);

    if (error) {
      showToast(error, "error");
    } else {
      showToast("Oath sealed! Stake placed in escrow.", "success");
      onSuccess();
    }
  };

  return (
    <div className="max-w-2xl mx-auto bg-white dark:bg-zinc-900 border-2 sm:border-4 border-zinc-950 dark:border-zinc-800 p-6 sm:p-8 shadow-[8px_8px_0px_0px_rgba(9,9,11,1)] dark:shadow-none space-y-6">
      {/* Wizard Progress Bar */}
      <div className="flex items-center justify-between border-b-2 border-zinc-950 dark:border-zinc-800 pb-3">
        <span className="text-xs font-mono font-black uppercase text-amber-500">
          STEP {step} OF 3: {step === 1 ? "THE SWEAR" : step === 2 ? "THE ENFORCER" : "THE STAKES"}
        </span>
        <div className="flex items-center gap-1.5">
          <span className={`w-2.5 h-2.5 rounded-full ${step >= 1 ? "bg-zinc-950 dark:bg-zinc-100" : "bg-zinc-300 dark:bg-zinc-800"}`} />
          <span className={`w-2.5 h-2.5 rounded-full ${step >= 2 ? "bg-zinc-950 dark:bg-zinc-100" : "bg-zinc-300 dark:bg-zinc-800"}`} />
          <span className={`w-2.5 h-2.5 rounded-full ${step >= 3 ? "bg-zinc-950 dark:bg-zinc-100" : "bg-zinc-300 dark:bg-zinc-800"}`} />
        </div>
      </div>

      {/* STEP 1: The Swear */}
      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="text-xs font-mono font-black uppercase block mb-1.5">
              What do you swear to accomplish?
            </label>
            <textarea
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              placeholder="e.g. Run 5km every single morning before 8 AM..."
              className="w-full p-4 border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-base font-bold resize-none focus:outline-none"
              rows={3}
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-mono font-black uppercase block mb-1.5">
              Accountability Cadence
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setCadence("single")}
                className={`p-3 border-2 text-left font-mono text-xs transition-colors ${
                  cadence === "single"
                    ? "border-zinc-950 dark:border-zinc-100 bg-zinc-100 dark:bg-zinc-800 font-black"
                    : "border-zinc-300 dark:border-zinc-800 text-zinc-500"
                }`}
              >
                <span className="flex items-center gap-1.5 font-black">
                  <Zap className="w-3.5 h-3.5 text-zinc-950 dark:text-zinc-100" /> Single Deadline
                </span>
                <span className="block text-[10px] text-zinc-500 font-normal mt-0.5">
                  Complete the target by one final cutoff.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setCadence("daily")}
                className={`p-3 border-2 text-left font-mono text-xs transition-colors ${
                  cadence === "daily"
                    ? "border-zinc-950 dark:border-zinc-100 bg-zinc-100 dark:bg-zinc-800 font-black"
                    : "border-zinc-300 dark:border-zinc-800 text-zinc-500"
                }`}
              >
                <span className="flex items-center gap-1.5 font-black">
                  <Repeat className="w-3.5 h-3.5 text-zinc-950 dark:text-zinc-100" /> Daily Streak Punch-Card
                </span>
                <span className="block text-[10px] text-zinc-500 font-normal mt-0.5">
                  Submit proof every 24h to protect streak.
                </span>
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-mono font-black uppercase block mb-1.5">
              Duration
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[3, 7, 14, 30].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDaysCount(d)}
                  className={`py-2 border-2 font-mono text-xs font-bold ${
                    daysCount === d
                      ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 border-zinc-950 dark:border-zinc-100"
                      : "border-zinc-300 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  {d} Days
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={!statement.trim()}
            onClick={() => setStep(2)}
            className="w-full py-3.5 bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 font-black uppercase text-xs tracking-wider flex items-center justify-center gap-2 disabled:opacity-50"
          >
            Next: Choose Enforcer <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* STEP 2: The Enforcer */}
      {step === 2 && (
        <div className="space-y-4">
          <label className="text-xs font-mono font-black uppercase block">
            Who verifies your proof?
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode("solo")}
              className={`p-3 border-2 text-left font-mono text-xs ${
                mode === "solo" ? "border-zinc-950 dark:border-zinc-100 bg-zinc-100 dark:bg-zinc-800 font-black" : "border-zinc-300 dark:border-zinc-800"
              }`}
            >
              <span className="flex items-center gap-1.5 font-black">
                <User className="w-3.5 h-3.5" /> Solo + Nominee Referee
              </span>
              <span className="block text-[10px] text-zinc-500 font-normal mt-0.5">
                A nominated friend approves each day in chat.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode("duo")}
              className={`p-3 border-2 text-left font-mono text-xs ${
                mode === "duo" ? "border-zinc-950 dark:border-zinc-100 bg-zinc-100 dark:bg-zinc-800 font-black" : "border-zinc-300 dark:border-zinc-800"
              }`}
            >
              <span className="flex items-center gap-1.5 font-black">
                <Swords className="w-3.5 h-3.5" /> Duo 1-on-1 Duel
              </span>
              <span className="block text-[10px] text-zinc-500 font-normal mt-0.5">
                Head-to-head match. Winner takes the pot.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode("squad")}
              className={`p-3 border-2 text-left font-mono text-xs ${
                mode === "squad" ? "border-zinc-950 dark:border-zinc-100 bg-zinc-100 dark:bg-zinc-800 font-black" : "border-zinc-300 dark:border-zinc-800"
              }`}
            >
              <span className="flex items-center gap-1.5 font-black">
                <Users className="w-3.5 h-3.5" /> Private Squad
              </span>
              <span className="block text-[10px] text-zinc-500 font-normal mt-0.5">
                Weakest Link or Survival group voting.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode("lobby")}
              className={`p-3 border-2 text-left font-mono text-xs ${
                mode === "lobby" ? "border-zinc-950 dark:border-zinc-100 bg-zinc-100 dark:bg-zinc-800 font-black" : "border-zinc-300 dark:border-zinc-800"
              }`}
            >
              <span className="flex items-center gap-1.5 font-black">
                <Globe className="w-3.5 h-3.5" /> Open Public Lobby
              </span>
              <span className="block text-[10px] text-zinc-500 font-normal mt-0.5">
                Anyone on Oath can join and stake buy-in.
              </span>
            </button>
          </div>

          {mode === "solo" && (
            <div>
              <label className="text-xs font-mono font-bold uppercase block mb-1">
                Nominee Username or Email
              </label>
              <input
                type="text"
                value={nominee}
                onChange={(e) => setNominee(e.target.value)}
                placeholder="@friend or referee@gmail.com"
                className="w-full p-3 border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm font-mono"
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="px-4 py-3.5 border-2 border-zinc-950 dark:border-zinc-800 font-mono text-xs font-bold uppercase"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              className="flex-1 py-3.5 bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 font-black uppercase text-xs tracking-wider flex items-center justify-center gap-2"
            >
              Next: Set Stakes <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: The Stakes */}
      {step === 3 && (
        <div className="space-y-5">
          <div>
            <label className="text-xs font-mono font-black uppercase block mb-2">
              Select Stake Amount
            </label>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {[10, 25, 50, 100].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setStake(amt)}
                  className={`py-3 border-2 font-mono text-sm font-black ${
                    stake === amt
                      ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 border-zinc-950 dark:border-zinc-100"
                      : "border-zinc-300 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  }`}
                >
                  ${amt}
                </button>
              ))}
            </div>
          </div>

          {/* Transparent Fee Receipt */}
          <div className="p-4 bg-zinc-100 dark:bg-zinc-950 border-2 border-zinc-300 dark:border-zinc-800 font-mono text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-zinc-500">Base Stake Locked:</span>
              <span className="font-bold">${baseStake.toFixed(2)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">10% Platform Protocol Fee:</span>
              <span className="font-bold text-amber-600 dark:text-amber-400">+${protocolFee.toFixed(2)}</span>
            </div>
            <div className="border-t border-zinc-300 dark:border-zinc-800 pt-1.5 flex justify-between font-black text-sm">
              <span>Total Debited from Wallet:</span>
              <span className="text-emerald-600 dark:text-emerald-400">${totalCharged.toFixed(2)}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="px-4 py-3.5 border-2 border-zinc-950 dark:border-zinc-800 font-mono text-xs font-bold uppercase"
            >
              Back
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleCreate}
              className="flex-1 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-xs tracking-wider flex items-center justify-center gap-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              Seal Oath & Lock ${totalCharged.toFixed(2)}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
