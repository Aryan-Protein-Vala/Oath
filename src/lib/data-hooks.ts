// ============================================================
// OATH — Data Hooks (Supabase + Resilient Local Mock Adapter)
// ============================================================
"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Oath, WallEntry, Transaction, Proof, GroupMember, Wallet, OathType, VerificationMethod, ConsequenceType, ProofType } from "@/lib/types";
import {
  mockProfile,
  mockActiveOaths,
  mockSquadOaths,
  mockWallOfShame,
  mockWallOfHonor,
  mockTransactions,
} from "./mock-data";
import { useAuth, ADMIN_MOCK_USER, getInitialMockWallet } from "./auth-context";

export function isMockMode(): boolean {
  if (typeof window === "undefined") return false;
  return (
    localStorage.getItem("oath_admin_logged_in") === "true" ||
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL.includes("placeholder")
  );
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
    if (saved) return JSON.parse(saved);
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

// ---- useOaths — fetch user's active oaths ----
export function useOaths() {
  const { user } = useAuth();
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
      const { data, error } = await supabase
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

      if (error || !data) {
        setOaths(getMockOaths());
      } else {
        setOaths(data as Oath[]);
      }
    } catch {
      setOaths(getMockOaths());
    } finally {
      setLoading(false);
    }
  }, [user, supabase]);

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
  const [lobbies, setLobbies] = useState<Oath[]>(() => isMockMode() ? getMockSquads() : []);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  const loadData = useCallback(async () => {
    if (isMockMode()) {
      setLobbies(getMockSquads());
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
        .eq("oath_type", "squad")
        .in("status", ["pending", "active"])
        .order("created_at", { ascending: false });

      if (error || !data) {
        setLobbies(getMockSquads());
      } else {
        setLobbies(data as Oath[]);
      }
    } catch {
      setLobbies(getMockSquads());
    } finally {
      setLoading(false);
    }
  }, [supabase]);

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
  const [entries, setEntries] = useState<WallEntry[]>(() => isMockMode() ? getMockWall(type) : []);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  const loadData = useCallback(async () => {
    if (isMockMode()) {
      setEntries(getMockWall(type));
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

      if (error || !data || data.length === 0) {
        setEntries(getMockWall(type));
      } else {
        setEntries(data as WallEntry[]);
      }
    } catch {
      setEntries(getMockWall(type));
    } finally {
      setLoading(false);
    }
  }, [supabase, type]);

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

      if (error || !data || data.length === 0) {
        setTransactions(getMockTransactions());
      } else {
        setTransactions(data as Transaction[]);
      }
    } catch {
      setTransactions(getMockTransactions());
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
        setProofs(data as Proof[]);
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

function validatePositiveAmount(amount: unknown): number | null {
  const n = typeof amount === "number" ? amount : parseFloat(String(amount));
  if (!Number.isFinite(n) || isNaN(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
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
  min_players?: number;
  max_players?: number;
}): Promise<{ oath?: Oath; error: string | null }> {
  const validStake = validatePositiveAmount(data.stake_amount);
  if (validStake === null) {
    return { error: "Stake amount must be a positive number." };
  }
  if (new Date(data.deadline).getTime() <= Date.now()) {
    return { error: "Deadline must be in the future." };
  }

  if (isMockMode()) {
    const currentWallet = getInitialMockWallet();
    if (currentWallet.balance < validStake) {
      return { error: "Insufficient funds. Deposit more or lower the stake." };
    }

    const initialStatus = data.oath_type === "squad" ? "pending" : "active";

    const newOath: Oath = {
      id: `oath-${Date.now()}`,
      creator_id: ADMIN_MOCK_USER.id,
      creator: { ...mockProfile, username: "AryanTheAdmin" },
      oath_statement: data.oath_statement,
      deadline: data.deadline,
      oath_type: data.oath_type,
      verification_method: data.verification_method,
      consequence_type: data.consequence_type,
      stake_amount: validStake,
      house_cut_percent: 10,
      social_ransom_phone: data.social_ransom_phone,
      social_ransom_message: data.social_ransom_message,
      nominee_email: data.nominee_email,
      status: initialStatus,
      min_players: data.min_players ?? 1,
      max_players: data.max_players ?? 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      members: data.oath_type === "squad" ? [
        {
          id: `gm-${Date.now()}`,
          oath_id: `oath-${Date.now()}`,
          user_id: ADMIN_MOCK_USER.id,
          user: { ...mockProfile, username: "AryanTheAdmin" },
          stake_amount: validStake,
          status: "joined",
          proof_submitted: false,
          votes_received: 0,
          votes_needed: 3,
          is_winner: false,
        }
      ] : undefined,
    };

    // Update wallet
    const updatedWallet: Wallet = {
      ...currentWallet,
      balance: currentWallet.balance - validStake,
      escrow_locked: currentWallet.escrow_locked + validStake,
    };
    setMockWallet(updatedWallet);

    // Add transaction
    const newTx: Transaction = {
      id: `tx-${Date.now()}`,
      wallet_id: currentWallet.id,
      oath_id: newOath.id,
      type: "escrow_lock",
      amount: validStake,
      description: `Locked for: ${data.oath_statement}`,
      created_at: new Date().toISOString(),
    };
    setMockTransactions([newTx, ...getMockTransactions()]);

    // Save oath
    if (data.oath_type === "squad") {
      setMockSquads([newOath, ...getMockSquads()]);
    }
    setMockOaths([newOath, ...getMockOaths()]);

    return { oath: newOath, error: null };
  }

  // Real Supabase
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const initialStatus = data.oath_type === "squad" ? "pending" : "active";

  const { data: oath, error: oathError } = await supabase
    .from("oaths")
    .insert({ ...data, stake_amount: validStake, creator_id: user.id, status: initialStatus })
    .select()
    .single();

  if (oathError) return { error: oathError.message };

  // If nominee email provided, register in nominees table
  if (data.nominee_email && oath) {
    await supabase.from("nominees").insert({
      oath_id: oath.id,
      email: data.nominee_email,
    });
  }

  const { data: wallet } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!wallet || wallet.balance < validStake) {
    await supabase.from("oaths").delete().eq("id", oath.id);
    return { error: "Insufficient funds" };
  }

  await supabase
    .from("wallets")
    .update({
      balance: wallet.balance - validStake,
      escrow_locked: wallet.escrow_locked + validStake,
    })
    .eq("user_id", user.id);

  await supabase.from("transactions").insert({
    wallet_id: wallet.id,
    oath_id: oath.id,
    type: "escrow_lock",
    amount: validStake,
    description: `Locked for: ${data.oath_statement}`,
  });

  notifyDataUpdated();
  return { oath, error: null };
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
      total_deposited: currentWallet.total_deposited + validAmount,
    };
    setMockWallet(updatedWallet);

    const newTx: Transaction = {
      id: `tx-${Date.now()}`,
      wallet_id: currentWallet.id,
      type: "deposit",
      amount: validAmount,
      description: "Wallet deposit",
      created_at: new Date().toISOString(),
    };
    setMockTransactions([newTx, ...getMockTransactions()]);
    return { error: null };
  }

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
      balance: wallet.balance + validAmount,
      total_deposited: wallet.total_deposited + validAmount,
    })
    .eq("user_id", user.id);

  await supabase.from("transactions").insert({
    wallet_id: wallet.id,
    type: "deposit",
    amount: validAmount,
    description: "Wallet deposit",
  });

  notifyDataUpdated();
  return { error: null };
}

