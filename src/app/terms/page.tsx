import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function TermsPage() {
  return (
    <div className="min-h-[100dvh] overflow-y-auto bg-white dark:bg-[#09090b] selection:bg-red-600/30">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-16 md:py-24 fade-in">
        <Link 
          href="/" 
          className="inline-flex items-center gap-2 text-xs sm:text-sm font-mono font-bold text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors mb-6 sm:mb-12 uppercase tracking-widest min-h-[36px]"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Oath
        </Link>
        
        <h1 className="text-3xl sm:text-5xl md:text-6xl font-black text-zinc-950 dark:text-zinc-50 tracking-tighter uppercase mb-4 sm:mb-6">
          Terms of Service
        </h1>
        <div className="w-12 sm:w-16 h-1.5 sm:h-2 bg-red-600 mb-8 sm:mb-12" />

        <div className="prose prose-zinc dark:prose-invert prose-headings:font-black prose-headings:tracking-tighter prose-headings:uppercase prose-p:font-mono prose-p:text-sm prose-p:leading-relaxed prose-a:text-red-600 hover:prose-a:text-red-500 max-w-none">
          <p className="text-lg font-bold">Last Updated: September 2026</p>
          
          <h2>1. Not a Gambling Platform</h2>
          <p>
            OATH (&ldquo;The Platform&rdquo;) is strictly a productivity and habit-building application utilizing the behavioral economics concept of &ldquo;Commitment Contracts&rdquo;. The Platform does not constitute gambling, betting, wagering, or a game of chance. All stakes placed on the Platform are tied entirely to verifiable, skill-based, or effort-based personal health, productivity, and lifestyle goals. You are staking money on your own ability to complete a task, not on random outcomes or external events.
          </p>

          <h2>2. India-Safe & Legality</h2>
          <p>
            In accordance with Indian law, including but not limited to the Public Gambling Act of 1867, OATH operates legally as a platform of skill and personal effort. The outcomes of OATHs are determined entirely by the user&apos;s direct actions. We explicitly prohibit the use of our platform for games of chance or sports betting. 
          </p>
          
          <h2>3. Commitment Contracts & Stakes</h2>
          <p>
            When you create a financial OATH, you agree to place an individual financial stake in escrow along with an upfront 10% platform protocol fee. If you successfully provide verified proof of your completed goal (as verified by your designated referee, partner, or squad quorum), 100% of your locked stake is returned to your wallet balance. If you fail or forfeit, your locked stake is forfeited according to the challenge rules. Non-monetary consequences (such as Wall of Shame, Social Ransom, and Anti-Charity) are recorded on the platform&apos;s accountability ledger and held to your personal honor code; OATH does not automatically dispatch external SMS messages or wire donations to third-party organizations.
          </p>

          <h2>4. Deposits, Escrow & Withdrawals</h2>
          <p>
            Deposits are processed through verified payment gateways (PayPal and Razorpay) and credited to your OATH wallet ledger once confirmed by the payment provider. Available wallet balances (excluding funds currently locked in active OATH escrow) may be requested for withdrawal to your designated UPI or PayPal payout address and are reviewed and fulfilled by platform administrators.
          </p>

          <h2>5. Dispute Resolution & Verification</h2>
          <p>
            Proof of completion is verified by your chosen accountability partners (Nominee or Squad). The Platform acts purely as the enforcer of the contract and the escrow agent. We do not arbitrate disputes regarding the subjective quality of the proof provided. The decision made by your verification method is final and binding.
          </p>

          <h2>6. User Responsibilities</h2>
          <p>
            You agree to use OATH solely for productive, health-based, and positive lifestyle goals. You agree not to create OATHs that involve illegal activities, self-harm, harm to others, or any activity that violates local jurisdictions.
          </p>
        </div>
      </div>
    </div>
  );
}
