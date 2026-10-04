// ============================================================
// OATH — Data Hooks (Supabase + Resilient Local Mock Adapter)
// ============================================================
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import type { Oath, WallEntry, Transaction, Proof, GroupMember, Wallet, OathType, VerificationMethod, ConsequenceType, ProofType, GroupMode, ProofStatus, Message } from "@/lib/types";
import {
  mockProfile,
  mockActiveOaths,
  mockSquadOaths,
  mockWallOfShame,
  mockWallOfHonor,
  mockTransactions,
} from "./mock-data";
import { useAuth, ADMIN_MOCK_USER, getInitialMockWallet, isDemoSession } from "./auth-context";

export function isMockMode(): boolean {
  return isDemoSession() || !isSupabaseConfigured();
}

function notifyDataUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("oath_data_updated"));
  }
}

// ---- Local Storage Helpers for Mock Mode ----
export function getMockOaths(): Oath[] {
  if (typeof window === "undefined") return mockActiveOaths;
  try {
    const saved = localStorage.getItem("oath_mock_active_oaths");
    if (saved) return JSON.parse(saved);
  } catch {}
  return mockActiveOaths;
}

export function setMockOaths(oaths: Oath[]) {
  if (typeof window !== "undefined") {
    localStorage.setItem("oath_mock_active_oaths", JSON.stringify(oaths));
    notifyDataUpdated();
  }
}

export function getMockSquads(): Oath[] {
  if (typeof window === "undefined") return mockSquadOaths;
  try {
    const saved = localStorage.getItem("oath_mock_squads");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        return parsed.map((item: Oath) => {
          if (item.id === "o-010" || item.id === "o-011" || item.id === "o-012") {
            return { ...item, oath_type: "lobby" as const };
          }
          return item;
        });
      }
      return parsed;
    }
  } catch {}
  return mockSquadOaths;
}

export function setMockSquads(squads: Oath[]) {
  if (typeof window !== "undefined") {
    localStorage.setItem("oath_mock_squads", JSON.stringify(squads));
    notifyDataUpdated();
  }
}

export function getMockTransactions(): Transaction[] {
  if (typeof window === "undefined") return mockTransactions;
  try {
    const saved = localStorage.getItem("oath_mock_txs");
    if (saved) return JSON.parse(saved);
  } catch {}
  return mockTransactions;
}

export function setMockTransactions(txs: Transaction[]) {
  if (typeof window !== "undefined") {
    localStorage.setItem("oath_mock_txs", JSON.stringify(txs));
    notifyDataUpdated();
  }
}

export function getMockWall(type: "shame" | "honor"): WallEntry[] {
  if (typeof window === "undefined") return type === "shame" ? mockWallOfShame : mockWallOfHonor;
  try {
    const key = `oath_mock_wall_${type}`;
    const saved = localStorage.getItem(key);
    if (saved) return JSON.parse(saved);
  } catch {}
  return type === "shame" ? mockWallOfShame : mockWallOfHonor;
}

export function setMockWall(type: "shame" | "honor", entries: WallEntry[]) {
  if (typeof window !== "undefined") {
    localStorage.setItem(`oath_mock_wall_${type}`, JSON.stringify(entries));
    notifyDataUpdated();
  }
}

export function setMockWallet(wallet: Wallet) {
  if (typeof window !== "undefined") {
    localStorage.setItem("oath_mock_wallet", JSON.stringify(wallet));
    notifyDataUpdated();
  }
}

export function getMockMessages(oathId: string): Message[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = localStorage.getItem(`oath_mock_messages_${oathId}`);
    if (saved) return JSON.parse(saved);
  } catch {}
  return [];
}

export function setMockMessages(oathId: string, messages: Message[]) {
  if (typeof window !== "undefined") {
    localStorage.setItem(`oath_mock_messages_${oathId}`, JSON.stringify(messages));
    notifyDataUpdated();
  }
}

// ---- useOaths — fetch user's active oaths ----
export function useOaths() {
  const { user, profile } = useAuth();
  const [oaths, setOaths] = useState<Oath[]>(() => isMockMode() ? getMockOaths() : []);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  const loadData = useCallback(async () => {
    if (isMockMode()) {
      setOaths(getMockOaths());
      setLoading(false);
      return;
    }
    if (!user) {
      setOaths([]);
      setLoading(false);
      return;
    }
    try {
      const { data: memberships } = await supabase.from("group_members").select("oath_id").eq("user_id", user.id);
      const membershipFilter = (memberships ?? []).map((member) => member.oath_id).filter(Boolean);

      // Check if user is referee/nominee for any oath (safely wrapped)
      let nomineeOathIds: string[] = [];
      try {
        const nomineeFilters = [`nominee_user_id.eq.${user.id}`];
        if (user.email) nomineeFilters.push(`email.eq."${user.email}"`);
        if (profile?.username) nomineeFilters.push(`email.eq."@${profile.username}"`);
        const { data: nomineeRows } = await supabase.from("nominees").select("oath_id").or(nomineeFilters.join(","));
        nomineeOathIds = (nomineeRows ?? []).map((r) => r.oath_id).filter(Boolean);
      } catch (nomineeErr) {
        console.warn("Could not query nominee rows:", nomineeErr);
      }

      const allAssociatedIds = Array.from(new Set([...membershipFilter, ...nomineeOathIds]));

      const filters = [`creator_id.eq.${user.id}`, `opponent_id.eq.${user.id}`];
      if (allAssociatedIds.length) {
        filters.push(`id.in.(${allAssociatedIds.join(",")})`);
      }

      // 1. Primary query with relations
      let { data, error } = await supabase
        .from("oaths")
        .select(`*, creator:profiles!oaths_creator_id_fkey(*), opponent:profiles!oaths_opponent_id_fkey(*), members:group_members(*, user:profiles(*)), proofs(*), nominees(*)`)
        .or(filters.join(","))
        .in("status", ["pending", "active", "disputed"])
        .order("created_at", { ascending: false });

      // 2. Resilient fallback: if nominees relation throws 403 or permission issue, retry without nominees(*)
      if (error) {
        console.warn("Retrying oaths query without nominees relation:", error.message);
        const fallback = await supabase
          .from("oaths")
          .select(`*, creator:profiles!oaths_creator_id_fkey(*), opponent:profiles!oaths_opponent_id_fkey(*), members:group_members(*, user:profiles(*)), proofs(*)`)
          .or(filters.join(","))
          .in("status", ["pending", "active", "disputed"])
          .order("created_at", { ascending: false });
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        console.error("useOaths fetch error:", error);
        setOaths([]);
      } else if (!data) {
        setOaths([]);
      } else {
        setOaths(data as Oath[]);
      }
    } catch (err) {
      console.error("useOaths unexpected error:", err);
      setOaths([]);
    } finally {
      setLoading(false);
    }
  }, [user, profile, supabase]);

  useEffect(() => {
    let isMounted = true;
    const execute = async () => {
      await loadData();
    };
    execute();

    const handleUpdate = () => {
      if (isMounted) loadData();
    };
    window.addEventListener("oath_data_updated", handleUpdate);
    return () => {
      isMounted = false;
      window.removeEventListener("oath_data_updated", handleUpdate);
    };
  }, [loadData]);

  return { oaths, loading, refresh: loadData };
}

