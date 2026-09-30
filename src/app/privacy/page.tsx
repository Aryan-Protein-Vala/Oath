import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPage() {
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
          Privacy Policy
        </h1>
        <div className="w-16 h-2 bg-red-600 mb-12" />

        <div className="prose prose-zinc dark:prose-invert prose-headings:font-black prose-headings:tracking-tighter prose-headings:uppercase prose-p:font-mono prose-p:text-sm prose-p:leading-relaxed prose-a:text-red-600 hover:prose-a:text-red-500 max-w-none">
          <p className="text-lg font-bold">Last Updated: September 2026</p>
          
          <h2>1. Data Collection</h2>
          <p>
            OATH collects information necessary to facilitate your commitment contracts, including your email address, phone number, and financial transaction metadata. We do not sell your personal data to third parties. We are a habit-building platform, not an advertising network.
          </p>

          <h2>2. Financial Data</h2>
          <p>
            Your payment information is securely processed by our authorized payment gateways (e.g., PayPal, Razorpay). We do not store your full credit card numbers or raw bank account credentials on our servers. Your &ldquo;Wallet&rdquo; balance merely reflects the ledger of your escrow deposits and oath outcomes.
          </p>
          
          <h2>3. Proof Submissions & Media</h2>
          <p>
            When you submit proof of your oath completion (images, videos, or text), this data is shared with your designated Nominee or Squad members for verification. Proof submissions may be temporarily retained to resolve disputes and maintain the integrity of the platform, after which they are subject to routine deletion.
          </p>

          <h2>4. Public Profiles & The Wall</h2>
          <p>
            If you select &ldquo;Public Shame&rdquo; as a consequence for your OATH, you explicitly consent to having your failure excuse, original goal, and username published publicly on the OATH platform. Your username, reputation score, and &ldquo;Duffer&rdquo; status are publicly visible on your profile to maintain platform accountability.
          </p>

          <h2>5. Third-Party Integrations</h2>
          <p>
            For features such as &ldquo;Anti-Charity&rdquo; donations, we may share minimal necessary transaction data with associated charities or automated webhooks to execute the promised donation on your behalf upon failure.
          </p>

          <h2>6. Data Deletion</h2>
          <p>
            You may request the deletion of your account at any time. Active funds in your wallet will be returned to you. However, records of completed or failed OATHs may be retained in anonymized formats for ledger integrity and legal compliance.
          </p>
        </div>
      </div>
    </div>
  );
}
