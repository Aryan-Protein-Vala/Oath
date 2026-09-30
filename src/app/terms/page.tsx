import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-white dark:bg-[#09090b] selection:bg-red-600/30">
      <div className="max-w-3xl mx-auto px-6 py-16 md:py-24 fade-in">
        <Link 
          href="/" 
          className="inline-flex items-center gap-2 text-sm font-mono font-bold text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors mb-12 uppercase tracking-widest"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Oath
        </Link>
        
        <h1 className="text-4xl sm:text-6xl font-black text-zinc-950 dark:text-zinc-50 tracking-tighter uppercase mb-6">
          Terms of Service
        </h1>
        <div className="w-16 h-2 bg-red-600 mb-12" />

        <div className="prose prose-zinc dark:prose-invert prose-headings:font-black prose-headings:tracking-tighter prose-headings:uppercase prose-p:font-mono prose-p:text-sm prose-p:leading-relaxed prose-a:text-red-600 hover:prose-a:text-red-500 max-w-none">
          <p className="text-lg font-bold">Last Updated: September 2026</p>
          
          <h2>1. Not a Gambling Platform</h2>
          <p>
            OATH ("The Platform") is strictly a productivity and habit-building application utilizing the behavioral economics concept of "Commitment Contracts". The Platform does not constitute gambling, betting, wagering, or a game of chance. All stakes placed on the Platform are tied entirely to verifiable, skill-based, or effort-based personal health, productivity, and lifestyle goals. You are staking money on your own ability to complete a task, not on random outcomes or external events.
          </p>

          <h2>2. India-Safe & Legality</h2>
          <p>
            In accordance with Indian law, including but not limited to the Public Gambling Act of 1867, OATH operates legally as a platform of skill and personal effort. The outcomes of OATHs are determined entirely by the user's direct actions. We explicitly prohibit the use of our platform for games of chance or sports betting. 
          </p>
          
          <h2>3. Commitment Contracts & Stakes</h2>
          <p>
            When you create an OATH, you agree to place a financial stake in escrow. This stake serves as a commitment device. If you successfully provide verified proof of your completed goal (as verified by your designated peers or nominees), your stake is returned to you. If you fail to complete your goal, you voluntarily forfeit your stake. A portion of forfeited stakes is retained by the Platform ("Oath Platform Fee"), and the remainder may be distributed to your accountability partners ("Shared Oath") or an Anti-Charity of your choice, depending on the contract terms you selected.
          </p>

          <h2>4. Money Safety & Escrow</h2>
          <p>
            All funds deposited into the Platform are held securely in non-interest-bearing escrow accounts. We employ enterprise-grade payment gateways to ensure the secure processing of your deposits and withdrawals. Your funds are only accessible to you for withdrawal or when explicitly locked into an active OATH.
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
