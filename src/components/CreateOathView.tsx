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
  ChevronRight,
  AlertCircle,
  Flame,
  Activity,
  UserX,
  PieChart
} from "lucide-react";
import type { OathType, VerificationMethod, ConsequenceType } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import { showToast } from "./Toast";

interface CreateOathViewProps {
  walletBalance: number;
  onOathCreated?: () => void;
}

export default function CreateOathView({ walletBalance, onOathCreated }: CreateOathViewProps) {
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
  const [step, setStep] = useState(0);

  const stakeNum = parseFloat(stakeAmount) || 0;
  const houseCut = Math.round(stakeNum * 0.1);
  const isOverBudget = stakeNum > walletBalance;

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
    setSubmitting(true);
    const { error } = await createOath({
      oath_statement: oathStatement,
      deadline: new Date(deadline).toISOString(),
      oath_type: oathType,
      verification_method: verificationMethod,
      consequence_type: consequenceType,
      stake_amount: stakeNum,
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
    <div className="flex-1 flex items-center justify-center overflow-y-auto py-8">
      <div className="w-full max-w-2xl px-6">
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-2xl font-black tracking-tight text-zinc-100 mb-1">
            CREATE AN OATH
          </h2>
          <p className="text-[11px] font-mono text-zinc-600 tracking-wide">
            Once created, your funds are locked. There is no undo.
          </p>
        </div>

        {/* ---- MAD-LIBS FORM ---- */}
        <div className="space-y-6">
          {/* THE OATH STATEMENT */}
          <div className="border border-zinc-800 p-5 bg-zinc-950/50">
            <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.2em] mb-3 block">
              I swear to
            </label>
            <textarea
              value={oathStatement}
              onChange={(e) => setOathStatement(e.target.value)}
              placeholder="Run 5km every morning for 30 days..."
              className="w-full text-xl font-bold text-zinc-100 placeholder:text-zinc-700 bg-transparent border-0 p-0 resize-none focus:ring-0 leading-relaxed"
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
                  setConsequenceType("fiat");
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
                  setConsequenceType("bounty_transfer");
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
                  setConsequenceType("deadweight_tag");
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
                  />
                  <TypeButton
                    icon={<MessageSquare className="w-4 h-4" />}
                    label="Social Ransom"
                    sublabel="Confession SMS"
                    isActive={consequenceType === "social_ransom"}
                    onClick={() => setConsequenceType("social_ransom")}
                  />
                  <TypeButton
                    icon={<Lock className="w-3.5 h-3.5" />}
                    label="Digital Lockout"
                    sublabel="App blackout"
                    isActive={consequenceType === "app_blocking"}
                    onClick={() => handleMobileExclusive("Digital Lockout")}
                    disabled
                  />
                  <TypeButton
                    icon={<Flame className="w-4 h-4" />}
                    label="Anti-Charity"
                    sublabel="Hate donation"
                    isActive={consequenceType === "anti_charity"}
                    onClick={() => setConsequenceType("anti_charity")}
                  />
                  <TypeButton
                    icon={<AlertCircle className="w-4 h-4" />}
                    label="Public Shame"
                    sublabel="Wall of Shame"
                    isActive={consequenceType === "public_shame"}
                    onClick={() => setConsequenceType("public_shame")}
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
                  />
                  <TypeButton
                    icon={<Activity className="w-4 h-4" />}
                    label="Physical Debt"
                    sublabel="Servant clause"
                    isActive={consequenceType === "physical_debt"}
                    onClick={() => setConsequenceType("physical_debt")}
                  />
                  <TypeButton
                    icon={<Flame className="w-4 h-4" />}
                    label="M.A.D."
                    sublabel="Mutual destruction"
                    isActive={consequenceType === "mutual_destruction"}
                    onClick={() => setConsequenceType("mutual_destruction")}
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
                  />
                  <TypeButton
                    icon={<PieChart className="w-4 h-4" />}
                    label="Bounty Split"
                    sublabel="Losers fund winners"
                    isActive={consequenceType === "bounty_split"}
                    onClick={() => setConsequenceType("bounty_split")}
                  />
                  <TypeButton
                    icon={<Lock className="w-4 h-4" />}
                    label="Squad Lockdown"
                    sublabel="Collective blackout"
                    isActive={consequenceType === "squad_lockdown"}
                    onClick={() => handleMobileExclusive("Squad Lockdown")}
                    disabled
                  />
                </>
              )}
            </div>
          </div>

          {/* SOCIAL RANSOM FIELDS */}
          {(consequenceType === "social_ransom") && (
            <div className="border border-zinc-800 p-4 bg-zinc-950/50 space-y-3 fade-in">
              <div className="flex items-center gap-2 mb-1">
                <Phone className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.2em]">
                  Social Ransom Target
                </span>
              </div>
              <input
                type="tel"
                value={socialPhone}
                onChange={(e) => setSocialPhone(e.target.value)}
                placeholder="Friend's phone number"
                className="w-full px-3 py-2 text-sm"
              />
              <textarea
                value={socialMessage}
                onChange={(e) => setSocialMessage(e.target.value)}
                placeholder="The embarrassing message that gets sent if you fail..."
                className="w-full px-3 py-2 text-sm resize-none"
                rows={2}
              />
            </div>
          )}

          {/* STAKE & DEADLINE ROW */}
          <div className="grid grid-cols-2 gap-3">
            {/* STAKE AMOUNT */}
            <div className="border border-zinc-800 p-4 bg-zinc-950/50">
              <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.2em] mb-2 block">
                Or I lose
              </label>
              <div className="flex items-center gap-2">
                <span className="text-2xl font-black text-zinc-500">$</span>
                <input
                  type="number"
                  value={stakeAmount}
                  onChange={(e) => setStakeAmount(e.target.value)}
                  placeholder="0"
                  min="1"
                  className="w-full text-3xl font-black text-zinc-100 bg-transparent border-0 p-0 stake-number"
                  style={{ outline: "none", border: "none" }}
                />
              </div>
              <div className="flex items-center justify-between mt-2">
                <span
                  className={`text-[10px] font-mono ${
                    isOverBudget ? "text-red-500" : "text-zinc-600"
                  }`}
                >
                  Balance: {formatCurrency(walletBalance)}
                </span>
                {stakeNum > 0 && (
                  <span className="text-[10px] font-mono text-zinc-600">
                    House: {formatCurrency(houseCut)}
                  </span>
                )}
              </div>
              {/* Quick stake buttons */}
              <div className="flex items-center gap-1.5 mt-3">
                {[25, 50, 100, 250, 500].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setStakeAmount(amount.toString())}
                    className={`px-2 py-1 text-[10px] font-mono border transition-colors ${
                      stakeNum === amount
                        ? "border-zinc-500 text-zinc-200 bg-zinc-800"
                        : "border-zinc-800 text-zinc-600 hover:text-zinc-400 hover:border-zinc-700"
                    }`}
                  >
                    ${amount}
                  </button>
                ))}
              </div>
            </div>

            {/* DEADLINE */}
            <div className="border border-zinc-800 p-4 bg-zinc-950/50">
              <label className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.2em] mb-2 block">
                By when
              </label>
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-zinc-500" />
                <input
                  type="date"
                  value={deadline}
                  onChange={(e) => setDeadline(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full text-sm bg-transparent border-0 p-0 text-zinc-200"
                  style={{ outline: "none", border: "none", colorScheme: "dark" }}
                />
              </div>
              {/* Quick deadline buttons */}
              <div className="flex items-center gap-1.5 mt-4">
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
                      className={`px-2.5 py-1 text-[10px] font-mono border transition-colors ${
                        deadline === val
                          ? "border-zinc-500 text-zinc-200 bg-zinc-800"
                          : "border-zinc-800 text-zinc-600 hover:text-zinc-400 hover:border-zinc-700"
                      }`}
                    >
                      {label}
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
            <div className="border border-zinc-800 p-4 bg-zinc-950/50 fade-in">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.2em]">
                  Nominee Email or Phone
                </span>
              </div>
              <input
                type="email"
                value={nomineeEmail}
                onChange={(e) => setNomineeEmail(e.target.value)}
                placeholder="nominee@email.com or +1234567890"
                className="w-full px-3 py-2 text-sm"
              />
              <p className="text-[10px] text-zinc-600 mt-2 font-mono">
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
          <div className="border-t border-zinc-800 pt-5">
            {/* Preview sentence */}
            {oathStatement && stakeNum > 0 && (
              <div className="mb-4 p-4 border border-zinc-800 bg-zinc-950/80">
                <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest mb-2">
                  Your Oath
                </p>
                <p className="text-base font-semibold text-zinc-200 leading-relaxed">
                  &ldquo;I swear to{" "}
                  <span className="text-zinc-50 font-bold">{oathStatement}</span>
                  {deadline && (
                    <>
                      {" "}by{" "}
                      <span className="text-zinc-50 font-bold">
                        {new Date(deadline).toLocaleDateString("en-US", {
                          month: "long",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </>
                  )}
                  {" "}or I lose{" "}
                  <span className={`font-black ${isOverBudget ? "text-red-500" : "text-zinc-50"}`}>
                    {formatCurrency(stakeNum)}
                  </span>
                  .&rdquo;
                </p>
              </div>
            )}

            <div className="flex items-center gap-3">
              <button
                onClick={handleSubmit}
                disabled={!oathStatement || stakeNum <= 0 || isOverBudget}
                className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-black tracking-tight uppercase transition-all ${
                  !oathStatement || stakeNum <= 0 || isOverBudget
                    ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                    : "bg-zinc-50 text-zinc-950 hover:bg-zinc-200"
                }`}
              >
                <Zap className="w-4 h-4" />
                Lock {formatCurrency(stakeNum)} & Create Oath
              </button>
            </div>

            {isOverBudget && (
              <div className="flex items-center gap-2 mt-3 text-red-500">
                <AlertCircle className="w-3.5 h-3.5" />
                <span className="text-[11px] font-mono">
                  Stake exceeds wallet balance. Deposit more funds.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
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
}: {
  icon: React.ReactNode;
  label: string;
  sublabel: string;
  isActive: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center gap-1 px-3 py-3 border transition-all ${
        disabled
          ? "border-zinc-800/40 text-zinc-700 cursor-not-allowed opacity-50"
          : isActive
          ? "border-zinc-500 bg-zinc-800/60 text-zinc-100"
          : "border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-700"
      }`}
    >
      {icon}
      <span className="text-[11px] font-bold tracking-tight">{label}</span>
      <span className="text-[9px] font-mono text-zinc-600">{sublabel}</span>
    </button>
  );
}
