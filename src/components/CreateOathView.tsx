"use client";

import { useEffect, useState } from "react";
import { createOath, searchRegisteredUsers } from "@/lib/data-hooks";
import {
  Zap,
  User,
  Users,
  DollarSign,
  MessageSquare,
  Calendar,
  Shield,
  Camera,
  Lock,
  Smartphone,
  AlertCircle,
  Flame,
  Activity,
  UserX,
  Info,
  X
} from "lucide-react";
import type { OathType, VerificationMethod, ConsequenceType } from "@/lib/types";
import { convertToUSD } from "@/lib/utils";
import { useRegion } from "@/lib/region-context";
import { showToast } from "./Toast";

interface CreateOathViewProps {
  walletBalance: number;
  onOathCreated?: () => void;
}

export default function CreateOathView({ walletBalance, onOathCreated }: CreateOathViewProps) {
  const { region, formatCurrency: formatRegionCurrency } = useRegion();
  // Form state
  const [oathStatement, setOathStatement] = useState("");
  const [oathType, setOathType] = useState<OathType>("solo");
  const [consequenceType, setConsequenceType] = useState<ConsequenceType>("fiat");
  const [verificationMethod, setVerificationMethod] = useState<VerificationMethod>("solo_lonely");
  const [stakeAmount, setStakeAmount] = useState("");
  const [deadline, setDeadline] = useState("");
  const [nomineeQuery, setNomineeQuery] = useState("");
  const [nomineeOptions, setNomineeOptions] = useState<{ id: string; username: string; display_name: string | null }[]>([]);
  const [nomineeOptionsQuery, setNomineeOptionsQuery] = useState("");
  const [selectedNominee, setSelectedNominee] = useState<{ id: string; username: string } | null>(null);
  const [infoModal, setInfoModal] = useState<{ title: string; desc: string } | null>(null);

  const stakeNum = parseFloat(stakeAmount) || 0;
  const stakeUsd = convertToUSD(stakeNum, region);
  const isOverBudget = stakeUsd > walletBalance;
  const isFinancialConsequence = consequenceType === "fiat";
  const requiresStake = isFinancialConsequence || oathType === "duo";
  const chooseConsequence = (type: ConsequenceType) => {
    setConsequenceType(type);
    if (type !== "fiat") setStakeAmount("");
  };

  useEffect(() => {
    const normalizedQuery = nomineeQuery.trim().replace(/^@/, "");
    if (verificationMethod !== "nominee" || normalizedQuery.length < 2 || selectedNominee) return;
    const timer = window.setTimeout(async () => {
      const result = await searchRegisteredUsers(nomineeQuery);
      setNomineeOptions(result.users);
      setNomineeOptionsQuery(nomineeQuery);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [verificationMethod, nomineeQuery, selectedNominee]);

  // Handle mobile-exclusive features
  const handleMobileExclusive = (feature: string) => {
    showToast(`${feature} is not available in this web build yet.`, "info", 5000);
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!oathStatement.trim() || oathStatement.trim().length > 500) {
      showToast("Write an oath between 1 and 500 characters.", "error");
      return;
    }
    if (requiresStake && stakeNum <= 0) {
      showToast("Add a positive stake for a financial or group oath.", "error");
      return;
    }
    if (stakeNum < 0) {
      showToast("Stake cannot be negative.", "error");
      return;
    }
    if (stakeNum > 0 && isOverBudget) {
      showToast("Insufficient funds. Deposit more or lower the stake.", "error");
      return;
    }
    if (!deadline) {
      showToast("Set a deadline. An oath without a deadline is a wish.", "error");
      return;
    }

    const deadlineDate = new Date(deadline);
    if (!deadline.includes("T")) {
      deadlineDate.setHours(23, 59, 59, 999);
    }
    if (!Number.isFinite(deadlineDate.getTime()) || deadlineDate.getTime() <= Date.now()) {
      showToast("Deadline must be in the future.", "error");
      return;
    }
    if (verificationMethod === "nominee" && !selectedNominee) {
      showToast("Choose a registered user as the nominee.", "error");
      return;
    }

    setSubmitting(true);
    let error: string | null = null;
    try {
      const result = await createOath({
        oath_statement: oathStatement.trim(),
        deadline: deadlineDate.toISOString(),
        oath_type: oathType,
        verification_method: verificationMethod,
        consequence_type: consequenceType,
        stake_amount: isFinancialConsequence ? stakeUsd : 0,
        nominee_user_id: verificationMethod === "nominee" ? selectedNominee?.id : undefined,
        min_players: oathType === "squad" ? 4 : 1,
        max_players: oathType === "squad" ? 8 : 1,
      });
      error = result.error;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Could not create the oath. Please try again.";
    } finally {
      setSubmitting(false);
    }
    if (error) {
      showToast(error, "error");
    } else {
      showToast(stakeUsd > 0 ? "Oath created. Stake is locked in the sandbox ledger." : "Oath created. No monetary stake was added.", "success");
      onOathCreated?.();
    }
  };

  return (
    <div className="flex-1 overflow-y-auto py-8 sm:py-12 px-4 sm:px-6 relative">
      <div className="w-full max-w-2xl mx-auto pb-32">
        {/* Header */}
        <div className="mb-8 text-center sm:text-left">
          <h2 className="text-3xl font-black tracking-tight text-zinc-950 dark:text-zinc-100 mb-2 uppercase">
            Create an Oath
          </h2>
          <p className="text-xs font-mono text-zinc-600 dark:text-zinc-400 tracking-wide border-2 border-zinc-300 dark:border-zinc-800 p-2 inline-block bg-white dark:bg-zinc-900">
            SANDBOX BETA: STAKES ARE VIRTUAL; NO REAL PAYMENTS ARE ENABLED.
          </p>
        </div>

        {/* ---- MAD-LIBS FORM ---- */}
        <div className="space-y-6">
          {/* THE OATH STATEMENT */}
          <div className="border-2 border-zinc-950 dark:border-zinc-800 p-5 bg-white dark:bg-zinc-950/50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
            <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.2em] mb-3 block">
              I swear to
            </label>
            <textarea
              value={oathStatement}
              maxLength={500}
              onChange={(e) => setOathStatement(e.target.value)}
              placeholder="Run 5km every morning for 30 days..."
              className="w-full text-xl font-black text-zinc-950 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-600 bg-transparent border-0 p-0 resize-none focus:ring-0 leading-relaxed"
              rows={2}
              style={{ outline: "none", border: "none" }}
            />
          </div>

          {/* OATH TYPE */}
          <div>
            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.2em] mb-3 block">
              Oath Type
            </label>
            <div className="grid grid-cols-3 gap-2">
              <TypeButton
                icon={<User className="w-4 h-4" />}
                label="Solo"
                sublabel="You vs You"
                isActive={oathType === "solo"}
                onClick={() => {
                  setOathType("solo");
                  setVerificationMethod("solo_lonely");
                  setSelectedNominee(null);
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
                onClick={() => showToast("Use the Challenge button to create an invited duo oath.", "info")}
                disabled
                onInfo={() => setInfoModal({ title: "Duo challenges", desc: "Use the Challenge button to create an invite. The backend locks both stakes when the invite is accepted." })}
              />
              <TypeButton
                icon={<Users className="w-4 h-4" />}
                label="Squad"
                sublabel="4-8 Players"
                isActive={oathType === "squad"}
                onClick={() => {
                  setOathType("squad");
                  setVerificationMethod("quorum");
                  setSelectedNominee(null);
                  if (consequenceType !== "deadweight_tag" && consequenceType !== "bounty_split" && consequenceType !== "squad_lockdown") {
                    setConsequenceType("deadweight_tag");
                    setStakeAmount("");
                  }
                }}
              />
            </div>
          </div>

          {/* CONSEQUENCE TYPE */}
          <div>
            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.2em] mb-3 block">
              Consequence
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {oathType === "solo" && (
                <>
                  <TypeButton
                    icon={<DollarSign className="w-4 h-4" />}
                    label="Sandbox stake"
                    sublabel="Virtual ledger"
                    isActive={consequenceType === "fiat"}
                    onClick={() => chooseConsequence("fiat")}
                    onInfo={() => setInfoModal({ title: "Sandbox stake", desc: "A failed oath forfeits the virtual stake from the demo ledger. This build does not process payments or cash withdrawals." })}
                  />
                  <TypeButton
                    icon={<MessageSquare className="w-4 h-4" />}
                    label="Social Ransom"
                    sublabel="Not connected yet"
                    isActive={consequenceType === "social_ransom"}
                    onClick={() => showToast("SMS delivery is not configured yet; this consequence is unavailable.", "info")}
                    disabled
                    onInfo={() => setInfoModal({ title: "Social Ransom", desc: "This build has no secure staff dispatch workflow or delivery provider. OATH does not collect recipient details or claim to send messages." })}
                  />
                  <TypeButton
                    icon={<Lock className="w-3.5 h-3.5" />}
                    label="Digital Lockout"
                    sublabel="App blackout"
                    isActive={consequenceType === "app_blocking"}
                    onClick={() => handleMobileExclusive("Digital Lockout")}
                    disabled
                    onInfo={() => setInfoModal({ title: "Digital Lockout", desc: "Available on Mobile only. Locks down Instagram, TikTok, and Reddit on your OS if you fail to complete your oath." })}
                  />
                  <TypeButton
                    icon={<Flame className="w-4 h-4" />}
                    label="Anti-Charity"
                    sublabel="Not connected yet"
                    isActive={consequenceType === "anti_charity"}
                    onClick={() => showToast("Donation routing is not configured yet; this consequence is unavailable.", "info")}
                    disabled
                    onInfo={() => setInfoModal({ title: "Donation routing", desc: "A selected destination alone would not make a donation. OATH has no payment or charity-disbursement integration, so this option stays unavailable rather than implying funds were sent." })}
                  />
                  <TypeButton
                    icon={<AlertCircle className="w-4 h-4" />}
                    label="Public Shame"
                    sublabel="Wall of Shame"
                    isActive={consequenceType === "public_shame"}
                    onClick={() => chooseConsequence("public_shame")}
                    onInfo={() => setInfoModal({ title: "Public Shame", desc: "If you fail, the oath statement and failure note are published to the public Wall of Shame. No proof photo is published." })}
                  />
                </>
              )}

              {oathType === "duo" && (
                <>
                  <TypeButton
                    icon={<DollarSign className="w-4 h-4" />}
                    label="Virtual Bounty"
                    sublabel="Sandbox payout"
                    isActive={consequenceType === "bounty_transfer"}
                    onClick={() => setConsequenceType("bounty_transfer")}
                    onInfo={() => setInfoModal({ title: "Virtual bounty", desc: "Head-to-head sandbox match. The estimated virtual winner payout is the combined stake minus a 10% platform fee. No cash moves." })}
                  />
                  <TypeButton
                    icon={<Activity className="w-4 h-4" />}
                    label="Physical Debt"
                    sublabel="Not available yet"
                    isActive={consequenceType === "physical_debt"}
                    onClick={() => showToast("Physical-debt verification is not available in this build.", "info")}
                    disabled
                    onInfo={() => setInfoModal({ title: "Physical debt", desc: "Recording and verifying physical consequences is not connected in this prototype." })}
                  />
                  <TypeButton
                    icon={<Flame className="w-4 h-4" />}
                    label="M.A.D."
                    sublabel="Not available yet"
                    isActive={consequenceType === "mutual_destruction"}
                    onClick={() => showToast("Mutual-destruction settlement is not available in this build.", "info")}
                    disabled
                    onInfo={() => setInfoModal({ title: "Mutual consequence", desc: "This prototype does not support joint loss settlement. Only the virtual bounty is available for duo challenges." })}
                  />
                </>
              )}

              {oathType === "squad" && (
                <>
                  <TypeButton
                    icon={<UserX className="w-4 h-4" />}
                    label="Recovery Quest"
                    sublabel="No monetary stake"
                    isActive={consequenceType === "deadweight_tag"}
                    onClick={() => chooseConsequence("deadweight_tag")}
                    onInfo={() => setInfoModal({ title: "Recovery quest", desc: "Each member is reviewed individually by quorum. A missed oath stays in history; the member can complete a private reflection and set a new check-in before the failed badge is cleared; the failure stays in history." })}
                  />
                  <TypeButton
                    icon={<DollarSign className="w-4 h-4" />}
                    label="Individual sandbox loss"
                    sublabel="Forfeit your own virtual stake"
                    isActive={consequenceType === "fiat"}
                    onClick={() => chooseConsequence("fiat")}
                    onInfo={() => setInfoModal({ title: "Individual sandbox loss", desc: "Each member risks only their own virtual stake. If they fail, it is forfeited in the sandbox ledger; no amount is redistributed to squad winners and no real money moves." })}
                  />
                  <TypeButton
                    icon={<Lock className="w-4 h-4" />}
                    label="Squad Lockdown"
                    sublabel="Collective blackout"
                    isActive={consequenceType === "squad_lockdown"}
                    onClick={() => handleMobileExclusive("Squad Lockdown")}
                    disabled
                    onInfo={() => setInfoModal({ title: "Squad Lockdown", desc: "Mobile App Only. If ANY member fails, ALL members have their recreational apps locked for 24 hours." })}
                  />
                </>
              )}
            </div>
          </div>

          {/* STAKE & DEADLINE ROW */}
          <div className={`grid grid-cols-1 ${isFinancialConsequence ? "sm:grid-cols-2" : "sm:grid-cols-1"} gap-4`}>
            {/* STAKE AMOUNT — only shown for financial consequences */}
            {isFinancialConsequence && <div className="border-2 border-zinc-950 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950/50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
              <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.2em] mb-2 block">
                Virtual stake
              </label>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-zinc-500">{region === "in" ? "₹" : "$"}</span>
                <input
                  type="number"
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(e.target.value)}
                  placeholder="0"
                  min="0"
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
                  Balance: {formatRegionCurrency(walletBalance)}
                </span>
                {stakeNum > 0 && (
                  <span className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400">
                    House: {formatRegionCurrency(stakeNum * 0.1)}
                  </span>
                )}
              </div>
              {/* Quick stake buttons */}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {[25, 50, 100, 250, 500].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setStakeAmount(amount.toString())}
                    className={`px-3 py-1.5 text-[10px] font-mono font-bold border-2 transition-colors ${
                      stakeNum === amount
                        ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-500 dark:text-zinc-200 dark:bg-zinc-800"
                        : "border-zinc-300 text-zinc-700 hover:text-zinc-950 hover:border-zinc-500 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                    }`}
                  >
                    {formatRegionCurrency(amount)}
                  </button>
                ))}
              </div>
            </div>}

            {/* DEADLINE */}
            <div className="border-2 border-zinc-950 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950/50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
              <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.2em] mb-2 block">
                By when
              </label>
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-zinc-500" />
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full text-lg bg-transparent border-0 p-0 text-zinc-900 dark:text-zinc-200 font-bold focus:outline-none"
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
                      onClick={() => setDeadline(val)}
                      className={`px-3 py-1.5 text-[10px] font-mono font-bold border-2 transition-colors ${
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
          </div>

          {/* VERIFICATION METHOD */}
          <div>
            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.2em] mb-3 block">
              Verification
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <TypeButton
                icon={<Shield className="w-4 h-4" />}
                label="Nominee"
                sublabel="Registered user inbox"
                isActive={verificationMethod === "nominee"}
                onClick={() => { setVerificationMethod("nominee"); setSelectedNominee(null); }}
                disabled={oathType !== "solo"}
                onInfo={() => setInfoModal({ title: "Nominee verification", desc: "Choose a registered OATH user. They will receive a request in their Reviews inbox and can approve or reject it. A verdict settles this sandbox oath immediately." })}
              />
              <TypeButton
                icon={<Users className="w-4 h-4" />}
                label="Peer"
                sublabel="Opponent verifies"
                isActive={verificationMethod === "peer"}
                onClick={() => setVerificationMethod("peer")}
                disabled={oathType === "solo"}
              />
              <TypeButton
                icon={<Users className="w-4 h-4" />}
                label="Quorum"
                sublabel=">50% vote"
                isActive={verificationMethod === "quorum"}
                onClick={() => setVerificationMethod("quorum")}
                disabled={oathType !== "squad"}
              />
              <TypeButton
                icon={<Camera className="w-4 h-4" />}
                label="Solo"
                sublabel="Self report"
                isActive={verificationMethod === "solo_lonely"}
                onClick={() => setVerificationMethod("solo_lonely")}
              />
            </div>
          </div>

          {/* REGISTERED NOMINEE PICKER */}
          {verificationMethod === "nominee" && (
            <div className="border-2 border-zinc-950 dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-950/50 fade-in shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
              <label htmlFor="nominee-search" className="flex items-center gap-2 mb-3 text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.2em]">
                <Shield className="w-3.5 h-3.5" /> Choose a registered nominee
              </label>
              {selectedNominee ? (
                <div className="flex items-center justify-between gap-3 border-2 border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-3">
                  <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">@{selectedNominee.username}</span>
                  <button type="button" onClick={() => { setSelectedNominee(null); setNomineeQuery(""); }} className="min-h-11 px-3 text-[10px] font-black uppercase text-zinc-600 hover:text-red-600">Change</button>
                </div>
              ) : (
                <>
                  <input
                    id="nominee-search"
                    type="search"
                    value={nomineeQuery}
                    onChange={(event) => setNomineeQuery(event.target.value)}
                    placeholder="Search @username (at least 2 characters)"
                    autoComplete="off"
                    className="w-full min-h-11 px-3.5 py-3 text-sm border-2 border-zinc-950 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-950 dark:text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
                  />
                  {nomineeOptionsQuery === nomineeQuery && nomineeOptions.length > 0 && (
                    <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800 border-2 border-zinc-200 dark:border-zinc-800" aria-label="Registered users">
                      {nomineeOptions.map((option) => (
                        <li key={option.id}>
                          <button type="button" onClick={() => { setSelectedNominee({ id: option.id, username: option.username }); setNomineeOptions([]); }} className="min-h-11 w-full text-left px-3 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                            <span className="text-sm font-bold">@{option.username}</span>{option.display_name && <span className="ml-2 text-xs text-zinc-500">{option.display_name}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {nomineeQuery.trim().length >= 2 && nomineeOptionsQuery === nomineeQuery && nomineeOptions.length === 0 && <p className="mt-2 text-[10px] font-mono text-zinc-500">No matching registered user found yet.</p>}
                </>
              )}
              <p className="text-[10px] text-zinc-500 mt-2 font-mono">Only the selected account can see and resolve this request. No email alert is sent; they can find it in Reviews. No nominee token or contact details are exposed.</p>
            </div>
          )}

          {/* MOBILE EXCLUSIVE OPTIONS */}
          <div className="border border-zinc-800/50 p-3 bg-zinc-950/30">
            <span className="text-[9px] font-mono text-zinc-600 uppercase tracking-widest mb-2 block">
              Mobile Features
            </span>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => handleMobileExclusive("Screen Time Integration")}
                className="flex items-center gap-2 px-3 py-2 border border-zinc-800/50 text-zinc-600 hover:border-zinc-700 transition-colors"
              >
                <Smartphone className="w-3 h-3" />
                <span className="text-[10px] font-mono">Screen Time</span>
              </button>
              <button
                onClick={() => handleMobileExclusive("Camera-based Health Tracking")}
                className="flex items-center gap-2 px-3 py-2 border border-zinc-800/50 text-zinc-600 hover:border-zinc-700 transition-colors"
              >
                <Camera className="w-3 h-3" />
                <span className="text-[10px] font-mono">Health Track</span>
              </button>
              <button
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
            {oathStatement && (stakeNum > 0 || !requiresStake) && (
              <div className="mb-4 p-4 border-2 border-zinc-950 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950/80 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
                <p className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-widest mb-2">
                  Your Oath
                </p>
                <p className="text-base font-semibold text-zinc-900 dark:text-zinc-200 leading-relaxed">
                  &ldquo;I swear to{" "}
                  <span className="text-zinc-950 dark:text-zinc-50 font-black">{oathStatement}</span>
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
                  {stakeNum > 0 ? (
                    <>{" "}or I lose{" "}<span className={`font-black ${isOverBudget ? "text-red-500" : "text-zinc-950 dark:text-zinc-50"}`}>{formatRegionCurrency(stakeNum)}</span>.</>
                  ) : <> with no monetary stake.</>}
                  &rdquo;
                </p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleSubmit}
                disabled={!oathStatement.trim() || (requiresStake && stakeNum <= 0) || (stakeNum > 0 && isOverBudget) || submitting}
                className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-black tracking-tight uppercase transition-all ${
                  !oathStatement.trim() || (requiresStake && stakeNum <= 0) || (stakeNum > 0 && isOverBudget) || submitting
                    ? "bg-zinc-300 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-600 cursor-not-allowed"
                    : "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 border-2 border-zinc-950 dark:border-transparent shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                }`}
              >
                <Zap className="w-4 h-4" />
                {submitting ? "Creating..." : stakeNum > 0 ? `Lock ${formatRegionCurrency(stakeNum)} & Create Oath` : "Create Oath"}
              </button>
            </div>

            {isOverBudget && (
              <div className="flex items-center gap-2 mt-3 text-red-500 font-bold">
                <AlertCircle className="w-3.5 h-3.5" />
                <span className="text-[11px] font-mono">
                  Stake exceeds available sandbox balance. Real deposits are not available.
                </span>
              </div>
            )}
          </div>
        </div>
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
    <div className={`relative flex flex-col items-center justify-center gap-1 px-2 py-4 border-2 transition-all ${
      disabled
        ? "border-zinc-300 dark:border-zinc-800/40 text-zinc-400 dark:text-zinc-700 cursor-not-allowed opacity-50"
        : isActive
        ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-500 dark:bg-zinc-800/80 dark:text-zinc-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
        : "border-zinc-300 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200 hover:border-zinc-500 dark:hover:border-zinc-700 bg-white dark:bg-transparent"
    }`}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="absolute inset-0 w-full h-full"
      />

      {onInfo && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onInfo();
          }}
          className="absolute top-1.5 right-1.5 z-10 p-1 text-zinc-400 hover:text-zinc-950 dark:hover:text-white transition-colors"
        >
          <Info className="w-3.5 h-3.5" />
        </button>
      )}

      <div className="pointer-events-none flex flex-col items-center gap-1 z-0">
        {icon}
        <span className="text-[11px] font-bold tracking-tight text-center">{label}</span>
        <span className={`text-[9px] font-mono text-center ${isActive ? "text-zinc-300 dark:text-zinc-400" : "text-zinc-500 dark:text-zinc-600"}`}>
          {sublabel}
        </span>
      </div>
    </div>
  );
}
