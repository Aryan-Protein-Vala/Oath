"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useAuth } from "@/lib/auth-context";
import {
  ArrowLeft,
  Bug,
  Flame,
  AlertTriangle,
  Send,
  Loader2,
  Sun,
  Moon,
  Sparkles,
  HelpCircle,
  ShieldAlert,
  Terminal,
  CheckCircle2,
} from "lucide-react";

const CONTACT_EMAIL = "aryansharma24112003@gmail.com";

const CATEGORIES = [
  {
    value: "critical_bug",
    label: "💥 Critical Bug: The app broke and it's not a skill issue",
    prefix: "[BUG]",
  },
  {
    value: "wallet_escrow",
    label: "💸 Balance & Escrow: My virtual coins vanished into the void",
    prefix: "[WALLET]",
  },
  {
    value: "mobile_ui",
    label: "📱 Mobile / UI Glitch: A button or layout ran off screen",
    prefix: "[UI]",
  },
  {
    value: "verification_proof",
    label: "👁️ Nominee & Proof: Verification or voting went rogue",
    prefix: "[VERIFY]",
  },
  {
    value: "auth_account",
    label: "🔐 Login & Profile: Username, Google auth or session headache",
    prefix: "[AUTH]",
  },
  {
    value: "feature_idea",
    label: "💡 Psychotic Feature Idea: How to make Oath even more brutal",
    prefix: "[IDEA]",
  },
  {
    value: "beta_roast",
    label: "🤬 Beta Roast: I failed an oath and need someone to blame",
    prefix: "[ROAST]",
  },
  {
    value: "security_exploit",
    label: "🕵️ Exploit / Security: I found a glitch (please don't ban me)",
    prefix: "[EXPLOIT]",
  },
  {
    value: "other",
    label: "🤷 Other Weird Nonsense: Something else is fundamentally broken",
    prefix: "[MISC]",
  },
];

type SeverityLevel = "mild" | "high" | "nuclear";