// ---- useSquadLobbies — fetch open squad pools ----
export function useSquadLobbies() {
  const { user } = useAuth();
  const [lobbies, setLobbies] = useState<Oath[]>(() => isMockMode() ? getMockSquads().filter((s) => s.oath_type === "lobby") : []);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  const loadData = useCallback(async () => {
    if (isMockMode()) {
      setLobbies(getMockSquads().filter((s) => s.oath_type === "lobby"));
      setLoading(false);
      return;
    }
    if (!user) {
      setLobbies([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("oaths")
        .select(`
          *,
          creator:profiles!oaths_creator_id_fkey(*),
          members:group_members(*, user:profiles(*))
        `)
        .eq("oath_type", "lobby")
        .in("status", ["pending", "active"])
        .order("created_at", { ascending: false });

      if (error) {
        console.error("useSquadLobbies fetch error:", error);
        setLobbies([]);
      } else if (!data) {
        setLobbies([]);
      } else {
        const oathRows = data as Oath[];
        const oathIds = oathRows.map((oath) => oath.id);
        const [{ data: proofs }, { data: votes }] = oathIds.length ? await Promise.all([
          supabase.from("proofs").select("*").in("oath_id", oathIds),
          supabase.from("votes").select("proof_id,oath_id,voter_id,vote").in("oath_id", oathIds),
        ]) : [{ data: [] }, { data: [] }];
        const proofRows = proofs ?? [];
        const voteRows = votes ?? [];
        setLobbies(oathRows.map((oath) => ({
          ...oath,
          proofs: (proofRows as Proof[]).filter((row) => row.oath_id === oath.id),
          members: oath.members?.map((member) => {
            const proof = proofRows.find((row) => row.oath_id === oath.id && row.submitted_by === member.user_id);
            const memberVotes = proof ? voteRows.filter((row) => row.proof_id === proof.id) : [];
            return {
              ...member,
              proof_submitted: Boolean(proof) || member.proof_submitted,
              votes_received: memberVotes.filter((row) => row.vote).length,
              voted_by: memberVotes.map((row) => row.voter_id),
            };
          }),
        })));
      }
    } catch (err) {
      console.error("useSquadLobbies unexpected error:", err);
      setLobbies([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, user]);

  useEffect(() => {
    let isMounted = true;
    const execute = async () => {
      await loadData();
    };
    execute();

    const handleUpdate = () => {
      if (isMounted) loadData();
    };
    window.addEventListener("oath_data_updated", handleUpdate);
    return () => {
      isMounted = false;
      window.removeEventListener("oath_data_updated", handleUpdate);
    };
  }, [loadData]);

  return { lobbies, loading, refresh: loadData };
}

// ---- useWall — fetch wall entries ----
export function useWall(type: "shame" | "honor") {
  const { user } = useAuth();
  const [entries, setEntries] = useState<WallEntry[]>(() => isMockMode() ? getMockWall(type) : []);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  const loadData = useCallback(async () => {
    if (isMockMode()) {
      setEntries(getMockWall(type));
      setLoading(false);
      return;
    }
    if (!user) {
      setEntries([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("wall_entries")
        .select("*")
        .eq("wall_type", type)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error || !data) {
        setEntries([]);
      } else {
        setEntries(data as WallEntry[]);
      }
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, type, user]);

  useEffect(() => {
    let isMounted = true;
    const execute = async () => {
      await loadData();
    };
    execute();

    const handleUpdate = () => {
      if (isMounted) loadData();
    };
    window.addEventListener("oath_data_updated", handleUpdate);
    return () => {
      isMounted = false;
      window.removeEventListener("oath_data_updated", handleUpdate);
    };
  }, [loadData]);

  return { entries, loading, refresh: loadData };
}

// ---- useTransactions — fetch wallet transactions ----
export function useTransactions() {
  const { wallet } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>(() => isMockMode() ? getMockTransactions() : []);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  const loadData = useCallback(async () => {
    if (isMockMode()) {
      setTransactions(getMockTransactions());
      setLoading(false);
      return;
    }
    if (!wallet) {
      setTransactions([]);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("wallet_id", wallet.id)
        .order("created_at", { ascending: false })
        .limit(30);

      if (error || !data) {
        setTransactions([]);
      } else {
        setTransactions(data as Transaction[]);
      }
    } catch {
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [wallet, supabase]);

  useEffect(() => {
    let isMounted = true;
    const execute = async () => {
      await loadData();
    };
    execute();

    const handleUpdate = () => {
      if (isMounted) loadData();
    };
    window.addEventListener("oath_data_updated", handleUpdate);
    return () => {
      isMounted = false;
      window.removeEventListener("oath_data_updated", handleUpdate);
    };
  }, [loadData]);

  return { transactions, loading, refresh: loadData };
}

// ---- useProofs — fetch proofs for an oath ----
export function useProofs(oathId: string) {
  const [proofs, setProofs] = useState<Proof[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  const loadData = useCallback(async () => {
    if (!oathId) return;
    if (isMockMode()) {
      const oaths = getMockOaths();
      const oath = oaths.find((o) => o.id === oathId);
      setProofs(oath?.proofs ?? []);
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("proofs")
        .select(`*, submitter:profiles!proofs_submitted_by_fkey(*)`)
        .eq("oath_id", oathId)
        .order("created_at", { ascending: false });

      if (error || !data) {
        setProofs([]);
      } else {
        const withSignedUrls = await Promise.all((data as Proof[]).map(async (proof) => {
          if (!proof.proof_url || /^https?:|^blob:|^data:/i.test(proof.proof_url)) return proof;
          const { data: signed, error: signedError } = await supabase.storage.from("oath-proofs").createSignedUrl(proof.proof_url, 60 * 60);
          return { ...proof, proof_url: signedError ? undefined : signed?.signedUrl };
        }));
        setProofs(withSignedUrls);
      }
    } catch {
      setProofs([]);
    } finally {
      setLoading(false);
    }
  }, [oathId, supabase]);

  useEffect(() => {
    let isMounted = true;
    const execute = async () => {
      await loadData();
    };
    execute();

    const handleUpdate = () => {
      if (isMounted) loadData();
    };
    window.addEventListener("oath_data_updated", handleUpdate);
    return () => {
      isMounted = false;
      window.removeEventListener("oath_data_updated", handleUpdate);
    };
  }, [loadData]);

  return { proofs, loading, refresh: loadData };
}

// ============================================================
// MUTATIONS
// ============================================================

function parseAmount(amount: unknown): number | null {
  if (typeof amount === "string" && !/^\d+(?:\.\d{1,2})?$/.test(amount.trim())) return null;
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function validatePositiveAmount(amount: unknown): number | null {
  const n = parseAmount(amount);
  return n !== null && n > 0 ? n : null;
}

function validateNonNegativeAmount(amount: unknown): number | null {
  return parseAmount(amount);
}

// ---- createOath — create oath + lock escrow ----
export async function createOath(data: {
  oath_statement: string;
  deadline: string;
  oath_type: OathType;
  verification_method: VerificationMethod;
  consequence_type: ConsequenceType;
  stake_amount: number;
  social_ransom_phone?: string;
  social_ransom_message?: string;
  nominee_email?: string;
  anti_charity_cause?: string;
  min_players?: number;
  max_players?: number;
  group_mode?: GroupMode;
  opponent_id?: string;
  opponent_ids?: string[]; // Multiple invites for squad
}): Promise<{ oath?: Oath; error: string | null }> {
  const validStake = validateNonNegativeAmount(data.stake_amount);
  if (validStake === null) {
    return { error: "Stake amount must be a non-negative number." };
  }
  if (!data.oath_statement.trim() || data.oath_statement.trim().length > 500) {
    return { error: "Oath statement must be 1–500 characters." };
  }
  const deadlineMs = new Date(data.deadline).getTime();
  if (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now()) {
    return { error: "Deadline must be a valid future date." };
  }
  if ((data.consequence_type === "fiat" || data.consequence_type === "anti_charity") && validStake <= 0) {
    return { error: "This oath requires a positive stake." };
  }

  if (isMockMode()) {
    if (mockProfile.penalty_box_until && new Date(mockProfile.penalty_box_until).getTime() > Date.now()) {
      return { error: `You are locked in The Penalty Box until ${new Date(mockProfile.penalty_box_until).toLocaleString()} for 3 consecutive oath failures. No oath creation allowed.` };
    }
    const currentWallet = getInitialMockWallet();
    const multiplier = data.oath_type === "squad" ? (data.max_players ?? 4) : data.oath_type === "duo" ? 2 : 1;
    const totalStake = validStake * multiplier;
    const protocolFee = Math.round(totalStake * 0.10 * 100) / 100;
    const totalDeduction = totalStake + protocolFee;
    if (currentWallet.balance < totalDeduction) {
      return { error: `Insufficient funds. Deposit more or lower the stake (${totalDeduction} required: ${totalStake} stake + 10% platform fee).` };
    }

    const initialStatus = (data.oath_type === "squad" || data.oath_type === "duo" || data.oath_type === "lobby") ? "pending" : "active";
    const demoOathId = `oath-${Date.now()}`;

    const newOath: Oath = {
      id: demoOathId,
      creator_id: ADMIN_MOCK_USER.id,
      creator: { ...mockProfile, username: "DemoUser" },
      oath_statement: data.oath_statement,
      deadline: data.deadline,
      oath_type: data.oath_type,
      verification_method: data.verification_method,
      consequence_type: data.consequence_type,
      stake_amount: validStake,
      social_ransom_phone: data.social_ransom_phone,
      social_ransom_message: data.social_ransom_message,
      nominee_email: data.nominee_email,
      status: initialStatus,
      min_players: data.min_players ?? (data.oath_type === "squad" ? 4 : data.oath_type === "lobby" ? 2 : data.oath_type === "duo" ? 2 : 1),
      max_players: data.max_players ?? (data.oath_type === "squad" ? 8 : data.oath_type === "lobby" ? 10 : data.oath_type === "duo" ? 2 : 1),
      group_mode: data.group_mode,
      opponent_id: data.opponent_id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      members: (data.oath_type === "squad" || data.oath_type === "lobby" || data.oath_type === "duo") ? [
        {
          id: `gm-${Date.now()}`,
          oath_id: demoOathId,
          user_id: ADMIN_MOCK_USER.id,
          user: { ...mockProfile, username: "DemoUser" },
          stake_amount: validStake,
          status: "joined",
          proof_submitted: false,
          votes_received: 0,
          votes_needed: data.oath_type === "duo" ? 1 : 3,
          is_active_participant: false,
        }
      ] : undefined,
    };

    // Update wallet
    const updatedWallet: Wallet = {
      ...currentWallet,
      balance: currentWallet.balance - totalDeduction,
      escrow_locked: currentWallet.escrow_locked + totalStake,
    };
    setMockWallet(updatedWallet);

    // Add transaction
    const newTx: Transaction = {
      id: `tx-${Date.now()}`,
      wallet_id: currentWallet.id,
      oath_id: newOath.id,
      type: "escrow_lock",
      amount: totalStake,
      description: `Locked for: ${data.oath_statement}`,
      created_at: new Date().toISOString(),
    };
    const feeTx: Transaction = {
      id: `tx-fee-${Date.now()}`,
      wallet_id: currentWallet.id,
      oath_id: newOath.id,
      type: "house_cut",
      amount: protocolFee,
      description: `Platform fee (10%) for: ${data.oath_statement}`,
      created_at: new Date().toISOString(),
    };
    setMockTransactions([newTx, feeTx, ...getMockTransactions()]);

    // Save oath
    if (data.oath_type === "squad" || data.oath_type === "lobby") {
      setMockSquads([newOath, ...getMockSquads()]);
    }
    setMockOaths([newOath, ...getMockOaths()]);

    return { oath: newOath, error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: oathId, error } = await supabase.rpc("create_oath_with_stake", {
    p_oath_statement: data.oath_statement,
    p_deadline: data.deadline,
    p_oath_type: data.oath_type,
    p_verification_method: data.verification_method,
    p_consequence_type: data.consequence_type,
    p_stake_amount: validStake,
    p_social_phone: data.social_ransom_phone ?? null,
    p_social_msg: data.social_ransom_message ?? null,
    p_nominee_email: data.nominee_email ?? null,
    p_anti_charity_cause: data.anti_charity_cause ?? null,
    p_min_players: data.min_players ?? 1,
    p_max_players: data.max_players ?? 1,
    p_group_mode: data.group_mode ?? null,
    p_opponent_id: data.opponent_id ?? null,
    p_opponent_ids: data.opponent_ids ?? null,
  });
  if (error || !oathId) return { error: error?.message ?? "Oath creation failed" };

  const { data: oath, error: readError } = await supabase
    .from("oaths")
    .select("*, creator:profiles!oaths_creator_id_fkey(*), members:group_members(*, user:profiles(*))")
    .eq("id", oathId)
    .single();
    
  if (data.oath_type === "squad" && data.opponent_ids && data.opponent_ids.length > 0) {
    const notifications = data.opponent_ids.map(id => ({
      user_id: id,
      oath_id: oathId,
      type: "invite_squad",
      title: "Squad Invitation",
      actor_id: user.id,
      message: `${user.user_metadata?.username || "Someone"} invited you to a squad: "${data.oath_statement}"`,
    }));
    await supabase.from("notifications").insert(notifications);
  }

  if (data.oath_type === "duo" && data.opponent_id) {
    await supabase.from("notifications").insert({
      user_id: data.opponent_id,
      oath_id: oathId,
      type: "invite_duo",
      title: "Duo Challenge",
      actor_id: user.id,
      message: `${user.user_metadata?.username || "Someone"} challenged you to a duo oath: "${data.oath_statement}"`,
    });
  }
  
  if (readError || !oath) return { error: readError?.message ?? "Oath was created but could not be loaded. Refresh to view it." };
  notifyDataUpdated();
  return { oath: oath as Oath, error: null };
}

// ---- depositFunds ----
export async function depositFunds(amount: number) {
  const validAmount = validatePositiveAmount(amount);
  if (validAmount === null) return { error: "Deposit amount must be a positive number." };
  
  if (isMockMode()) {
    const currentWallet = getInitialMockWallet();
    const updatedWallet: Wallet = {
      ...currentWallet,
      balance: currentWallet.balance + validAmount,
      total_deposited: (currentWallet.total_deposited ?? 0) + validAmount,
    };
    setMockWallet(updatedWallet);
    const newTx: Transaction = {
      id: `tx-${Date.now()}`,
      wallet_id: currentWallet.id,
      type: "deposit",
      amount: validAmount,
      description: "Deposit to wallet",
      created_at: new Date().toISOString(),
    };
    setMockTransactions([newTx, ...getMockTransactions()]);
    notifyDataUpdated();
    return { error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.rpc("add_funds", { p_amount: validAmount });
  if (error) return { error: error.message };
  
  notifyDataUpdated();
  return { error: null };
}

// ---- withdrawFunds ----
export async function withdrawFunds(amount: number, destination: string = "Unknown") {
  const validAmount = validatePositiveAmount(amount);
  if (validAmount === null) return { error: "Withdrawal amount must be a positive number." };

  if (isMockMode()) {
    const currentWallet = getInitialMockWallet();
    if (currentWallet.balance < validAmount) {
      return { error: "Insufficient funds in wallet." };
    }
    const updatedWallet: Wallet = {
      ...currentWallet,
      balance: currentWallet.balance - validAmount,
      total_withdrawn: (currentWallet.total_withdrawn ?? 0) + validAmount,
    };
    setMockWallet(updatedWallet);
    const newTx: Transaction = {
      id: `tx-${Date.now()}`,
      wallet_id: currentWallet.id,
      type: "withdrawal",
      amount: validAmount,
      description: `Withdrawal to ${destination}`,
      created_at: new Date().toISOString(),
    };
    setMockTransactions([newTx, ...getMockTransactions()]);
    notifyDataUpdated();
    return { error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.rpc("withdraw_funds", { 
    p_amount: validAmount,
    p_destination: destination 
  });
  if (error) return { error: error.message };
  
  notifyDataUpdated();
  return { error: null };
}

// ---- submitProof ----
export async function submitProof(data: {
  oath_id: string;
  proof_type: ProofType;
  proof_url?: string;
  proof_text?: string;
}) {
  if (isMockMode()) {
    const oaths = getMockOaths();
    const newProof: Proof = {
      id: `proof-${Date.now()}`,
      oath_id: data.oath_id,
      submitted_by: ADMIN_MOCK_USER.id,
      submitter: { ...mockProfile, username: "DemoUser" },
      proof_type: data.proof_type,
      proof_url: data.proof_url,
      proof_text: data.proof_text,
      status: "pending_review",
      review_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
    };

    const updatedOaths = oaths.map((o) => {
      if (o.id === data.oath_id) {
        return {
          ...o,
          proofs: [newProof, ...(o.proofs ?? [])],
        };
      }
      return o;
    });
    setMockOaths(updatedOaths);

    // Also update squad lobbies if member of squad
    const squads = getMockSquads();
    const updatedSquads = squads.map((s) => {
      if (s.id === data.oath_id) {
        const updatedMembers = s.members?.map((m) =>
          m.user_id === ADMIN_MOCK_USER.id ? { ...m, proof_submitted: true } : m
        );
        return { ...s, members: updatedMembers, proofs: [newProof, ...(s.proofs ?? [])] };
      }
      return s;
    });
    setMockSquads(updatedSquads);

    const mockMsg: Message = {
      id: `msg-${Date.now()}`,
      oath_id: data.oath_id,
      sender_id: ADMIN_MOCK_USER.id,
      content: data.proof_url || data.proof_text || "Submitted Daily Proof",
      type: "proof",
      proof_id: newProof.id,
      created_at: new Date().toISOString(),
      sender: { ...mockProfile, username: "DemoUser" },
    };
    const currentMsgs = getMockMessages(data.oath_id);
    setMockMessages(data.oath_id, [...currentMsgs, mockMsg]);

    return { proof: newProof, error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { data: proofId, error } = await supabase.rpc("submit_oath_proof", {
    p_oath_id: data.oath_id,
    p_proof_type: data.proof_type,
    p_proof_url: data.proof_url ?? null,
    p_proof_text: data.proof_text ?? null,
  });
  if (error || !proofId) return { error: error?.message ?? "Proof submission failed" };

  // Post proof directly into chat messages so peers and referees see it in chat
  try {
    await supabase.from("messages").insert({
      oath_id: data.oath_id,
      sender_id: user.id,
      content: data.proof_url || data.proof_text || "Submitted Daily Proof",
      type: "proof",
      proof_id: proofId,
    });
  } catch (msgErr) {
    console.warn("Could not insert chat message for proof:", msgErr);
  }

  notifyDataUpdated();
  return {
    proof: {
      ...data,
      id: proofId,
      submitted_by: user.id,
      status: "pending_review",
      review_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
    } as Proof,
    error: null,
  };
}

// ---- joinSquad ----
export async function joinSquad(oathId: string, stakeAmount: number) {
  if (isMockMode()) {
    if (mockProfile.penalty_box_until && new Date(mockProfile.penalty_box_until).getTime() > Date.now()) {
      return { error: `You are locked in The Penalty Box until ${new Date(mockProfile.penalty_box_until).toLocaleString()} for 3 consecutive oath failures. You cannot join squads or lobbies.` };
    }
    const squads = getMockSquads();
    const target = squads.find((s) => s.id === oathId);
    if (!target) return { error: "Squad pool not found." };

    if (target.members?.some((m) => m.user_id === ADMIN_MOCK_USER.id)) {
      return { error: "You have already joined this squad pool." };
    }

    if (target.oath_type === "lobby" && target.stake_amount > 0) {
      const currentWallet = getInitialMockWallet();
      const fee = Math.round(target.stake_amount * 0.10 * 100) / 100;
      const totalRequired = target.stake_amount + fee;
      if (currentWallet.balance < totalRequired) {
        return { error: `Insufficient funds. You need ${totalRequired} (${target.stake_amount} stake + 10% platform fee) to join this lobby.` };
      }
      const updatedWallet: Wallet = {
        ...currentWallet,
        balance: currentWallet.balance - totalRequired,
        escrow_locked: currentWallet.escrow_locked + target.stake_amount,
      };
      setMockWallet(updatedWallet);
      const newTx: Transaction = {
        id: `tx-${Date.now()}`,
        wallet_id: currentWallet.id,
        oath_id: oathId,
        type: "escrow_lock",
        amount: target.stake_amount,
        description: `Joined lobby: ${target.oath_statement}`,
        created_at: new Date().toISOString(),
      };
      const feeTx: Transaction = {
        id: `tx-fee-${Date.now()}`,
        wallet_id: currentWallet.id,
        oath_id: oathId,
        type: "house_cut",
        amount: fee,
        description: `Platform fee (10%) for joining lobby: ${target.oath_statement}`,
        created_at: new Date().toISOString(),
      };
      setMockTransactions([newTx, feeTx, ...getMockTransactions()]);
    }

    const newMember: GroupMember = {
      id: `gm-${Date.now()}`,
      oath_id: oathId,
      user_id: ADMIN_MOCK_USER.id,
      user: { ...mockProfile, username: "DemoUser" },
      stake_amount: stakeAmount,
      status: "joined",
      proof_submitted: false,
      votes_received: 0,
      votes_needed: 3,
      is_active_participant: false,
    };

    const updatedSquads = squads.map((s) => {
      if (s.id === oathId) {
        const updatedMembers = [...(s.members ?? []), newMember];
        const minReached = updatedMembers.length >= (s.min_players ?? 4);
        return {
          ...s,
          status: minReached ? ("active" as const) : s.status,
          members: updatedMembers,
        };
      }
      return s;
    });
    setMockSquads(updatedSquads);

    const allOaths = getMockOaths();
    const updatedOaths = allOaths.map(o => o.id === oathId ? {
      ...o,
      status: (o.members?.length ?? 0) + 1 >= (o.min_players ?? 2) ? ("active" as const) : o.status,
      members: [...(o.members ?? []), newMember],
    } : o);
    setMockOaths(updatedOaths);

    notifyDataUpdated();
    return { error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { error } = await supabase.rpc("join_squad", { p_oath_id: oathId, p_stake_amount: stakeAmount });
  if (error) return { error: error.message };
  notifyDataUpdated();
  return { error: null };
}

export const joinLobby = joinSquad;

// ---- castVote ----
export async function castVote(targetId: string, oathId: string, vote: boolean) {
  if (isMockMode()) {
    const squads = getMockSquads();
    const currentUserId = ADMIN_MOCK_USER.id;
    const squad = squads.find((s) => s.id === oathId);
    if (!squad) return { error: "Squad pool not found" };

    const member = squad.members?.find((m) => m.id === targetId || m.user_id === targetId);
    if (!member) return { error: "Member not found in squad pool" };

    if (member.user_id === currentUserId) {
      return { error: "You cannot vote on your own proof." };
    }

    if (!member.proof_submitted) {
      return { error: "Member has not submitted proof yet." };
    }

    if (member.voted_by?.includes(currentUserId)) {
      return { error: "You have already voted on this proof." };
    }

    const updatedSquads = squads.map((s) => {
      if (s.id === oathId) {
        const updatedMembers = s.members?.map((m) => {
          if (m.id === targetId || m.user_id === targetId) {
            const votesReceived = m.votes_received + (vote ? 1 : 0);
            const votesRejected = (m.votes_rejected ?? 0) + (vote ? 0 : 1);
            const isCompleted = votesReceived >= Math.max(1, m.votes_needed);
            const isFailed = votesRejected >= Math.max(1, m.votes_needed);
            return {
              ...m,
              votes_received: votesReceived,
              votes_rejected: votesRejected,
              status: isCompleted ? ("completed" as const) : isFailed ? ("failed" as const) : m.status,
              is_active_participant: isCompleted,
              voted_by: [...(m.voted_by || []), currentUserId],
            };
          }
          return m;
        });
        return { ...s, members: updatedMembers };
      }
      return s;
    });
    setMockSquads(updatedSquads);
    return { error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { data: member, error: memberError } = await supabase.from("group_members").select("id").eq("oath_id", oathId).or(`id.eq.${targetId},user_id.eq.${targetId}`).maybeSingle();
  if (memberError || !member) return { error: memberError?.message ?? "Member not found" };
  const { error } = await supabase.rpc("cast_squad_vote", { p_oath_id: oathId, p_member_id: member.id, p_approve: vote });
  if (error) return { error: error.message };
  notifyDataUpdated();
  return { error: null };
}

// ---- failSquadMember — settle a member with no proof after the deadline ----
export async function failSquadMember(oathId: string, memberId?: string) {
  if (isMockMode()) {
    const squads = getMockSquads();
    const squad = squads.find((candidate) => candidate.id === oathId);
    if (!squad) return { error: "Squad not found." };
    if (new Date(squad.deadline).getTime() > Date.now()) return { error: "Squad deadline has not passed." };
    const member = memberId 
      ? squad.members?.find((m) => m.id === memberId)
      : squad.members?.find((m) => m.user_id === ADMIN_MOCK_USER.id);
    if (!member || member.status !== "joined") return { error: "No unresolved squad membership found." };
    if (member.proof_submitted) return { error: "Submitted proof must be resolved by quorum." };

    const penaltyAmount = squad.group_mode === "weakest_link" ? squad.stake_amount * (squad.max_players ?? 4) : squad.stake_amount;
    const wallet = getInitialMockWallet();
    if (wallet.escrow_locked >= penaltyAmount) {
      setMockWallet({ ...wallet, escrow_locked: wallet.escrow_locked - penaltyAmount, total_lost: (wallet.total_lost ?? 0) + penaltyAmount });
    }
    setMockSquads(squads.map((candidate) => candidate.id === oathId ? {
      ...candidate,
      status: squad.group_mode === "weakest_link" ? ("failed" as const) : candidate.status,
      members: candidate.members?.map((item) => item.id === member.id ? { ...item, status: "failed" as const } : item),
    } : candidate));
    const transaction: Transaction = {
      id: `tx-${Date.now()}`,
      wallet_id: wallet.id,
      oath_id: oathId,
      type: "penalty",
      amount: penaltyAmount,
      description: "Squad deadline passed without proof",
      created_at: new Date().toISOString(),
    };
    setMockTransactions([transaction, ...getMockTransactions()]);
    notifyDataUpdated();
    return { error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { error } = await supabase.rpc("fail_squad_member", { p_oath_id: oathId, p_member_id: memberId ?? null });
  if (error) return { error: error.message };
  notifyDataUpdated();
  return { error: null };
}

// ---- forfeitSquadMember — member voluntary forfeiture ----
export async function forfeitSquadMember(oathId: string) {
  if (isMockMode()) {
    const squads = getMockSquads();
    const squad = squads.find((candidate) => candidate.id === oathId);
    if (!squad) return { error: "Squad not found." };
    const member = squad.members?.find((m) => m.user_id === ADMIN_MOCK_USER.id);
    if (!member || member.status !== "joined") return { error: "No unresolved squad membership found." };

    const penaltyAmount = squad.group_mode === "weakest_link" ? squad.stake_amount * (squad.max_players ?? 4) : squad.stake_amount;
    const wallet = getInitialMockWallet();
    if (wallet.escrow_locked >= penaltyAmount) {
      setMockWallet({ ...wallet, escrow_locked: wallet.escrow_locked - penaltyAmount, total_lost: (wallet.total_lost ?? 0) + penaltyAmount });
    }
    setMockSquads(squads.map((candidate) => candidate.id === oathId ? {
      ...candidate,
      status: squad.group_mode === "weakest_link" ? ("failed" as const) : candidate.status,
      members: candidate.members?.map((item) => item.id === member.id ? { ...item, status: "failed" as const } : item),
    } : candidate));
    notifyDataUpdated();
    return { error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { error } = await supabase.rpc("forfeit_squad_member", { p_oath_id: oathId });
  if (error) return { error: error.message };
  notifyDataUpdated();
  return { error: null };
}

// ---- uploadProofFile ----
export async function uploadProofFile(file: File, oathId: string): Promise<string | null> {
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) return null;
  const allowedTypes = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm",
    "video/quicktime",
  ]);
  if (!allowedTypes.has(file.type)) return null;
  if (isMockMode()) {
    try { return URL.createObjectURL(file); } catch { return null; }
  }
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const extensionByType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  const ext = extensionByType[file.type] || file.name.split('.').pop() || "bin";
  const path = `${oathId}/${user.id}/${crypto.randomUUID()}.${ext}`;

  let uploadBucket = "oath-proofs";
  let uploadRes = await supabase.storage.from("oath-proofs").upload(path, file, { contentType: file.type, upsert: false });
  if (uploadRes.error) {
    const fallbackRes = await supabase.storage.from("proofs").upload(path, file, { contentType: file.type, upsert: false });
    if (!fallbackRes.error) {
      uploadBucket = "proofs";
      uploadRes = fallbackRes;
    }
  }
  if (uploadRes.error) return null;

  const { data: urlData } = supabase.storage.from(uploadBucket).getPublicUrl(path);
  return urlData?.publicUrl || path;
}

// ---- createDuoChallenge ----
export async function createDuoChallenge(data: {
  oath_statement: string;
  deadline: string;
  stake_amount: number;
  opponent_email?: string;
  opponent_username?: string;
  group_mode?: "weakest_link" | "survival";
}): Promise<{ oath?: Oath; error: string | null }> {
  if (isMockMode()) {
    const currentWallet = getInitialMockWallet();
    if (currentWallet.balance < data.stake_amount) {
      return { error: "Insufficient virtual balance for this challenge." };
    }

    const newOath: Oath = {
      id: `duo-${Date.now()}`,
      creator_id: ADMIN_MOCK_USER.id,
      creator: { ...mockProfile, username: "DemoUser" },
      oath_statement: data.oath_statement,
      deadline: data.deadline,
      oath_type: "duo",
      verification_method: "peer",
      consequence_type: "shared_oath",
      stake_amount: data.stake_amount,
      status: "pending",
      min_players: 2,
      max_players: 2,
      opponent_id: data.opponent_username ? `user-${data.opponent_username}` : undefined,
      opponent: data.opponent_username ? { ...mockProfile, username: data.opponent_username, display_name: data.opponent_username } : undefined,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Lock funds
    const updatedWallet: Wallet = {
      ...currentWallet,
      balance: currentWallet.balance - data.stake_amount,
      escrow_locked: currentWallet.escrow_locked + data.stake_amount,
    };
    setMockWallet(updatedWallet);

    const newTx: Transaction = {
      id: `tx-${Date.now()}`,
      wallet_id: currentWallet.id,
      oath_id: newOath.id,
      type: "escrow_lock",
      amount: data.stake_amount,
      description: `Wager locked for Duo: ${data.oath_statement}`,
      created_at: new Date().toISOString(),
    };
    setMockTransactions([newTx, ...getMockTransactions()]);
    setMockOaths([newOath, ...getMockOaths()]);

    return { oath: newOath, error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  let opponentId: string | null = null;
  if (data.opponent_username) {
    const { data: opponent, error: lookupError } = await supabase.from("profiles").select("id").eq("username", data.opponent_username).single();
    if (lookupError || !opponent) return { error: "No user found for that username" };
    opponentId = opponent.id;
  }
  const { data: oathId, error } = await supabase.rpc("create_oath_with_stake", {
    p_oath_statement: data.oath_statement,
    p_deadline: data.deadline,
    p_oath_type: "duo",
    p_verification_method: "peer",
    p_consequence_type: "shared_oath",
    p_stake_amount: data.stake_amount,
    p_min_players: 2,
    p_max_players: 2,
    p_opponent_id: opponentId,
    p_group_mode: data.group_mode ?? "survival",
  });
  if (error || !oathId) return { error: error?.message ?? "Challenge creation failed" };
  const { data: oath, error: readError } = await supabase.from("oaths").select("*").eq("id", oathId).single();
  notifyDataUpdated();
  if (oath && !readError) return { oath: oath as Oath, error: null };

  // The create RPC already committed the invitation and locked the stake. Keep the shareable
  // id even if the follow-up read is temporarily blocked or the network drops.
  const createdAt = new Date().toISOString();
  return {
    oath: {
      id: oathId,
      creator_id: user.id,
      oath_statement: data.oath_statement,
      deadline: data.deadline,
      oath_type: "duo",
      verification_method: "peer",
      consequence_type: "shared_oath",
      stake_amount: data.stake_amount,
      status: "pending",
      min_players: 2,
      max_players: 2,
      opponent_id: opponentId ?? undefined,
      created_at: createdAt,
      updated_at: createdAt,
    },
    error: null,
  };
}

// ---- acceptDuoChallenge ----
export async function acceptDuoChallenge(oathId: string) {
  if (isMockMode()) {
    const oaths = getMockOaths();
    const target = oaths.find((o) => o.id === oathId);
    if (!target) return { error: "Challenge not found" };

    const updatedOaths = oaths.map((o) => {
      if (o.id === oathId) {
        return {
          ...o,
          status: "active" as const,
          opponent_id: ADMIN_MOCK_USER.id,
          opponent: { ...mockProfile, username: "DemoUser" },
        };
      }
      return o;
    });
    setMockOaths(updatedOaths);
    notifyDataUpdated();
    return { error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { error } = await supabase.rpc("accept_duo_challenge", { p_oath_id: oathId });
  if (error) return { error: error.message };
  notifyDataUpdated();
  return { error: null };
}

// ---- cancelPendingOath — refund pending invitation/lobby creator and member stake ----
export async function cancelPendingOath(oathId: string) {
  if (isMockMode()) {
    const oaths = getMockOaths();
    const oath = oaths.find((item) => item.id === oathId);
    if (!oath || oath.status !== "pending") return { error: "Oath is no longer pending." };
    if (oath.creator_id !== ADMIN_MOCK_USER.id) return { error: "Only the creator can cancel this oath." };

    let refundAmount = oath.stake_amount;
    if (oath.oath_type === "duo") {
      refundAmount = oath.stake_amount * 2;
    } else if (oath.oath_type === "squad") {
      refundAmount = oath.stake_amount * (oath.max_players ?? 4);
    }

    const wallet = getInitialMockWallet();
    if (wallet.escrow_locked >= refundAmount) {
      setMockWallet({ ...wallet, balance: wallet.balance + refundAmount, escrow_locked: wallet.escrow_locked - refundAmount });
    }
    setMockOaths(oaths.map((item) => item.id === oathId ? { ...item, status: "cancelled" as const } : item));
    setMockSquads(getMockSquads().map((s) => s.id === oathId ? { ...s, status: "cancelled" as const } : s));

    setMockTransactions([{
      id: `tx-${Date.now()}`,
      wallet_id: wallet.id,
      oath_id: oathId,
      type: "escrow_release",
      amount: refundAmount,
      description: `Cancelled pending ${oath.oath_type}; escrow refunded`,
      created_at: new Date().toISOString()
    }, ...getMockTransactions()]);

    notifyDataUpdated();
    return { error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { error } = await supabase.rpc("cancel_pending_oath", { p_oath_id: oathId });
  if (error) return { error: error.message };
  notifyDataUpdated();
  return { error: null };
}

// ---- cancelDuoChallenge — alias to universal cancelPendingOath ----
export async function cancelDuoChallenge(oathId: string) {
  return cancelPendingOath(oathId);
}

// ---- forfeitOath — give up and incur penalty ----
export async function forfeitOath(oathId: string, excuse?: string) {
  if (isMockMode()) {
    const oaths = getMockOaths();
    const oath = oaths.find((o) => o.id === oathId);
    if (!oath) return { error: "Oath not found." };
    if (oath.status !== "active") return { error: "Oath is not active or already settled." };

    const currentWallet = getInitialMockWallet();
    // Unlock escrow, deduct penalty
    const updatedWallet: Wallet = {
      ...currentWallet,
      escrow_locked: Math.max(0, currentWallet.escrow_locked - oath.stake_amount),
    };
    setMockWallet(updatedWallet);

    // Update oath status
    const updatedOaths = oaths.map((o) =>
      o.id === oathId
        ? { ...o, status: "failed" as const, failed_at: new Date().toISOString(), failure_excuse: excuse }
        : o
    );
    setMockOaths(updatedOaths);

    // Add penalty transaction
    const newTx: Transaction = {
      id: `tx-${Date.now()}`,
      wallet_id: currentWallet.id,
      oath_id: oathId,
      type: "penalty",
      amount: oath.stake_amount,
      description: `Forfeited oath: ${oath.oath_statement}`,
      created_at: new Date().toISOString(),
    };
    setMockTransactions([newTx, ...getMockTransactions()]);

    if (oath.consequence_type === "public_shame") {
      const shameEntry: WallEntry = {
        id: `ws-${Date.now()}`,
        oath_id: oathId,
        user_id: ADMIN_MOCK_USER.id,
        wall_type: "shame",
        oath_statement: oath.oath_statement,
        stake_amount: oath.stake_amount,
        excuse: excuse || "I gave up under pressure.",
        username: "DemoUser",
        created_at: new Date().toISOString(),
      };
      setMockWall("shame", [shameEntry, ...getMockWall("shame")]);
    }

    return { error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { error } = await supabase.rpc("forfeit_oath", { p_oath_id: oathId, p_note: excuse ?? null });
  if (error) return { error: error.message };
  notifyDataUpdated();
  return { error: null };
}

// ---- settleOath — complete or fail oath with escrow settlement ----
export async function settleOath(oathId: string, verdict: "success" | "penalty", note?: string) {
  if (isMockMode()) {
    const oaths = getMockOaths();
    const oath = oaths.find((o) => o.id === oathId);
    if (!oath) return { error: "Oath not found." };
    if (oath.status !== "active") return { error: "Oath is not active or already settled." };

    const currentWallet = getInitialMockWallet();
    const isDuo = oath.oath_type === "duo";
    const pot = isDuo ? oath.stake_amount * 2 : oath.stake_amount;
    const winnerPayout = pot;

    if (verdict === "success") {
      // Release escrow back to balance and credit success amount (100% pot payout)
      const updatedWallet: Wallet = {
        ...currentWallet,
        balance: currentWallet.balance + winnerPayout,
        escrow_locked: Math.max(0, currentWallet.escrow_locked - (isDuo ? pot : oath.stake_amount)),
      };
      setMockWallet(updatedWallet);

      const updatedOaths = oaths.map((o) =>
        o.id === oathId ? { ...o, status: "completed" as const, completed_at: new Date().toISOString() } : o
      );
      setMockOaths(updatedOaths);

      const newTx: Transaction = {
        id: `tx-${Date.now()}`,
        wallet_id: currentWallet.id,
        oath_id: oathId,
        type: "escrow_release",
        amount: winnerPayout,
        description: isDuo
          ? `Won Duo Challenge ($${winnerPayout.toFixed(2)}): ${oath.oath_statement}`
          : `Completed: ${oath.oath_statement}`,
        created_at: new Date().toISOString(),
      };
      setMockTransactions([newTx, ...getMockTransactions()]);

      if (oath.consequence_type === "public_shame") {
        const honorEntry: WallEntry = {
          id: `wh-${Date.now()}`,
          oath_id: oathId,
          user_id: ADMIN_MOCK_USER.id,
          wall_type: "honor",
          oath_statement: oath.oath_statement,
          stake_amount: oath.stake_amount,
          username: "DemoUser",
          created_at: new Date().toISOString(),
        };
        setMockWall("honor", [honorEntry, ...getMockWall("honor")]);
      }

      mockProfile.oaths_completed += 1;
      mockProfile.loss_streak = 0;
      mockProfile.penalty_box_until = null;
    } else {
      // Forfeited stake
      const updatedWallet: Wallet = {
        ...currentWallet,
        escrow_locked: Math.max(0, currentWallet.escrow_locked - oath.stake_amount),
      };
      setMockWallet(updatedWallet);

      const updatedOaths = oaths.map((o) =>
        o.id === oathId
          ? { ...o, status: "failed" as const, failed_at: new Date().toISOString(), failure_excuse: note }
          : o
      );
      setMockOaths(updatedOaths);

      const newTx: Transaction = {
        id: `tx-${Date.now()}`,
        wallet_id: currentWallet.id,
        oath_id: oathId,
        type: "penalty",
        amount: oath.stake_amount,
        description: isDuo ? `Lost Duo Challenge: ${oath.oath_statement}` : `Failed: ${oath.oath_statement}`,
        created_at: new Date().toISOString(),
      };
      setMockTransactions([newTx, ...getMockTransactions()]);

      if (oath.consequence_type === "public_shame") {
        const shameEntry: WallEntry = {
          id: `ws-${Date.now()}`,
          oath_id: oathId,
          user_id: ADMIN_MOCK_USER.id,
          wall_type: "shame",
          oath_statement: oath.oath_statement,
          stake_amount: oath.stake_amount,
          excuse: note || (isDuo ? "Lost duo challenge." : "Failed to complete before the deadline."),
          username: "DemoUser",
          created_at: new Date().toISOString(),
        };
        setMockWall("shame", [shameEntry, ...getMockWall("shame")]);
      }

      mockProfile.oaths_failed += 1;
      mockProfile.loss_streak = (mockProfile.loss_streak ?? 0) + 1;
      if (mockProfile.loss_streak >= 3) {
        mockProfile.penalty_box_until = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
      }
    }

    return { error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { error } = await supabase.rpc("settle_oath", {
    p_oath_id: oathId,
    p_success: verdict === "success",
    p_note: note ?? null,
  });
  if (error) return { error: error.message };
  notifyDataUpdated();
  return { error: null };
}

// ---- verifyNominee ----
export async function verifyNominee(token: string, verdict: "success" | "penalty", note?: string) {
  if (isMockMode()) {
    const oath = getMockOaths().find((candidate) => candidate.id === token);
    if (!oath) return { error: "Invalid or expired verification link" };
    return settleOath(oath.id, verdict, note);
  }
  const supabase = createClient();
  const { error } = await supabase.rpc("verify_nominee", {
    p_token: token,
    p_success: verdict === "success",
    p_note: note ?? null,
  });
  if (error) return { error: error.message };
  notifyDataUpdated();
  return { error: null };
}

// ---- peerReviewProof — duo peer review of proof submission ----
export async function peerReviewProof(oathId: string, approve: boolean, note?: string) {
  if (isMockMode()) {
    const oaths = getMockOaths();
    const oath = oaths.find((o) => o.id === oathId);
    if (!oath) return { error: "Oath not found." };

    const updatedProofs = oath.proofs?.map((p) => {
      if (p.status === "pending_review") {
        return {
          ...p,
          status: (approve ? "verified" : "rejected") as ProofStatus,
          reviewer_id: ADMIN_MOCK_USER.id,
          review_note: note,
          reviewed_at: new Date().toISOString(),
        };
      }
      return p;
    });

    const updatedOaths = oaths.map((o) => (o.id === oathId ? { ...o, proofs: updatedProofs } : o));
    setMockOaths(updatedOaths);

    return settleOath(oathId, approve ? "success" : "penalty", note);
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  try {
    await supabase
      .from("proofs")
      .update({
        status: approve ? "verified" : "rejected",
        reviewer_id: user.id,
        review_note: note ?? null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("oath_id", oathId)
      .eq("status", "pending_review");
  } catch (err) {
    console.warn("Could not update proof status directly:", err);
  }

  const { error } = await supabase.rpc("settle_oath", {
    p_oath_id: oathId,
    p_success: approve,
    p_note: note ?? null,
  });
  if (error) return { error: error.message };
  notifyDataUpdated();
  return { error: null };
}

// ---- requestMoreProof — reviewer requests clearer evidence ----
export async function requestMoreProof(oathId: string, note: string): Promise<{ error: string | null }> {
  if (isMockMode()) {
    const oaths = getMockOaths();
    const updatedOaths = oaths.map((o) => {
      if (o.id === oathId) {
        const updatedProofs = o.proofs?.map((p, idx) =>
          idx === 0 || p.status === "pending_review"
            ? { ...p, status: "needs_more_proof" as ProofStatus, review_note: note, reviewed_at: new Date().toISOString() }
            : p
        );
        return { ...o, proofs: updatedProofs };
      }
      return o;
    });
    setMockOaths(updatedOaths);
    notifyDataUpdated();
    return { error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase.rpc("request_more_proof", {
    p_oath_id: oathId,
    p_note: note,
  });
  if (error) return { error: error.message };
  notifyDataUpdated();
  return { error: null };
}

// ---- passDailyWork — referee/opponent/quorum approves today's proof and advances cadence ----
export async function passDailyWork(oathId: string, note?: string): Promise<{ error: string | null; data?: any }> {
  if (isMockMode()) {
    const oaths = getMockOaths();
    const oath = oaths.find((o) => o.id === oathId);
    if (!oath) return { error: "Oath not found" };

    const totalDays = oath.total_days ?? 1;
    const currentDay = oath.current_day ?? 1;
    const isFinalDay = currentDay >= totalDays || totalDays <= 1;

    if (isFinalDay) {
      return settleOath(oathId, "success", note);
    } else {
      const updatedOaths = oaths.map((o) => {
        if (o.id === oathId) {
          const updatedProofs = o.proofs?.map((p, idx) =>
            idx === 0 || p.status === "pending_review" || p.status === "needs_more_proof"
              ? { ...p, status: "verified" as ProofStatus, review_note: note ?? "Passed", reviewed_at: new Date().toISOString() }
              : p
          );
          return {
            ...o,
            current_day: currentDay + 1,
            current_streak: (o.current_streak ?? 0) + 1,
            daily_deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            proofs: updatedProofs,
          };
        }
        return o;
      });
      setMockOaths(updatedOaths);
      notifyDataUpdated();
      return { error: null, data: { status: "active", current_day: currentDay + 1 } };
    }
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data, error } = await supabase.rpc("pass_today_work", {
    p_oath_id: oathId,
    p_note: note ?? null,
  });
  if (error) return { error: error.message };
  notifyDataUpdated();
  return { error: null, data };
}
export async function searchUsersByUsername(query: string): Promise<Array<{ id: string; username: string; display_name?: string }>> {
  if (isMockMode()) {
    const q = query.toLowerCase();
    const demoCandidates = [
      { id: "mock-user-ghost", username: "ghost_protocol", display_name: "Ghost Protocol" },
      { id: "mock-user-void", username: "void_walker", display_name: "Void Walker" },
      { id: "mock-user-iron", username: "iron_oath", display_name: "Iron Oath" },
      { id: "mock-user-deadweight", username: "deadweight", display_name: "Deadweight" },
      { id: "mock-user-silent", username: "silent_vow", display_name: "Silent Vow" },
      { id: "mock-user-reaper", username: "reaper_exe", display_name: "Reaper" },
    ];
    return demoCandidates.filter(u => u.username.toLowerCase().startsWith(q));
  }
  const supabase = createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, username, display_name")
    .ilike("username", `${query}%`)
    .limit(5);
  return data || [];
}