// ---- withdrawFunds ----
export async function withdrawFunds(amount: number) {
  const validAmount = validatePositiveAmount(amount);
  if (validAmount === null) return { error: "Withdrawal amount must be a positive number." };

  if (isMockMode()) {
    const currentWallet = getInitialMockWallet();
    if (currentWallet.balance < validAmount) return { error: "Insufficient funds" };

    const updatedWallet: Wallet = {
      ...currentWallet,
      balance: currentWallet.balance - validAmount,
      total_withdrawn: currentWallet.total_withdrawn + validAmount,
    };
    setMockWallet(updatedWallet);

    const newTx: Transaction = {
      id: `tx-${Date.now()}`,
      wallet_id: currentWallet.id,
      type: "withdrawal",
      amount: validAmount,
      description: "Wallet withdrawal",
      created_at: new Date().toISOString(),
    };
    setMockTransactions([newTx, ...getMockTransactions()]);
    return { error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: wallet } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!wallet || wallet.balance < validAmount) return { error: "Insufficient funds" };

  await supabase
    .from("wallets")
    .update({
      balance: wallet.balance - validAmount,
      total_withdrawn: wallet.total_withdrawn + validAmount,
    })
    .eq("user_id", user.id);

  await supabase.from("transactions").insert({
    wallet_id: wallet.id,
    type: "withdrawal",
    amount: validAmount,
    description: "Wallet withdrawal",
  });

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
      submitter: { ...mockProfile, username: "AryanTheAdmin" },
      proof_type: data.proof_type,
      proof_url: data.proof_url,
      proof_text: data.proof_text,
      status: "pending_review",
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
        return { ...s, members: updatedMembers };
      }
      return s;
    });
    setMockSquads(updatedSquads);

    return { proof: newProof, error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: proof, error } = await supabase
    .from("proofs")
    .insert({ ...data, submitted_by: user.id, status: "pending_review" })
    .select()
    .single();

  notifyDataUpdated();
  return { proof, error: error?.message ?? null };
}

