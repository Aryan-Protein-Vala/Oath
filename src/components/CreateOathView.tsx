"use client";

import { useState } from "react";
import { createOath } from "@/lib/data-hooks";
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
  const [socialPhone, setSocialPhone] = useState("");
  const [socialMessage, setSocialMessage] = useState("");
  const [nomineeEmail, setNomineeEmail] = useState("");
  const [infoModal, setInfoModal] = useState<{ title: string; desc: string } | null>(null);

  const stakeNum = parseFloat(stakeAmount) || 0;
  const stakeUsd = convertToUSD(stakeNum, region);
  const isOverBudget = stakeUsd > walletBalance;

  // Handle mobile-exclusive features
  const handleMobileExclusive = (feature: string) => {
    showToast(`${feature} — Available only on mobile app.`, "error", 5000);
  };

  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!oathStatement.trim()) {
      showToast("You need to swear to something.", "error");
      return;
    }
    if (stakeNum <= 0) {
      showToast("No stake, no oath. Put something on the line.", "error");
      return;
    }
    if (isOverBudget) {
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
    if (deadlineDate.getTime() <= Date.now()) {
      showToast("Deadline must be in the future.", "error");
      return;
    }
    if (verificationMethod === "nominee" && !nomineeEmail.trim()) {
      showToast("Please provide the nominee referee email.", "error");
      return;
    }
    if (consequenceType === "social_ransom" && (!socialPhone.trim() || !socialMessage.trim())) {
      showToast("Social ransom requires both a recipient phone number and a ransom message.", "error");
      return;
    }

    setSubmitting(true);
    const { error } = await createOath({
      oath_statement: oathStatement,
      deadline: deadlineDate.toISOString(),
      oath_type: oathType,
      verification_method: verificationMethod,
      consequence_type: consequenceType,
      stake_amount: stakeUsd,
      nominee_email: nomineeEmail || undefined,
      social_ransom_phone: socialPhone || undefined,
      social_ransom_message: socialMessage || undefined,
      min_players: oathType === "squad" ? 5 : 1,
      max_players: oathType === "squad" ? 8 : 1,
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
    <div className="flex-1 overflow-y-auto py-8 sm:py-12 px-4 sm:px-6 relative">
      <div className="w-full max-w-2xl mx-auto pb-32">
        {/* Header */}
        <div className="mb-8 text-center sm:text-left">
          <h2 className="text-3xl font-black tracking-tight text-zinc-950 dark:text-zinc-100 mb-2 uppercase">
            Create an Oath
          </h2>
          <p className="text-xs font-mono text-zinc-600 dark:text-zinc-400 tracking-wide border-2 border-zinc-300 dark:border-zinc-800 p-2 inline-block bg-white dark:bg-zinc-900">
            WARNING: ONCE CREATED, FUNDS ARE LOCKED. NO UNDO.
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
                  if (consequenceType !== "fiat" && consequenceType !== "bounty_transfer" && consequenceType !== "physical_debt" && consequenceType !== "mutual_destruction") {
                    setConsequenceType("bounty_transfer");
                  }
                }}
              />
              <TypeButton
                icon={<Users className="w-4 h-4" />}
                label="Squad"
                sublabel="5-8 Players"
                isActive={oathType === "squad"}
                onClick={() => {
                  setOathType("squad");
                  setVerificationMethod("quorum");
                  if (consequenceType !== "fiat" && consequenceType !== "deadweight_tag" && consequenceType !== "bounty_split" && consequenceType !== "squad_lockdown") {
                    setConsequenceType("deadweight_tag");
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
                    label="Fiat"
                    sublabel="Lose money"
                    isActive={consequenceType === "fiat"}
                    onClick={() => setConsequenceType("fiat")}
                    onInfo={() => setInfoModal({ title: "Fiat Consequence", desc: "If you fail, the house takes a 10% cut of your locked stake, and the remaining 90% is burned forever. Hard financial loss." })}
                  />
                  <TypeButton
                    icon={<MessageSquare className="w-4 h-4" />}
                    label="Social Ransom"
                    sublabel="Confession SMS"
                    isActive={consequenceType === "social_ransom"}
                    onClick={() => setConsequenceType("social_ransom")}
                    onInfo={() => setInfoModal({ title: "Social Ransom", desc: "You write an embarrassing confession and provide a friend/boss's phone number. If you fail, we automatically text it to them." })}
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
                </>
              )}

              {oathType === "duo" && (
                <>
                  <TypeButton
                    icon={<DollarSign className="w-4 h-4" />}
                    label="Direct Bounty"
                    sublabel="Winner takes all"
                    isActive={consequenceType === "bounty_transfer"}
                    onClick={() => setConsequenceType("bounty_transfer")}
                    onInfo={() => setInfoModal({ title: "Direct Bounty", desc: "Head-to-head match. If you fail, your entire locked stake is transferred directly to your opponent's wallet." })}
                  />
                  <TypeButton
                    icon={<Activity className="w-4 h-4" />}
                    label="Physical Debt"
                    sublabel="Servant clause"
                    isActive={consequenceType === "physical_debt"}
                    onClick={() => setConsequenceType("physical_debt")}
                    onInfo={() => setInfoModal({ title: "Physical Debt", desc: "The loser must record themselves doing 100 burpees or buying the winner a meal, verified by the winner." })}
                  />
                  <TypeButton
                    icon={<Flame className="w-4 h-4" />}
                    label="M.A.D."
                    sublabel="Mutual destruction"
                    isActive={consequenceType === "mutual_destruction"}
                    onClick={() => setConsequenceType("mutual_destruction")}
                    onInfo={() => setInfoModal({ title: "Mutual Assured Destruction", desc: "If EITHER of you fail the oath, BOTH of your stakes are completely seized by the house." })}
                  />
                </>
              )}

              {oathType === "squad" && (
                <>
                  <TypeButton
                    icon={<UserX className="w-4 h-4" />}
                    label="Deadweight Tag"
                    sublabel="Public squad tag"
                    isActive={consequenceType === "deadweight_tag"}
                    onClick={() => setConsequenceType("deadweight_tag")}
                    onInfo={() => setInfoModal({ title: "The Deadweight Tag", desc: "Whoever breaks the squad's streak gets permanently tagged with 'Deadweight' on their public profile." })}
                  />
                  <TypeButton
                    icon={<PieChart className="w-4 h-4" />}
                    label="Bounty Split"
                    sublabel="Losers fund winners"
                    isActive={consequenceType === "bounty_split"}
                    onClick={() => setConsequenceType("bounty_split")}
                    onInfo={() => setInfoModal({ title: "The Bounty Split", desc: "All losers forfeit their stakes, which are pooled and distributed equally to those who completed the oath." })}
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

          {/* STAKE & DEADLINE ROW */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* STAKE AMOUNT */}
            <div className="border-2 border-zinc-950 dark:border-zinc-800 p-4 bg-white dark:bg-zinc-950/50 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
              <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.2em] mb-2 block">
                Or I lose
              </label>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-zinc-500">{region === "in" ? "₹" : "$"}</span>
                <input
                  type="number"
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
            </div>

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
                sublabel="Third party"
                isActive={verificationMethod === "nominee"}
                onClick={() => setVerificationMethod("nominee")}
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
                sublabel="Photo proof"
                isActive={verificationMethod === "solo_lonely"}
                onClick={() => setVerificationMethod("solo_lonely")}
              />
            </div>
          </div>

          {/* NOMINEE INPUT */}
          {verificationMethod === "nominee" && (
            <div className="border-2 border-zinc-950 dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-950/50 fade-in shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
              <div className="flex items-center gap-2 mb-3">
                <Shield className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-500 uppercase tracking-[0.2em]">
                  Nominee Email or Phone
                </span>
              </div>
              <input
                type="email"
                value={nomineeEmail}
                onChange={(e) => setNomineeEmail(e.target.value)}
                placeholder="nominee@email.com or +1234567890"
                className="w-full px-3.5 py-3 text-sm border-2 border-zinc-950 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-zinc-950 dark:text-zinc-100 placeholder:text-zinc-500 dark:placeholder:text-zinc-400 focus:outline-none transition-colors"
              />
              <p className="text-[10px] font-bold text-zinc-500 mt-2.5 font-mono">
                They&apos;ll receive a unique link to verify or enforce penalty.
              </p>
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
            {oathStatement && stakeNum > 0 && (
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
                  {" "}or I lose{" "}
                  <span className={`font-black ${isOverBudget ? "text-red-500" : "text-zinc-950 dark:text-zinc-50"}`}>
                    {formatRegionCurrency(stakeNum)}
                  </span>
                  .&rdquo;
                </p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleSubmit}
                disabled={!oathStatement || stakeNum <= 0 || isOverBudget || submitting}
                className={`flex-1 flex items-center justify-center gap-2 py-4 text-sm font-black tracking-tight uppercase transition-all ${
                  !oathStatement || stakeNum <= 0 || isOverBudget || submitting
                    ? "bg-zinc-300 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-600 cursor-not-allowed"
                    : "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950 hover:bg-zinc-800 dark:hover:bg-zinc-200 border-2 border-zinc-950 dark:border-transparent shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                }`}
              >
                <Zap className="w-4 h-4" />
                {submitting ? "Locking Escrow..." : `Lock ${formatRegionCurrency(stakeNum)} & Create Oath`}
              </button>
            </div>

            {isOverBudget && (
              <div className="flex items-center gap-2 mt-3 text-red-500 font-bold">
                <AlertCircle className="w-3.5 h-3.5" />
                <span className="text-[11px] font-mono">
                  Stake exceeds wallet balance. Deposit more funds.
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
