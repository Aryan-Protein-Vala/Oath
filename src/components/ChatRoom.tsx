"use client";

import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import {
  X,
  Send,
  Camera,
  Info,
  ShieldAlert,
  Loader2,
  Check,
  AlertTriangle,
  Clock,
  ExternalLink,
  Lock,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Message, Oath, Proof } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@/lib/utils";
import { showToast } from "./Toast";
import { confirmAction } from "./ConfirmationModal";
import { isNomineeRefereeForOath } from "./ActiveOathsView";
import ProofUploadModal from "./ProofUploadModal";
import {
  passDailyWork,
  requestMoreProof,
  peerReviewProof,
  isMockMode,
  getMockMessages,
  setMockMessages,
  getMockOaths,
} from "@/lib/data-hooks";

interface ChatRoomProps {
  oath: Oath;
  onClose: () => void;
  onProofUpdated?: () => void;
}

const isImage = (url: string) =>
  Boolean(url && (/\.(jpg|jpeg|png|webp|gif|svg)/i.test(url) || url.startsWith("data:image/")));

const isVideo = (url: string) =>
  Boolean(url && (/\.(mp4|webm|mov|ogg)/i.test(url) || url.startsWith("data:video/")));

const isLink = (url: string) =>
  Boolean(url && /^https?:\/\//i.test(url));

export default function ChatRoom({ oath, onClose, onProofUpdated }: ChatRoomProps) {
  const { user, profile } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [proofs, setProofs] = useState<Proof[]>(oath.proofs || []);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);
  const [showProofUploadModal, setShowProofUploadModal] = useState(false);
  const [reviewAction, setReviewAction] = useState<{
    type: "need_more_proof" | "reject";
    message?: Message;
    proof?: Proof;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [reviewNote, setReviewNote] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  const fetchProofs = useCallback(async () => {
    if (isMockMode()) {
      const oaths = getMockOaths();
      const current = oaths.find((o) => o.id === oath.id);
      if (current?.proofs) {
        setProofs(current.proofs);
      }
      return;
    }

    const { data, error } = await supabase
      .from("proofs")
      .select("*, submitter:profiles!proofs_submitted_by_fkey(id, username, display_name, avatar_url)")
      .eq("oath_id", oath.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setProofs(data as unknown as Proof[]);
    }
  }, [oath.id, supabase]);

  const scrollToBottom = () => {
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 100);
  };

  const fetchMessages = useCallback(async () => {
    if (isMockMode()) {
      const mockMsgs = getMockMessages(oath.id);
      setMessages(mockMsgs);
      setLoading(false);
      scrollToBottom();
      return;
    }

    const { data, error } = await supabase
      .from("messages")
      .select("*, sender:profiles!messages_sender_id_fkey(id, username, display_name, avatar_url)")
      .eq("oath_id", oath.id)
      .order("created_at", { ascending: true });

    if (!error && data) {
      setMessages(data as unknown as Message[]);
      scrollToBottom();
    }
    setLoading(false);
  }, [oath.id, supabase]);

  useEffect(() => {
    if (!user) return;
    fetchMessages();
    fetchProofs();

    if (isMockMode()) {
      const handleDataUpdate = () => {
        fetchProofs();
        fetchMessages();
      };
      window.addEventListener("oath_data_updated", handleDataUpdate);
      return () => window.removeEventListener("oath_data_updated", handleDataUpdate);
    }

    const channel = supabase
      .channel(`chat:oath:${oath.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `oath_id=eq.${oath.id}` },
        async (payload: { new: Message }) => {
          let incoming = payload.new as Message;
          if (!incoming.sender && incoming.sender_id) {
            if (incoming.sender_id === user.id) {
              incoming = {
                ...incoming,
                sender: {
                  id: user.id,
                  username: profile?.username || user.user_metadata?.username || "You",
                  display_name: profile?.display_name || user.user_metadata?.display_name || "You",
                } as any,
              };
            } else {
              const { data: senderProfile } = await supabase
                .from("profiles")
                .select("id, username, display_name, avatar_url")
                .eq("id", incoming.sender_id)
                .maybeSingle();
              if (senderProfile) {
                incoming = { ...incoming, sender: senderProfile as any };
              }
            }
          }
          setMessages((prev) => {
            if (prev.some((m) => m.id === incoming.id)) return prev;
            return [...prev, incoming];
          });
          scrollToBottom();
          if (incoming.type === "proof" || incoming.type === "system") {
            fetchProofs();
          }
        }
      )
      .subscribe();

    const proofChannel = supabase
      .channel(`chat:proofs:${oath.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "proofs", filter: `oath_id=eq.${oath.id}` },
        () => {
          fetchProofs();
          fetchMessages();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      supabase.removeChannel(proofChannel);
    };
  }, [user, oath.id, profile, fetchMessages, fetchProofs, supabase]);

  // Set of proof IDs that have completed review
  const reviewedProofIds = useMemo(() => {
    return new Set(
      proofs.filter((p) => p.status !== "pending_review").map((p) => p.id)
    );
  }, [proofs]);

  // Active pending proof in oath
  const pendingProof = useMemo(() => {
    return (
      proofs.find((p) => p.status === "pending_review") ||
      oath.proofs?.find((p) => p.status === "pending_review")
    );
  }, [proofs, oath.proofs]);

  // Helper: check if a specific message represents a proof that is still pending review
  const isMessagePendingProof = useCallback(
    (m: Message): boolean => {
      if (m.type !== "proof") return false;
      if (m.proof_id) {
        if (reviewedProofIds.has(m.proof_id)) return false;
        const matching = proofs.find((p) => p.id === m.proof_id);
        if (matching) return matching.status === "pending_review";
      }
      if (pendingProof) return true;
      const idx = messages.findIndex((item) => item.id === m.id);
      if (idx !== -1) {
        const subsequent = messages.slice(idx + 1);
        const hasResolution = subsequent.some(
          (s) =>
            s.content.includes("approved today's work") ||
            s.content.includes("requested more proof") ||
            s.content.includes("rejected proof") ||
            s.content.includes("Need More Proof") ||
            s.content.includes("verified! Today's work passed")
        );
        if (hasResolution) return false;
      }
      return true;
    },
    [reviewedProofIds, proofs, pendingProof, messages]
  );

  // Latest pending proof message in chat
  const pendingProofMessage = useMemo(() => {
    return messages.slice().reverse().find(isMessagePendingProof);
  }, [messages, isMessagePendingProof]);

  // Overall pending lockout flag
  const hasPendingProof = Boolean(pendingProof || pendingProofMessage);

  // Submitter username for banner
  const pendingSubmitterName = useMemo(() => {
    if (pendingProofMessage?.sender?.username) {
      return pendingProofMessage.sender_id === user?.id ? "You" : pendingProofMessage.sender.username;
    }
    if (pendingProof?.submitter?.username) {
      return pendingProof.submitted_by === user?.id ? "You" : pendingProof.submitter.username;
    }
    if (pendingProofMessage?.sender_id === user?.id || pendingProof?.submitted_by === user?.id) {
      return "You";
    }
    return "member";
  }, [pendingProofMessage, pendingProof, user?.id]);

  const canReview = useCallback(
    (submitterId?: string): boolean => {
      if (!user) return false;
      if (submitterId && submitterId === user.id) return false; // Can't review own proof

      if (oath.oath_type === "solo") {
        return isNomineeRefereeForOath(oath, user.id, user.email, profile?.username);
      }
      if (oath.oath_type === "duo") {
        if (submitterId) {
          return (submitterId === oath.creator_id && user.id === oath.opponent_id) ||
                 (submitterId === oath.opponent_id && user.id === oath.creator_id);
        }
        return oath.opponent_id === user.id || oath.creator_id === user.id;
      }
      if (oath.oath_type === "squad" || oath.oath_type === "lobby") {
        if (submitterId && submitterId === user.id) return false;
        return Boolean(oath.members?.some((m) => m.user_id === user.id) || oath.creator_id === user.id);
      }
      return false;
    },
    [user, oath, profile]
  );

  const canReviewPendingProof = canReview(
    pendingProofMessage?.sender_id || pendingProof?.submitted_by
  );

  // Check if current user has their own pending proof
  const hasPendingMine = useMemo(() => {
    if (!user) return false;
    return proofs.some((p) => p.submitted_by === user.id && p.status === "pending_review") ||
      messages.some((m) => m.type === "proof" && m.sender_id === user.id && !reviewedProofIds.has(m.proof_id ?? ""));
  }, [user, proofs, messages, reviewedProofIds]);

  // Check if current user's latest proof was rejected
  const latestUserRejectedProof = useMemo(() => {
    if (!user) return null;
    const userProofs = proofs.filter((p) => p.submitted_by === user.id);
    const sorted = [...userProofs].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (sorted[0]?.status === "rejected") {
      return sorted[0];
    }
    return null;
  }, [user, proofs]);

  // Check if current user has already completed today's proof and is on a break until midnight
  const userDailyState = useMemo(() => {
    if (!user || oath.cadence !== "daily") {
      return { isCompletedToday: false, currentStreak: oath.current_streak ?? 0, currentDay: oath.current_day ?? 1 };
    }

    const now = new Date();
    const isSameUtcDay = (dateStr?: string | null) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d.getUTCFullYear() === now.getUTCFullYear() &&
             d.getUTCMonth() === now.getUTCMonth() &&
             d.getUTCDate() === now.getUTCDate();
    };

    if (oath.oath_type === "solo") {
      const verifiedToday = isSameUtcDay(oath.last_verified_at) ||
        proofs.some(p => p.submitted_by === user.id && p.status === "verified" && isSameUtcDay(p.reviewed_at || p.created_at));
      return {
        isCompletedToday: Boolean(verifiedToday),
        currentStreak: oath.current_streak ?? 0,
        currentDay: oath.current_day ?? 1,
      };
    } else {
      const member = oath.members?.find((m) => m.user_id === user.id);
      const memberStreak = member?.day_streak ?? 0;
      const memberDay = member?.current_day ?? 1;
      const verifiedToday = (member?.last_verified_at && isSameUtcDay(member.last_verified_at)) ||
        proofs.some(p => p.submitted_by === user.id && p.status === "verified" && isSameUtcDay(p.reviewed_at || p.created_at));
      return {
        isCompletedToday: Boolean(verifiedToday),
        currentStreak: memberStreak,
        currentDay: memberDay,
      };
    }
  }, [user, oath, proofs]);

  const postSystemChatMessage = async (content: string, proofId?: string) => {
    if (!user) return;
    const reviewerUsername = profile?.username || user?.user_metadata?.username || "reviewer";

    if (isMockMode()) {
      const mockMsg: Message = {
        id: `msg-${Date.now()}`,
        oath_id: oath.id,
        sender_id: user.id,
        content,
        type: "system",
        proof_id: proofId,
        created_at: new Date().toISOString(),
        sender: {
          id: user.id,
          username: reviewerUsername,
          display_name: profile?.display_name || reviewerUsername,
        } as any,
      };
      const cur = getMockMessages(oath.id);
      setMockMessages(oath.id, [...cur, mockMsg]);
      setMessages((prev) => [...prev, mockMsg]);
      return;
    }

    try {
      await supabase.from("messages").insert({
        oath_id: oath.id,
        sender_id: user.id,
        content,
        type: "system",
        proof_id: proofId,
      });
    } catch (e) {
      console.warn("Could not post system chat message:", e);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !user) return;

    const content = inputText.trim();
    setInputText("");

    if (isMockMode()) {
      const mockMsg: Message = {
        id: `msg-${Date.now()}`,
        oath_id: oath.id,
        sender_id: user.id,
        content,
        type: "text",
        created_at: new Date().toISOString(),
        sender: {
          id: user.id,
          username: profile?.username || user.user_metadata?.username || "You",
          display_name: profile?.display_name || user.user_metadata?.display_name || "You",
        } as any,
      };
      const cur = getMockMessages(oath.id);
      setMockMessages(oath.id, [...cur, mockMsg]);
      setMessages((prev) => [...prev, mockMsg]);
      scrollToBottom();
      return;
    }

    const newMessage = {
      oath_id: oath.id,
      sender_id: user.id,
      content,
      type: "text",
    };

    const { error } = await supabase.from("messages").insert(newMessage);
    if (error) {
      console.error("Message send error:", error);
      showToast(error.message, "error");
    }
  };

  const handlePassProof = async (msgOrProof?: Message | Proof) => {
    const reviewerUsername = profile?.username || user?.user_metadata?.username || "reviewer";
    const confirmed = await confirmAction({
      title: "Pass Today's Work?",
      message: "Verify and pass this daily proof? This updates daily cadence, streak, and unlocks chat.",
      confirmLabel: "Pass Work",
      cancelLabel: "Cancel",
      variant: "default",
    });
    if (!confirmed) return;

    const targetProofId = (msgOrProof as Message)?.proof_id || (msgOrProof as Proof)?.id || pendingProof?.id;
    setActionLoading(true);
    const { error } = await passDailyWork(oath.id, "Approved via chat", targetProofId);
    setActionLoading(false);

    if (error) {
      showToast(error, "error");
    } else {
      await postSystemChatMessage(
        `@${reviewerUsername} approved today's work. Streak updated. Chat unlocked.`,
        targetProofId
      );
      showToast("Today's work passed! Streak updated. Chat unlocked.", "success");
      await fetchProofs();
      await fetchMessages();
      onProofUpdated?.();
    }
  };

  const handleConfirmReviewAction = async () => {
    if (!reviewAction) return;
    const reviewerUsername = profile?.username || user?.user_metadata?.username || "reviewer";
    const note = reviewNote.trim();
    if (!note) {
      showToast(
        reviewAction.type === "need_more_proof"
          ? "Please enter what additional proof is needed."
          : "Please specify a reason for rejection.",
        "error"
      );
      return;
    }

    const targetProofId = reviewAction.message?.proof_id || reviewAction.proof?.id || pendingProof?.id;

    setActionLoading(true);
    if (reviewAction.type === "need_more_proof") {
      const { error } = await requestMoreProof(oath.id, note);
      setActionLoading(false);
      if (error) {
        showToast(error, "error");
      } else {
        await postSystemChatMessage(
          `@${reviewerUsername} requested more proof: "${note}". Chat unlocked.`,
          targetProofId
        );
        showToast("Requested more proof. Chat unlocked.", "info");
        setReviewAction(null);
        setReviewNote("");
        await fetchProofs();
        await fetchMessages();
        onProofUpdated?.();
      }
    } else {
      const { error } = await peerReviewProof(oath.id, false, note, targetProofId);
      setActionLoading(false);
      if (error) {
        showToast(error, "error");
      } else {
        await postSystemChatMessage(
          `@${reviewerUsername} rejected proof: "${note}". Chat unlocked.`,
          targetProofId
        );
        showToast("Proof rejected. Chat unlocked.", "info");
        setReviewAction(null);
        setReviewNote("");
        await fetchProofs();
        await fetchMessages();
        onProofUpdated?.();
      }
    }
  };

  const isLobby = oath.oath_type === "lobby";

  return (
    <>
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 transition-opacity" onClick={onClose} />
      <div className="fixed inset-0 sm:inset-4 md:inset-x-[10%] md:inset-y-[5%] bg-white dark:bg-[#0a0a0f] border-0 sm:border-4 border-zinc-950 dark:border-zinc-800 z-50 shadow-none sm:shadow-[16px_16px_0px_0px_rgba(9,9,11,1)] dark:shadow-none flex flex-col fade-in h-[100dvh] sm:h-auto max-h-[100dvh]">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b-2 sm:border-b-4 border-zinc-950 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900/40 shrink-0 gap-3 sm:gap-4 relative">
          <div className="flex-1 min-w-0 pr-10 sm:pr-2">
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2 py-0.5 text-[10px] font-mono font-black uppercase tracking-widest shrink-0 ${isLobby ? "bg-indigo-500 text-white" : "bg-zinc-950 text-white"}`}>
                {oath.oath_type}
              </span>
              <h2 className="text-base sm:text-xl font-black text-zinc-950 dark:text-zinc-100 tracking-tight uppercase line-clamp-1">
                {oath.oath_statement}
              </h2>
            </div>
            <p className="text-[11px] sm:text-xs font-mono font-bold text-zinc-600 dark:text-zinc-400">
              {isLobby ? "GLOBAL LOBBY" : `DEADLINE: ${new Date(oath.deadline).toLocaleDateString()}`}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close chat" className="p-2 border-2 border-zinc-950 dark:border-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-950 dark:text-zinc-300 transition-colors shrink-0 absolute top-3 right-4 sm:static">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Warning Banner */}
        <div className="bg-yellow-400 dark:bg-yellow-500/20 px-4 sm:px-5 py-2 flex items-center justify-center gap-2 border-b-2 border-zinc-950 dark:border-zinc-800 shrink-0">
          <ShieldAlert className="w-4 h-4 text-yellow-950 dark:text-yellow-500 shrink-0" />
          <span className="text-[10px] font-mono font-black text-yellow-950 dark:text-yellow-500 uppercase tracking-widest text-center">Motivational chats only. No personal talks.</span>
        </div>

        {/* Chat Area */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-4 bg-zinc-50 dark:bg-transparent">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 animate-spin text-zinc-300" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400">
              <Info className="w-12 h-12 mb-4 opacity-20" />
              <p className="font-mono font-bold uppercase tracking-wider text-sm">No messages yet</p>
              <p className="text-xs mt-2 max-w-sm text-center">Post your daily proofs here and review submissions with your peers.</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isMine = msg.sender_id === user?.id;

              // System announcement message
              if (msg.type === "system") {
                return (
                  <div key={msg.id} className="flex justify-center my-2 w-full fade-in">
                    <div className="max-w-[90%] sm:max-w-[80%] bg-zinc-100 dark:bg-zinc-900 border-2 border-zinc-950 dark:border-zinc-700 px-4 py-2.5 text-center text-xs font-mono font-bold text-zinc-950 dark:text-zinc-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
                      {msg.content}
                    </div>
                  </div>
                );
              }

              // Proof card message
              if (msg.type === "proof") {
                const linkedProof = proofs.find((p) => p.id === msg.proof_id);
                const isMsgPending = isMessagePendingProof(msg);
                const proofStatus = linkedProof?.status || (isMsgPending ? "pending_review" : "verified");
                const canReviewThisProof = canReview(msg.sender_id) && proofStatus === "pending_review";
                const isImg = isImage(msg.content);
                const isVid = isVideo(msg.content);
                const isLnk = isLink(msg.content);

                return (
                  <div key={msg.id} className={`flex flex-col ${isMine ? "items-end" : "items-start"} w-full`}>
                    <span className="text-[9px] font-mono font-bold text-zinc-500 mb-1 px-1">
                      {isMine ? "YOU" : (msg.sender?.username ? `@${msg.sender.username}` : "MEMBER")} • {formatRelativeTime(msg.created_at)}
                    </span>
                    <div className={`max-w-[85%] sm:max-w-[80%] border-2 border-zinc-950 dark:border-zinc-800 p-3 shadow-[4px_4px_0px_0px_rgba(9,9,11,1)] dark:shadow-none ${
                      isMine ? "bg-zinc-950 text-white dark:bg-zinc-800" : "bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100"
                    }`}>
                      <div className="flex flex-col gap-2.5 w-full">
                        {/* Media or link or text description */}
                        {isImg ? (
                          <img
                            src={msg.content}
                            alt="Proof"
                            className="max-w-full max-h-56 sm:max-h-72 object-contain rounded border-2 border-zinc-950 dark:border-zinc-800 bg-black/40"
                          />
                        ) : isVid ? (
                          <video
                            src={msg.content}
                            controls
                            className="max-w-full max-h-56 sm:max-h-72 rounded border-2 border-zinc-950 dark:border-zinc-800 bg-black/40"
                          />
                        ) : isLnk ? (
                          <a
                            href={msg.content}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 p-2.5 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 rounded font-mono text-xs font-bold transition-colors break-all"
                          >
                            <ExternalLink className="w-4 h-4 shrink-0" />
                            <span>{msg.content}</span>
                          </a>
                        ) : (
                          <div className="p-3 bg-zinc-100 dark:bg-zinc-950/70 border border-zinc-300 dark:border-zinc-700 rounded text-xs font-mono text-zinc-900 dark:text-zinc-200">
                            <p className="font-bold text-[10px] uppercase text-zinc-500 mb-1">Proof Report / Statement:</p>
                            <p className="italic leading-relaxed whitespace-pre-wrap">&ldquo;{msg.content}&rdquo;</p>
                          </div>
                        )}

                        {/* Optional context note from proof record */}
                        {linkedProof?.proof_text && linkedProof.proof_text !== msg.content && (
                          <p className="text-xs font-mono italic text-zinc-400 dark:text-zinc-300 px-1 border-l-2 border-amber-500 pl-2">
                            &ldquo;{linkedProof.proof_text}&rdquo;
                          </p>
                        )}

                        {/* Header badge & proof indicator */}
                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-zinc-200 dark:border-zinc-800 text-[11px] font-mono font-bold">
                          <div className="flex items-center gap-1.5 text-amber-500">
                            <Camera className="w-4 h-4 shrink-0" />
                            <span className="uppercase text-[10px] tracking-wider">Proof Submitted</span>
                          </div>
                          <div>
                            {proofStatus === "verified" ? (
                              <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/40 text-[10px] font-mono font-bold uppercase inline-flex items-center gap-1">
                                <Check className="w-3 h-3" /> Verified
                              </span>
                            ) : proofStatus === "needs_more_proof" ? (
                              <span className="px-2 py-0.5 bg-zinc-200 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-200 border border-zinc-400 dark:border-zinc-700 text-[10px] font-mono font-bold uppercase inline-flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" /> More Proof Requested
                              </span>
                            ) : proofStatus === "rejected" ? (
                              <span className="px-2 py-0.5 bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/40 text-[10px] font-mono font-bold uppercase inline-flex items-center gap-1">
                                <X className="w-3 h-3" /> Rejected
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700 text-[10px] font-mono font-bold uppercase flex items-center gap-1">
                                <Clock className="w-3 h-3" /> Awaiting Review
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Inline reviewer buttons on the proof card */}
                        {canReviewThisProof && (
                          <div className="w-full flex flex-wrap items-center justify-center gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                            <button
                              type="button"
                              onClick={() => handlePassProof(msg)}
                              disabled={actionLoading}
                              className="px-2.5 py-1.5 bg-zinc-950 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200 font-mono text-[10px] font-black uppercase tracking-wider flex items-center gap-1 transition-colors border border-zinc-950 dark:border-zinc-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                            >
                              <Check className="w-3.5 h-3.5" /> Pass Today&apos;s Work
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setReviewAction({ type: "need_more_proof", message: msg, proof: linkedProof });
                                setReviewNote("");
                              }}
                              disabled={actionLoading}
                              className="px-2.5 py-1.5 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 dark:bg-zinc-800 dark:hover:bg-zinc-700 dark:text-zinc-100 font-mono text-[10px] font-black uppercase tracking-wider flex items-center gap-1 transition-colors border border-zinc-400 dark:border-zinc-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                            >
                              <AlertTriangle className="w-3.5 h-3.5" /> Need More Proof
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setReviewAction({ type: "reject", message: msg, proof: linkedProof });
                                setReviewNote("");
                              }}
                              disabled={actionLoading}
                              className="px-2.5 py-1.5 bg-red-600 hover:bg-red-700 text-white font-mono text-[10px] font-black uppercase tracking-wider flex items-center gap-1 transition-colors border border-red-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                            >
                              <X className="w-3.5 h-3.5" /> Reject
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              // Standard chat text message
              return (
                <div key={msg.id} className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
                  <span className="text-[9px] font-mono font-bold text-zinc-500 mb-1 px-1">
                    {isMine ? "YOU" : (msg.sender?.username ? `@${msg.sender.username}` : "MEMBER")} • {formatRelativeTime(msg.created_at)}
                  </span>
                  <div className={`max-w-[85%] sm:max-w-[80%] border-2 border-zinc-950 dark:border-zinc-800 p-3 shadow-[4px_4px_0px_0px_rgba(9,9,11,1)] dark:shadow-none ${
                    isMine ? "bg-zinc-950 text-white dark:bg-zinc-800" : "bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100"
                  }`}>
                    <p className="text-sm font-medium whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pinned Proof Review Banner */}
        {hasPendingProof && (
          <div className="bg-zinc-950 text-white dark:bg-[#0c0c0e] dark:text-zinc-100 px-4 py-3 border-t-2 sm:border-t-4 border-red-600 shadow-[0_-2px_10px_rgba(0,0,0,0.2)] shrink-0">
            <div className="flex items-start gap-2.5">
              <Lock className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono font-black uppercase tracking-wide leading-snug">
                  {canReviewPendingProof
                    ? `REVIEW REQUIRED — Proof submitted by @${pendingSubmitterName}. Please submit your verdict ([Pass Today's Work], [Need More Proof], or [Reject]).`
                    : `PROOF IN REVIEW — Day proof submitted by @${pendingSubmitterName}. Awaiting reviewer verdict. You can use the chat below to provide additional context.`}
                </p>

                {/* Reviewer Action Buttons right on the banner */}
                {canReviewPendingProof && (
                  <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-zinc-800">
                    <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-zinc-400 mr-1">
                      Your Verdict:
                    </span>
                    <button
                      type="button"
                      onClick={() => handlePassProof(pendingProofMessage || pendingProof)}
                      disabled={actionLoading}
                      className="px-2.5 py-1 bg-white hover:bg-zinc-200 text-zinc-950 font-mono text-[10px] font-black uppercase tracking-wider flex items-center gap-1 transition-colors border-2 border-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    >
                      <Check className="w-3 h-3 text-emerald-600" /> Pass Today&apos;s Work
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReviewAction({
                          type: "need_more_proof",
                          message: pendingProofMessage,
                          proof: pendingProof,
                        });
                        setReviewNote("");
                      }}
                      disabled={actionLoading}
                      className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 font-mono text-[10px] font-black uppercase tracking-wider flex items-center gap-1 transition-colors border-2 border-zinc-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    >
                      <AlertTriangle className="w-3 h-3 text-zinc-400" /> Need More Proof
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReviewAction({
                          type: "reject",
                          message: pendingProofMessage,
                          proof: pendingProof,
                        });
                        setReviewNote("");
                      }}
                      disabled={actionLoading}
                      className="px-2.5 py-1 bg-red-600 hover:bg-red-700 text-white font-mono text-[10px] font-black uppercase tracking-wider flex items-center gap-1 transition-colors border-2 border-red-700 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                    >
                      <X className="w-3 h-3" /> Reject
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Daily Break Notice */}
        {userDailyState.isCompletedToday && !hasPendingProof && (
          <div className="bg-zinc-100 dark:bg-zinc-900 border-t-2 border-zinc-950 dark:border-zinc-800 px-4 py-2 flex flex-wrap items-center justify-between gap-1 text-[11px] font-mono shrink-0">
            <div className="flex items-center gap-2 font-bold text-emerald-600 dark:text-emerald-400">
              <Check className="w-3.5 h-3.5" />
              <span>TODAY&apos;S WORK VERIFIED (Streak: {userDailyState.currentStreak})</span>
            </div>
            <span className="text-zinc-600 dark:text-zinc-400">
              Break active · Day {userDailyState.currentDay} opens at 12:00 AM midnight
            </span>
          </div>
        )}

        {/* Submitter Rejection Alert */}
        {latestUserRejectedProof && !hasPendingMine && !userDailyState.isCompletedToday && (
          <div className="bg-red-500/10 border-t-2 border-red-600 px-4 py-2.5 flex items-center justify-between gap-2 text-xs font-mono shrink-0">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>PROOF REJECTED: &ldquo;{latestUserRejectedProof.review_note || "Evidence rejected by reviewer"}&rdquo;. Please upload revised proof before deadline.</span>
            </div>
          </div>
        )}

        {/* Input Area */}
        <div className="p-3 sm:p-4 bg-white dark:bg-[#0a0a0f] border-t-2 sm:border-t-4 border-zinc-950 dark:border-zinc-800 shrink-0 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <form onSubmit={handleSend} className="flex gap-2">
            {!(oath.oath_type === "solo" && oath.creator_id !== user?.id) && (
              <button
                type="button"
                onClick={() => setShowProofUploadModal(true)}
                disabled={hasPendingMine || userDailyState.isCompletedToday}
                className="px-3 sm:px-4 py-3 border-2 border-zinc-950 dark:border-transparent bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 font-mono font-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 flex items-center gap-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                title={
                  hasPendingMine
                    ? "Your proof is already uploaded and pending review"
                    : userDailyState.isCompletedToday
                    ? `Today's proof complete (Streak: ${userDailyState.currentStreak}). Day ${userDailyState.currentDay} opens at midnight.`
                    : "Upload Daily Proof"
                }
              >
                <Camera className="w-5 h-5 shrink-0" />
                <span className="hidden sm:inline text-xs font-black uppercase tracking-wider">
                  {userDailyState.isCompletedToday ? `Day ${userDailyState.currentStreak} Done` : "Upload Proof"}
                </span>
              </button>
            )}
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onFocus={() => setTimeout(scrollToBottom, 150)}
              placeholder="Send message or provide context..."
              className="flex-1 px-3 sm:px-4 py-3 border-2 border-zinc-950 dark:border-zinc-800 bg-transparent text-zinc-950 dark:text-zinc-100 font-mono text-base sm:text-sm focus:outline-none focus:bg-zinc-50 dark:focus:bg-zinc-900/50"
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="px-4 sm:px-6 py-3 bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 border-2 border-zinc-950 dark:border-zinc-100 hover:bg-zinc-800 dark:hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-black uppercase tracking-wider text-sm flex items-center gap-2 shrink-0"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </form>
        </div>

        {/* Proof Upload Modal */}
        {showProofUploadModal && (
          <ProofUploadModal
            oath={oath}
            onClose={() => setShowProofUploadModal(false)}
            onSuccess={async () => {
              setShowProofUploadModal(false);
              await fetchProofs();
              await fetchMessages();
            }}
          />
        )}

        {/* Inline Review Action Modal */}
        {reviewAction && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            <div className="w-full max-w-md bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 p-6 fade-in shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] dark:shadow-none text-left">
              <div className="flex items-center justify-between border-b-2 border-zinc-950 dark:border-zinc-800 pb-3 mb-4">
                <div className="flex items-center gap-2">
                  {reviewAction.type === "need_more_proof" ? (
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 text-red-600" />
                  )}
                  <h3 className="text-base font-black text-zinc-950 dark:text-zinc-50 uppercase tracking-tight">
                    {reviewAction.type === "need_more_proof" ? "Request More Proof" : "Reject Proof (Fraud)"}
                  </h3>
                </div>
                <button
                  onClick={() => setReviewAction(null)}
                  className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <p className="text-xs font-mono text-zinc-600 dark:text-zinc-400 mb-3">
                {reviewAction.type === "need_more_proof"
                  ? `Tell @${reviewAction.message?.sender?.username || reviewAction.proof?.submitter?.username || "member"} specifically what additional evidence is required:`
                  : `Specify why this proof from @${reviewAction.message?.sender?.username || reviewAction.proof?.submitter?.username || "member"} is invalid or fraudulent:`}
              </p>

              <textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder={
                  reviewAction.type === "need_more_proof"
                    ? "e.g. Please send a clearer shot with today's date stamp..."
                    : "e.g. Evidence does not match oath requirement..."
                }
                className="w-full p-3 border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm font-medium resize-none mb-4 focus:outline-none"
                rows={3}
                autoFocus
              />

              <div className="flex items-center gap-3">
                <button
                  onClick={handleConfirmReviewAction}
                  disabled={actionLoading}
                  className={`flex-1 py-3 text-xs font-black uppercase tracking-wider transition-colors flex items-center justify-center gap-2 border-2 ${
                    reviewAction.type === "need_more_proof"
                      ? "bg-amber-500 hover:bg-amber-400 text-zinc-950 border-amber-600"
                      : "bg-red-600 hover:bg-red-700 text-white border-red-700"
                  } disabled:opacity-50`}
                >
                  {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {reviewAction.type === "need_more_proof" ? "Send Request" : "Confirm Rejection"}
                </button>
                <button
                  onClick={() => setReviewAction(null)}
                  className="px-4 py-3 border-2 border-zinc-950 dark:border-zinc-700 text-xs font-mono font-bold uppercase hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
