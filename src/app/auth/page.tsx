"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Zap, AlertCircle, Loader2, ArrowLeft, Shield } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";

export default function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { signIn, signUp } = useAuth();
  const router = useRouter();

  const handleDemoFill = () => {
    setMode("signin");
    setEmail(process.env.NEXT_PUBLIC_ADMIN_EMAIL || "aryansharma24112003@gmail.com");
    setPassword(process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "Aryan@24");
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    if (mode === "signup" && username.trim().length < 3) {
      setError("Username must be at least 3 characters.");
      setLoading(false);
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      setLoading(false);
      return;
    }

    const { error: err } =
      mode === "signin"
        ? await signIn(email, password)
        : await signUp(email, password, username.toLowerCase().replace(/\s+/g, "_"));

    if (err) {
      setError(err);
    } else {
      router.push("/");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 px-6 py-12 transition-colors duration-300">
      <div className="noise-overlay" aria-hidden="true" />
      <div className="scanline-overlay" aria-hidden="true" />

      <div className="w-full max-w-sm fade-in bg-white dark:bg-[#09090b] p-8 border-4 border-zinc-950 dark:border-zinc-800 shadow-[12px_12px_0px_0px_rgba(9,9,11,1)] dark:shadow-none">
        {/* Navigation Back */}
        <div className="mb-6 flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 transition-colors uppercase tracking-wider"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Home
          </Link>
          <button
            type="button"
            onClick={handleDemoFill}
            className="inline-flex items-center gap-1 px-2 py-1 text-[9px] font-mono font-bold uppercase tracking-wider text-red-600 dark:text-red-400 border border-red-600/40 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
          >
            <Shield className="w-2.5 h-2.5" /> Auto-fill Demo
          </button>
        </div>

        {/* Brand */}
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-black tracking-[-0.08em] text-zinc-950 dark:text-zinc-50">OATH</h1>
          <p className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-400 tracking-[0.25em] uppercase mt-1">
            Stake everything.
          </p>
        </div>

        {/* Toggle */}
        <div className="flex border-4 border-zinc-950 dark:border-zinc-800 mb-8 bg-zinc-100 dark:bg-[#09090b] p-1 shadow-[inset_4px_4px_0px_0px_rgba(0,0,0,0.05)] dark:shadow-none">
          <button
            onClick={() => { setMode("signin"); setError(null); }}
            className={`flex-1 py-2.5 text-[11px] font-black uppercase tracking-widest transition-all ${
              mode === "signin" 
                ? "bg-zinc-950 text-white dark:bg-zinc-800/60 dark:text-zinc-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] dark:shadow-none" 
                : "text-zinc-500 hover:text-zinc-950 dark:text-zinc-600 dark:hover:text-zinc-400"
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => { setMode("signup"); setError(null); }}
            className={`flex-1 py-2.5 text-[11px] font-black uppercase tracking-widest transition-all ${
              mode === "signup" 
                ? "bg-zinc-950 text-white dark:bg-zinc-800/60 dark:text-zinc-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,0.2)] dark:shadow-none" 
                : "text-zinc-500 hover:text-zinc-950 dark:text-zinc-600 dark:hover:text-zinc-400"
            }`}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Username (signup only) */}
          {mode === "signup" && (
            <div className="fade-in">
              <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-500 uppercase tracking-[0.15em] mb-2 block">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="reaper_exe"
                className="w-full px-4 py-3.5 text-sm font-medium border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 focus:border-red-600 dark:focus:border-zinc-600 outline-none transition-colors text-zinc-950 dark:text-zinc-50 shadow-[4px_4px_0px_0px_rgba(9,9,11,1)] dark:shadow-none"
                autoComplete="username"
                required
              />
            </div>
          )}

          {/* Email */}
          <div>
            <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-500 uppercase tracking-[0.15em] mb-2 block">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@nowhere.com"
              className="w-full px-4 py-3.5 text-sm font-medium border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 focus:border-red-600 dark:focus:border-zinc-600 outline-none transition-colors text-zinc-950 dark:text-zinc-50 shadow-[4px_4px_0px_0px_rgba(9,9,11,1)] dark:shadow-none"
              autoComplete="email"
              required
            />
          </div>

          {/* Password */}
          <div>
            <label className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-500 uppercase tracking-[0.15em] mb-2 block">
              Password
            </label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-3.5 pr-12 text-sm font-medium border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-950/50 focus:border-red-600 dark:focus:border-zinc-600 outline-none transition-colors text-zinc-950 dark:text-zinc-50 shadow-[4px_4px_0px_0px_rgba(9,9,11,1)] dark:shadow-none"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                required
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-950 dark:text-zinc-600 dark:hover:text-zinc-400 transition-colors"
              >
                {showPw ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-red-500 fade-in">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="text-[11px] font-mono">{error}</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-4 mt-6 bg-red-600 text-white text-base font-black uppercase tracking-tight hover:bg-red-700 hover:-translate-y-1 hover:shadow-[8px_8px_0px_0px_rgba(9,9,11,1)] dark:hover:shadow-[0_0_20px_rgba(220,38,38,0.3)] active:translate-y-0 active:shadow-none disabled:opacity-50 disabled:cursor-not-allowed transition-all border-4 border-zinc-950 dark:border-transparent shadow-[4px_4px_0px_0px_rgba(9,9,11,1)] dark:shadow-none"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Zap className="w-5 h-5" />
            )}
            {loading ? "Working..." : mode === "signin" ? "Enter Arena" : "Create Account"}
          </button>
        </form>

        <p className="text-center text-[10px] font-mono font-bold text-zinc-500 dark:text-zinc-700 mt-8 leading-relaxed">
          By continuing you agree that you are bound by your oaths.
          <br />
          Consequences are real. Excuses are not.
        </p>
      </div>
    </div>
  );
}
