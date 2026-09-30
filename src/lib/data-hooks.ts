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
import { useAuth, ADMIN_MOCK_USER, getInitialMockWallet, isDemoSession } from "./auth-context";

export function isMockMode(): boolean {
  if (typeof window === "undefined") return false;
  return isDemoSession();
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
      const { data: memberships } = await supabase.from("group_members").select("oath_id").eq("user_id", user.id);
      const membershipFilter = (memberships ?? []).map((member) => member.oath_id).filter(Boolean);
      const filters = [`creator_id.eq.${user.id}`, `opponent_id.eq.${user.id}`];
      if (membershipFilter.length) filters.push(`id.in.(${membershipFilter.join(",")})`);
      const { data, error } = await supabase
        .from("oaths")
        .select(`*, creator:profiles!oaths_creator_id_fkey(*), opponent:profiles!oaths_opponent_id_fkey(*), members:group_members(*, user:profiles(*)), proofs(*)`)
        .or(filters.join(","))
        .in("status", ["pending", "active", "disputed"])
        .order("created_at", { ascending: false });

      if (error || !data) {
        setOaths([]);
      } else {
        setOaths(data as Oath[]);
      }
    } catch {
      setOaths([]);
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
  const { user } = useAuth();
  const [lobbies, setLobbies] = useState<Oath[]>(() => isMockMode() ? getMockSquads() : []);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);

  const loadData = useCallback(async () => {
    if (isMockMode()) {
      setLobbies(getMockSquads());
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
        .eq("oath_type", "squad")
        .in("status", ["pending", "active"])
        .order("created_at", { ascending: false });

      if (error || !data) {
        setLobbies([]);
      } else {
        const oathRows = data as Oath[];
        const oathIds = oathRows.map((oath) => oath.id);
        const [{ data: proofs }, { data: votes }] = oathIds.length ? await Promise.all([
          supabase.from("proofs").select("id,oath_id,submitted_by").in("oath_id", oathIds),
          supabase.from("votes").select("proof_id,oath_id,voter_id,vote").in("oath_id", oathIds),
        ]) : [{ data: [] }, { data: [] }];
        const proofRows = proofs ?? [];
        const voteRows = votes ?? [];
        setLobbies(oathRows.map((oath) => ({
          ...oath,
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
    } catch {
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
  if (!Number.isFinite(n) || n < 0 || Math.abs(n * 100 - Math.round(n * 100)) > 1e-7) return null;
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
  min_players?: number;
  max_players?: number;
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
  if ((data.oath_type === "duo" || data.oath_type === "squad" || data.consequence_type === "fiat") && validStake <= 0) {
    return { error: "This oath requires a positive stake." };
  }

  if (isMockMode()) {
    const currentWallet = getInitialMockWallet();
    if (currentWallet.balance < validStake) {
      return { error: "Insufficient funds. Deposit more or lower the stake." };
    }

    const initialStatus = data.oath_type === "squad" ? "pending" : "active";
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
      min_players: data.min_players ?? 1,
      max_players: data.max_players ?? 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      members: data.oath_type === "squad" ? [
        {
          id: `gm-${Date.now()}`,
          oath_id: demoOathId,
          user_id: ADMIN_MOCK_USER.id,
          user: { ...mockProfile, username: "DemoUser" },
          stake_amount: validStake,
          status: "joined",
          proof_submitted: false,
          votes_received: 0,
          votes_needed: 3,
          is_active_participant: false,
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
    p_social_ransom_phone: data.social_ransom_phone ?? null,
    p_social_ransom_message: data.social_ransom_message ?? null,
    p_nominee_email: data.nominee_email ?? null,
    p_min_players: data.min_players ?? 1,
    p_max_players: data.max_players ?? 1,
    p_opponent_id: null,
  });
  if (error || !oathId) return { error: error?.message ?? "Oath creation failed" };

  const { data: oath, error: readError } = await supabase
    .from("oaths")
    .select("*, creator:profiles!oaths_creator_id_fkey(*), members:group_members(*, user:profiles(*))")
    .eq("id", oathId)
    .single();
  if (readError || !oath) return { error: readError?.message ?? "Oath was created but could not be loaded. Refresh to view it." };
  notifyDataUpdated();
  return { oath: oath as Oath, error: null };
}

// ---- depositFunds ----
export async function depositFunds(amount: number) {
  const validAmount = validatePositiveAmount(amount);
  if (validAmount === null) return { error: "Deposit amount must be a positive number." };
  if (!isMockMode()) return { error: "Real deposits are disabled until a verified payment provider is connected." };
  const currentWallet = getInitialMockWallet();
  const updatedWallet: Wallet = { ...currentWallet, balance: currentWallet.balance + validAmount, total_deposited: currentWallet.total_deposited + validAmount };
  setMockWallet(updatedWallet);
  const tx: Transaction = { id: `tx-${Date.now()}`, wallet_id: currentWallet.id, type: "deposit", amount: validAmount, description: "Demo-only virtual deposit", created_at: new Date().toISOString() };
  setMockTransactions([tx, ...getMockTransactions()]);
  return { error: null };
}

// ---- withdrawFunds ----
export async function withdrawFunds(amount: number) {
  const validAmount = validatePositiveAmount(amount);
  if (validAmount === null) return { error: "Withdrawal amount must be a positive number." };
  if (!isMockMode()) return { error: "Real withdrawals are disabled until a verified payment provider is connected." };
  const currentWallet = getInitialMockWallet();
  if (currentWallet.balance < validAmount) return { error: "Insufficient funds" };
  const updatedWallet: Wallet = { ...currentWallet, balance: currentWallet.balance - validAmount, total_withdrawn: currentWallet.total_withdrawn + validAmount };
  setMockWallet(updatedWallet);
  const tx: Transaction = { id: `tx-${Date.now()}`, wallet_id: currentWallet.id, type: "withdrawal", amount: validAmount, description: "Demo-only virtual withdrawal", created_at: new Date().toISOString() };
  setMockTransactions([tx, ...getMockTransactions()]);
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
  const { data: proofId, error } = await supabase.rpc("submit_oath_proof", {
    p_oath_id: data.oath_id,
    p_proof_type: data.proof_type,
    p_proof_url: data.proof_url ?? null,
    p_proof_text: data.proof_text ?? null,
  });
  if (error || !proofId) return { error: error?.message ?? "Proof submission failed" };
  notifyDataUpdated();
  return { proof: { ...data, id: proofId, submitted_by: user.id, status: "pending_review", created_at: new Date().toISOString() } as Proof, error: null };
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
  const { error } = await supabase.rpc("join_squad", { p_oath_id: oathId, p_stake_amount: stakeAmount });
  if (error) return { error: error.message };
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
export async function failSquadMember(oathId: string) {
  if (isMockMode()) {
    const squads = getMockSquads();
    const squad = squads.find((candidate) => candidate.id === oathId);
    if (!squad) return { error: "Squad not found." };
    if (new Date(squad.deadline).getTime() > Date.now()) return { error: "Squad deadline has not passed." };
    const member = squad.members?.find((candidate) => candidate.user_id === ADMIN_MOCK_USER.id);
    if (!member || member.status !== "joined") return { error: "No unresolved squad membership found." };
    if (member.proof_submitted) return { error: "Submitted proof must be resolved by quorum." };
    const wallet = getInitialMockWallet();
    if (wallet.escrow_locked < member.stake_amount) return { error: "Member escrow is inconsistent." };
    setMockWallet({ ...wallet, escrow_locked: wallet.escrow_locked - member.stake_amount, total_lost: (wallet.total_lost ?? 0) + member.stake_amount });
    setMockSquads(squads.map((candidate) => candidate.id === oathId ? {
      ...candidate,
      members: candidate.members?.map((item) => item.id === member.id ? { ...item, status: "failed" as const } : item),
    } : candidate));
    const transaction: Transaction = {
      id: `tx-${Date.now()}`,
      wallet_id: wallet.id,
      oath_id: oathId,
      type: "penalty",
      amount: member.stake_amount,
      description: "Squad deadline passed without proof",
      created_at: new Date().toISOString(),
    };
    setMockTransactions([transaction, ...getMockTransactions()]);
    return { error: null };
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { error } = await supabase.rpc("fail_squad_member", { p_oath_id: oathId });
  if (error) return { error: error.message };
  notifyDataUpdated();
  return { error: null };
}

// ---- uploadProofFile ----
export async function uploadProofFile(file: File, oathId: string): Promise<string | null> {
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) return null;
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"]);
  if (!allowedTypes.has(file.type)) return null;
  if (isMockMode()) {
    try { return URL.createObjectURL(file); } catch { return null; }
  }
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const extensionByType: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "video/mp4": "mp4", "video/webm": "webm" };
  const path = `${oathId}/${user.id}/${crypto.randomUUID()}.${extensionByType[file.type]}`;
  const { error } = await supabase.storage.from("oath-proofs").upload(path, file, { contentType: file.type, upsert: false });
  if (error) return null;
  return path;
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
    p_opponent_id: opponentId,
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
          opponent: { ...mockProfile, username: "DemoUser" },
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
  const { error } = await supabase.rpc("accept_duo_challenge", { p_oath_id: oathId });
  if (error) return { error: error.message };
  notifyDataUpdated();
  return { error: null };
}

// ---- cancelDuoChallenge — refund a pending invitation's creator stake ----
export async function cancelDuoChallenge(oathId: string) {
  if (isMockMode()) {
    const oaths = getMockOaths();
    const oath = oaths.find((item) => item.id === oathId);
    if (!oath || oath.oath_type !== "duo" || oath.status !== "pending") return { error: "Challenge is no longer pending." };
    if (oath.creator_id !== ADMIN_MOCK_USER.id) return { error: "Only the challenge creator can cancel it." };
    const wallet = getInitialMockWallet();
    if (wallet.escrow_locked < oath.stake_amount) return { error: "Creator escrow is inconsistent." };
    setMockWallet({ ...wallet, balance: wallet.balance + oath.stake_amount, escrow_locked: wallet.escrow_locked - oath.stake_amount });
    setMockOaths(oaths.map((item) => item.id === oathId ? { ...item, status: "cancelled" as const } : item));
    setMockTransactions([{ id: `tx-${Date.now()}`, wallet_id: wallet.id, oath_id: oathId, type: "escrow_release", amount: oath.stake_amount, description: "Cancelled duo invite; stake returned", created_at: new Date().toISOString() }, ...getMockTransactions()]);
    return { error: null };
  }
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };
  const { error } = await supabase.rpc("cancel_duo_challenge", { p_oath_id: oathId });
  if (error) return { error: error.message };
  notifyDataUpdated();
  return { error: null };
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
    const platformFee = isDuo ? pot * (10 / 100) : 0;
    const winnerPayout = isDuo ? pot - platformFee : oath.stake_amount;

    if (verdict === "success") {
      // Release escrow back to balance and credit success amount
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
          ? `Completed Duo Challenge ($${winnerPayout.toFixed(2)} after $${platformFee.toFixed(2)} fee): ${oath.oath_statement}`
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
