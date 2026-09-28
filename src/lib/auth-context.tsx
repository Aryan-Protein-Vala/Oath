"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import type { Profile, Wallet } from "@/lib/types";
import { mockProfile, mockWallet } from "@/lib/mock-data";

const ADMIN_MOCK_USER = {
  id: "admin-mock-id",
  email: process.env.NEXT_PUBLIC_ADMIN_EMAIL,
  app_metadata: {},
  user_metadata: { username: "Admin_Aryan" },
  aud: "authenticated",
  created_at: new Date().toISOString(),
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

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
    // Check for mock admin session first
    const isAdmin = typeof window !== "undefined" && localStorage.getItem("oath_admin_logged_in") === "true";
    if (isAdmin) {
      setUser(ADMIN_MOCK_USER);
      setProfile({ ...mockProfile, username: "AryanTheAdmin" });
      setWallet({ ...mockWallet, balance: 99999 });
      setLoading(false);
      return;
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
    if (
      email === process.env.NEXT_PUBLIC_ADMIN_EMAIL &&
      password === process.env.NEXT_PUBLIC_ADMIN_PASSWORD
    ) {
      localStorage.setItem("oath_admin_logged_in", "true");
      setUser(ADMIN_MOCK_USER);
      setProfile({ ...mockProfile, username: "AryanTheAdmin" });
      setWallet({ ...mockWallet, balance: 99999 });
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
    await supabase.auth.signOut();
  };

  const refreshProfile = async () => {
    if (user) await fetchProfile(user.id);
  };

  const refreshWallet = async () => {
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
