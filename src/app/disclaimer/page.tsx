import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function DisclaimerPage() {
  return (
    <div className="h-screen overflow-y-auto bg-white dark:bg-[#09090b] selection:bg-red-600/30">
      <div className="max-w-3xl mx-auto px-6 py-16 md:py-24 fade-in">
        <Link 
          href="/" 
          className="inline-flex items-center gap-2 text-sm font-mono font-bold text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-200 transition-colors mb-12 uppercase tracking-widest"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Oath
        </Link>
        
        <h1 className="text-4xl sm:text-6xl font-black text-zinc-950 dark:text-zinc-50 tracking-tighter uppercase mb-6">
          Legal Disclaimer
        </h1>
        <div className="w-16 h-2 bg-red-600 mb-12" />

        <div className="prose prose-zinc dark:prose-invert prose-headings:font-black prose-headings:tracking-tighter prose-headings:uppercase prose-p:font-mono prose-p:text-sm prose-p:leading-relaxed prose-a:text-red-600 hover:prose-a:text-red-500 max-w-none">
          <p className="text-lg font-bold">A Productivity and Health Application.</p>
          
          <h2>1. Not a Game of Chance or Gambling</h2>
          <p>
            OATH is a behavioral health and productivity application. We explicitly state that OATH is <strong>NOT</strong> a gambling application, betting platform, or casino. No element of our platform involves wagering on external events, games of chance, or random outcomes. All financial stakes placed on OATH are &ldquo;Commitment Contracts&rdquo; tied entirely to the user&apos;s personal ability to complete self-assigned, positive lifestyle goals (e.g., fitness, studying, habit building).
          </p>

          <h2>2. India Legality & Safety</h2>
          <p>
            Operating safely under Indian law, OATH qualifies as a platform of skill and effort. The user maintains 100% control over the outcome of their stakes through their own actions and willpower. OATH is fully compliant with money safety laws, utilizing secure, registered payment gateways and non-interest-bearing escrow accounts to temporarily hold commitment stakes. We are not a bank or a financial institution.
          </p>
          
          <h2>3. No Medical or Financial Advice</h2>
          <p>
            The OATH platform is designed to motivate users but does not provide medical, psychological, or financial advice. We encourage users to set healthy, realistic goals. Do not set OATHs that involve extreme physical exertion without consulting a physician, and do not stake money you cannot afford to forfeit.
          </p>

          <h2>4. User Accountability</h2>
          <p>
            By using OATH, you acknowledge that any money lost on the platform is a result of your own failure to fulfill the terms of the commitment contract you voluntarily created. The platform acts solely as the neutral enforcer of your contract.
          </p>
        </div>
      </div>
    </div>
  );
}
