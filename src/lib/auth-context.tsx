"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import type { Profile, Wallet } from "@/lib/types";
import { mockProfile, mockWallet } from "@/lib/mock-data";

export const ADMIN_MOCK_USER = {
  id: "admin-mock-id",
  email: process.env.NEXT_PUBLIC_ADMIN_EMAIL || "aryansharma24112003@gmail.com",
  app_metadata: {},
  user_metadata: { username: "AryanTheAdmin" },
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
  signUp: (email: string, password: string, username: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshWallet: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function getInitialMockProfile(): Profile {
  if (typeof window === "undefined") return { ...mockProfile, username: "AryanTheAdmin" };
  try {
    const saved = localStorage.getItem("oath_mock_profile");
    if (saved) return JSON.parse(saved);
  } catch {}
  return { ...mockProfile, username: "AryanTheAdmin" };
}

export function getInitialMockWallet(): Wallet {
  if (typeof window === "undefined") return { ...mockWallet, balance: 5000, escrow_locked: 500 };
  try {
    const saved = localStorage.getItem("oath_mock_wallet");
    if (saved) return JSON.parse(saved);
  } catch {}
  return { ...mockWallet, balance: 5000, escrow_locked: 500 };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);

  const [user, setUser] = useState<User | null>(() => {
    if (typeof window !== "undefined" && localStorage.getItem("oath_admin_logged_in") === "true") {
      return ADMIN_MOCK_USER;
    }
    return null;
  });

  const [session, setSession] = useState<Session | null>(null);

  const [profile, setProfile] = useState<Profile | null>(() => {
    if (typeof window !== "undefined" && localStorage.getItem("oath_admin_logged_in") === "true") {
      return getInitialMockProfile();
    }
    return null;
  });

  const [wallet, setWallet] = useState<Wallet | null>(() => {
    if (typeof window !== "undefined" && localStorage.getItem("oath_admin_logged_in") === "true") {
      return getInitialMockWallet();
    }
    return null;
  });

  const [loading, setLoading] = useState<boolean>(() => {
    if (typeof window !== "undefined" && localStorage.getItem("oath_admin_logged_in") === "true") {
      return false;
    }
    return true;
  });

  const fetchProfile = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (data) setProfile(data as Profile);
  }, [supabase]);

  const fetchWallet = useCallback(async (userId: string) => {
    const { data } = await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", userId)
      .single();
    if (data) setWallet(data as Wallet);
  }, [supabase]);

  useEffect(() => {
    const isAdmin = typeof window !== "undefined" && localStorage.getItem("oath_admin_logged_in") === "true";
    if (isAdmin) {
      // Mock admin is active; listen for local data updates
      const handleDataUpdate = () => {
        setWallet(getInitialMockWallet());
        setProfile(getInitialMockProfile());
      };
      window.addEventListener("oath_data_updated", handleDataUpdate);
      return () => window.removeEventListener("oath_data_updated", handleDataUpdate);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          await fetchProfile(session.user.id);
          await fetchWallet(session.user.id);
        } else {
          setProfile(null);
          setWallet(null);
        }
        setLoading(false);
      }
    );
    return () => subscription.unsubscribe();
  }, [supabase, fetchProfile, fetchWallet]);

  const signIn = async (email: string, password: string) => {
    const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL || "aryansharma24112003@gmail.com";
    const adminPassword = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "Aryan@24";

    if (email === adminEmail && password === adminPassword) {
      localStorage.setItem("oath_admin_logged_in", "true");
      setUser(ADMIN_MOCK_USER);
      setProfile(getInitialMockProfile());
      setWallet(getInitialMockWallet());
      setLoading(false);
      return { error: null };
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error?.message ?? null };
  };

  const signUp = async (email: string, password: string, username: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username, display_name: username } },
    });
    return { error: error?.message ?? null };
  };

  const signOut = async () => {
    localStorage.removeItem("oath_admin_logged_in");
    setUser(null);
    setProfile(null);
    setWallet(null);
    try {
      await supabase.auth.signOut();
    } catch {}
  };

  const refreshProfile = async () => {
    const isAdmin = typeof window !== "undefined" && localStorage.getItem("oath_admin_logged_in") === "true";
    if (isAdmin) {
      setProfile(getInitialMockProfile());
      return;
    }
    if (user) await fetchProfile(user.id);
  };

  const refreshWallet = async () => {
    const isAdmin = typeof window !== "undefined" && localStorage.getItem("oath_admin_logged_in") === "true";
    if (isAdmin) {
      setWallet(getInitialMockWallet());
      return;
    }
    if (user) await fetchWallet(user.id);
  };

  return (
    <AuthContext.Provider
      value={{ user, session, profile, wallet, loading, signIn, signUp, signOut, refreshProfile, refreshWallet }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
