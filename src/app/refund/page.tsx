import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function RefundPage() {
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
          Refund Policy
        </h1>
        <div className="w-16 h-2 bg-red-600 mb-12" />

        <div className="prose prose-zinc dark:prose-invert prose-headings:font-black prose-headings:tracking-tighter prose-headings:uppercase prose-p:font-mono prose-p:text-sm prose-p:leading-relaxed prose-a:text-red-600 hover:prose-a:text-red-500 max-w-none">
          <p className="text-lg font-bold">Last Updated: September 2026</p>
          
          <h2>1. Deposits and Withdrawals</h2>
          <p>
            OATH ensures that your uncommitted funds are always yours. Any money you deposit into your OATH Wallet that is not currently locked in an active commitment contract can be withdrawn at any time. We process withdrawals back to your original payment method or designated UPI/PayPal account within 5-7 business days.
          </p>

          <h2>2. Non-Refundable Stakes (Forfeitures)</h2>
          <p>
            The core premise of OATH is accountability through financial consequence. When you voluntarily stake money on an OATH and subsequently fail to verify its completion by the deadline, your stake is permanently forfeited according to the consequence you selected (e.g., Shared Oath, Anti-Charity, Platform Penalty). <strong>Forfeited stakes are strictly non-refundable.</strong> This is the intentional design of our productivity mechanism.
          </p>
          
          <h2>3. Disputed Outcomes</h2>
          <p>
            If your Nominee or Squad maliciously or incorrectly rejects your proof, OATH cannot automatically reverse the transaction. The verification power lies entirely with the peers you selected. We strongly advise only selecting trusted individuals as Nominees or Squad members.
          </p>

          <h2>4. Technical Errors</h2>
          <p>
            If a deposit is made in error, duplicated due to network issues, or a withdrawal fails to reach your account due to a gateway error, please contact our support team. Verified technical anomalies will be refunded in full.
          </p>

          <h2>5. Platform Fees</h2>
          <p>
            The OATH Platform Fee (if applicable to your specific contract outcome) is deducted from the payout or forfeiture. This fee covers escrow maintenance, payment gateway costs, and platform operations, and is non-refundable.
          </p>
        </div>
      </div>
    </div>
  );
}