// ---- joinSquad ----
export async function joinSquad(oathId: string, stakeAmount: number) {
  if (isMockMode()) {
    const currentWallet = getInitialMockWallet();
    if (currentWallet.balance < stakeAmount) return { error: "Insufficient funds to join pool." };

    const squads = getMockSquads();
    const target = squads.find((s) => s.id === oathId);
    if (!target) return { error: "Squad pool not found." };

    if (target.members?.some((m) => m.user_id === ADMIN_MOCK_USER.id)) {
      return { error: "You have already joined this squad pool." };
    }

    const newMember: GroupMember = {
      id: `gm-${Date.now()}`,
      oath_id: oathId,
      user_id: ADMIN_MOCK_USER.id,
      user: { ...mockProfile, username: "AryanTheAdmin" },
      stake_amount: stakeAmount,
      status: "joined",
      proof_submitted: false,
      votes_received: 0,
      votes_needed: 3,
      is_winner: false,
    };

    const updatedSquads = squads.map((s) => {
      if (s.id === oathId) {
        return {
          ...s,
          members: [...(s.members ?? []), newMember],
        };
      }
      return s;
    });
    setMockSquads(updatedSquads);

    // Lock funds
    const updatedWallet: Wallet = {
      ...currentWallet,
      balance: currentWallet.balance - stakeAmount,
      escrow_locked: currentWallet.escrow_locked + stakeAmount,
    };
    setMockWallet(updatedWallet);

    const newTx: Transaction = {
      id: `tx-${Date.now()}`,
      wallet_id: currentWallet.id,
      oath_id: oathId,
      type: "escrow_lock",
      amount: stakeAmount,
      description: `Joined squad pool: ${target.oath_statement}`,
      created_at: new Date().toISOString(),
    };
    setMockTransactions([newTx, ...getMockTransactions()]);

    return { error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { data: wallet } = await supabase
    .from("wallets")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (!wallet || wallet.balance < stakeAmount) return { error: "Insufficient funds" };

  const { error: memberError } = await supabase
    .from("group_members")
    .insert({ oath_id: oathId, user_id: user.id, stake_amount: stakeAmount, status: "joined" });

  if (memberError) return { error: memberError.message };

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

  notifyDataUpdated();
  return { error: null };
}

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
            const votesReceived = vote ? m.votes_received + 1 : Math.max(0, m.votes_received - 1);
            const isCompleted = votesReceived >= m.votes_needed;
            return {
              ...m,
              votes_received: votesReceived,
              status: isCompleted ? ("completed" as const) : m.status,
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

  // Resolve targetId to proof_id
  let proofId = targetId;
  const { data: proof } = await supabase
    .from("proofs")
    .select("id, submitted_by")
    .eq("oath_id", oathId)
    .or(`id.eq.${targetId},submitted_by.eq.${targetId}`)
    .maybeSingle();

  if (proof) {
    if (proof.submitted_by === user.id) {
      return { error: "You cannot vote on your own proof." };
    }
    proofId = proof.id;
  } else {
    // If targetId is a group_member record, find the user_id
    const { data: member } = await supabase
      .from("group_members")
      .select("user_id, proof_submitted")
      .eq("id", targetId)
      .maybeSingle();

    if (member) {
      if (member.user_id === user.id) {
        return { error: "You cannot vote on your own proof." };
      }
      const { data: memberProof } = await supabase
        .from("proofs")
        .select("id")
        .eq("oath_id", oathId)
        .eq("submitted_by", member.user_id)
        .maybeSingle();

      if (memberProof) {
        proofId = memberProof.id;
      } else {
        return { error: "Member has not uploaded verifiable proof yet." };
      }
    } else {
      return { error: "No verifiable proof found to cast vote on." };
    }
  }

  const { error } = await supabase
    .from("votes")
    .upsert({ proof_id: proofId, oath_id: oathId, voter_id: user.id, vote }, { onConflict: "proof_id,voter_id" });

  if (error) return { error: error.message };

  if (vote) {
    const { count } = await supabase
      .from("votes")
      .select("*", { count: "exact", head: true })
      .eq("proof_id", proofId)
      .eq("vote", true);

    if (count !== null) {
      const { data: proofRecord } = await supabase
        .from("proofs")
        .select("submitted_by")
        .eq("id", proofId)
        .single();

      if (proofRecord) {
        await supabase
          .from("group_members")
          .update({
            votes_received: count,
            status: count >= 3 ? "completed" : "joined",
          })
          .eq("oath_id", oathId)
          .eq("user_id", proofRecord.submitted_by);
      }
    }
  }

  notifyDataUpdated();
  return { error: null };
}

// ---- uploadProofFile ----
export async function uploadProofFile(file: File, oathId: string): Promise<string | null> {
  if (isMockMode()) {
    // Return object URL for instant preview
    try {
      return URL.createObjectURL(file);
    } catch {
      return "https://images.unsplash.com/photo-1517838277536-f5f99be501cd?w=600";
    }
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return URL.createObjectURL(file);

  const ext = file.name.split(".").pop();
  const path = `proofs/${oathId}/${user.id}-${Date.now()}.${ext}`;

  try {
    const { error } = await supabase.storage.from("oath-proofs").upload(path, file);
    if (error) {
      return URL.createObjectURL(file);
    }
    const { data } = supabase.storage.from("oath-proofs").getPublicUrl(path);
    return data.publicUrl;
  } catch {
    return URL.createObjectURL(file);
  }
}

// ---- createDuoChallenge ----
export async function createDuoChallenge(data: {
  oath_statement: string;
  deadline: string;
  stake_amount: number;
  opponent_email?: string;
  opponent_username?: string;
}): Promise<{ oath?: Oath; error: string | null }> {
  if (isMockMode()) {
    const currentWallet = getInitialMockWallet();
    if (currentWallet.balance < data.stake_amount) {
      return { error: "Insufficient funds for duo wager." };
    }

    const newOath: Oath = {
      id: `duo-${Date.now()}`,
      creator_id: ADMIN_MOCK_USER.id,
      creator: { ...mockProfile, username: "AryanTheAdmin" },
      oath_statement: data.oath_statement,
      deadline: data.deadline,
      oath_type: "duo",
      verification_method: "peer",
      consequence_type: "bounty_transfer",
      stake_amount: data.stake_amount,
      house_cut_percent: 10,
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
      consequence_type: "bounty_transfer",
      stake_amount: data.stake_amount,
      status: "pending",
    })
    .select()
    .single();

  if (error) return { error: error.message };
  notifyDataUpdated();
  return { oath, error: null };
}

// ---- acceptDuoChallenge ----
export async function acceptDuoChallenge(oathId: string) {
  if (isMockMode()) {
    const oaths = getMockOaths();
    const target = oaths.find((o) => o.id === oathId);
    if (!target) return { error: "Challenge not found" };

    const currentWallet = getInitialMockWallet();
    if (currentWallet.balance < target.stake_amount) {
      return { error: "Insufficient funds to accept this challenge." };
    }

    const updatedOaths = oaths.map((o) => {
      if (o.id === oathId) {
        return {
          ...o,
          status: "active" as const,
          opponent_id: ADMIN_MOCK_USER.id,
          opponent: { ...mockProfile, username: "AryanTheAdmin" },
        };
      }
      return o;
    });
    setMockOaths(updatedOaths);

    // Lock funds
    const updatedWallet: Wallet = {
      ...currentWallet,
      balance: currentWallet.balance - target.stake_amount,
      escrow_locked: currentWallet.escrow_locked + target.stake_amount,
    };
    setMockWallet(updatedWallet);

    const newTx: Transaction = {
      id: `tx-${Date.now()}`,
      wallet_id: currentWallet.id,
      oath_id: oathId,
      type: "escrow_lock",
      amount: target.stake_amount,
      description: `Accepted Duo Challenge: ${target.oath_statement}`,
      created_at: new Date().toISOString(),
    };
    setMockTransactions([newTx, ...getMockTransactions()]);
    return { error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const { error } = await supabase
    .from("oaths")
    .update({ status: "active", opponent_id: user.id })
    .eq("id", oathId);

  notifyDataUpdated();
  return { error: error?.message ?? null };
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

    // Add to Wall of Shame
    const shameEntry: WallEntry = {
      id: `ws-${Date.now()}`,
      oath_id: oathId,
      user_id: ADMIN_MOCK_USER.id,
      wall_type: "shame",
      oath_statement: oath.oath_statement,
      stake_amount: oath.stake_amount,
      excuse: excuse || "I gave up under pressure.",
      username: "AryanTheAdmin",
      created_at: new Date().toISOString(),
    };
    setMockWall("shame", [shameEntry, ...getMockWall("shame")]);

    return { error: null };
  }

  const supabase = createClient();
  const { data: oath } = await supabase
    .from("oaths")
    .select("*")
    .eq("id", oathId)
    .single();

  if (!oath) return { error: "Oath not found." };
  if (oath.status !== "active") return { error: "Oath is not active or already settled." };

  const { error } = await supabase
    .from("oaths")
    .update({ status: "failed", failed_at: new Date().toISOString(), failure_excuse: excuse })
    .eq("id", oathId);

  if (error) return { error: error.message };

  // Fallback wallet update for Supabase mode
  try {
    const { data: wallet } = await supabase
      .from("wallets")
      .select("*")
      .eq("user_id", oath.creator_id)
      .single();

    if (wallet) {
      await supabase
        .from("wallets")
        .update({
          escrow_locked: Math.max(0, wallet.escrow_locked - oath.stake_amount),
        })
        .eq("id", wallet.id);

      await supabase.from("transactions").insert({
        wallet_id: wallet.id,
        oath_id: oath.id,
        type: "penalty",
        amount: oath.stake_amount,
        description: `Forfeited oath: ${oath.oath_statement}`,
      });
    }
  } catch (err) {
    console.warn("Wallet forfeit fallback note:", err);
  }

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
    const houseCut = isDuo ? pot * ((oath.house_cut_percent ?? 10) / 100) : 0;
    const winnerPayout = isDuo ? pot - houseCut : oath.stake_amount;

    if (verdict === "success") {
      // Release escrow back to balance and credit winnings
      const updatedWallet: Wallet = {
        ...currentWallet,
        balance: currentWallet.balance + winnerPayout,
        escrow_locked: Math.max(0, currentWallet.escrow_locked - oath.stake_amount),
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
          ? `Won Duo Challenge ($${winnerPayout.toFixed(2)} after $${houseCut.toFixed(2)} fee): ${oath.oath_statement}`
          : `Completed: ${oath.oath_statement}`,
        created_at: new Date().toISOString(),
      };
      setMockTransactions([newTx, ...getMockTransactions()]);

      const honorEntry: WallEntry = {
        id: `wh-${Date.now()}`,
        oath_id: oathId,
        user_id: ADMIN_MOCK_USER.id,
        wall_type: "honor",
        oath_statement: oath.oath_statement,
        stake_amount: oath.stake_amount,
        username: "AryanTheAdmin",
        created_at: new Date().toISOString(),
      };
      setMockWall("honor", [honorEntry, ...getMockWall("honor")]);
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

      const shameEntry: WallEntry = {
        id: `ws-${Date.now()}`,
        oath_id: oathId,
        user_id: ADMIN_MOCK_USER.id,
        wall_type: "shame",
        oath_statement: oath.oath_statement,
        stake_amount: oath.stake_amount,
        excuse: note || (isDuo ? "Lost duo wager challenge." : "Failed to submit sufficient proof before the deadline."),
        username: "AryanTheAdmin",
        created_at: new Date().toISOString(),
      };
      setMockWall("shame", [shameEntry, ...getMockWall("shame")]);
    }

    return { error: null };
  }

  const supabase = createClient();
  const { data: oath } = await supabase
    .from("oaths")
    .select("*")
    .eq("id", oathId)
    .single();

  if (!oath) return { error: "Oath not found." };
  if (oath.status !== "active") return { error: "Oath is not active or already settled." };

  const updatePayload =
    verdict === "success"
      ? { status: "completed", completed_at: new Date().toISOString() }
      : { status: "failed", failed_at: new Date().toISOString(), failure_excuse: note };

  const { error } = await supabase.from("oaths").update(updatePayload).eq("id", oathId);
  if (error) return { error: error.message };

  // Fallback wallet settlement in case DB trigger is not active
  try {
    const isDuo = oath.oath_type === "duo";
    const pot = isDuo ? oath.stake_amount * 2 : oath.stake_amount;
    const houseCut = isDuo ? pot * ((oath.house_cut_percent ?? 10) / 100) : 0;
    const winnerPayout = isDuo ? pot - houseCut : oath.stake_amount;

    if (verdict === "success") {
      const { data: creatorWallet } = await supabase.from("wallets").select("*").eq("user_id", oath.creator_id).single();
      if (creatorWallet) {
        await supabase.from("wallets").update({
          balance: creatorWallet.balance + winnerPayout,
          escrow_locked: Math.max(0, creatorWallet.escrow_locked - oath.stake_amount),
        }).eq("id", creatorWallet.id);

        await supabase.from("transactions").insert({
          wallet_id: creatorWallet.id,
          oath_id: oath.id,
          type: "escrow_release",
          amount: winnerPayout,
          description: isDuo ? `Won Duo Challenge: ${oath.oath_statement}` : `Completed: ${oath.oath_statement}`,
        });
      }

      if (isDuo && oath.opponent_id) {
        const { data: opponentWallet } = await supabase.from("wallets").select("*").eq("user_id", oath.opponent_id).single();
        if (opponentWallet) {
          await supabase.from("wallets").update({
            escrow_locked: Math.max(0, opponentWallet.escrow_locked - oath.stake_amount),
          }).eq("id", opponentWallet.id);
        }
      }
    } else {
      const { data: creatorWallet } = await supabase.from("wallets").select("*").eq("user_id", oath.creator_id).single();
      if (creatorWallet) {
        await supabase.from("wallets").update({
          escrow_locked: Math.max(0, creatorWallet.escrow_locked - oath.stake_amount),
        }).eq("id", creatorWallet.id);

        await supabase.from("transactions").insert({
          wallet_id: creatorWallet.id,
          oath_id: oath.id,
          type: "penalty",
          amount: oath.stake_amount,
          description: `Failed: ${oath.oath_statement}`,
        });
      }

      if (isDuo && oath.opponent_id) {
        const { data: opponentWallet } = await supabase.from("wallets").select("*").eq("user_id", oath.opponent_id).single();
        if (opponentWallet) {
          await supabase.from("wallets").update({
            balance: opponentWallet.balance + winnerPayout,
            escrow_locked: Math.max(0, opponentWallet.escrow_locked - oath.stake_amount),
          }).eq("id", opponentWallet.id);
        }
      }
    }
  } catch (err) {
    console.warn("Client-side wallet settlement fallback notice:", err);
  }

  notifyDataUpdated();
  return { error: null };
}

// ---- verifyNominee ----
export async function verifyNominee(token: string, verdict: "success" | "penalty", note?: string) {
  if (isMockMode()) {
    const oaths = getMockOaths();
    const oath = oaths.find((o) => o.id === token || o.nominee_email) || oaths[0];
    if (oath) {
      await settleOath(oath.id, verdict, note);
    }
    return { error: null };
  }

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

  await settleOath(nominee.oath_id, verdict, note);
  notifyDataUpdated();
  return { error: null };
}