export default function ContactPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("critical_bug");
  const [severity, setSeverity] = useState<SeverityLevel>("high");
  const [oathId, setOathId] = useState("");
  const [message, setMessage] = useState("");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Pre-fill profile info if user is logged in
  useEffect(() => {
    if (profile?.username && !name) {
      setName(`@${profile.username}`);
    }
    if (user?.email && !email) {
      setEmail(user.email);
    }
  }, [profile, user, name, email]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!name.trim()) {
      setErrorMessage("Tell us who you are (handle or name). No faceless phantoms.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setErrorMessage("Enter a valid email so our team can roast/reply back to you.");
      return;
    }
    if (!message.trim() || message.trim().length < 10) {
      setErrorMessage("Message is too short. Describe the tragedy in at least 10 characters.");
      return;
    }

    setLoading(true);

    const diagnostics = includeDiagnostics
      ? {
          url: typeof window !== "undefined" ? window.location.href : "unknown",
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "unknown",
          screenSize:
            typeof window !== "undefined"
              ? `${window.innerWidth}x${window.innerHeight}`
              : "unknown",
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          timestamp: new Date().toISOString(),
        }
      : null;

    const selectedCategory = CATEGORIES.find((c) => c.value === category);
    const subjectLine = `[OATH BETA ${selectedCategory?.prefix || "[FEEDBACK]"}] ${name} - ${severity.toUpperCase()} PRIORITY`;

    const payload: Record<string, string> = {
      name: name.trim(),
      email: email.trim(),
      category: selectedCategory?.label || category,
      severity: severity.toUpperCase(),
      oath_id: oathId.trim() || "N/A",
      message: message.trim(),
      _subject: subjectLine,
      _template: "table",
      _captcha: "false",
    };

    if (diagnostics) {
      payload.diagnostics = JSON.stringify(diagnostics, null, 2);
    }

    try {
      // Primary: FormSubmit AJAX endpoint for seamless SPA transition to confirmation page
      const response = await fetch(`https://formsubmit.co/ajax/${CONTACT_EMAIL}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        // Successfully submitted via FormSubmit
        router.push("/contact/success");
        return;
      }

      // If AJAX failed, fallback to native form submission
      if (formRef.current) {
        formRef.current.submit();
        return;
      }

      throw new Error("FormSubmit did not accept transmission.");
    } catch {
      // Native fallback
      if (formRef.current) {
        formRef.current.submit();
      } else {
        setLoading(false);
        setErrorMessage(
          "Transmission interrupted by the void. Please check your internet or retry."
        );
      }
    }
  };

  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="min-h-[100dvh] w-full bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 overflow-y-auto selection:bg-red-500/30 font-sans transition-colors duration-300">
      {/* Top Navbar */}
      <nav className="w-full border-b-2 sm:border-b-4 border-zinc-950 dark:border-zinc-800 bg-white/95 dark:bg-[#09090b]/95 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center justify-between h-14 sm:h-18 px-4 sm:px-6 max-w-5xl mx-auto w-full">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 border-2 border-zinc-950 dark:border-zinc-800 text-xs sm:text-sm font-mono font-black uppercase tracking-wider text-zinc-950 dark:text-zinc-100 bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none hover:-translate-y-0.5 active:translate-y-0 transition-all"
          >
            <ArrowLeft className="w-4 h-4 text-red-600" />
            <span>Back to Dashboard</span>
          </Link>

          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-xl font-black tracking-tighter text-zinc-950 dark:text-zinc-50">
                OATH
              </span>
              <span className="px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-widest bg-red-500 text-white border border-red-600">
                BETA HQ
              </span>
            </div>

            {mounted && (
              <button
                type="button"
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                className="p-2 border-2 border-zinc-950 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                aria-label="Toggle theme"
              >
                {resolvedTheme === "dark" ? (
                  <Sun className="w-4 h-4 text-zinc-300" />
                ) : (
                  <Moon className="w-4 h-4 text-zinc-800" />
                )}
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Main Container */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-14">
        {/* Hero Header */}
        <div className="mb-8 sm:mb-12">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 text-[10px] sm:text-xs font-mono font-black tracking-widest uppercase text-red-600 dark:text-red-400 border-2 border-red-600 dark:border-red-500/40 bg-red-50 dark:bg-red-950/20 mb-4 shadow-[2px_2px_0px_0px_rgba(220,38,38,1)] dark:shadow-none">
            <Bug className="w-3.5 h-3.5" /> BETA FEEDBACK & BUG REPORT HQ
          </div>

          <h1 className="text-3xl sm:text-5xl md:text-6xl font-black tracking-tight uppercase leading-[0.95] text-zinc-950 dark:text-zinc-50 mb-3 sm:mb-4">
            BREAK OUR APP? <br />
            <span className="text-red-600 dark:text-red-500 underline decoration-4 underline-offset-4">
              CRY TO THE DEVS.
            </span>
          </h1>

          <p className="text-xs sm:text-sm md:text-base font-mono font-medium text-zinc-700 dark:text-zinc-300 leading-relaxed max-w-2xl">
            Welcome to the Beta version of Oath. Everything is high-stakes, including our
            codebase. Hit a game-breaking glitch? Did your virtual coins go missing? Or do you just want to
            roast our design decisions? Spill the tea below and our caffeinated code monkeys will investigate.
          </p>

          {/* Quick Info Badges */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-6">
            <div className="p-3 border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none flex items-center gap-2.5">
              <Terminal className="w-4 h-4 text-red-600 shrink-0" />
              <div className="text-[10px] font-mono leading-tight">
                <span className="font-black uppercase block">BETA RELEASE v0.2</span>
                <span className="text-zinc-500">Live test flight with real humans</span>
              </div>
            </div>

            <div className="p-3 border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none flex items-center gap-2.5">
              <Flame className="w-4 h-4 text-amber-500 shrink-0" />
              <div className="text-[10px] font-mono leading-tight">
                <span className="font-black uppercase block">RESPONSE SPEED</span>
                <span className="text-zinc-500">Faster than your morning routine</span>
              </div>
            </div>

            <div className="p-3 border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none flex items-center gap-2.5">
              <ShieldAlert className="w-4 h-4 text-emerald-600 shrink-0" />
              <div className="text-[10px] font-mono leading-tight">
                <span className="font-black uppercase block">ZERO EXCUSES</span>
                <span className="text-zinc-500">All submissions read by humans</span>
              </div>
            </div>
          </div>
        </div>

        {/* Error Alert if any */}
        {errorMessage && (
          <div className="mb-6 p-4 border-2 border-red-600 bg-red-500 text-white font-mono text-xs font-bold flex items-center gap-3 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <div className="flex-1">{errorMessage}</div>
          </div>
        )}

        {/* The Brutalist Form */}
        <div className="border-4 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-[#0a0a0f] p-5 sm:p-8 md:p-10 shadow-[8px_8px_0px_0px_rgba(9,9,11,1)] dark:shadow-none">
          <div className="flex items-center justify-between border-b-2 border-zinc-950 dark:border-zinc-800 pb-4 mb-6">
            <div>
              <span className="text-[10px] font-mono font-black text-red-600 dark:text-red-500 uppercase tracking-widest block">
                INCIDENT FORM
              </span>
              <h2 className="text-xl sm:text-2xl font-black uppercase text-zinc-950 dark:text-zinc-50">
                DISPATCH A TICKET
              </h2>
            </div>
            <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase border border-zinc-300 dark:border-zinc-800 px-2 py-1">
              ENCRYPTED DISPATCH
            </span>
          </div>

          <form
            ref={formRef}
            action={`https://formsubmit.co/${CONTACT_EMAIL}`}
            method="POST"
            onSubmit={handleSubmit}
            className="space-y-6"
          >
            {/* Native FormSubmit Hidden Configuration */}
            <input
              type="hidden"
              name="_next"
              value={`${currentOrigin}/contact/success`}
            />
            <input
              type="hidden"
              name="_subject"
              value={`[OATH BETA] ${name || "Anonymous"} - ${category}`}
            />
            <input type="hidden" name="_captcha" value="false" />
            <input type="hidden" name="_template" value="table" />
            <input
              type="text"
              name="_honey"
              style={{ display: "none" }}
              tabIndex={-1}
              autoComplete="off"
            />

            {/* Row 1: Category Dropdown */}
            <div>
              <label
                htmlFor="category-select"
                className="block text-xs font-mono font-black uppercase text-zinc-900 dark:text-zinc-100 tracking-wider mb-2"
              >
                1. What is your emergency? (Select Category){" "}
                <span className="text-red-600">*</span>
              </label>
              <div className="relative">
                <select
                  id="category-select"
                  name="category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full py-3.5 px-4 font-mono font-bold text-xs sm:text-sm border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-950 dark:text-zinc-50 focus:border-red-600 dark:focus:border-red-500 focus:outline-none shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-none appearance-none cursor-pointer"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-4 text-zinc-950 dark:text-zinc-300 font-black font-mono">
                  ▼
                </div>
              </div>
              <p className="text-[10px] font-mono text-zinc-500 mt-1.5">
                Pick the category that best describes your digital suffering.
              </p>
            </div>

            {/* Row 2: Name & Email */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label
                  htmlFor="contact-name"
                  className="block text-xs font-mono font-black uppercase text-zinc-900 dark:text-zinc-100 tracking-wider mb-2"
                >
                  2. Who are you? (@handle or name){" "}
                  <span className="text-red-600">*</span>
                </label>
                <input
                  id="contact-name"
                  type="text"
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. @iron_warrior or Anonymous Crybaby"
                  className="w-full py-3 px-4 font-mono font-bold text-xs sm:text-sm border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-950 dark:text-zinc-50 focus:border-red-600 dark:focus:border-red-500 focus:outline-none shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                  required
                />
              </div>

              <div>
                <label
                  htmlFor="contact-email"
                  className="block text-xs font-mono font-black uppercase text-zinc-900 dark:text-zinc-100 tracking-wider mb-2"
                >
                  3. Where can we reply? (Email){" "}
                  <span className="text-red-600">*</span>
                </label>
                <input
                  id="contact-email"
                  type="email"
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. slacker@discipline.org"
                  className="w-full py-3 px-4 font-mono font-bold text-xs sm:text-sm border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-950 dark:text-zinc-50 focus:border-red-600 dark:focus:border-red-500 focus:outline-none shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                  required
                />
              </div>
            </div>

            {/* Row 3: Severity Level & Oath ID */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-xs font-mono font-black uppercase text-zinc-900 dark:text-zinc-100 tracking-wider mb-2">
                  4. Severity / Meltdown Index
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setSeverity("mild")}
                    className={`py-2 px-1 text-[10px] font-mono font-black uppercase border-2 text-center transition-all ${
                      severity === "mild"
                        ? "border-emerald-600 bg-emerald-600 text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                        : "border-zinc-950 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    🟢 Mild
                  </button>
                  <button
                    type="button"
                    onClick={() => setSeverity("high")}
                    className={`py-2 px-1 text-[10px] font-mono font-black uppercase border-2 text-center transition-all ${
                      severity === "high"
                        ? "border-amber-600 bg-amber-600 text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                        : "border-zinc-950 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    🟡 Annoying
                  </button>
                  <button
                    type="button"
                    onClick={() => setSeverity("nuclear")}
                    className={`py-2 px-1 text-[10px] font-mono font-black uppercase border-2 text-center transition-all ${
                      severity === "nuclear"
                        ? "border-red-600 bg-red-600 text-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                        : "border-zinc-950 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400"
                    }`}
                  >
                    🔴 Nuclear
                  </button>
                </div>
              </div>

              <div>
                <label
                  htmlFor="contact-oath-id"
                  className="block text-xs font-mono font-black uppercase text-zinc-900 dark:text-zinc-100 tracking-wider mb-2"
                >
                  5. Crime Scene ID (Oath or Lobby ID)
                </label>
                <input
                  id="contact-oath-id"
                  type="text"
                  name="oath_id"
                  value={oathId}
                  onChange={(e) => setOathId(e.target.value)}
                  placeholder="e.g. 7c91-44b2 or leave blank"
                  className="w-full py-3 px-4 font-mono font-bold text-xs sm:text-sm border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-950 dark:text-zinc-50 focus:border-red-600 dark:focus:border-red-500 focus:outline-none shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                />
              </div>
            </div>

            {/* Row 4: Message */}
            <div>
              <label
                htmlFor="contact-message"
                className="block text-xs font-mono font-black uppercase text-zinc-900 dark:text-zinc-100 tracking-wider mb-2"
              >
                6. Spill The Evidence (Be as dramatic as needed){" "}
                <span className="text-red-600">*</span>
              </label>
              <textarea
                id="contact-message"
                name="message"
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Explain what happened. What were you doing when the screen froze? Did your nominee betray you? Did a button disappear on mobile? Be specific so we don't have to guess."
                className="w-full py-3 px-4 font-mono font-medium text-xs sm:text-sm border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-950 dark:text-zinc-50 focus:border-red-600 dark:focus:border-red-500 focus:outline-none shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-none leading-relaxed"
                required
              />
              <div className="flex items-center justify-between mt-1 text-[10px] font-mono text-zinc-500">
                <span>The more detail you give, the faster the fix.</span>
                <span>{message.length} chars</span>
              </div>
            </div>

            {/* Row 5: Diagnostics Checkbox */}
            <div className="p-3 border-2 border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950/60 flex items-start gap-3">
              <input
                id="diag-check"
                type="checkbox"
                checked={includeDiagnostics}
                onChange={(e) => setIncludeDiagnostics(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-red-600 cursor-pointer"
              />
              <label
                htmlFor="diag-check"
                className="text-xs font-mono text-zinc-700 dark:text-zinc-300 cursor-pointer select-none"
              >
                <span className="font-bold text-zinc-950 dark:text-zinc-100">
                  Include browser & device telemetry
                </span>{" "}
                (Auto-attaches screen size, OS, and user agent so developers don't have to interrogate you).
              </label>
            </div>

            {/* Action Buttons */}
            <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
              <button
                type="submit"
                disabled={loading}
                className="w-full sm:flex-1 py-4 px-6 bg-red-600 hover:bg-red-700 text-white font-black text-xs sm:text-sm uppercase tracking-widest transition-all border-2 sm:border-4 border-zinc-950 dark:border-zinc-100 shadow-[5px_5px_0px_0px_rgba(0,0,0,1)] dark:shadow-none hover:shadow-[7px_7px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>TRANSMITTING TO WAR ROOM...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>DISPATCH TICKET TO THE DEVS 💥</span>
                  </>
                )}
              </button>

              <Link
                href="/"
                className="w-full sm:w-auto py-4 px-6 border-2 sm:border-4 border-zinc-950 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 font-mono font-bold text-xs sm:text-sm uppercase tracking-wider hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors text-center shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
              >
                Cancel & Return
              </Link>
            </div>
          </form>
        </div>

        {/* Funny Beta Disclaimer Card */}
        <div className="mt-8 p-5 border-2 border-zinc-950 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900/30 text-zinc-700 dark:text-zinc-400 font-mono text-xs leading-relaxed">
          <div className="flex items-center gap-2 font-black uppercase text-zinc-950 dark:text-zinc-200 mb-1">
            <Sparkles className="w-4 h-4 text-amber-500" />
            <span>THE BETA COVENANT</span>
          </div>
          <p>
            Submitting a fake bug report to escape losing an active oath or avoid forfeiture will
            result in your profile being publicly shamed on the Wall of Shame. Our automated
            auditor checks server logs before issuing refunds. Be honest, stay ruthless, and keep
            swearing by your oaths.
          </p>
        </div>
      </main>
    </div>
  );
}
