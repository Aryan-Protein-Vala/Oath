"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { Eye, EyeOff, AlertCircle, Loader2, ArrowLeft, ShieldCheck, CheckCircle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useRouter, useSearchParams } from "next/navigation";
import { showToast } from "@/components/Toast";

export default function AuthPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#09090b]">
          <Loader2 className="w-8 h-8 animate-spin text-zinc-950 dark:text-zinc-50" />
        </div>
      }
    >
      <AuthForm />
    </Suspense>
  );
}

function AuthForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawRedirect = searchParams.get("redirect") || "/";
  const redirectUrl = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? rawRedirect : "/";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    setLoading(true);

    if (mode === "signup") {
      const cleanUsername = username.trim().toLowerCase().replace(/\s+/g, "_");
      if (cleanUsername.length < 3) {
        setError("Username must be at least 3 characters.");
        setLoading(false);
        return;
      }
      if (!/^[a-z0-9_]+$/.test(cleanUsername)) {
        setError("Username can only contain letters, numbers, and underscores.");
        setLoading(false);
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        setLoading(false);
        return;
      }

      const { error: err, confirmationRequired } = await signUp(
        email.trim(),
        password,
        cleanUsername
      );

      if (err) {
        setError(err);
        showToast(err, "error");
      } else if (confirmationRequired) {
        setInfoMessage(
          "Account created. We sent a verification email to your address. Please verify to continue."
        );
        showToast("Account created. Check your email to verify.", "success");
        setMode("signin");
      } else {
        showToast("Account created and verified! Welcome to OATH.", "success");
        router.push(redirectUrl);
      }
    } else {
      const { error: err } = await signIn(email.trim(), password);
      if (err) {
        setError(err);
        showToast(err, "error");
      } else {
        showToast("Welcome back.", "success");
        router.push(redirectUrl);
      }
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 px-4 sm:px-6 py-8 sm:py-12 transition-colors duration-300">
      <div className="noise-overlay" aria-hidden="true" />
      <div className="scanline-overlay" aria-hidden="true" />

      <div className="w-full max-w-sm fade-in bg-white dark:bg-[#09090b] p-6 sm:p-8 border-4 border-zinc-950 dark:border-zinc-800 shadow-[8px_8px_0px_0px_rgba(9,9,11,1)] dark:shadow-none">
        {/* Navigation Back */}
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 transition-colors uppercase tracking-wider"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Dashboard
          </Link>
          <div className="flex items-center gap-1 text-[10px] font-mono text-zinc-500 uppercase tracking-widest font-bold">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Secure Auth
          </div>
        </div>

        {/* Brand */}
        <div className="mb-6 text-center">
          <h1 className="text-3xl sm:text-4xl font-black tracking-[-0.08em] text-zinc-950 dark:text-zinc-50">OATH</h1>
          <p className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 tracking-[0.25em] uppercase mt-1">
            Stake everything.
          </p>
        </div>

        {/* Toggle */}
        <div className="flex border-4 border-zinc-950 dark:border-zinc-800 mb-6 bg-zinc-100 dark:bg-[#09090b] p-1 shadow-[inset_4px_4px_0px_0px_rgba(0,0,0,0.05)] dark:shadow-none">
          <button
            type="button"
            onClick={() => {
              setMode("signin");
              setError(null);
              setInfoMessage(null);
            }}
            className={`flex-1 py-2.5 text-[11px] font-black uppercase tracking-widest transition-all ${
              mode === "signin"
                ? "bg-zinc-950 text-white dark:bg-zinc-800/80 dark:text-zinc-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] dark:shadow-none"
                : "text-zinc-500 hover:text-zinc-950 dark:text-zinc-500 dark:hover:text-zinc-300"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("signup");
              setError(null);
              setInfoMessage(null);
            }}
            className={`flex-1 py-2.5 text-[11px] font-black uppercase tracking-widest transition-all ${
              mode === "signup"
                ? "bg-zinc-950 text-white dark:bg-zinc-800/80 dark:text-zinc-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] dark:shadow-none"
                : "text-zinc-500 hover:text-zinc-950 dark:text-zinc-500 dark:hover:text-zinc-300"
            }`}
          >
            Create Account
          </button>
        </div>

        {/* Informational Message */}
        {infoMessage && (
          <div className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-950/40 border-2 border-emerald-600 text-emerald-800 dark:text-emerald-300 text-xs font-mono font-bold flex items-start gap-2">
            <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
            <span>{infoMessage}</span>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/40 border-2 border-red-600 text-red-700 dark:text-red-300 text-xs font-mono font-bold flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Username (signup only) */}
          {mode === "signup" && (
            <div className="fade-in">
              <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.15em] mb-1.5 block">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="iron_will"
                className="w-full px-3.5 py-3 text-sm font-medium border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 focus:border-red-600 dark:focus:border-zinc-500 outline-none transition-colors text-zinc-950 dark:text-zinc-50 shadow-[3px_3px_0px_0px_rgba(9,9,11,1)] dark:shadow-none"
                autoComplete="username"
                required
              />
            </div>
          )}

          {/* Email */}
          <div>
            <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.15em] mb-1.5 block">
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@domain.com"
              className="w-full px-3.5 py-3 text-sm font-medium border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 focus:border-red-600 dark:focus:border-zinc-500 outline-none transition-colors text-zinc-950 dark:text-zinc-50 shadow-[3px_3px_0px_0px_rgba(9,9,11,1)] dark:shadow-none"
              autoComplete="email"
              required
            />
          </div>

          {/* Password */}
          <div>
            <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 uppercase tracking-[0.15em] mb-1.5 block">
              Password {mode === "signup" && <span className="text-[9px] text-zinc-400">(min 8 chars)</span>}
            </label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-3 pr-11 text-sm font-medium border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 focus:border-red-600 dark:focus:border-zinc-500 outline-none transition-colors text-zinc-950 dark:text-zinc-50 shadow-[3px_3px_0px_0px_rgba(9,9,11,1)] dark:shadow-none"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors p-1"
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 px-4 bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 font-black text-xs uppercase tracking-widest hover:bg-zinc-800 dark:hover:bg-zinc-200 active:translate-x-0.5 active:translate-y-0.5 transition-all flex items-center justify-center gap-2 border-2 border-zinc-950 dark:border-zinc-100 shadow-[4px_4px_0px_0px_rgba(9,9,11,1)] dark:shadow-none disabled:opacity-60 disabled:pointer-events-none mt-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processing...</span>
              </>
            ) : mode === "signin" ? (
              "Sign In to Escrow"
            ) : (
              "Create Account & Join"
            )}
          </button>
        </form>

        {/* Footer info */}
        <div className="mt-6 pt-4 border-t border-zinc-200 dark:border-zinc-800 text-center">
          <p className="text-[10px] text-zinc-500 font-mono">
            By signing in, you agree to Oath&apos;s{" "}
            <Link href="/terms" className="underline hover:text-zinc-950 dark:hover:text-zinc-200">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="underline hover:text-zinc-950 dark:hover:text-zinc-200">
              Privacy Policy
            </Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
