"use client";

import { useState, useEffect } from "react";
import { ChevronRight, User, Users, Upload, Eye, XCircle, Shield, AlertTriangle, X, Copy, ExternalLink, Check, Loader2, MessageSquare, Clock } from "lucide-react";
import type { Oath, ProofStatus } from "@/lib/types";
import { getTimeRemaining, padZero, formatCurrency as utilsFormatCurrency, formatRelativeTime } from "@/lib/utils";
import { useRegion } from "@/lib/region-context";
import { useAuth } from "@/lib/auth-context";
import ProofUploadModal from "./ProofUploadModal";
import ChatRoom from "./ChatRoom";
import { forfeitOath, forfeitSquadMember, cancelPendingOath, peerReviewProof, requestMoreProof, passDailyWork } from "@/lib/data-hooks";
import { showToast } from "./Toast";
import { confirmAction } from "./ConfirmationModal";

export function isNomineeRefereeForOath(oath: Oath, userId?: string, userEmail?: string, username?: string): boolean {
  if (userId && oath.creator_id === userId) return false;
  if (oath.oath_type === "solo") {
    // In a solo oath, any viewing user other than the creator IS the nominee referee!
    if (userId && oath.creator_id !== userId) return true;

    const cleanUserEmail = userEmail?.toLowerCase();
    const cleanUsername = username?.toLowerCase();
    const byNominees = oath.nominees?.some((n) => {
      if (userId && n.nominee_user_id === userId) return true;
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
  }
  return false;
}

interface ActiveOathsViewProps {
  oaths: Oath[];
  onProofSubmitted?: () => void;
  onCreateClick?: () => void;
}

export default function ActiveOathsView({ oaths, onProofSubmitted, onCreateClick }: ActiveOathsViewProps) {
  const { user, profile } = useAuth();
  const [filterType, setFilterType] = useState<"all" | "solo" | "duo" | "squad" | "lobby" | "referee">("all");
  
  const isReferee = (o: Oath) => isNomineeRefereeForOath(o, user?.id, user?.email, profile?.username);

  const filteredOaths = oaths.filter((o) => {
    if (filterType === "all") return true;
    if (filterType === "referee") return isReferee(o);
    if (filterType === "solo") return o.oath_type === "solo" && !isReferee(o);
    return o.oath_type === filterType;
  });

  const [selectedOathId, setSelectedOathId] = useState<string | null>(
    filteredOaths.length > 0 ? filteredOaths[0].id : (oaths.length > 0 ? oaths[0].id : null)
  );
  const [showProofModal, setShowProofModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [showForfeitModal, setShowForfeitModal] = useState(false);
  const [showPeerReviewModal, setShowPeerReviewModal] = useState(false);
  const [refereeAction, setRefereeAction] = useState<{ type: "need_more_proof" | "reject"; oath: Oath } | null>(null);
  // On mobile, track whether we're showing the detail panel or list
  const [mobileShowDetail, setMobileShowDetail] = useState(false);

  // Selected oath lookup
  const selectedOath = oaths.find((o) => o.id === selectedOathId) || filteredOaths[0] || oaths[0] || null;

  useEffect(() => {
    if (!selectedOathId && filteredOaths.length > 0) {
      setSelectedOathId(filteredOaths[0].id);
    } else if (selectedOathId && !oaths.some((o) => o.id === selectedOathId)) {
      setSelectedOathId(filteredOaths.length > 0 ? filteredOaths[0].id : null);
    }
  }, [oaths, filteredOaths, selectedOathId]);

  if (oaths.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-sm">
          <div className="text-6xl sm:text-8xl font-black text-zinc-300 dark:text-zinc-800 tracking-tighter leading-none mb-3">
            NO<br />OATHS
          </div>
          <p className="text-sm font-bold text-zinc-800 dark:text-zinc-400 font-mono tracking-wide">
            You have nothing at stake.
          </p>
          <p className="text-sm text-zinc-500 font-mono mt-1 mb-6">
            That&apos;s the problem.
          </p>
          {onCreateClick && (
            <button
              onClick={onCreateClick}
              className="px-6 py-3.5 bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 text-xs font-black uppercase tracking-wider hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-all shadow-[4px_4px_0px_0px_rgba(9,9,11,1)] dark:shadow-none"
            >
              Swear Your First Oath
            </button>
          )}
        </div>
      </div>
    );
  }

  const actionItems = filteredOaths
    .map((oath) => ({ oath, reason: getActionRequired(oath, user?.id, isReferee(oath)) }))
    .filter((x): x is { oath: Oath; reason: ActionReason } => x.reason !== null);
  const actionIds = new Set(actionItems.map((x) => x.oath.id));
  const inFlightOaths = filteredOaths.filter((o) => !actionIds.has(o.id));

  return (
    <div className="flex-1 flex overflow-hidden" suppressHydrationWarning>
      {/* Sidebar — hidden on mobile when detail is shown */}
      <div className={`${
        mobileShowDetail ? "hidden sm:flex" : "flex"
      } sm:w-72 w-full border-r-2 border-zinc-950 dark:border-zinc-800/60 flex-col overflow-y-auto shrink-0 bg-white dark:bg-transparent`}>
        <div className="border-b-2 border-zinc-950 dark:border-zinc-800/40 bg-zinc-100 dark:bg-zinc-900/50">
          <div className="px-4 py-2.5 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800">
            <span className="text-[10px] font-mono font-bold text-zinc-700 dark:text-zinc-400 uppercase tracking-widest">
              Active Oaths ({filteredOaths.length})
            </span>
          </div>
          <div className="flex items-center gap-1 px-3 py-2 overflow-x-auto scrollbar-none">
            {(["all", "solo", "duo", "squad", "lobby", "referee"] as const)
              .filter((t) => t !== "lobby" || oaths.some((o) => o.oath_type === "lobby"))
              .map((t) => {
              const refereeCount = oaths.filter(isReferee).length;
              return (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-2.5 py-1 text-[9px] sm:text-[10px] font-mono font-bold uppercase shrink-0 border transition-colors flex items-center gap-1.5 ${
                    filterType === t
                      ? t === "referee"
                        ? "bg-amber-500 text-zinc-950 border-amber-500 font-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                        : "bg-zinc-950 text-white border-zinc-950 dark:bg-zinc-100 dark:text-zinc-950"
                      : "border-zinc-300 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-zinc-500"
                  }`}
                >
                  {t === "referee" ? (
                    <>
                      <span>Referee</span>
                      {refereeCount > 0 && (
                        <span className="px-1 py-0.2 text-[8px] bg-amber-400 text-zinc-950 font-black border border-amber-600">
                          {refereeCount}
                        </span>
                      )}
                    </>
                  ) : (
                    t
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="border-b-2 border-red-300 dark:border-red-950/60 bg-red-50/40 dark:bg-red-950/10">
          <div className="px-4 py-2 flex items-center gap-2">
            {actionItems.length > 0 ? (
              <>
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-600" />
                </span>
                <span className="text-[10px] font-mono font-black text-red-600 dark:text-red-500 uppercase tracking-widest">
                  ACTION REQUIRED TODAY ({actionItems.length})
                </span>
              </>
            ) : (
              <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-widest">All caught up</span>
            )}
          </div>
          {actionItems.map(({ oath, reason }) => (
            <ActionRequiredRow
              key={oath.id}
              oath={oath}
              reason={reason}
              isSelected={selectedOath?.id === oath.id}
              onClick={() => {
                setSelectedOathId(oath.id);
                setMobileShowDetail(true);
              }}
            />
          ))}
        </div>
        {inFlightOaths.length > 0 && (
          <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-widest">
            IN FLIGHT ({inFlightOaths.length})
          </div>
        )}
        {inFlightOaths.map((oath) => (
          <OathListItem
            key={oath.id}
            oath={oath}
            isSelected={selectedOath?.id === oath.id}
            isReferee={isReferee(oath)}
            onClick={() => {
              setSelectedOathId(oath.id);
              setMobileShowDetail(true);
            }}
          />
        ))}
        {filteredOaths.length === 0 && (
          <div className="p-6 text-center text-xs font-mono text-zinc-500">
            No active {filterType} oaths
          </div>
        )}
      </div>

      {/* Main Countdown — hidden on mobile when list is shown */}
      {selectedOath && (
        <div className={`${
          mobileShowDetail ? "flex" : "hidden sm:flex"
        } flex-1 flex-col overflow-y-auto sm:overflow-hidden`}>
          {/* Mobile back button */}
          <div className="flex sm:hidden items-center px-4 py-2.5 border-b-2 border-zinc-950 dark:border-zinc-800/60 bg-zinc-100 dark:bg-zinc-900/50 shrink-0 sticky top-0 z-10">
            <button
              onClick={() => setMobileShowDetail(false)}
              className="flex items-center gap-2 px-3 py-1.5 text-xs font-mono font-black uppercase tracking-wider text-zinc-900 dark:text-zinc-100 bg-white dark:bg-zinc-800 border-2 border-zinc-950 dark:border-zinc-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
            >
              <ChevronRight className="w-3.5 h-3.5 rotate-180" />
              Back to Oaths
            </button>
          </div>

          <OathCountdownCard
            oath={selectedOath}
            isReferee={isReferee(selectedOath)}
            onSubmitProof={() => setShowProofModal(true)}
            onViewDetails={() => setShowDetailsModal(true)}
            onOpenChat={() => setShowChatModal(true)}
            onForfeit={() => setShowForfeitModal(true)}
            onPeerReview={() => setShowPeerReviewModal(true)}
            onPassTodayWork={async (oathToPass) => {
              const confirmed = await confirmAction({
                title: "Pass Today's Work?",
                message: `Verify and pass today's work for @${oathToPass.creator?.username || "Challenger"}? This will advance their streak to the next day.`,
                confirmLabel: "Yes, Pass Today's Work",
                cancelLabel: "Cancel",
                variant: "default",
              });
              if (!confirmed) return;
              const { error } = await passDailyWork(oathToPass.id, "Approved by Referee");
              if (error) {
                showToast(error, "error");
              } else {
                showToast("Today's work passed! Streak updated.", "success");
                onProofSubmitted?.();
              }
            }}
            onRequestMoreProof={(oathToReview) => {
              setRefereeAction({ type: "need_more_proof", oath: oathToReview });
            }}
            onRejectProof={(oathToReview) => {
              setRefereeAction({ type: "reject", oath: oathToReview });
            }}
          />

          {showProofModal && (
            <ProofUploadModal
              oath={selectedOath}
              onClose={() => setShowProofModal(false)}
              onSuccess={() => { setShowProofModal(false); onProofSubmitted?.(); }}
            />
          )}

          {showDetailsModal && (
            <OathDetailsModal
              oath={selectedOath}
              onClose={() => setShowDetailsModal(false)}
            />
          )}

          {showChatModal && (
            <ChatRoom
              oath={selectedOath}
              onClose={() => {
                setShowChatModal(false);
                onProofSubmitted?.();
              }}
              onProofUpdated={() => {
                onProofSubmitted?.();
              }}
            />
          )}

          {showForfeitModal && (
            <ForfeitModal
              oath={selectedOath}
              onClose={() => setShowForfeitModal(false)}
              onForfeited={() => {
                setShowForfeitModal(false);
                setMobileShowDetail(false);
                onProofSubmitted?.();
              }}
            />
          )}

          {showPeerReviewModal && (
            <PeerReviewModal
              oath={selectedOath}
              onClose={() => setShowPeerReviewModal(false)}
              onReviewed={() => {
                setShowPeerReviewModal(false);
                onProofSubmitted?.();
              }}
            />
          )}

          {refereeAction && (
            <RefereeReviewModal
              oath={refereeAction.oath}
              type={refereeAction.type}
              onClose={() => setRefereeAction(null)}
              onSuccess={() => {
                setRefereeAction(null);
                onProofSubmitted?.();
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

type ActionReason = { reason: string; timeLabel: string; urgent: boolean };

function formatCompactTime(t: ReturnType<typeof getTimeRemaining>): string {
  if (t.isExpired) return "EXP";
  if (t.days > 0) return `${t.days}d`;
  if (t.hours > 0) return `${t.hours}h ${t.minutes}m`;
  return `${t.minutes}m`;
}

function getActionRequired(oath: Oath, userId: string | undefined, refereeDuty: boolean): ActionReason | null {
  if (!userId) return null;
  const dueAt = oath.daily_deadline || oath.deadline;
  const time = getTimeRemaining(dueAt);
  const timeLabel = formatCompactTime(time);
  const proofs = oath.proofs ?? [];
  const isChallenger = oath.creator_id === userId;
  const isDuoOpponent = oath.oath_type === "duo" && oath.opponent_id === userId;
  const isSquadMember = oath.oath_type === "squad" && Boolean(oath.members?.some((m) => m.user_id === userId));

  // Reviewer duties first: someone else's proof is waiting on me
  if (refereeDuty || isDuoOpponent || isSquadMember) {
    const toReview = proofs.filter((p) => p.status === "pending_review" && p.submitted_by !== userId);
    if (toReview.length > 0) {
      const who = toReview[0].submitter?.username || oath.creator?.username;
      return {
        reason: `Review ${who ? `@${who}'s ` : ""}proof${toReview.length > 1 ? ` (${toReview.length})` : ""}`,
        timeLabel,
        urgent: true,
      };
    }
  }

  // Challenger duties
  if (!refereeDuty && (isChallenger || isDuoOpponent || isSquadMember)) {
    const mine = proofs.filter((p) => p.submitted_by === userId);
    const latestMine = [...mine].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    if (latestMine?.status === "needs_more_proof") {
      return { reason: "More proof requested", timeLabel, urgent: true };
    }
    if (!time.isExpired && time.days === 0) {
      const day = oath.current_day ?? 1;
      const doneToday = mine.some(
        (p) => (p.status === "pending_review" || p.status === "verified") && (p.day_number ?? day) === day
      );
      if (!doneToday) return { reason: "Proof due today", timeLabel, urgent: time.isUrgent };
    }
  }
  return null;
}

function ActionRequiredRow({ oath, reason, isSelected, onClick }: { oath: Oath; reason: ActionReason; isSelected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      suppressHydrationWarning
      className={`w-full text-left px-4 py-2 border-b border-red-200 dark:border-red-950/40 transition-all ${
        isSelected
          ? "bg-red-50 dark:bg-red-950/30 shadow-[inset_4px_0_0_0_rgba(220,38,38,1)]"
          : "hover:bg-red-50/60 dark:hover:bg-red-950/20"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate leading-tight">{oath.oath_statement}</p>
          <p className="text-[10px] font-mono font-bold text-red-600 dark:text-red-500 uppercase truncate mt-0.5">{reason.reason}</p>
        </div>
        <span className="text-[10px] font-mono font-black stake-number text-red-600 dark:text-red-500 shrink-0">{reason.timeLabel}</span>
      </div>
    </button>
  );
}

function OathListItem({ oath, isSelected, isReferee, onClick }: { oath: Oath; isSelected: boolean; isReferee: boolean; onClick: () => void }) {
  const { region } = useRegion();
  const time = getTimeRemaining(oath.deadline);
  const typeIcon = isReferee ? (
    <Shield className="w-3 h-3 text-amber-500" />
  ) : oath.oath_type === "solo" ? (
    <User className="w-3 h-3" />
  ) : (
    <Users className="w-3 h-3" />
  );

  return (
    <button
      onClick={onClick}
      suppressHydrationWarning
      className={`w-full text-left px-4 py-3.5 border-b-2 border-zinc-200 dark:border-zinc-800/30 transition-all ${
        isSelected
          ? isReferee
            ? "bg-amber-50/80 dark:bg-amber-950/30 shadow-[inset_4px_0_0_0_rgba(245,158,11,1)]"
            : "bg-zinc-200 dark:bg-zinc-900/80 shadow-[inset_4px_0_0_0_rgba(220,38,38,1)]"
          : "hover:bg-zinc-100 dark:hover:bg-zinc-900/40"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {isReferee && (
            <span className="inline-block text-[9px] font-mono font-black uppercase tracking-widest px-1.5 py-0.5 bg-amber-400 text-zinc-950 dark:bg-amber-500 dark:text-zinc-950 mb-1 border border-amber-600">
              REFEREE DUTY
            </span>
          )}
          <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100 truncate leading-tight">
            {oath.oath_statement}
          </p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-zinc-500">{typeIcon}</span>
            <span className="text-[10px] font-mono text-zinc-600 dark:text-zinc-400 uppercase font-semibold">
              {isReferee ? `Refereeing @${oath.creator?.username || "Challenger"}` : oath.oath_type}
            </span>
            <span className="text-zinc-400">·</span>
            <span className="text-[10px] font-mono font-black text-zinc-800 dark:text-zinc-300 stake-number">
              {isReferee
                ? `Challenger: ${utilsFormatCurrency(oath.stake_amount, region)}`
                : utilsFormatCurrency(oath.stake_amount, region)}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end shrink-0">
          <span className={`text-[10px] font-mono font-black stake-number ${time.isUrgent ? "text-red-600 dark:text-red-500" : "text-zinc-600 dark:text-zinc-400"}`}>
            {time.isExpired ? "EXP" : time.days > 0 ? `${time.days}d` : time.hours > 0 ? `${time.hours}h` : `${time.minutes}m`}
          </span>
          <ChevronRight className={`w-3 h-3 mt-1 ${isSelected ? (isReferee ? "text-amber-500" : "text-zinc-800 dark:text-zinc-300") : "text-zinc-400 dark:text-zinc-600"}`} />
        </div>
      </div>
    </button>
  );
}

function OathCountdownCard({
  oath,
  isReferee,
  onSubmitProof,
  onViewDetails,
  onOpenChat,
  onForfeit,
  onPeerReview,
  onPassTodayWork,
  onRequestMoreProof,
  onRejectProof,
}: {
  oath: Oath;
  isReferee: boolean;
  onSubmitProof: () => void;
  onViewDetails: () => void;
  onOpenChat: () => void;
  onForfeit: () => void;
  onPeerReview: () => void;
  onPassTodayWork: (oath: Oath) => void;
  onRequestMoreProof: (oath: Oath) => void;
  onRejectProof: (oath: Oath) => void;
}) {
  const { region } = useRegion();
  const { user, profile } = useAuth();
  const [now, setNow] = useState(() => Date.now());
  const [timeState, setTimeState] = useState(() => getTimeRemaining(oath.deadline));

  const totalDays = oath.total_days ?? 1;
  const currentDay = oath.current_day ?? 1;
  const isMultiDay = totalDays > 1;
  const dailyDeadline = oath.daily_deadline || oath.deadline;
  const [todayTime, setTodayTime] = useState(() => getTimeRemaining(dailyDeadline));

  const latestProof = oath.proofs?.find((p) => p.status === "pending_review") || oath.proofs?.[0];
  const hasPendingProof = Boolean(oath.proofs?.some((p) => p.status === "pending_review"));
  const needsMoreProof = Boolean(latestProof?.status === "needs_more_proof");
  const isVerifiedToday = Boolean(latestProof?.status === "verified");

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Date.now());
      setTimeState(getTimeRemaining(oath.deadline));
      setTodayTime(getTimeRemaining(dailyDeadline));
    }, 1000);
    return () => clearInterval(interval);
  }, [oath.deadline, dailyDeadline]);

  const deadlineMs = new Date(oath.deadline).getTime();
  const createdMs = new Date(oath.created_at).getTime();
  const progressTotal = isNaN(deadlineMs) || isNaN(createdMs) ? 1 : Math.max(1, deadlineMs - createdMs);
  const progressElapsed = isNaN(createdMs) ? 0 : Math.max(0, now - createdMs);
  const progressPercent = Math.min(100, Math.max(0, (progressElapsed / progressTotal) * 100));

  // --- REFEREE VIEW ---
  if (isReferee) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center py-8 px-4 sm:px-8 relative overflow-y-auto bg-zinc-50 dark:bg-transparent" suppressHydrationWarning>
        <div className="w-full max-w-xl bg-white dark:bg-zinc-900 border-4 border-zinc-950 dark:border-zinc-800 p-6 sm:p-8 shadow-[8px_8px_0px_0px_rgba(245,158,11,1)] dark:shadow-none text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-400 text-zinc-950 font-mono font-black text-xs uppercase tracking-widest border-2 border-zinc-950 mb-6 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]">
            <Shield className="w-4 h-4 text-zinc-950" />
            REFEREE DUTY: @{oath.creator?.username || "Challenger"}&apos;s Oath
          </div>

          {/* Statement */}
          <h1 className="text-2xl sm:text-3xl font-black text-zinc-950 dark:text-zinc-50 tracking-tight leading-tight mb-6">
            &ldquo;{oath.oath_statement}&rdquo;
          </h1>

          {/* Cadence progression if multi-day */}
          {isMultiDay && (
            <div className="mb-6 flex flex-col items-center">
              <div className="flex items-center gap-1.5 mb-2">
                {Array.from({ length: Math.min(totalDays, 14) }).map((_, idx) => {
                  const dayNum = idx + 1;
                  const isDone = dayNum < currentDay;
                  const isCurrent = dayNum === currentDay;
                  return (
                    <div
                      key={idx}
                      className={`w-7 h-7 flex items-center justify-center border font-mono text-[9px] font-bold ${
                        isDone
                          ? "bg-emerald-500 text-white border-emerald-600"
                          : isCurrent
                          ? "bg-amber-500 text-zinc-950 border-amber-600 ring-2 ring-amber-400"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-400 border-zinc-300 dark:border-zinc-700"
                      }`}
                    >
                      D{dayNum}
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] font-mono font-bold text-zinc-600 dark:text-zinc-400">
                Day {currentDay} of {totalDays} · Streak: {oath.current_streak ?? 0} days
              </p>
            </div>
          )}

          {/* Duty & Stake Box */}
          <div className="p-4 bg-amber-50 dark:bg-amber-950/20 border-2 border-amber-500/80 mb-6 text-center">
            <p className="text-xs sm:text-sm font-mono text-zinc-800 dark:text-zinc-200 leading-relaxed">
              Challenger has staked{" "}
              <span className="font-black text-zinc-950 dark:text-zinc-100 stake-number">
                {utilsFormatCurrency(oath.stake_amount, region)}
              </span>
              . As referee, your job is to review their daily proofs in chat.
            </p>
            <p className="text-[10px] font-mono text-amber-700 dark:text-amber-400 font-bold mt-1.5">
              You have $0 at risk · Challenger is held accountable by you
            </p>
          </div>

          {/* Primary Action Button: Open Chat & Review Proofs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              onClick={onOpenChat}
              className="w-full sm:w-auto px-6 py-3.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 border-2 border-zinc-950 dark:border-zinc-700 text-sm font-black uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
            >
              <MessageSquare className="w-4 h-4 text-zinc-950" />
              Open Chat &amp; Review Proofs
            </button>
            <button
              onClick={onViewDetails}
              className="w-full sm:w-auto px-5 py-3.5 border-2 border-zinc-950 dark:border-zinc-700 text-zinc-900 dark:text-zinc-300 text-sm font-bold tracking-tight hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none flex items-center justify-center gap-2"
            >
              <Eye className="w-4 h-4" />
              Oath Details
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- CHALLENGER VIEW ---
  return (
    <div className="flex-1 flex flex-col items-center justify-start sm:justify-center py-6 sm:py-8 px-4 sm:px-8 relative overflow-y-auto bg-zinc-50 dark:bg-transparent" suppressHydrationWarning>
      {/* Crimson glow when urgent */}
      {timeState.isUrgent && (
        <div className="absolute inset-0 pointer-events-none crimson-glow" />
      )}

      {/* Status badges */}
      <div className="absolute top-5 right-5 flex items-center gap-2">
        <span className={`text-[9px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 border ${
          oath.status === "active" ? "border-zinc-400 dark:border-zinc-700 text-zinc-700 dark:text-zinc-400" : "border-red-600 text-red-600"
        }`}>
          {oath.status}
        </span>
        <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-zinc-600 dark:text-zinc-500 px-2.5 py-1 border border-zinc-300 dark:border-zinc-800">
          {oath.verification_method.replace(/_/g, " ")}
        </span>
      </div>

      {/* Oath text */}
      <div className="text-center mb-6 max-w-xl">
        <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-500 uppercase tracking-[0.2em] font-bold mb-3">I swore to</p>
        <h1 className="text-2xl sm:text-3xl font-black text-zinc-950 dark:text-zinc-50 tracking-tight leading-tight">
          {oath.oath_statement}
        </h1>
        {oath.opponent && (
          <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-2 font-mono font-bold">vs @{oath.opponent.username}</p>
        )}
      </div>

      {/* Cadence progression */}
      {isMultiDay && (
        <div className="mb-6 flex flex-col items-center">
          <div className="flex items-center gap-1.5 mb-2">
            {Array.from({ length: Math.min(totalDays, 14) }).map((_, idx) => {
              const dayNum = idx + 1;
              const isDone = dayNum < currentDay;
              const isCurrent = dayNum === currentDay;
              return (
                <div
                  key={idx}
                  className={`w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center border font-mono text-[9px] font-bold ${
                    isDone
                      ? "bg-emerald-500 text-white border-emerald-600"
                      : isCurrent
                      ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 border-zinc-950 dark:border-white ring-2 ring-amber-500"
                      : "bg-zinc-100 dark:bg-zinc-900 text-zinc-400 border-zinc-300 dark:border-zinc-800"
                  }`}
                >
                  D{dayNum}
                </div>
              );
            })}
          </div>
          <p className="text-[11px] font-mono font-bold text-zinc-700 dark:text-zinc-300">
            DAY {currentDay} OF {totalDays} · {oath.current_streak ?? 0} DAY STREAK
          </p>
          <p className="text-[10px] font-mono font-bold text-amber-600 dark:text-amber-400 mt-0.5">
            Today&apos;s proof due in {todayTime.hours}h {todayTime.minutes}m
          </p>
        </div>
      )}

      {/* Countdown */}
      <div className="mb-6">
        {timeState.isExpired ? (
          <p className="text-7xl sm:text-8xl font-black text-red-600 timer-display urgent-pulse tracking-tighter">
            EXPIRED
          </p>
        ) : (
          <div className="flex items-baseline gap-1 sm:gap-2">
            {timeState.days > 0 && (
              <>
                <TimeUnit value={timeState.days} label="DAYS" large />
                <Sep urgent={timeState.isUrgent} large />
              </>
            )}
            <TimeUnit value={timeState.hours} label="HRS" large={timeState.days === 0} urgent={timeState.isUrgent && timeState.days === 0} />
            <Sep urgent={timeState.isUrgent} large={timeState.days === 0} />
            <TimeUnit value={timeState.minutes} label="MIN" large={timeState.days === 0} urgent={timeState.isUrgent && timeState.days === 0} />
            <Sep urgent={timeState.isUrgent} large={timeState.days === 0} />
            <TimeUnit value={timeState.seconds} label="SEC" large={timeState.days === 0} urgent={timeState.isUrgent && timeState.days === 0} />
          </div>
        )}
      </div>

      {/* Needs more proof alert for challenger */}
      {needsMoreProof && (
        <div className="w-full max-w-md p-3.5 mb-6 bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-500 text-left fade-in">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-mono font-bold text-xs uppercase mb-1">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            Reviewer Requested More Proof:
          </div>
          <p className="text-xs font-mono text-zinc-900 dark:text-zinc-100 italic mb-2 leading-relaxed">
            &ldquo;{latestProof?.review_note || "Please submit clearer evidence."}&rdquo;
          </p>
          <p className="text-[10px] font-mono text-zinc-600 dark:text-zinc-400">
            Please re-upload clearer evidence before today&apos;s deadline expires.
          </p>
        </div>
      )}

      {/* Stake or Non-financial Consequence */}
      <div className="text-center mb-6">
        {oath.stake_amount > 0 ? (
          <>
            <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-500 uppercase tracking-[0.2em] font-bold mb-1">At stake</p>
            <p className="text-4xl sm:text-5xl font-black text-zinc-950 dark:text-zinc-50 stake-number tracking-tight">
              {utilsFormatCurrency(oath.stake_amount, region)}
            </p>
          </>
        ) : (
          <>
            <p className="text-[10px] font-mono text-zinc-500 dark:text-zinc-500 uppercase tracking-[0.2em] font-bold mb-1">Consequence</p>
            <p className="text-2xl sm:text-3xl font-black text-red-600 dark:text-red-500 tracking-tight uppercase">
              {oath.consequence_type === "social_ransom"
                ? "Social Ransom"
                : oath.consequence_type === "public_shame"
                ? "Wall of Shame"
                : "Social Stigma"}
            </p>
          </>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full max-w-md mb-6">
        <div className="progress-bar h-[3px] w-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className={`h-full ${timeState.isUrgent ? "progress-fill-danger" : "progress-fill bg-zinc-900 dark:bg-zinc-100"}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5">
          <span className="text-[9px] font-mono text-zinc-600 dark:text-zinc-500">
            Started {formatRelativeTime(oath.created_at)}
          </span>
          <span className="text-[9px] font-mono text-zinc-600 dark:text-zinc-500">
            {Math.round(progressPercent)}% elapsed
          </span>
        </div>
      </div>

      {/* Actions */}
      {(() => {
        const isExpired = timeState.isExpired;
        const isActionable = oath.status === "active" && !isExpired;
        const isPendingAcceptance = oath.status === "pending";

        const isDuoOpponentVerifier =
          oath.oath_type === "duo" &&
          (oath.opponent_id === user?.id || (oath.opponent?.username && oath.opponent.username === profile?.username)) &&
          oath.creator_id !== user?.id;

        const chatProofLabel = (() => {
          if (isDuoOpponentVerifier && hasPendingProof) {
            return "Open Chat & Review Opponent Proof";
          }
          if (needsMoreProof) {
            return "Open Chat & Re-upload Proof";
          }
          if (isPendingAcceptance) {
            return oath.oath_type === "duo"
              ? "Open Chat (Waiting for Opponent)"
              : "Open Chat (Waiting for Squad)";
          }
          if (hasPendingProof) {
            return "Open Chat (Proof In Review)";
          }
          if (isVerifiedToday) {
            return "Open Chat (Today's Work Passed ✅)";
          }
          return "Open Chat to Upload Proof";
        })();

        return (
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-2.5 w-full max-w-md px-2">
            {isExpired && oath.status === "active" ? (
              <button
                onClick={onForfeit}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white border-2 border-red-700 text-sm font-black tracking-tight uppercase hover:bg-red-700 transition-colors shadow-[2px_2px_0px_0px_rgba(220,38,38,1)]"
              >
                <XCircle className="w-3.5 h-3.5" />
                Resolve Expired (Forfeit)
              </button>
            ) : (
              <>
                <button
                  onClick={onOpenChat}
                  className={`flex items-center gap-2 px-5 py-2.5 text-sm font-black tracking-tight uppercase transition-all border-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none ${
                    needsMoreProof
                      ? "bg-amber-500 hover:bg-amber-400 text-zinc-950 border-amber-600 font-black animate-pulse"
                      : isDuoOpponentVerifier && hasPendingProof
                      ? "bg-amber-500 hover:bg-amber-400 text-zinc-950 border-amber-600 font-black"
                      : "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 border-zinc-950 dark:border-transparent font-black"
                  }`}
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  {chatProofLabel}
                </button>
                <button
                  onClick={onViewDetails}
                  className="flex items-center gap-2 px-5 py-2.5 border-2 border-zinc-950 dark:border-zinc-700 text-zinc-900 dark:text-zinc-300 text-sm font-bold tracking-tight hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Details
                </button>
                <button
                  onClick={onForfeit}
                  disabled={!isActionable}
                  className={`flex items-center gap-2 px-4 py-2.5 border-2 text-xs font-black uppercase tracking-tight transition-colors shadow-[2px_2px_0px_0px_rgba(220,38,38,1)] dark:shadow-none ${
                    isActionable
                      ? "border-red-600 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                      : "border-zinc-300 dark:border-zinc-800 text-zinc-400 dark:text-zinc-600 cursor-not-allowed shadow-none"
                  }`}
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Forfeit
                </button>
                {isPendingAcceptance && oath.creator_id === user?.id && (
                  <button
                    onClick={async () => {
                      const confirmed = await confirmAction({
                        title: "Cancel Pending Oath?",
                        message: "Cancel this pending invitation and reclaim your locked stake back to your wallet balance?",
                        confirmLabel: "Cancel Oath & Refund Stake",
                        cancelLabel: "Keep Waiting",
                        variant: "danger",
                        dangerWarning: "Your locked escrow will be refunded to your wallet immediately.",
                      });
                      if (!confirmed) return;

                      const { error } = await cancelPendingOath(oath.id);
                      if (error) {
                        showToast(error, "error");
                      } else {
                        showToast("Oath cancelled and escrow refunded to your balance.", "success");
                      }
                    }}
                    className="flex items-center gap-1.5 px-4 py-2.5 bg-red-600 text-white text-xs font-black uppercase tracking-tight hover:bg-red-700 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                )}
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}

function TimeUnit({ value, label, large, urgent }: { value: number; label: string; large?: boolean; urgent?: boolean }) {
  return (
    <div className="flex flex-col items-center">
      <span className={`font-black timer-display ${large ? "text-4xl sm:text-6xl md:text-7xl" : "text-3xl sm:text-5xl md:text-6xl"} ${urgent ? "text-red-600 dark:text-red-500" : "text-zinc-950 dark:text-zinc-50"}`}>
        {padZero(value)}
      </span>
      <span className={`text-[8px] font-mono tracking-[0.3em] mt-1 font-bold ${urgent ? "text-red-600" : "text-zinc-500 dark:text-zinc-500"}`}>
        {label}
      </span>
    </div>
  );
}

function Sep({ urgent, large }: { urgent?: boolean; large?: boolean }) {
  return (
    <span className={`${large ? "text-3xl sm:text-5xl md:text-6xl" : "text-2xl sm:text-4xl md:text-5xl"} font-black mb-3 sm:mb-6 ${urgent ? "text-red-600 urgent-pulse" : "text-zinc-400 dark:text-zinc-700"}`}>
      :
    </span>
  );
}

function OathDetailsModal({ oath, onClose }: { oath: Oath; onClose: () => void }) {
  const { region } = useRegion();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="details-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-lg max-h-[90dvh] overflow-y-auto overscroll-contain bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 p-4 sm:p-6 fade-in shadow-none sm:shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
        <div className="flex items-center justify-between border-b-2 border-zinc-950 dark:border-zinc-800 pb-4 mb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-red-600" />
            <h3 id="details-modal-title" className="text-base font-black text-zinc-950 dark:text-zinc-50 uppercase tracking-tight">Oath Details</h3>
          </div>
          <button onClick={onClose} aria-label="Close details" className="p-2 -mr-1 min-w-[40px] min-h-[40px] flex items-center justify-center hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 text-left">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 font-bold block mb-1">Statement</span>
            <p className="text-lg font-black text-zinc-900 dark:text-zinc-100 leading-snug">&ldquo;{oath.oath_statement}&rdquo;</p>
          </div>

          <div className="grid grid-cols-2 gap-3 border-y-2 border-zinc-200 dark:border-zinc-800 py-3">
            <div>
              <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block">Type</span>
              <span className="text-sm font-mono font-black text-zinc-900 dark:text-zinc-200 uppercase">{oath.oath_type}</span>
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block">Consequence</span>
              <span className="text-sm font-mono font-black text-zinc-900 dark:text-zinc-200 uppercase">{oath.consequence_type.replace(/_/g, " ")}</span>
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block">Stake Locked</span>
              <span className="text-sm font-mono font-black text-zinc-900 dark:text-zinc-200">{utilsFormatCurrency(oath.stake_amount, region)}</span>
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase text-zinc-500 font-bold block">Oath Fee</span>
              <span className="text-sm font-mono font-black text-zinc-900 dark:text-zinc-200">
                {oath.stake_amount > 0 ? `${utilsFormatCurrency(oath.stake_amount * 0.05, region)} (5%)` : "No Fee"}
              </span>
            </div>
          </div>

          {oath.social_ransom_phone && (
            <div className="p-3 bg-red-50 dark:bg-red-950/20 border border-red-300 dark:border-red-900 text-xs font-mono text-red-700 dark:text-red-400">
              <span className="font-bold">Social Ransom Target:</span> {oath.social_ransom_phone}
              {oath.social_ransom_message && <p className="mt-1 italic">&ldquo;{oath.social_ransom_message}&rdquo;</p>}
            </div>
          )}

          {oath.nominee_email && (
            <div className="p-3 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 text-xs font-mono flex items-center justify-between gap-2">
              <div>
                <span className="font-bold text-zinc-700 dark:text-zinc-300">Nominee Referee:</span> {oath.nominee_email}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (typeof window !== "undefined") {
                    const url = `${window.location.origin}/verify?token=${oath.id}`;
                    navigator.clipboard.writeText(url);
                    showToast("Referee verification link copied!", "success");
                  }
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors shrink-0"
              >
                <Copy className="w-3 h-3" /> Copy Link
              </button>
            </div>
          )}

          <div className="text-[11px] font-mono text-zinc-500">
            Deadline: {new Date(oath.deadline).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-6 py-3 bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 text-xs font-black uppercase tracking-wider hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function ForfeitModal({ oath, onClose, onForfeited }: { oath: Oath; onClose: () => void; onForfeited: () => void }) {
  const { region } = useRegion();
  const [excuse, setExcuse] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleForfeit = async () => {
    setLoading(true);
    const { error } = (oath.oath_type === "squad" || oath.oath_type === "lobby")
      ? await forfeitSquadMember(oath.id)
      : await forfeitOath(oath.id, excuse.trim() || undefined);
    setLoading(false);
    if (error) {
      showToast(error, "error");
    } else {
      showToast("Oath forfeited. Stake forfeited to penalty escrow.", "error", 6000);
      onForfeited();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="forfeit-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md bg-white dark:bg-[#0a0a0f] border-4 border-red-600 p-6 fade-in shadow-[12px_12px_0px_0px_rgba(220,38,38,1)] dark:shadow-none text-left">
        <div className="flex items-center gap-2 mb-3 text-red-600">
          <AlertTriangle className="w-6 h-6" />
          <h3 id="forfeit-modal-title" className="text-lg font-black uppercase tracking-tight">Forfeit Oath</h3>
        </div>

        <p className="text-sm font-bold text-zinc-800 dark:text-zinc-300 mb-2">
          Are you conceding defeat?
        </p>
        <p className="text-xs font-mono text-zinc-600 dark:text-zinc-400 mb-4 leading-relaxed">
          Forfeiting immediately terminates this oath. Your locked stake of{" "}
          <strong className="text-red-600 dark:text-red-500 font-bold">{utilsFormatCurrency(oath.stake_amount, region)}</strong> will be permanently forfeited, and your excuse will be posted to the Wall of Shame.
        </p>

        <div className="mb-4">
          <label className="text-[10px] font-mono uppercase font-bold text-zinc-600 dark:text-zinc-400 block mb-1.5">
            What is your excuse?
          </label>
          <textarea
            value={excuse}
            onChange={(e) => setExcuse(e.target.value)}
            placeholder="I gave up because..."
            className="w-full px-3 py-2 text-sm border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950/50 resize-none font-medium"
            rows={2}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleForfeit}
            disabled={loading}
            className="flex-1 py-3 bg-red-600 text-white font-black text-xs uppercase tracking-wider hover:bg-red-700 transition-colors disabled:opacity-50"
          >
            {loading ? "Processing..." : `Forfeit ${utilsFormatCurrency(oath.stake_amount, region)}`}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-3 border-2 border-zinc-950 dark:border-zinc-700 font-mono text-xs font-bold uppercase hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function PeerReviewModal({
  oath,
  onClose,
  onReviewed,
}: {
  oath: Oath;
  onClose: () => void;
  onReviewed: () => void;
}) {
  const { region } = useRegion();
  const [loading, setLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const proof = oath.proofs?.find((p) => p.status === "pending_review") || oath.proofs?.[0];

  const reviewDeadline =
    proof?.review_deadline ||
    (proof?.created_at
      ? new Date(new Date(proof.created_at).getTime() + 24 * 3600 * 1000).toISOString()
      : new Date().toISOString());
  const remainingMs = Math.max(0, new Date(reviewDeadline).getTime() - now);
  const hours = Math.floor(remainingMs / (1000 * 60 * 60));
  const mins = Math.floor((remainingMs % (1000 * 60 * 60)) / (1000 * 60));
  const secs = Math.floor((remainingMs % (1000 * 60)) / 1000);

  const handleApprove = async () => {
    setLoading(true);
    const { error } = await peerReviewProof(oath.id, true, "Approved by Duel Opponent");
    setLoading(false);
    if (error) {
      showToast(error, "error");
    } else {
      showToast("Duel approved! Escrow pot released to winner.", "success");
      onReviewed();
      onClose();
    }
  };

  const handleReject = async () => {
    if (!showRejectInput) {
      setShowRejectInput(true);
      return;
    }
    if (!rejectReason.trim()) {
      showToast("Please provide a reason to reject this proof for fraud.", "error");
      return;
    }
    setLoading(true);
    const { error } = await peerReviewProof(oath.id, false, rejectReason.trim());
    setLoading(false);
    if (error) {
      showToast(error, "error");
    } else {
      showToast("Proof rejected as fraudulent. Dispute penalties applied.", "error");
      onReviewed();
      onClose();
    }
  };

  const isImage =
    proof?.proof_type === "photo" ||
    proof?.proof_type === "screenshot" ||
    Boolean(proof?.proof_url && /\.(jpg|jpeg|png|webp|gif)/i.test(proof.proof_url));

  const isVideo =
    proof?.proof_type === "video" ||
    Boolean(proof?.proof_url && /\.(mp4|webm|mov)/i.test(proof.proof_url));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="peer-review-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto"
    >
      <div className="w-full max-w-lg bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 p-6 fade-in shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] dark:shadow-none text-left my-8">
        <div className="flex items-center justify-between border-b-2 border-zinc-950 dark:border-zinc-800 pb-4 mb-4">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-amber-500" />
            <h3 id="peer-review-modal-title" className="text-base font-black text-zinc-950 dark:text-zinc-50 uppercase tracking-tight">
              Review Opponent Proof
            </h3>
          </div>
          <button onClick={onClose} aria-label="Close modal" className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Oath statement banner */}
          <div className="p-3 bg-zinc-100 dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-800 text-xs font-mono">
            <span className="text-[10px] uppercase font-bold text-zinc-500 block mb-0.5">Duo Duel</span>
            <p className="font-bold text-zinc-900 dark:text-zinc-100 text-sm">&ldquo;{oath.oath_statement}&rdquo;</p>
            <p className="text-[11px] text-zinc-600 dark:text-zinc-400 mt-1">
              Duel Pot: <strong className="text-zinc-950 dark:text-zinc-100">{utilsFormatCurrency(oath.stake_amount * 2, region)}</strong> · Submitted by @{proof?.submitter?.username || oath.creator?.username || "opponent"}
            </p>
          </div>

          {/* 24-hour review timer */}
          <div className="p-2.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-800/60 flex items-center justify-between text-xs font-mono">
            <span className="text-amber-800 dark:text-amber-300 font-bold">
              ⏳ 24h Review Window: {hours}h {mins}m {secs}s remaining
            </span>
            <span className="text-[10px] text-amber-700 dark:text-amber-400 uppercase tracking-wider font-semibold">
              Review or forfeit on expiry
            </span>
          </div>

          {/* Submitted proof content */}
          <div className="space-y-2">
            <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 font-bold block">
              Submitted Evidence ({proof?.proof_type || "Proof"})
            </span>

            {isImage && proof?.proof_url && (
              <div className="border-2 border-zinc-950 dark:border-zinc-800 overflow-hidden bg-black flex items-center justify-center max-h-72">
                <img
                  src={proof.proof_url}
                  alt="Opponent proof"
                  className="max-h-72 w-full object-contain"
                />
              </div>
            )}

            {isVideo && proof?.proof_url && (
              <div className="border-2 border-zinc-950 dark:border-zinc-800 overflow-hidden bg-black max-h-72">
                <video
                  src={proof.proof_url}
                  controls
                  className="max-h-72 w-full object-contain"
                />
              </div>
            )}

            {proof?.proof_text && (
              <div className="p-3 bg-zinc-100 dark:bg-zinc-900 border-l-4 border-amber-500 text-xs font-mono text-zinc-800 dark:text-zinc-200">
                <p className="font-bold text-[10px] uppercase text-zinc-500 mb-1">Statement / Notes:</p>
                <p className="italic leading-relaxed">&ldquo;{proof.proof_text}&rdquo;</p>
              </div>
            )}

            {proof?.proof_url && (
              <div className="pt-1">
                <a
                  href={proof.proof_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-sky-500 dark:text-sky-400 hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> View Submitted Evidence Link &rarr;
                </a>
              </div>
            )}

            {!proof && (
              <p className="text-xs font-mono text-zinc-500 italic p-3 border border-dashed border-zinc-400">
                No proof records found for review.
              </p>
            )}
          </div>

          {/* Reject Reason Input */}
          {showRejectInput && (
            <div className="p-3 border-2 border-red-600 bg-red-50 dark:bg-red-950/20 text-xs font-mono fade-in">
              <label className="text-[10px] font-bold text-red-600 uppercase block mb-1">
                Reason for Rejection / Fraud (Required):
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Specify why this proof is fraudulent, staged, or invalid..."
                className="w-full p-2 border border-red-400 dark:border-red-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 resize-none font-medium"
                rows={3}
                autoFocus
              />
            </div>
          )}

          {/* Buttons: Approve Duel / Reject Fraud */}
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <button
              onClick={handleApprove}
              disabled={loading}
              className="w-full sm:flex-1 py-3 bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 font-black text-xs uppercase tracking-wider hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors flex items-center justify-center gap-1.5 border-2 border-transparent disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Approve Duel
            </button>
            <button
              onClick={handleReject}
              disabled={loading}
              className="w-full sm:flex-1 py-3 bg-red-600 text-white font-black text-xs uppercase tracking-wider hover:bg-red-700 transition-colors flex items-center justify-center gap-1.5 border-2 border-transparent disabled:opacity-50"
            >
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
              {showRejectInput ? "Confirm Reject (Fraud)" : "Reject (Fraud)"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RefereeReviewModal({
  oath,
  type,
  onClose,
  onSuccess,
}: {
  oath: Oath;
  type: "need_more_proof" | "reject";
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSubmit = async () => {
    if (!note.trim()) {
      showToast(
        type === "need_more_proof"
          ? "Please describe what additional proof you need."
          : "Please specify a reason for rejecting this proof.",
        "error"
      );
      return;
    }
    setLoading(true);
    if (type === "need_more_proof") {
      const { error } = await requestMoreProof(oath.id, note.trim());
      setLoading(false);
      if (error) {
        showToast(error, "error");
      } else {
        showToast("Requested clearer proof from challenger.", "info");
        onSuccess();
        onClose();
      }
    } else {
      const { error } = await peerReviewProof(oath.id, false, note.trim());
      setLoading(false);
      if (error) {
        showToast(error, "error");
      } else {
        showToast("Proof rejected as fraudulent.", "error");
        onSuccess();
        onClose();
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 p-6 fade-in shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] dark:shadow-none text-left">
        <div className="flex items-center justify-between border-b-2 border-zinc-950 dark:border-zinc-800 pb-3 mb-4">
          <div className="flex items-center gap-2">
            {type === "need_more_proof" ? (
              <AlertTriangle className="w-5 h-5 text-amber-500" />
            ) : (
              <XCircle className="w-5 h-5 text-red-600" />
            )}
            <h3 className="text-base font-black text-zinc-950 dark:text-zinc-50 uppercase tracking-tight">
              {type === "need_more_proof" ? "Request More Proof" : "Reject Proof (Fraud)"}
            </h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-xs font-mono text-zinc-600 dark:text-zinc-400 mb-3">
          {type === "need_more_proof"
            ? "Specify what evidence the challenger needs to provide before you can pass today's work (e.g. angle, date stamp, gym timer, screen recording)."
            : "Explain why this proof is fraudulent, staged, or violates the sworn oath statement."}
        </p>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            type === "need_more_proof"
              ? "e.g. Please take a photo showing today's timestamp and wider room context..."
              : "e.g. This photo is copied from online / reused from last week..."
          }
          className="w-full p-3 border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm font-medium resize-none mb-4 focus:outline-none"
          rows={3}
          autoFocus
        />

        <div className="flex items-center gap-3">
          <button
            onClick={handleSubmit}
            disabled={loading}
            className={`flex-1 py-3 text-xs font-black uppercase tracking-wider transition-colors flex items-center justify-center gap-2 border-2 ${
              type === "need_more_proof"
                ? "bg-amber-500 hover:bg-amber-400 text-zinc-950 border-amber-600"
                : "bg-red-600 hover:bg-red-700 text-white border-red-700"
            } disabled:opacity-50`}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {type === "need_more_proof" ? "Send Request to Challenger" : "Confirm Rejection"}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-3 border-2 border-zinc-950 dark:border-zinc-700 text-xs font-mono font-bold uppercase hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
