"use client";

import { useState, useEffect, useRef } from "react";
import { createOath, searchUsersByUsername } from "@/lib/data-hooks";
import {
  Zap,
  User,
  Users,
  DollarSign,
  MessageSquare,
  Phone,
  Calendar,
  Shield,
  Camera,
  Lock,
  Smartphone,
  AlertCircle,
  Flame,
  Activity,
  UserX,
  PieChart,
  Info,
  X,
  Globe,
  Target,
  ArrowRight,
  ArrowLeft,
  Check
} from "lucide-react";
import type { OathType, VerificationMethod, ConsequenceType } from "@/lib/types";
import { convertToUSD, convertToLocal } from "@/lib/utils";
import { useRegion } from "@/lib/region-context";
import { useAuth } from "@/lib/auth-context";
import { showToast } from "./Toast";

interface CreateOathViewProps {
  walletBalance: number;
  onOathCreated?: () => void;
  penaltyBoxUntil?: string | null;
}

export default function CreateOathView({ walletBalance, onOathCreated, penaltyBoxUntil }: CreateOathViewProps) {
  const { user } = useAuth();
  const { region, formatCurrency: formatRegionCurrency } = useRegion();
  const isPenaltyBoxActive = Boolean(
    penaltyBoxUntil && new Date(penaltyBoxUntil).getTime() > Date.now()
  );

  // Step wizard state (1: The Oath & Mode, 2: Schedule & Verification, 3: Stakes & Consequences)
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);

  // Form state
  const [oathStatement, setOathStatement] = useState("");
  const [oathType, setOathType] = useState<OathType>("solo");
  const [consequenceType, setConsequenceType] = useState<ConsequenceType>("fiat");
  const [verificationMethod, setVerificationMethod] = useState<VerificationMethod>("nominee");
  const [groupMode, setGroupMode] = useState<"weakest_link" | "survival">("survival");
  const [maxPlayers, setMaxPlayers] = useState<number>(4);
  const [stakeAmount, setStakeAmount] = useState("");
  const [deadline, setDeadline] = useState("");
  const [cadence, setCadence] = useState<"daily" | "once">("daily");
  const [socialPhone, setSocialPhone] = useState("");
  const [socialMessage, setSocialMessage] = useState("");
  const [nomineeEmail, setNomineeEmail] = useState("");
  const [nomineeSuggestions, setNomineeSuggestions] = useState<{ id?: string; username: string; display_name?: string }[]>([]);
  const [showNomineeSuggestions, setShowNomineeSuggestions] = useState(false);
  const [antiCharityCause, setAntiCharityCause] = useState("Opposing Political Party");
  const [opponentUsername, setOpponentUsername] = useState("");
  const [opponentSuggestions, setOpponentSuggestions] = useState<{ id?: string; username: string; display_name?: string }[]>([]);
  const [showOpponentSuggestions, setShowOpponentSuggestions] = useState(false);
  const [opponentId, setOpponentId] = useState("");
  const [squadMembers, setSquadMembers] = useState<{ id: string; username: string; display_name?: string }[]>([]);
  const [infoModal, setInfoModal] = useState<{ title: string; desc: string } | null>(null);

  const financialConsequences = ["fiat", "anti_charity"];
  const isFinancial = financialConsequences.includes(consequenceType);

  const stakeNum = parseFloat(stakeAmount) || 0;
  const walletInLocal = convertToLocal(walletBalance, region);
  const stakeUsd = convertToUSD(stakeNum, region);
  const multiplier = 1;
  const totalStakeLocal = isFinancial ? stakeNum * multiplier : 0;
  const totalStakeUsd = isFinancial ? stakeUsd * multiplier : 0;
  const protocolFeeLocal = isFinancial ? Math.round(totalStakeLocal * 0.10 * 100) / 100 : 0;
  const totalChargedLocal = totalStakeLocal + protocolFeeLocal;
  const protocolFeeUsd = isFinancial ? Math.round(totalStakeUsd * 0.10 * 100) / 100 : 0;
  const totalChargedUsd = totalStakeUsd + protocolFeeUsd;
  const isOverBudget = isFinancial && totalChargedLocal > walletInLocal;

  // Handle mobile-exclusive features
  const handleMobileExclusive = (feature: string) => {
    showToast(`${feature} is an upcoming native Mobile App exclusive. It cannot be used on this web version.`, "info", 6000);
  };

  const [submitting, setSubmitting] = useState(false);
  const selectedFromDropdownRef = useRef(false);

  useEffect(() => {
    if (verificationMethod !== "nominee") return;
    if (selectedFromDropdownRef.current) {
      selectedFromDropdownRef.current = false;
      return;
    }
    
    const query = nomineeEmail.replace("@", "").trim();
    const isEmailFormat = nomineeEmail.includes("@") && nomineeEmail.indexOf("@") > 0 && nomineeEmail.includes(".");

    const timer = setTimeout(async () => {
      if (query.length < 1 || isEmailFormat) {
        setNomineeSuggestions([]);
        setShowNomineeSuggestions(false);
        return;
      }
      const results = await searchUsersByUsername(query);
      const filtered = results.filter(
        (u) => u.id !== user?.id && u.username.toLowerCase() !== user?.user_metadata?.username?.toLowerCase()
      );
      setNomineeSuggestions(filtered);
      setShowNomineeSuggestions(filtered.length > 0);
    }, 300);

    return () => clearTimeout(timer);
  }, [nomineeEmail, verificationMethod, user]);

  useEffect(() => {
    if (oathType !== "duo" && oathType !== "squad") return;
    if (selectedFromDropdownRef.current) {
      selectedFromDropdownRef.current = false;
      return;
    }
    const query = opponentUsername.replace("@", "").trim();
    const timer = setTimeout(async () => {
      if (query.length < 1) {
        setOpponentSuggestions([]);
        setShowOpponentSuggestions(false);
        return;
      }
      const results = await searchUsersByUsername(query);
      const filtered = results.filter((u) => u.id !== user?.id);
      setOpponentSuggestions(filtered);
      setShowOpponentSuggestions(filtered.length > 0);
    }, 300);
    return () => clearTimeout(timer);
  }, [opponentUsername, oathType, user?.id]);

  const handleAddSquadMember = (u: { id?: string; username: string; display_name?: string }) => {
    if (u.id === user?.id) {
      showToast("You cannot invite yourself", "error");
      return;
    }
    if (squadMembers.length >= maxPlayers - 1) {
      showToast(`Squad full (max ${maxPlayers} including you)`, "error");
    } else if (squadMembers.find((m) => m.id === u.id || m.username.toLowerCase() === u.username.toLowerCase())) {
      showToast("User already added", "error");
    } else {
      setSquadMembers([...squadMembers, { id: u.id || "", username: u.username, display_name: u.display_name }]);
      setOpponentUsername("");
      setShowOpponentSuggestions(false);
      setOpponentSuggestions([]);
    }
  };

  useEffect(() => {
    if (oathType === "solo" && (consequenceType === "shared_oath" || consequenceType === "deadweight_tag")) {
      setConsequenceType("fiat");
    } else if (oathType === "duo" && consequenceType === "deadweight_tag") {
      setConsequenceType("fiat");
    } else if (oathType === "squad" && consequenceType === "shared_oath") {
      setConsequenceType("fiat");
    }
  }, [oathType, consequenceType]);

  const handleAddFromInput = async () => {
    if (!opponentUsername.trim()) return;
    const clean = opponentUsername.replace("@", "").trim();
    if (clean.toLowerCase() === user?.user_metadata?.username?.toLowerCase()) {
      showToast("You cannot invite yourself", "error");
      return;
    }
    const results = await searchUsersByUsername(clean);
    const match = results.find((u) => u.username.toLowerCase() === clean.toLowerCase());
    if (match) {
      handleAddSquadMember(match);
    } else {
      showToast(`User @${clean} not found`, "error");
    }
  };

  const handleSubmit = async () => {
    if (isPenaltyBoxActive) {
      showToast(`Account locked in The Penalty Box until ${new Date(penaltyBoxUntil!).toLocaleDateString()} for 3 consecutive failures. No oath creation allowed.`, "error");
      return;
    }

    if (!oathStatement.trim()) {
      showToast("You need to swear to something.", "error");
      return;
    }
    
    if (isFinancial) {
      if (stakeNum <= 0) {
        showToast("No stake, no oath. Put something on the line.", "error");
        return;
      }
      if (isOverBudget) {
        showToast(`Insufficient funds. You need ${formatRegionCurrency(totalChargedUsd)} (${formatRegionCurrency(totalStakeUsd)} stake + 10% platform fee) for this ${oathType} oath.`, "error");
        return;
      }
    }
    if (!deadline) {
      showToast("Set a deadline. An oath without a deadline is a wish.", "error");
      return;
    }

    const deadlineDate = new Date(deadline);
    if (!deadline.includes("T")) {
      deadlineDate.setHours(23, 59, 59, 999);
    }
    if (deadlineDate.getTime() <= new Date().getTime()) {
      showToast("Deadline must be in the future.", "error");
      return;
    }
    if (verificationMethod === "nominee" && !nomineeEmail.trim()) {
      showToast("Please provide the nominee @username or referee email.", "error");
      return;
    }
    if (consequenceType === "social_ransom") {
      const cleanPhone = socialPhone.replace(/\D/g, "");
      if (cleanPhone.length < 10) {
        showToast("Please enter a valid phone number with country/area code.", "error");
        return;
      }
      if (!socialMessage.trim() || socialMessage.trim().length < 5) {
        showToast("Social ransom requires a message of at least 5 characters.", "error");
        return;
      }
    }

    const statementWithCause = oathStatement.trim();

    setSubmitting(true);
    let finalOpponentId = opponentId;
    if (oathType === "duo" && !finalOpponentId && opponentUsername.trim()) {
      const clean = opponentUsername.replace("@", "").trim();
      const results = await searchUsersByUsername(clean);
      const match = results.find(u => u.username.toLowerCase() === clean.toLowerCase());
      if (match?.id) {
        finalOpponentId = match.id;
      }
    }

    if (oathType === "duo" && finalOpponentId && finalOpponentId === user?.id) {
      showToast("You cannot challenge yourself.", "error");
      setSubmitting(false);
      return;
    }

    if (verificationMethod === "nominee") {
      const cleanNominee = nomineeEmail.replace("@", "").trim().toLowerCase();
      if (
        cleanNominee === user?.user_metadata?.username?.toLowerCase() ||
        (user?.email && nomineeEmail.trim().toLowerCase() === user.email.toLowerCase())
      ) {
        showToast("You cannot select yourself as nominee referee.", "error");
        setSubmitting(false);
        return;
      }
    }

    let finalSquadMembers = [...squadMembers];
    if (oathType === "squad" && opponentUsername.trim()) {
      const clean = opponentUsername.replace("@", "").trim();
      if (!finalSquadMembers.some(m => m.username.toLowerCase() === clean.toLowerCase())) {
        const results = await searchUsersByUsername(clean);
        const match = results.find(u => u.username.toLowerCase() === clean.toLowerCase());
        if (match?.id && match.id !== user?.id) {
          finalSquadMembers.push({ id: match.id, username: match.username, display_name: match.display_name });
        }
      }
    }

    const { error } = await createOath({
      oath_statement: statementWithCause,
      deadline: deadlineDate.toISOString(),
      oath_type: oathType,
      verification_method: verificationMethod,
      consequence_type: consequenceType,
      stake_amount: isFinancial ? stakeUsd : 0,
      nominee_email: nomineeEmail || undefined,
      social_ransom_phone: socialPhone || undefined,
      social_ransom_message: socialMessage || undefined,
      anti_charity_cause: consequenceType === "anti_charity" ? antiCharityCause : undefined,
      min_players: oathType === "squad" ? Math.min(3, maxPlayers) : (oathType === "duo" ? 2 : 1),
      max_players: oathType === "squad" ? maxPlayers : (oathType === "duo" ? 2 : 1),
      group_mode: oathType === "duo" || oathType === "squad" ? groupMode : undefined,
      opponent_id: oathType === "duo" && finalOpponentId ? finalOpponentId : undefined,
      opponent_ids: oathType === "squad" && finalSquadMembers.length > 0 ? finalSquadMembers.map(m => m.id) : undefined,
      cadence,
    });
    setSubmitting(false);
    if (error) {
      showToast(error, "error");
    } else {
      showToast("Oath created. Funds locked in escrow. No turning back.", "success");
      onOathCreated?.();
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto py-8 sm:py-12 px-4 sm:px-6 relative">
      <div className="w-full max-w-2xl mx-auto pb-32">
        {/* Header */}
        <div className="mb-6 text-center sm:text-left">
          <h2 className="text-3xl font-black tracking-tight text-zinc-950 dark:text-zinc-100 mb-2 uppercase">
            Create an Oath
          </h2>
          <p className="text-xs font-mono text-zinc-600 dark:text-zinc-400 tracking-wide border-2 border-zinc-300 dark:border-zinc-800 p-2 inline-block bg-white dark:bg-zinc-900">
            WARNING: ONCE CREATED, FUNDS ARE LOCKED. NO UNDO.
          </p>
        </div>

        {/* STEP PROGRESS INDICATOR */}
        <div className="mb-6 p-3 sm:p-4 bg-white dark:bg-zinc-950 border-2 border-zinc-950 dark:border-zinc-800 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono font-black uppercase text-amber-600 dark:text-amber-400 tracking-wider">
              STEP {currentStep} OF 3: {currentStep === 1 ? "THE OATH & MODE" : currentStep === 2 ? "SCHEDULE & VERIFICATION" : "STAKES & CONSEQUENCE"}
            </span>
            <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase">
              {currentStep === 1 ? "Next: Verification" : currentStep === 2 ? "Next: Stakes" : "Final Step"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className={`h-2 border border-zinc-950 dark:border-zinc-700 transition-colors ${currentStep >= 1 ? "bg-zinc-950 dark:bg-zinc-100" : "bg-zinc-200 dark:bg-zinc-800"}`} />
            <div className={`h-2 border border-zinc-950 dark:border-zinc-700 transition-colors ${currentStep >= 2 ? "bg-zinc-950 dark:bg-zinc-100" : "bg-zinc-200 dark:bg-zinc-800"}`} />
            <div className={`h-2 border border-zinc-950 dark:border-zinc-700 transition-colors ${currentStep >= 3 ? "bg-zinc-950 dark:bg-zinc-100" : "bg-zinc-200 dark:bg-zinc-800"}`} />
          </div>
        </div>

        {/* ---- STEP 1: THE OATH & MODE ---- */}
        {currentStep === 1 && (
          <div className="space-y-6 fade-in">
            {/* THE OATH STATEMENT */}
            <div className="border-2 border-zinc-950 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-950/50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
              <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.2em] mb-3 block">
                I swear to
              </label>
              <textarea
                value={oathStatement}
                onChange={(e) => setOathStatement(e.target.value)}
                placeholder="Run 5km every morning for 30 days..."
                className="w-full text-xl font-black text-zinc-950 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 bg-transparent border-0 p-0 resize-none focus:ring-0 leading-relaxed"
                rows={2}
                autoFocus
                style={{ outline: "none", border: "none" }}
              />
            </div>

            {/* PROOF CADENCE SELECTOR */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.2em] font-bold block">
                  Proof Cadence
                </label>
                <span className="text-[10px] font-mono text-amber-600 dark:text-amber-400 font-bold">
                  {cadence === "daily" ? "Daily upload required" : "Single upload at deadline"}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <TypeButton
                  icon={<Flame className="w-4 h-4 text-amber-500" />}
                  label="Daily Proof"
                  sublabel="Upload every 24h"
                  isActive={cadence === "daily"}
                  onClick={() => setCadence("daily")}
                  onInfo={() => setInfoModal({
                    title: "Daily Proof Cadence",
                    desc: "You must submit verified proof every single day before 12:00 AM midnight in your local timezone. In multiplayer challenges (Duo/Squad/Lobby), each member follows their own country's 12:00 AM midnight. If you miss even one day's upload, the oath immediately fails, your stake is seized, and your loss streak increases.",
                  })}
                />
                <TypeButton
                  icon={<Target className="w-4 h-4 text-blue-500" />}
                  label="One-Time Deadline"
                  sublabel="Submit once by deadline"
                  isActive={cadence === "once"}
                  onClick={() => setCadence("once")}
                  onInfo={() => setInfoModal({
                    title: "One-Time Proof Deadline",
                    desc: "You have until the final deadline to submit your proof. You only need to verify your achievement once on or before the timer expires.",
                  })}
                />
              </div>
            </div>

            {/* OATH TYPE */}
            <div>
              <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.2em] mb-3 block">
                Oath Type
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <TypeButton
                  icon={<User className="w-4 h-4" />}
                  label="Solo"
                  sublabel="You vs You"
                  isActive={oathType === "solo"}
                  onClick={() => {
                    setOathType("solo");
                    setVerificationMethod("nominee");
                    if (consequenceType !== "fiat" && consequenceType !== "social_ransom" && consequenceType !== "app_blocking" && consequenceType !== "anti_charity" && consequenceType !== "public_shame") {
                      setConsequenceType("fiat");
                    }
                  }}
                />
                <TypeButton
                  icon={<Users className="w-4 h-4" />}
                  label="Duo"
                  sublabel="Head to Head"
                  isActive={oathType === "duo"}
                  onClick={() => {
                    setOathType("duo");
                    setVerificationMethod("peer");
                    if (consequenceType !== "fiat" && consequenceType !== "anti_charity" && consequenceType !== "public_shame" && consequenceType !== "social_ransom") {
                      setConsequenceType("fiat");
                    }
                  }}
                />
                <TypeButton
                  icon={<Users className="w-4 h-4" />}
                  label="Squad"
                  sublabel="3-8 Players"
                  isActive={oathType === "squad"}
                  onClick={() => {
                    setOathType("squad");
                    setVerificationMethod("quorum");
                    if (consequenceType !== "fiat" && consequenceType !== "anti_charity" && consequenceType !== "public_shame" && consequenceType !== "social_ransom") {
                      setConsequenceType("fiat");
                    }
                  }}
                />
              </div>
            </div>

            {/* SQUAD SIZE SELECTOR */}
            {oathType === "squad" && (
              <div className="border-2 border-zinc-950 dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-950/50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
                <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.2em] mb-2.5 block">
                  Squad Size ({maxPlayers} Players)
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[4, 5, 6, 8].map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() => setMaxPlayers(size)}
                      className={`py-2 text-xs font-mono font-bold border-2 transition-colors ${
                        maxPlayers === size
                          ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-100"
                          : "border-zinc-300 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:border-zinc-600"
                      }`}
                    >
                      {size} <span className="hidden sm:inline">Players</span><span className="sm:hidden">P</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* DUO / SQUAD GROUP MODE */}
            {(oathType === "duo" || oathType === "squad") && (
              <div>
                <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.2em] mb-3 block">
                  Group Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <TypeButton
                    icon={<Zap className="w-4 h-4" />}
                    label="Weakest Link"
                    sublabel="All or nothing"
                    isActive={groupMode === "weakest_link"}
                    onClick={() => setGroupMode("weakest_link")}
                    onInfo={() => setInfoModal({ title: "Weakest Link", desc: "If ANY member of the duo/squad fails, the ENTIRE squad fails. You win or lose as a team." })}
                  />
                  <TypeButton
                    icon={<Activity className="w-4 h-4" />}
                    label="Survival"
                    sublabel="Individual stakes"
                    isActive={groupMode === "survival"}
                    onClick={() => setGroupMode("survival")}
                    onInfo={() => setInfoModal({ title: "Survival Mode", desc: "Members who succeed get their money back. Members who fail lose their money to the platform." })}
                  />
                </div>
              </div>
            )}

            {/* DUO OPPONENT OR SQUAD INVITES */}
            {(oathType === "duo" || oathType === "squad") && (
              <div className="border-2 border-zinc-950 dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-950/50 fade-in shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-500 uppercase tracking-[0.2em]">
                    {oathType === "squad" ? "Invite Squad Members" : "Opponent @username"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={opponentUsername}
                      onChange={(e) => {
                        selectedFromDropdownRef.current = false;
                        setOpponentUsername(e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && oathType === "squad") {
                          e.preventDefault();
                          handleAddFromInput();
                        }
                      }}
                      onFocus={() => { if (opponentSuggestions.length > 0) setShowOpponentSuggestions(true); }}
                      onBlur={() => setTimeout(() => setShowOpponentSuggestions(false), 200)}
                      placeholder={oathType === "squad" ? "Search @username to invite" : "@username"}
                      className="w-full px-3.5 py-3 text-base sm:text-sm border-2 border-zinc-950 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-950 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none transition-colors"
                    />
                    
                    {showOpponentSuggestions && opponentSuggestions.length > 0 && (
                      <div
                        onMouseDown={(e) => e.preventDefault()}
                        onTouchStart={(e) => e.preventDefault()}
                        className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#0a0a0f] border-2 border-zinc-950 dark:border-zinc-800 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none z-30 max-h-40 overflow-y-auto"
                      >
                        {opponentSuggestions.map((u) => (
                          <button
                            key={u.username}
                            type="button"
                            className="w-full text-left px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 last:border-0 flex items-center justify-between"
                            onClick={() => {
                              if (oathType === "squad") {
                                handleAddSquadMember(u);
                              } else {
                                selectedFromDropdownRef.current = true;
                                setOpponentUsername("@" + u.username);
                                setOpponentId(u.id || "");
                                setShowOpponentSuggestions(false);
                                setOpponentSuggestions([]);
                              }
                            }}
                          >
                            <span className="font-bold text-zinc-950 dark:text-zinc-100 text-sm">@{u.username}</span>
                            <span className="text-[10px] text-zinc-500 font-mono truncate ml-2">{u.display_name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {oathType === "squad" && (
                    <button
                      type="button"
                      onClick={handleAddFromInput}
                      className="px-4 py-3 bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs font-mono font-black uppercase tracking-wider hover:bg-zinc-800 dark:hover:bg-zinc-200 border-2 border-zinc-950 dark:border-transparent transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none shrink-0"
                    >
                      Add
                    </button>
                  )}
                </div>
                
                {oathType === "squad" && squadMembers.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {squadMembers.map((member) => (
                      <div key={member.id} className="flex items-center justify-between p-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
                        <div className="flex flex-col">
                          <span className="text-sm font-bold">@{member.username}</span>
                        </div>
                        <button 
                          onClick={() => setSquadMembers(squadMembers.filter(m => m.id !== member.id))}
                          className="w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded text-red-500 transition-colors shrink-0"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* STEP 1 NEXT BUTTON */}
            <div className="flex items-center justify-end pt-4 border-t-2 border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => {
                  if (!oathStatement.trim()) {
                    showToast("You need to swear to something.", "error");
                    return;
                  }
                  if (oathType === "duo") {
                    if (!opponentUsername.trim() && !opponentId) {
                      showToast("Please enter an opponent @username for this duel.", "error");
                      return;
                    }
                    const clean = opponentUsername.replace("@", "").trim().toLowerCase();
                    if (clean === user?.user_metadata?.username?.toLowerCase() || opponentId === user?.id) {
                      showToast("You cannot challenge yourself.", "error");
                      return;
                    }
                  }
                  if (oathType === "squad" && squadMembers.length === 0 && !opponentUsername.trim()) {
                    showToast("Please invite at least 1 member to your squad.", "error");
                    return;
                  }
                  setCurrentStep(2);
                }}
                disabled={!oathStatement.trim() || (oathType === "duo" && !opponentUsername.trim() && !opponentId)}
                className="px-6 py-3.5 bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 font-black uppercase text-xs tracking-wider flex items-center gap-2 hover:bg-zinc-800 dark:hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
              >
                Next: Schedule & Verification <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ---- STEP 2: SCHEDULE & VERIFICATION ---- */}
        {currentStep === 2 && (
          <div className="space-y-6 fade-in">
            {/* DEADLINE */}
            <div className="border-2 border-zinc-950 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950/50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.2em] block">
                  {cadence === "daily" ? "Challenge Duration (Daily Proofs Required)" : "Final Deadline (One-Time Proof)"}
                </label>
                <span className="text-[10px] font-mono text-zinc-500 font-bold">
                  {cadence === "daily" ? "Proof due every night by 12:00 AM local time" : "Single proof by date"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-zinc-500" />
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full text-base sm:text-lg bg-transparent border-0 p-0 text-zinc-900 dark:text-zinc-200 font-bold focus:outline-none"
                  style={{ outline: "none", border: "none" }}
                />
              </div>
              {/* Quick deadline buttons */}
              <div className="flex flex-wrap items-center gap-2 mt-4">
                {[
                  { label: "7d", days: 7 },
                  { label: "14d", days: 14 },
                  { label: "30d", days: 30 },
                  { label: "90d", days: 90 },
                ].map(({ label, days }) => {
                  const d = new Date();
                  d.setDate(d.getDate() + days);
                  const val = d.toISOString().split("T")[0];
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setDeadline(val)}
                      className={`px-3 sm:px-2.5 py-2 sm:py-1.5 min-h-[38px] sm:min-h-0 text-xs sm:text-[10px] font-mono font-bold border-2 transition-colors ${
                        deadline === val
                          ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-500 dark:text-zinc-200 dark:bg-zinc-800"
                          : "border-zinc-300 text-zinc-700 hover:text-zinc-950 hover:border-zinc-500 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                      }`}
                    >
                      +{label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* VERIFICATION METHOD */}
            <div>
              <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.2em] mb-3 block">
                Verification Method
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <TypeButton
                  icon={<Shield className="w-4 h-4" />}
                  label="Nominee"
                  sublabel="Third party"
                  isActive={verificationMethod === "nominee"}
                  onClick={() => setVerificationMethod("nominee")}
                  disabled={oathType !== "solo"}
                />
                <TypeButton
                  icon={<Users className="w-4 h-4" />}
                  label="Peer"
                  sublabel="Opponent verifies"
                  isActive={verificationMethod === "peer"}
                  onClick={() => setVerificationMethod("peer")}
                  disabled={oathType !== "duo"}
                />
                <TypeButton
                  icon={<Users className="w-4 h-4" />}
                  label="Quorum"
                  sublabel=">50% vote"
                  isActive={verificationMethod === "quorum"}
                  onClick={() => setVerificationMethod("quorum")}
                  disabled={oathType !== "squad"}
                />
              </div>
            </div>

            {/* NOMINEE INPUT (IF SOLO) */}
            {verificationMethod === "nominee" && (
              <div className="border-2 border-zinc-950 dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-950/50 fade-in shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-500 uppercase tracking-[0.2em]">
                    Nominee @username
                  </span>
                  <button 
                    type="button" 
                    onClick={() => setInfoModal({ 
                      title: "Trustworthy Nominees", 
                      desc: "A Nominee is the sole judge of your oath. If you pick someone who easily caves to your excuses, you are wasting your money. Pick someone ruthless."
                    })}
                    className="ml-auto text-zinc-400 hover:text-zinc-950 dark:hover:text-white"
                  >
                    <Info className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={nomineeEmail}
                    onChange={(e) => {
                      selectedFromDropdownRef.current = false;
                      setNomineeEmail(e.target.value);
                    }}
                    onFocus={() => { if (nomineeSuggestions.length > 0) setShowNomineeSuggestions(true); }}
                    onBlur={() => setTimeout(() => setShowNomineeSuggestions(false), 200)}
                    placeholder="@username"
                    className="w-full px-3.5 py-3 text-base sm:text-sm border-2 border-zinc-950 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-950 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none transition-colors"
                  />
                  <div className="mt-2 p-2 bg-yellow-100/50 dark:bg-yellow-950/30 border border-yellow-300 dark:border-yellow-900/50 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-500 mt-0.5 shrink-0" />
                    <p className="text-[10px] sm:text-xs text-yellow-800 dark:text-yellow-200/80 font-mono leading-tight">
                      <strong className="font-bold">IMPORTANT:</strong> Type `@` followed by the username of a trustworthy referee. <span className="underline decoration-yellow-400/50">The nominee must already have an account on this app</span>, otherwise they cannot verify your proof.
                    </p>
                  </div>
                  
                  {showNomineeSuggestions && nomineeSuggestions.length > 0 && (
                    <div
                      onMouseDown={(e) => e.preventDefault()}
                      onTouchStart={(e) => e.preventDefault()}
                      className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#0a0a0f] border-2 border-zinc-950 dark:border-zinc-800 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none z-30 max-h-40 overflow-y-auto"
                    >
                      {nomineeSuggestions.map((u) => (
                        <button
                          key={u.username}
                          type="button"
                          className="w-full text-left px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 last:border-0 flex items-center justify-between"
                          onClick={() => {
                            selectedFromDropdownRef.current = true;
                            setNomineeEmail("@" + u.username);
                            setShowNomineeSuggestions(false);
                            setNomineeSuggestions([]);
                          }}
                        >
                          <span className="font-bold text-zinc-950 dark:text-zinc-100 text-sm">@{u.username}</span>
                          <span className="text-[10px] text-zinc-500 font-mono truncate ml-2">{u.display_name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-[10px] font-bold text-zinc-500 mt-2.5 font-mono">
                  They will receive a notification in their app to verify your oath.
                </p>
              </div>
            )}

            {/* STEP 2 NAVIGATION BUTTONS */}
            <div className="flex items-center justify-between pt-4 border-t-2 border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setCurrentStep(1)}
                className="px-5 py-3.5 border-2 border-zinc-950 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono text-xs font-black uppercase tracking-wider hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-1.5 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!deadline) {
                    showToast("Set a deadline. An oath without a deadline is a wish.", "error");
                    return;
                  }
                  const deadlineDate = new Date(deadline);
                  if (!deadline.includes("T")) deadlineDate.setHours(23, 59, 59, 999);
                  if (deadlineDate.getTime() <= Date.now()) {
                    showToast("Deadline must be in the future.", "error");
                    return;
                  }
                  if (verificationMethod === "nominee" && !nomineeEmail.trim()) {
                    showToast("Please provide the nominee @username or referee email.", "error");
                    return;
                  }
                  setCurrentStep(3);
                }}
                disabled={!deadline || (verificationMethod === "nominee" && !nomineeEmail.trim())}
                className="px-6 py-3.5 bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 font-black uppercase text-xs tracking-wider flex items-center gap-2 hover:bg-zinc-800 dark:hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
              >
                Next: Stakes & Consequences <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ---- STEP 3: STAKES & CONSEQUENCES ---- */}
        {currentStep === 3 && (
          <div className="space-y-6 fade-in">
            {/* CONSEQUENCE TYPE */}
            <div>
              <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.2em] mb-3 block">
                Consequence Type
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <TypeButton
                  icon={<DollarSign className="w-4 h-4" />}
                  label="Financial"
                  sublabel="Cold cash"
                  isActive={consequenceType === "fiat"}
                  onClick={() => setConsequenceType("fiat")}
                />
                <TypeButton
                  icon={<Phone className="w-4 h-4" />}
                  label="Social Ransom"
                  sublabel="Auto-text friend"
                  isActive={consequenceType === "social_ransom"}
                  onClick={() => setConsequenceType("social_ransom")}
                  onInfo={() => setInfoModal({ title: "Social Ransom", desc: "You write an embarrassing confession and provide a friend/boss's phone number. If you fail, we automatically text it to them." })}
                />
                <TypeButton
                  icon={<Lock className="w-3.5 h-3.5" />}
                  label="Digital Lockout"
                  sublabel="App Only"
                  isActive={consequenceType === "app_blocking"}
                  onClick={() => handleMobileExclusive("Digital Lockout")}
                  disabled
                  onInfo={() => setInfoModal({ title: "Digital Lockout (App Only)", desc: "IMPORTANT: This feature requires our native mobile application (iOS/Android). If you fail an oath, it uses OS-level permissions to physically lock you out of distracting apps like Instagram, TikTok, and Reddit." })}
                />
                <TypeButton
                  icon={<Flame className="w-4 h-4" />}
                  label="Anti-Charity"
                  sublabel="Hate donation"
                  isActive={consequenceType === "anti_charity"}
                  onClick={() => setConsequenceType("anti_charity")}
                  onInfo={() => setInfoModal({ title: "Anti-Charity Donation", desc: "You pick a cause you absolutely despise. Failing forfeits your stake directly to that entity to cause maximum ideological pain." })}
                />
                <TypeButton
                  icon={<AlertCircle className="w-4 h-4" />}
                  label="Public Shame"
                  sublabel="Wall of Shame"
                  isActive={consequenceType === "public_shame"}
                  onClick={() => setConsequenceType("public_shame")}
                  onInfo={() => setInfoModal({ title: "Public Humiliation", desc: "Your failure, excuse, and headshot are permanently broadcasted to the global Wall of Shame feed for everyone to mock." })}
                />
              </div>
            </div>

            {/* SOCIAL RANSOM FIELDS */}
            {(consequenceType === "social_ransom") && (
              <div className="border-2 border-zinc-950 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950/50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none space-y-4 fade-in">
                <div className="flex items-center gap-2 mb-2">
                  <Phone className="w-4 h-4 text-zinc-950 dark:text-zinc-500" />
                  <span className="text-[11px] font-mono font-bold text-zinc-950 dark:text-zinc-400 uppercase tracking-[0.2em]">
                    Social Ransom Target
                  </span>
                </div>
                <input
                  type="tel"
                  value={socialPhone}
                  onChange={(e) => setSocialPhone(e.target.value)}
                  placeholder="Friend's phone number"
                  className="w-full px-3 py-3 text-sm bg-white dark:bg-zinc-950 border-2 border-zinc-950 dark:border-zinc-700 text-zinc-950 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none"
                />
                <textarea
                  value={socialMessage}
                  onChange={(e) => setSocialMessage(e.target.value)}
                  placeholder="The embarrassing message that gets sent if you fail..."
                  className="w-full px-3 py-3 text-sm resize-none bg-white dark:bg-zinc-950 border-2 border-zinc-950 dark:border-zinc-700 text-zinc-950 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none"
                  rows={3}
                />
              </div>
            )}

            {/* ANTI-CHARITY FIELDS */}
            {consequenceType === "anti_charity" && (
              <div className="border-2 border-zinc-950 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950/50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none space-y-3 fade-in">
                <div className="flex items-center gap-2 mb-1">
                  <Flame className="w-4 h-4 text-red-600" />
                  <span className="text-[11px] font-mono font-bold text-zinc-950 dark:text-zinc-400 uppercase tracking-[0.2em]">
                    Despised Cause
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    "Opposing Political Party",
                    "Scientology Foundation",
                    "Anti-Renewable Coal PAC",
                    "Tobacco Research Institute"
                  ].map((cause) => (
                    <button
                      key={cause}
                      type="button"
                      onClick={() => setAntiCharityCause(cause)}
                      className={`p-2.5 text-left border-2 text-xs font-mono font-bold transition-colors ${
                        antiCharityCause === cause
                          ? "border-red-600 bg-red-600 text-white"
                          : "border-zinc-300 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-700"
                      }`}
                    >
                      {cause}
                    </button>
                  ))}
                </div>
                <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
                  <input
                    type="text"
                    placeholder="Or enter custom despised cause / organization..."
                    value={["Opposing Political Party", "Scientology Foundation", "Anti-Renewable Coal PAC", "Tobacco Research Institute"].includes(antiCharityCause) ? "" : antiCharityCause}
                    onChange={(e) => setAntiCharityCause(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-zinc-300 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none focus:border-red-600 transition-colors"
                  />
                </div>
              </div>
            )}

            {/* STAKE AMOUNT */}
            {isFinancial && (
              <div className="border-2 border-zinc-950 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950/50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
                <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.2em] mb-2 block">
                  Or I lose
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-black text-zinc-500">{region === "in" ? "₹" : "$"}</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={stakeAmount}
                    onChange={(e) => setStakeAmount(e.target.value)}
                    placeholder="0"
                    min="1"
                    className="w-full text-3xl font-black text-zinc-950 dark:text-zinc-100 bg-transparent border-0 p-0 stake-number focus:outline-none"
                    style={{ outline: "none", border: "none" }}
                  />
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span
                    className={`text-[10px] font-mono font-bold ${
                      isOverBudget ? "text-red-500" : "text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    Wallet Balance: {formatRegionCurrency(walletBalance)}
                  </span>
                  <span className="text-[10px] font-mono font-bold text-zinc-500">
                    Upfront Protocol Fee: 10%
                  </span>
                </div>
                {stakeNum > 0 && (
                  <div className="mt-3 p-2.5 bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-[11px] font-mono space-y-1">
                    <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                      <span>Base Escrow Stake {multiplier > 1 ? `(${multiplier}x pot)` : ""}:</span>
                      <span className="font-bold text-zinc-900 dark:text-zinc-100">{formatRegionCurrency(totalStakeUsd)}</span>
                    </div>
                    <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                      <span>Platform Fee (+10% upfront):</span>
                      <span className="font-bold text-amber-600 dark:text-amber-400">+{formatRegionCurrency(protocolFeeUsd)}</span>
                    </div>
                    <div className="pt-1 border-t border-zinc-200 dark:border-zinc-800 flex justify-between font-bold text-zinc-950 dark:text-zinc-50">
                      <span>Total Charged from Wallet:</span>
                      <span className={isOverBudget ? "text-red-500" : "text-emerald-600 dark:text-emerald-400"}>
                        {formatRegionCurrency(totalChargedUsd)}
                      </span>
                    </div>
                    <div className="text-[9px] text-zinc-500 dark:text-zinc-400 pt-0.5 leading-normal flex items-start gap-1">
                      <Check className="w-3 h-3 text-zinc-500 shrink-0 mt-0.5" />
                      <span>Non-refundable 10% platform fee is retained by Oath. Winners receive 100% of their escrow pot ({formatRegionCurrency(totalStakeUsd)}). If you fail, your stake is lost and the 10% fee stays with Oath.</span>
                    </div>
                  </div>
                )}
                {/* Quick stake buttons */}
                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {(region === "in" ? [500, 1000, 2500, 5000, 10000] : [25, 50, 100, 250, 500]).map((amount) => (
                    <button
                      key={amount}
                      type="button"
                      onClick={() => setStakeAmount(amount.toString())}
                      className={`px-3 sm:px-2.5 py-2 sm:py-1.5 min-h-[38px] sm:min-h-0 text-xs sm:text-[10px] font-mono font-bold border-2 transition-colors ${
                        stakeNum === amount
                          ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-500 dark:text-zinc-200 dark:bg-zinc-800"
                          : "border-zinc-300 text-zinc-700 hover:text-zinc-950 hover:border-zinc-500 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                      }`}
                    >
                      {region === "in" ? `₹${amount}` : `$${amount}`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* MOBILE EXCLUSIVE OPTIONS */}
            <div className="border border-zinc-800/50 p-3 bg-zinc-950/30">
              <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mb-2 block">
                Mobile Features
              </span>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => handleMobileExclusive("Screen Time Integration")}
                  className="flex items-center gap-2 px-3 py-2 border border-zinc-800/50 text-zinc-600 hover:border-zinc-700 transition-colors"
                >
                  <Smartphone className="w-3 h-3" />
                  <span className="text-[10px] font-mono">Screen Time</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleMobileExclusive("Camera-based Health Tracking")}
                  className="flex items-center gap-2 px-3 py-2 border border-zinc-800/50 text-zinc-600 hover:border-zinc-700 transition-colors"
                >
                  <Camera className="w-3 h-3" />
                  <span className="text-[10px] font-mono">Health Track</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleMobileExclusive("App Blocking")}
                  className="flex items-center gap-2 px-3 py-2 border border-zinc-800/50 text-zinc-600 hover:border-zinc-700 transition-colors"
                >
                  <Lock className="w-3 h-3" />
                  <span className="text-[10px] font-mono">App Block</span>
                </button>
              </div>
            </div>

            {/* SUMMARY & SUBMIT */}
            <div className="border-t-2 border-zinc-200 dark:border-zinc-800 pt-5">
              {/* Preview sentence */}
              {oathStatement && stakeNum > 0 && (
                <div className="mb-4 p-4 border-2 border-zinc-950 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950/80 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
                  <p className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest mb-2">
                    Your Oath
                  </p>
                  <p className="text-base font-semibold text-zinc-900 dark:text-zinc-200 leading-relaxed">
                    &ldquo;I swear to{" "}
                    <span className="text-zinc-950 dark:text-zinc-50 font-black">{oathStatement}</span>
                    <span className="text-amber-600 dark:text-amber-400 font-bold font-mono text-sm">
                      {" "}[{cadence === "daily" ? "Daily Proofs" : "One-Time Proof"}]
                    </span>
                    {deadline && (
                      <>
                        {" "}by{" "}
                        <span className="text-zinc-950 dark:text-zinc-50 font-black">
                          {new Date(deadline).toLocaleDateString("en-US", {
                            month: "long",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </>
                    )}
                    {" "}or I lose{" "}
                    <span className={`font-black ${isOverBudget ? "text-red-500" : "text-zinc-950 dark:text-zinc-50"}`}>
                      {formatRegionCurrency(totalStakeUsd)}
                    </span>
                    {multiplier > 1 && ` (${multiplier}x total for ${oathType})`}
                    .&rdquo;
                  </p>
                </div>
              )}

              {(oathType === "duo" || oathType === "squad") && isFinancial && (
                <div className="p-3 bg-zinc-100 dark:bg-zinc-900 border-2 border-zinc-950 dark:border-zinc-800 text-[11px] font-mono text-zinc-700 dark:text-zinc-300 mb-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none flex items-start gap-2">
                  <Info className="w-4 h-4 text-zinc-900 dark:text-zinc-100 shrink-0 mt-0.5" />
                  <div>
                    <strong>Individual Buy-In:</strong> You pay your own stake ({formatRegionCurrency(totalStakeUsd)} + 10% platform fee = <strong>{formatRegionCurrency(totalChargedUsd)}</strong>). {oathType === "duo" ? "Your opponent will lock their matching stake from their wallet when accepting the challenge." : "Each squad member will lock their own stake from their wallet when accepting the invite."}
                  </div>
                </div>
              )}

              {isPenaltyBoxActive && (
                <div className="mb-4 p-4 border-2 border-red-600 bg-red-950/20 text-red-600 dark:text-red-400 font-mono space-y-1 shadow-[2px_2px_0px_0px_rgba(220,38,38,1)]">
                  <div className="flex items-center gap-2 font-black text-xs uppercase tracking-wider">
                    <AlertCircle className="w-4 h-4 text-red-500" />
                    LOCKED IN THE PENALTY BOX
                  </div>
                  <p className="text-[11px] leading-relaxed">
                    You have failed 3 consecutive oaths. The system has placed you on a 7-day timeout. Creating oaths is disabled until{" "}
                    <strong>{new Date(penaltyBoxUntil!).toLocaleDateString()} {new Date(penaltyBoxUntil!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} UTC</strong>.
                  </p>
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="px-5 py-4 border-2 border-zinc-950 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono text-xs font-black uppercase tracking-wider hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-1.5 shrink-0 transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={!oathStatement || (isFinancial && (stakeNum <= 0 || isOverBudget)) || submitting || isPenaltyBoxActive}
                  className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-black tracking-tight uppercase transition-all ${
                    !oathStatement || (isFinancial && (stakeNum <= 0 || isOverBudget)) || submitting || isPenaltyBoxActive
                      ? "bg-zinc-300 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-600 cursor-not-allowed"
                      : "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 border-2 border-zinc-950 dark:border-transparent shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                  }`}
                >
                  <Zap className="w-4 h-4" />
                  {submitting
                    ? "Locking Escrow..."
                    : isPenaltyBoxActive
                    ? "Locked in Penalty Box"
                    : isFinancial
                    ? `Pay ${formatRegionCurrency(totalChargedUsd)} & Create Oath`
                    : "Create Oath"}
                </button>
              </div>

              {isFinancial && isOverBudget && (
                <div className="flex items-center gap-2 mt-3 text-red-500 font-bold">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-mono">
                    Total required of {formatRegionCurrency(totalChargedUsd)} ({formatRegionCurrency(totalStakeUsd)} stake + 10% platform fee) exceeds wallet balance ({formatRegionCurrency(walletBalance)}). Deposit more funds.
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* INFO MODAL */}
      {infoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-zinc-950 border-4 border-zinc-950 dark:border-zinc-800 max-w-sm w-full p-6 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] dark:shadow-[8px_8px_0px_0px_rgba(255,255,255,0.05)] relative">
            <button
              onClick={() => setInfoModal(null)}
              className="absolute top-4 right-4 text-zinc-500 hover:text-zinc-950 dark:hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
            <h3 className="text-xl font-black uppercase tracking-tight text-zinc-950 dark:text-zinc-100 pr-8 mb-4">
              {infoModal.title}
            </h3>
            <p className="text-sm font-bold text-zinc-700 dark:text-zinc-400 leading-relaxed">
              {infoModal.desc}
            </p>
            <button
              onClick={() => setInfoModal(null)}
              className="mt-6 w-full py-3 bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950 font-black uppercase tracking-widest text-xs hover:bg-zinc-800 dark:hover:bg-white"
            >
              Understood
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TypeButton({
  icon,
  label,
  sublabel,
  isActive,
  onClick,
  disabled,
  onInfo,
}: {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
  onInfo?: () => void;
}) {
  return (
    <div
      aria-disabled={disabled}
      className={`relative flex flex-col items-center justify-center gap-1 px-2 py-4 border-2 transition-all ${
        disabled
          ? "border-zinc-200 dark:border-zinc-800/40 text-zinc-400 dark:text-zinc-600 bg-zinc-100/50 dark:bg-zinc-900/30 cursor-not-allowed opacity-40 select-none pointer-events-none"
          : isActive
          ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-500 dark:bg-zinc-800/80 dark:text-zinc-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
          : "border-zinc-300 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200 hover:border-zinc-500 dark:hover:border-zinc-700 bg-white dark:bg-transparent"
      }`}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          if (disabled) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          onClick();
        }}
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        className={`absolute inset-0 w-full h-full ${
          disabled ? "cursor-not-allowed pointer-events-none" : "cursor-pointer"
        }`}
      />
      
      {onInfo && !disabled && (
        <button 
          onClick={(e) => {
            e.stopPropagation();
            onInfo();
          }}
          className="absolute top-0 right-0 z-10 w-9 h-9 sm:w-8 sm:h-8 flex items-center justify-center text-zinc-400 hover:text-zinc-950 dark:hover:text-white transition-colors"
        >
          <Info className="w-3.5 h-3.5" />
        </button>
      )}

      <div className="pointer-events-none flex flex-col items-center gap-1 z-0">
        {icon}
        <span className="text-[11px] font-bold tracking-tight text-center">{label}</span>
        <span className={`text-[9px] font-mono text-center ${
          disabled
            ? "text-zinc-400 dark:text-zinc-600 italic"
            : isActive
            ? "text-zinc-300 dark:text-zinc-400"
            : "text-zinc-500 dark:text-zinc-600"
        }`}>
          {disabled ? "Unavailable" : sublabel}
        </span>
      </div>
    </div>
  );
}
