// ============================================================
// OATH — Supabase Data Hooks
// ============================================================
"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Oath, WallEntry, Transaction, Proof } from "@/lib/types";
import { useAuth } from "./auth-context";

// ---- useOaths — fetch user's active oaths ----
export function useOaths() {
  const { user } = useAuth();
  const [oaths, setOaths] = useState<Oath[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetch = useCallback(async () => {
    if (!user) { setOaths([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("oaths")
      .select(`
        *,
        creator:profiles!oaths_creator_id_fkey(*),
        opponent:profiles!oaths_opponent_id_fkey(*),
        members:group_members(*, user:profiles(*)),
        proofs(*)
      `)
      .or(`creator_id.eq.${user.id},opponent_id.eq.${user.id}`)
      .in("status", ["pending", "active", "disputed"])
      .order("created_at", { ascending: false });
    setOaths((data as Oath[]) ?? []);
    setLoading(false);
  }, [user, supabase]);

  useEffect(() => { fetch(); }, [fetch]);

  return { oaths, loading, refresh: fetch };
}

// ---- useSquadLobbies — fetch open squad pools ----
export function useSquadLobbies() {
  const [lobbies, setLobbies] = useState<Oath[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("oaths")
      .select(`
        *,
        creator:profiles!oaths_creator_id_fkey(*),
        members:group_members(*, user:profiles(*))
      `)
      .eq("oath_type", "squad")
      .in("status", ["pending", "active"])
      .order("created_at", { ascending: false });
    setLobbies((data as Oath[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { fetch(); }, [fetch]);

  return { lobbies, loading, refresh: fetch };
}

// ---- useWall — fetch wall entries ----
export function useWall(type: "shame" | "honor") {
  const [entries, setEntries] = useState<WallEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetch = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("wall_entries")
      .select("*")
      .eq("wall_type", type)
      .order("created_at", { ascending: false })
      .limit(50);
    setEntries((data as WallEntry[]) ?? []);
    setLoading(false);
  }, [supabase, type]);

  useEffect(() => { fetch(); }, [fetch]);

  return { entries, loading, refresh: fetch };
}

// ---- useTransactions — fetch wallet transactions ----
export function useTransactions() {
  const { wallet } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetch = useCallback(async () => {
    if (!wallet) { setTransactions([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("transactions")
      .select("*")
      .eq("wallet_id", wallet.id)
      .order("created_at", { ascending: false })
      .limit(30);
    setTransactions((data as Transaction[]) ?? []);
    setLoading(false);
  }, [wallet, supabase]);

  useEffect(() => { fetch(); }, [fetch]);

  return { transactions, loading, refresh: fetch };
}

// ---- useProofs — fetch proofs for an oath ----
export function useProofs(oathId: string) {
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  const fetch = useCallback(async () => {
    if (!oathId) return;
    setLoading(true);
    const { data } = await supabase
      .from("proofs")
      .select(`*, submitter:profiles!proofs_submitted_by_fkey(*)`)
      .eq("oath_id", oathId)
      .order("created_at", { ascending: false });
    setProofs((data as Proof[]) ?? []);
    setLoading(false);
  }, [oathId, supabase]);

  useEffect(() => { fetch(); }, [fetch]);

  return { proofs, loading, refresh: fetch };
}

// ---- createOath — create oath + lock escrow ----
export async function createOath(data: {
  oath_statement: string;
  deadline: string;
  oath_type: string;
  verification_method: string;
  consequence_type: string;
  stake_amount: number;
  social_ransom_phone?: string;
  social_ransom_message?: string;
  min_players?: number;
  max_players?: number;
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // 1. Create oath
  const { data: oath, error: oathError } = await supabase
    .from("oaths")
    .insert({ ...data, creator_id: user.id, status: "active" })
    .select()
    .single();

  if (oathError) return { error: oathError.message };

  // 2. Lock escrow — deduct from wallet, add to escrow_locked
  const { data: wallet } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!wallet || wallet.balance < data.stake_amount) {
    // Rollback oath creation
    await supabase.from("oaths").delete().eq("id", oath.id);
    return { error: "Insufficient funds" };
  }

  await supabase
    .from("wallets")
    .update({
      balance: wallet.balance - data.stake_amount,
      escrow_locked: wallet.escrow_locked + data.stake_amount,
    })
    .eq("user_id", user.id);

  // 3. Log transaction
  await supabase.from("transactions").insert({
    wallet_id: wallet.id,
    oath_id: oath.id,
    type: "escrow_lock",
    amount: data.stake_amount,
    description: `Locked for: ${data.oath_statement}`,
  });

  return { oath, error: null };
}

// ---- depositFunds ----
export async function depositFunds(amount: number) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: wallet } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!wallet) return { error: "Wallet not found" };

  await supabase
    .from("wallets")
    .update({
      balance: wallet.balance + amount,
      total_deposited: wallet.total_deposited + amount,
    })
    .eq("user_id", user.id);

  await supabase.from("transactions").insert({
    wallet_id: wallet.id,
    type: "deposit",
    amount,
    description: "Wallet deposit",
  });

  return { error: null };
}

// ---- withdrawFunds ----
export async function withdrawFunds(amount: number) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: wallet } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!wallet || wallet.balance < amount) return { error: "Insufficient funds" };

  await supabase
    .from("wallets")
    .update({
      balance: wallet.balance - amount,
      total_withdrawn: wallet.total_withdrawn + amount,
    })
    .eq("user_id", user.id);

  await supabase.from("transactions").insert({
    wallet_id: wallet.id,
    type: "withdrawal",
    amount,
    description: "Wallet withdrawal",
  });

  return { error: null };
}

// ---- submitProof ----
export async function submitProof(data: {
  oath_id: string;
  proof_type: string;
  proof_url?: string;
  proof_text?: string;
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: proof, error } = await supabase
    .from("proofs")
    .insert({ ...data, submitted_by: user.id, status: "pending_review" })
    .select()
    .single();

  return { proof, error: error?.message ?? null };
}

// ---- joinSquad ----
export async function joinSquad(oathId: string, stakeAmount: number) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: wallet } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!wallet || wallet.balance < stakeAmount) return { error: "Insufficient funds" };

  // Add group member
  const { error: memberError } = await supabase
    .from("group_members")
    .insert({ oath_id: oathId, user_id: user.id, stake_amount: stakeAmount, status: "joined" });

  if (memberError) return { error: memberError.message };

  // Lock escrow
  await supabase
    .from("wallets")
    .update({
      balance: wallet.balance - stakeAmount,
      escrow_locked: wallet.escrow_locked + stakeAmount,
    })
    .eq("user_id", user.id);

  await supabase.from("transactions").insert({
    wallet_id: wallet.id,
    oath_id: oathId,
    type: "escrow_lock",
    amount: stakeAmount,
    description: "Joined squad pool",
  });

  return { error: null };
}

