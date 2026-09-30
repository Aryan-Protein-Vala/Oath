"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import type { Profile, Wallet } from "@/lib/types";
import { mockProfile, mockWallet } from "@/lib/mock-data";

export const DEMO_SESSION_KEY = "oath_demo_session";

export function demoModeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_OATH_DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
}

export function isDemoSession(): boolean {
  return typeof window !== "undefined" && demoModeEnabled() && localStorage.getItem(DEMO_SESSION_KEY) === "true";
}

export const ADMIN_MOCK_USER = {
  id: "local-demo-user",
  email: "demo@example.invalid",
  app_metadata: {},
  user_metadata: { username: "DemoUser" },
  aud: "authenticated",
  created_at: "2025-01-01T00:00:00Z",
} as User;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  wallet: Wallet | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, username: string) => Promise<{ error: string | null; confirmationRequired?: boolean }>;
  enterDemo: () => { error: string | null };
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshWallet: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getInitialMockProfile(): Profile {
  if (typeof window === "undefined") return { ...mockProfile, username: "DemoUser" };
  try {
    const saved = localStorage.getItem("oath_mock_profile");
    if (saved) return JSON.parse(saved) as Profile;
  } catch {}
  return { ...mockProfile, username: "DemoUser", display_name: "Demo User" };
}

export function getInitialMockWallet(): Wallet {
  if (typeof window === "undefined") return { ...mockWallet, balance: 5000, escrow_locked: 500 };
  try {
    const saved = localStorage.getItem("oath_mock_wallet");
    if (saved) return JSON.parse(saved) as Wallet;
  } catch {}
  return { ...mockWallet, balance: 5000, escrow_locked: 500 };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => (isSupabaseConfigured() ? createClient() : null), []);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (userId: string) => {
    if (!supabase) return;
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
    if (!error && data) setProfile(data as Profile);
  }, [supabase]);

  const fetchWallet = useCallback(async (userId: string) => {
    if (!supabase) return;
    const { data, error } = await supabase.from("wallets").select("*").eq("user_id", userId).single();
    if (!error && data) setWallet(data as Wallet);
  }, [supabase]);

  useEffect(() => {
    if (isDemoSession()) {
      queueMicrotask(() => {
        setUser(ADMIN_MOCK_USER);
        setProfile(getInitialMockProfile());
        setWallet(getInitialMockWallet());
        setLoading(false);
      });
      return;
    }
    if (!supabase) {
      queueMicrotask(() => setLoading(false));
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
      if (nextSession?.user) {
        // Do not await Supabase queries inside its auth callback; that can deadlock its auth lock.
        void Promise.resolve().then(() => Promise.all([
          fetchProfile(nextSession.user.id),
          fetchWallet(nextSession.user.id),
        ])).catch((error) => console.error("Unable to load account data", error));
      } else {
        setProfile(null);
        setWallet(null);
      }
    });

    return () => subscription.unsubscribe();
  }, [supabase, fetchProfile, fetchWallet]);

  const signIn = async (email: string, password: string) => {
    if (!supabase) return { error: "Account sign-in is unavailable until Supabase is configured." };
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUp = async (email: string, password: string, username: string) => {
    if (!supabase) return { error: "Account creation is unavailable until Supabase is configured." };
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username, display_name: username } },
    });
    return { error: error?.message ?? null, confirmationRequired: !error && !data.session };
  };

  const enterDemo = () => {
    if (!demoModeEnabled()) return { error: "Demo mode is disabled." };
    localStorage.setItem(DEMO_SESSION_KEY, "true");
    setUser(ADMIN_MOCK_USER);
    setProfile(getInitialMockProfile());
    setWallet(getInitialMockWallet());
    setLoading(false);
    return { error: null };
  };

  const signOut = async () => {
    localStorage.removeItem(DEMO_SESSION_KEY);
    setUser(null);
    setProfile(null);
    setWallet(null);
    setSession(null);
    if (supabase) {
      const { error } = await supabase.auth.signOut();
      if (error) console.warn("Sign out failed", error.message);
    }
  };

  const refreshProfile = async () => {
    if (isDemoSession()) {
      setProfile(getInitialMockProfile());
      return;
    }
    if (user) await fetchProfile(user.id);
  };

  const refreshWallet = async () => {
    if (isDemoSession()) {
      setWallet(getInitialMockWallet());
      return;
    }
    if (user) await fetchWallet(user.id);
  };

  return (
    <AuthContext.Provider value={{ user, session, profile, wallet, loading, signIn, signUp, enterDemo, signOut, refreshProfile, refreshWallet }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
