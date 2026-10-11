"use client";

import { useState, useEffect, useRef } from "react";
import { UserCheck, AlertCircle, Loader2, Check, X, Shield, LogOut } from "lucide-react";
import { checkUsernameAvailable, updateUsername } from "@/lib/data-hooks";
import { useAuth } from "@/lib/auth-context";
import { showToast } from "./Toast";

interface UsernameModalProps {
  isOpen: boolean;
  onClose?: () => void;
  currentUsername?: string;
  mode: "google_onboarding" | "edit_profile";
}

export default function UsernameModal({
  isOpen,
  onClose,
  currentUsername = "",
  mode,
}: UsernameModalProps) {
  const { signOut, refreshProfile } = useAuth();
  const [usernameInput, setUsernameInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState<{
    status: "idle" | "available" | "taken" | "invalid";
    message: string;
  }>({ status: "idle", message: "" });
  const checkTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isOpen) {
      if (mode === "edit_profile" && currentUsername) {
        setUsernameInput(currentUsername);
      } else {
        setUsernameInput("");
      }
      setAvailability({ status: "idle", message: "" });
    }
  }, [isOpen, mode, currentUsername]);

  const cleanHandle = usernameInput.trim().toLowerCase().replace(/^@+/, "");

  // Real-time debounced availability check
  useEffect(() => {
    if (checkTimeoutRef.current) {
      clearTimeout(checkTimeoutRef.current);
    }

    if (!cleanHandle) {
      setAvailability({ status: "idle", message: "" });
      setChecking(false);
      return;
    }

    if (cleanHandle.length < 3) {
      setAvailability({ status: "invalid", message: "Must be at least 3 characters." });
      setChecking(false);
      return;
    }

    if (cleanHandle.length > 24) {
      setAvailability({ status: "invalid", message: "Cannot exceed 24 characters." });
      setChecking(false);
      return;
    }

    if (!/^[a-z0-9_]+$/.test(cleanHandle)) {
      setAvailability({
        status: "invalid",
        message: "Only lowercase letters, numbers, and underscores allowed.",
      });
      setChecking(false);
      return;
    }

    if (mode === "edit_profile" && cleanHandle === currentUsername.toLowerCase()) {
      setAvailability({ status: "idle", message: "This is your current handle." });
      setChecking(false);
      return;
    }

    setChecking(true);
    checkTimeoutRef.current = setTimeout(async () => {
      const { available, error } = await checkUsernameAvailable(cleanHandle);
      setChecking(false);
      if (available) {
        setAvailability({ status: "available", message: "Available!" });
      } else {
        setAvailability({
          status: "taken",
          message: error || "Username is already taken.",
        });
      }
    }, 350);

    return () => {
      if (checkTimeoutRef.current) clearTimeout(checkTimeoutRef.current);
    };
  }, [cleanHandle, mode, currentUsername]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (availability.status === "invalid" || availability.status === "taken" || checking) {
      return;
    }

    if (mode === "edit_profile" && cleanHandle === currentUsername.toLowerCase()) {
      onClose?.();
      return;
    }

    setLoading(true);
    const res = await updateUsername(cleanHandle);
    setLoading(false);

    if (!res.success) {
      setAvailability({
        status: "taken",
        message: res.error || "Failed to set username.",
      });
      showToast(res.error || "Failed to set username.", "error");
      return;
    }

    await refreshProfile();
    showToast(`Handle set to @${cleanHandle}`, "success");
    onClose?.();
  };

  const isFormValid =
    cleanHandle.length >= 3 &&
    cleanHandle.length <= 24 &&
    /^[a-z0-9_]+$/.test(cleanHandle) &&
    availability.status !== "taken" &&
    availability.status !== "invalid" &&
    !checking &&
    !(mode === "edit_profile" && cleanHandle === currentUsername.toLowerCase());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div
        className="w-full max-w-md bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 p-6 sm:p-8 shadow-[12px_12px_0px_0px_rgba(0,0,0,1)] dark:shadow-none fade-in my-auto relative text-left"
        role="dialog"
        aria-modal="true"
        aria-labelledby="username-modal-title"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4 border-b-2 border-zinc-950 dark:border-zinc-800 pb-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 text-[9px] font-mono font-black uppercase tracking-wider bg-red-500 text-white dark:bg-red-600">
                {mode === "google_onboarding" ? "Google Sign-In" : "Identity"}
              </span>
              <span className="text-[10px] font-mono font-bold text-zinc-500 uppercase tracking-widest flex items-center gap-1">
                <Shield className="w-3 h-3 text-emerald-600" /> Unique Handle
              </span>
            </div>
            <h2
              id="username-modal-title"
              className="text-xl sm:text-2xl font-black uppercase text-zinc-950 dark:text-zinc-50 tracking-tight"
            >
              {mode === "google_onboarding" ? "Choose Your Username" : "Edit Username"}
            </h2>
          </div>

          {mode === "edit_profile" && onClose && (
            <button
              onClick={onClose}
              className="p-1.5 border-2 border-zinc-950 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Description */}
        <p className="text-xs font-mono font-medium text-zinc-600 dark:text-zinc-400 mb-5 leading-relaxed">
          {mode === "google_onboarding"
            ? "You signed in via Google. Claim your unique handle to participate in oaths, squads, and leaderboards. Usernames are permanently unique."
            : "Update your public handle. This changes how you are identified across active oaths, squads, and chat feeds."}
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label
                htmlFor="unique-username-input"
                className="text-[10px] font-mono font-bold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider"
              >
                Desired Handle
              </label>
              <span className="text-[10px] font-mono font-bold text-zinc-400">
                {cleanHandle.length}/24
              </span>
            </div>

            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-500 font-mono font-black text-base">
                @
              </div>
              <input
                id="unique-username-input"
                type="text"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
                placeholder="iron_will"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                autoFocus
                className="w-full pl-8 pr-10 py-3 text-base sm:text-sm font-mono font-bold border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 focus:border-red-600 dark:focus:border-red-500 focus:outline-none transition-colors text-zinc-950 dark:text-zinc-50 shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
              />

              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                {checking ? (
                  <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />
                ) : availability.status === "available" ? (
                  <Check className="w-4 h-4 text-emerald-600" />
                ) : availability.status === "taken" || availability.status === "invalid" ? (
                  <AlertCircle className="w-4 h-4 text-red-600" />
                ) : null}
              </div>
            </div>

            {/* Availability feedback message */}
            <div className="mt-2 min-h-[1.25rem]">
              {checking ? (
                <p className="text-[11px] font-mono font-bold text-zinc-500 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Checking availability...
                </p>
              ) : availability.message ? (
                <p
                  className={`text-[11px] font-mono font-bold flex items-center gap-1.5 ${
                    availability.status === "available"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : availability.status === "taken" || availability.status === "invalid"
                      ? "text-red-600 dark:text-red-400"
                      : "text-zinc-500"
                  }`}
                >
                  {availability.status === "available" && <Check className="w-3 h-3" />}
                  {(availability.status === "taken" || availability.status === "invalid") && (
                    <AlertCircle className="w-3 h-3" />
                  )}
                  {availability.message}
                </p>
              ) : (
                <p className="text-[10px] font-mono text-zinc-400">
                  Use 3-24 characters: letters, numbers, and underscores.
                </p>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="pt-2 flex flex-col sm:flex-row items-center gap-2.5">
            <button
              type="submit"
              disabled={!isFormValid || loading}
              className="w-full sm:flex-1 py-3 px-4 bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 font-black text-xs uppercase tracking-widest hover:bg-zinc-800 dark:hover:bg-white active:translate-x-0.5 active:translate-y-0.5 transition-all flex items-center justify-center gap-2 border-2 border-zinc-950 dark:border-zinc-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <UserCheck className="w-4 h-4" />
                  <span>{mode === "google_onboarding" ? "Confirm & Enter Arena" : "Save Username"}</span>
                </>
              )}
            </button>

            {mode === "edit_profile" && onClose && (
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="w-full sm:w-auto py-3 px-4 border-2 border-zinc-950 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100 font-mono font-bold text-xs uppercase tracking-wider hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
            )}

            {mode === "google_onboarding" && (
              <button
                type="button"
                onClick={() => signOut()}
                className="w-full sm:w-auto py-3 px-3 border-2 border-zinc-300 dark:border-zinc-800 text-zinc-500 hover:text-red-600 dark:hover:text-red-400 font-mono font-bold text-[11px] uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors"
                title="Sign out of Google"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="sm:hidden">Sign Out</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