// ---- castVote ----
export async function castVote(proofId: string, oathId: string, vote: boolean) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("votes")
    .upsert({ proof_id: proofId, oath_id: oathId, voter_id: user.id, vote });

  return { error: error?.message ?? null };
}

// ---- uploadProofFile ----
export async function uploadProofFile(file: File, oathId: string): Promise<string | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const ext = file.name.split(".").pop();
  const path = `proofs/${oathId}/${user.id}-${Date.now()}.${ext}`;

  const { error } = await supabase.storage.from("oath-proofs").upload(path, file);
  if (error) return null;

  const { data } = supabase.storage.from("oath-proofs").getPublicUrl(path);
  return data.publicUrl;
}

// ---- createDuoChallenge ----
export async function createDuoChallenge(data: {
  oath_statement: string;
  deadline: string;
  stake_amount: number;
  opponent_email?: string;
  opponent_username?: string;
}) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  // Find opponent
  let opponentId: string | null = null;
  if (data.opponent_username) {
    const { data: opponent } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", data.opponent_username)
      .single();
    opponentId = opponent?.id ?? null;
  }

  const { data: oath, error } = await supabase
    .from("oaths")
    .insert({
      creator_id: user.id,
      opponent_id: opponentId,
      oath_statement: data.oath_statement,
      deadline: data.deadline,
      oath_type: "duo",
      verification_method: "peer",
      consequence_type: "fiat",
      stake_amount: data.stake_amount,
      status: opponentId ? "pending" : "pending",
    })
    .select()
    .single();

  if (error) return { error: error.message };
  return { oath, error: null };
}

// ---- verifyNominee ----
export async function verifyNominee(token: string, verdict: "success" | "penalty", note?: string) {
  const supabase = createClient();

  const { data: nominee, error: nomError } = await supabase
    .from("nominees")
    .select("*, oath:oaths(*)")
    .eq("verification_token", token)
    .single();

  if (nomError || !nominee) return { error: "Invalid or expired token" };
  if (nominee.verified) return { error: "This link has already been used" };

  await supabase
    .from("nominees")
    .update({ verified: true, verdict, verdict_note: note, responded_at: new Date().toISOString() })
    .eq("verification_token", token);

  // Update oath status
  if (verdict === "success") {
    await supabase.from("oaths").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", nominee.oath_id);
  } else {
    await supabase.from("oaths").update({ status: "failed", failed_at: new Date().toISOString() }).eq("id", nominee.oath_id);
  }

  return { nominee, error: null };
}
