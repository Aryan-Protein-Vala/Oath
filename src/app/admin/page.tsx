"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import {
  Shield,
  Ban,
  CheckCircle,
  Plus,
  Minus,
  Mail,
  Loader2,
  ArrowLeft,
  AlertTriangle,
  Scale,
  XCircle,
  RefreshCw,
  Power,
  BarChart3,
  Users,
  Eye,
  Clock,
  Search,
  Send,
  Megaphone,
  ToggleLeft,
  ToggleRight,
  FileText,
  ChevronDown,
  ChevronRight,
  DollarSign,
  Flame,
  Trophy,
  Skull,
  Activity,
  Bell,
  Settings,
  Trash2,
  Copy,
  ExternalLink,
} from "lucide-react";
import { showToast } from "@/components/Toast";
import Link from "next/link";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";
import { isMockMode } from "@/lib/data-hooks";
import { mockProfile, mockTransactions } from "@/lib/mock-data";

// ============================================================
// TYPES
// ============================================================

interface AdminDispute {
  id: string;
  oath_id: string;
  oath_statement: string;
  creator_username: string;
  referee_username: string;
  stake_amount: number;
  reason: string;
  status: "disputed" | "resolved_swearer" | "resolved_counterparty";
  created_at: string;
}

interface PlatformStats {
  totalUsers: number;
  activeUsers7d: number;
  totalOaths: number;
  completedOaths: number;
  failedOaths: number;
  activeOaths: number;
  pendingOaths: number;
  successRate: number;
  totalEscrowLocked: number;
  totalMoneyLost: number;
  totalDeposited: number;
  totalWithdrawn: number;
  platformRevenue: number;
}

interface AuditEntry {
  id: string;
  action: string;
  targetUser?: string;
  details: string;
  timestamp: string;
}

interface CronResult {
  ghostedProofs: number;
  expiredOaths: number;
  timestamp: string;
  success: boolean;
  error?: string;
}

interface FeatureFlags {
  duoMode: boolean;
  squadMode: boolean;
  lobbyMode: boolean;
  newSignups: boolean;
  withdrawals: boolean;
  minStake: number;
  maxStake: number;
}

type AdminTab = "analytics" | "users" | "oaths" | "disputes" | "cron" | "broadcast" | "flags" | "audit";

// ============================================================
// MOCK DATA
// ============================================================

const INITIAL_MOCK_DISPUTES: AdminDispute[] = [
  {
    id: "disp-101",
    oath_id: "oath-abc",
    oath_statement: "Run 10km under 50 minutes",
    creator_username: "reaper_exe",
    referee_username: "ghost_protocol",
    stake_amount: 150,
    reason: "Nominee claims GPS screenshot was cropped and missed last 800m.",
    status: "disputed",
    created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
  },
  {
    id: "disp-102",
    oath_id: "oath-def",
    oath_statement: "No phone after 10 PM for 7 days",
    creator_username: "void_walker",
    referee_username: "iron_will",
    stake_amount: 75,
    reason: "Screen time proof shows battery recharge anomaly at 10:15 PM.",
    status: "disputed",
    created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
  },
];

const MOCK_STATS: PlatformStats = {
  totalUsers: 847,
  activeUsers7d: 312,
  totalOaths: 2_341,
  completedOaths: 1_567,
  failedOaths: 489,
  activeOaths: 197,
  pendingOaths: 88,
  successRate: 76.2,
  totalEscrowLocked: 14_250,
  totalMoneyLost: 32_780,
  totalDeposited: 128_400,
  totalWithdrawn: 67_200,
  platformRevenue: 3_278,
};

// ============================================================
// COMPONENT
// ============================================================

export default function AdminDashboard() {
  const { user } = useAuth();
  const supabase = createClient();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>("analytics");

  // Data states
  const [users, setUsers] = useState<any[]>([]);
  const [allOaths, setAllOaths] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  const [disputes, setDisputes] = useState<AdminDispute[]>(INITIAL_MOCK_DISPUTES);
  const [stats, setStats] = useState<PlatformStats>(MOCK_STATS);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [cronResults, setCronResults] = useState<CronResult[]>([]);
  const [isEmergencyPaused, setIsEmergencyPaused] = useState(false);
  const [loading, setLoading] = useState(true);

  // UI states
  const [fundAmount, setFundAmount] = useState<Record<string, string>>({});
  const [funding, setFunding] = useState<Record<string, boolean>>({});
  const [blocking, setBlocking] = useState<Record<string, boolean>>({});
  const [userSearch, setUserSearch] = useState("");
  const [oathSearch, setOathSearch] = useState("");
  const [oathStatusFilter, setOathStatusFilter] = useState<string>("all");
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [expandedOath, setExpandedOath] = useState<string | null>(null);
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcastSending, setBroadcastSending] = useState(false);
  const [cronRunning, setCronRunning] = useState(false);
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>({
    duoMode: true,
    squadMode: true,
    lobbyMode: true,
    newSignups: true,
    withdrawals: true,
    minStake: 1,
    maxStake: 10000,
  });

  // ============================================================
  // AUDIT HELPER
  // ============================================================
  const addAuditEntry = useCallback((action: string, targetUser: string | undefined, details: string) => {
    const entry: AuditEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      action,
      targetUser,
      details,
      timestamp: new Date().toISOString(),
    };
    setAuditLog((prev) => [entry, ...prev].slice(0, 200));
  }, []);

  // ============================================================
  // AUTH + DATA LOADING
  // ============================================================
  useEffect(() => {
    if (!user) return;
    if (
      user.email === "aryansharma24112003@gmail.com" ||
      user.email === "admin@oath.app" ||
      isMockMode()
    ) {
      setIsAdmin(true);
      fetchAdminData();
    } else {
      setIsAdmin(false);
      setLoading(false);
    }
  }, [user]);

  const fetchAdminData = async () => {
    setLoading(true);

    if (isMockMode()) {
      setUsers([
        {
          id: mockProfile.id,
          username: mockProfile.username,
          display_name: mockProfile.display_name,
          is_blocked: false,
          oaths_created: 12,
          oaths_completed: 9,
          oaths_failed: 3,
          total_staked: 450,
          total_lost: 120,
          total_won: 280,
          created_at: new Date(Date.now() - 86400000 * 30).toISOString(),
          wallets: [{ balance: 1247.5, escrow_locked: 200, total_deposited: 2000, total_withdrawn: 500 }],
        },
        {
          id: "u-002",
          username: "ghost_protocol",
          display_name: "Ghost Protocol",
          is_blocked: false,
          oaths_created: 45,
          oaths_completed: 38,
          oaths_failed: 7,
          total_staked: 1800,
          total_lost: 340,
          total_won: 1200,
          created_at: new Date(Date.now() - 86400000 * 60).toISOString(),
          wallets: [{ balance: 8400.0, escrow_locked: 500, total_deposited: 12000, total_withdrawn: 3000 }],
        },
        {
          id: "u-003",
          username: "void_walker",
          display_name: "Void Walker",
          is_blocked: true,
          oaths_created: 6,
          oaths_completed: 1,
          oaths_failed: 5,
          total_staked: 300,
          total_lost: 250,
          total_won: 30,
          created_at: new Date(Date.now() - 86400000 * 90).toISOString(),
          wallets: [{ balance: 350.0, escrow_locked: 0, total_deposited: 600, total_withdrawn: 0 }],
        },
      ]);
      setAllOaths([
        {
          id: "oath-001",
          oath_statement: "Run 5km every morning for a week",
          oath_type: "solo",
          status: "active",
          stake_amount: 50,
          deadline: new Date(Date.now() + 86400000 * 3).toISOString(),
          verification_method: "nominee",
          consequence_type: "fiat",
          creator: { username: "reaper_exe" },
          created_at: new Date(Date.now() - 86400000).toISOString(),
          members: [{ user_id: "u-001", status: "joined", user: { username: "reaper_exe" } }],
          proofs: [],
        },
        {
          id: "oath-002",
          oath_statement: "No sugar for 30 days",
          oath_type: "duo",
          status: "completed",
          stake_amount: 100,
          deadline: new Date(Date.now() - 86400000 * 2).toISOString(),
          verification_method: "peer",
          consequence_type: "fiat",
          creator: { username: "ghost_protocol" },
          opponent: { username: "void_walker" },
          created_at: new Date(Date.now() - 86400000 * 32).toISOString(),
          members: [],
          proofs: [{ id: "p-1", status: "verified", proof_type: "photo", created_at: new Date().toISOString() }],
        },
        {
          id: "oath-003",
          oath_statement: "Finish React project by Friday",
          oath_type: "squad",
          status: "failed",
          stake_amount: 75,
          deadline: new Date(Date.now() - 86400000).toISOString(),
          verification_method: "quorum",
          consequence_type: "public_shame",
          group_mode: "survival",
          creator: { username: "void_walker" },
          created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
          members: [
            { user_id: "u-003", status: "failed", user: { username: "void_walker" } },
            { user_id: "u-002", status: "completed", user: { username: "ghost_protocol" } },
          ],
          proofs: [],
        },
      ]);
      setWithdrawals(
        mockTransactions
          .filter((tx) => tx.type === "withdrawal")
          .map((tx) => ({
            ...tx,
            wallets: { profiles: { username: "reaper_exe" } },
          }))
      );
      setFeedbacks([
        {
          id: "fb-1",
          message:
            "Anti-Charity feature caused me to actually finish my CS thesis. 10/10 psychological torture.",
          created_at: new Date(Date.now() - 7200000).toISOString(),
          user: { username: "ghost_protocol" },
        },
      ]);
      setStats(MOCK_STATS);
      setLoading(false);
      return;
    }

    // 1. Fetch Users
    const { data: profiles } = await supabase
      .from("profiles")
      .select("*, wallets(*)")
      .order("created_at", { ascending: false });

    // 2. Fetch Oaths
    const { data: oaths } = await supabase
      .from("oaths")
      .select("*, creator:profiles!oaths_creator_id_fkey(*), opponent:profiles!oaths_opponent_id_fkey(*), members:group_members(*, user:profiles(*)), proofs(*)")
      .order("created_at", { ascending: false })
      .limit(200);

    // 3. Fetch Withdrawals
    const { data: wTxs } = await supabase
      .from("transactions")
      .select("*, wallets(user_id, profiles!inner(username, display_name))")
      .eq("type", "withdrawal")
      .order("created_at", { ascending: false });

    // 4. Fetch Feedbacks
    const { data: fbs } = await supabase
      .from("feedbacks")
      .select("*, user:profiles(username)")
      .order("created_at", { ascending: false });

    if (profiles) {
      setUsers(profiles);
      // Compute stats from real data
      const totalUsers = profiles.length;
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const activeUsers7d = profiles.filter(
        (p: any) => p.updated_at && p.updated_at > sevenDaysAgo
      ).length;
      const allWallets = profiles.map((p: any) => p.wallets?.[0]).filter(Boolean);
      const totalEscrowLocked = allWallets.reduce(
        (sum: number, w: any) => sum + (w.escrow_locked || 0),
        0
      );
      const totalDeposited = allWallets.reduce(
        (sum: number, w: any) => sum + (w.total_deposited || 0),
        0
      );
      const totalWithdrawn = allWallets.reduce(
        (sum: number, w: any) => sum + (w.total_withdrawn || 0),
        0
      );
      const totalMoneyLost = profiles.reduce(
        (sum: number, p: any) => sum + (p.total_lost || 0),
        0
      );

      if (oaths) {
        const totalOaths = oaths.length;
        const completedOaths = oaths.filter((o: any) => o.status === "completed").length;
        const failedOaths = oaths.filter((o: any) => o.status === "failed").length;
        const activeOaths = oaths.filter((o: any) => o.status === "active").length;
        const pendingOaths = oaths.filter((o: any) => o.status === "pending").length;
        const successRate =
          completedOaths + failedOaths > 0
            ? Math.round((completedOaths / (completedOaths + failedOaths)) * 1000) / 10
            : 0;

        setStats({
          totalUsers,
          activeUsers7d,
          totalOaths,
          completedOaths,
          failedOaths,
          activeOaths,
          pendingOaths,
          successRate,
          totalEscrowLocked,
          totalMoneyLost,
          totalDeposited,
          totalWithdrawn,
          platformRevenue: Math.round(totalMoneyLost * 0.1 * 100) / 100,
        });
      }
    }
    if (oaths) setAllOaths(oaths);
    if (wTxs) setWithdrawals(wTxs);
    if (fbs) setFeedbacks(fbs);

    setLoading(false);
  };

  // ============================================================
  // HANDLERS
  // ============================================================
  const handleAddFunds = async (userId: string) => {
    const amount = parseFloat(fundAmount[userId]);
    if (!amount || amount <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    setFunding((prev) => ({ ...prev, [userId]: true }));

    if (isMockMode()) {
      setUsers((prev) =>
        prev.map((u) => {
          if (u.id === userId) {
            const currBal = u.wallets?.[0]?.balance ?? 0;
            return { ...u, wallets: [{ ...u.wallets?.[0], balance: currBal + amount }] };
          }
          return u;
        })
      );
      setFunding((prev) => ({ ...prev, [userId]: false }));
      const username = users.find((u) => u.id === userId)?.username;
      addAuditEntry("ADD_FUNDS", `@${username}`, `Added $${amount} to wallet`);
      showToast(`Added $${amount} to user (Demo Mode)`, "success");
      setFundAmount((prev) => ({ ...prev, [userId]: "" }));
      return;
    }

    const { error } = await supabase.rpc("admin_add_funds", {
      p_user_id: userId,
      p_amount: amount,
    });
    setFunding((prev) => ({ ...prev, [userId]: false }));
    if (error) {
      showToast(error.message, "error");
    } else {
      const username = users.find((u) => u.id === userId)?.username;
      addAuditEntry("ADD_FUNDS", `@${username}`, `Added $${amount} to wallet`);
      showToast(`Added $${amount} to user`, "success");
      setFundAmount((prev) => ({ ...prev, [userId]: "" }));
      fetchAdminData();
    }
  };

  const handleToggleBlock = async (userId: string, currentlyBlocked: boolean) => {
    setBlocking((prev) => ({ ...prev, [userId]: true }));
    const username = users.find((u) => u.id === userId)?.username;

    if (isMockMode()) {
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, is_blocked: !currentlyBlocked } : u))
      );
      setBlocking((prev) => ({ ...prev, [userId]: false }));
      addAuditEntry(
        currentlyBlocked ? "UNBLOCK_USER" : "BLOCK_USER",
        `@${username}`,
        currentlyBlocked ? "User unblocked" : "User blocked"
      );
      showToast(
        `User ${currentlyBlocked ? "unblocked" : "blocked"} successfully (Demo Mode)`,
        "success"
      );
      return;
    }

    const { error } = await supabase.rpc("admin_set_blocked", {
      p_user_id: userId,
      p_blocked: !currentlyBlocked,
    });
    setBlocking((prev) => ({ ...prev, [userId]: false }));
    if (error) {
      showToast(error.message, "error");
    } else {
      addAuditEntry(
        currentlyBlocked ? "UNBLOCK_USER" : "BLOCK_USER",
        `@${username}`,
        currentlyBlocked ? "User unblocked" : "User blocked"
      );
      showToast(`User ${currentlyBlocked ? "unblocked" : "blocked"} successfully`, "success");
      fetchAdminData();
    }
  };

  const handleResolveDispute = (disputeId: string, ruleInFavor: "swearer" | "counterparty") => {
    setDisputes((prev) =>
      prev.map((d) => {
        if (d.id === disputeId) {
          return {
            ...d,
            status: ruleInFavor === "swearer" ? "resolved_swearer" : "resolved_counterparty",
          };
        }
        return d;
      })
    );
    const dispute = disputes.find((d) => d.id === disputeId);
    addAuditEntry(
      "RESOLVE_DISPUTE",
      `Dispute #${disputeId}`,
      `Ruled in favor of ${ruleInFavor}. Oath: "${dispute?.oath_statement}"`
    );
    if (ruleInFavor === "swearer") {
      showToast(`Ruled in favor of Swearer. Escrow released back to creator.`, "success");
    } else {
      showToast(`Ruled in favor of Counterparty. Stake slashed & forfeited.`, "error");
    }
  };

  const toggleEmergencyPause = () => {
    const nextState = !isEmergencyPaused;
    setIsEmergencyPaused(nextState);
    addAuditEntry(
      nextState ? "EMERGENCY_PAUSE" : "EMERGENCY_RESUME",
      undefined,
      nextState
        ? "All escrow settlements frozen"
        : "Platform resumed, settlements operating normally"
    );
    if (nextState) {
      showToast(
        "CRITICAL: Platform emergency pause activated. All escrow settlements frozen.",
        "error",
        7000
      );
    } else {
      showToast("Platform resumed. Contract settlements operating normally.", "success");
    }
  };

  const handleBroadcast = async () => {
    if (!broadcastMsg.trim()) {
      showToast("Enter a message to broadcast", "error");
      return;
    }
    setBroadcastSending(true);

    if (isMockMode()) {
      await new Promise((r) => setTimeout(r, 800));
      addAuditEntry("BROADCAST", undefined, `Sent to all users: "${broadcastMsg}"`);
      showToast(`Broadcast sent to ${stats.totalUsers} users`, "success");
      setBroadcastMsg("");
      setBroadcastSending(false);
      return;
    }

    // Insert a notification for every user
    const { data: allProfiles } = await supabase.from("profiles").select("id");
    if (allProfiles && allProfiles.length > 0) {
      const notifications = allProfiles.map((p: any) => ({
        user_id: p.id,
        type: "system",
        title: "[SYSTEM] Announcement",
        message: broadcastMsg,
        status: "pending",
      }));
      const { error } = await supabase.from("notifications").insert(notifications);
      if (error) {
        showToast(`Broadcast failed: ${error.message}`, "error");
      } else {
        addAuditEntry("BROADCAST", undefined, `Sent to ${allProfiles.length} users: "${broadcastMsg}"`);
        showToast(`Broadcast sent to ${allProfiles.length} users`, "success");
        setBroadcastMsg("");
      }
    }
    setBroadcastSending(false);
  };

  const handleManualCron = async () => {
    setCronRunning(true);
    try {
      const res = await fetch("/api/cron/sweep");
      const data = await res.json();
      const result: CronResult = {
        ghostedProofs: data.resolved_ghosted_proofs ?? 0,
        expiredOaths: data.resolved_expired_oaths ?? 0,
        timestamp: data.timestamp || new Date().toISOString(),
        success: data.success ?? false,
        error: data.error,
      };
      setCronResults((prev) => [result, ...prev].slice(0, 20));
      addAuditEntry(
        "MANUAL_CRON",
        undefined,
        `Swept ${result.ghostedProofs} ghosted proofs, ${result.expiredOaths} expired oaths`
      );
      if (result.success) {
        showToast(
          `Cron sweep complete: ${result.ghostedProofs} ghosted proofs, ${result.expiredOaths} expired oaths`,
          "success"
        );
      } else {
        showToast(`Cron sweep failed: ${result.error}`, "error");
      }
    } catch (err) {
      const result: CronResult = {
        ghostedProofs: 0,
        expiredOaths: 0,
        timestamp: new Date().toISOString(),
        success: false,
        error: err instanceof Error ? err.message : "Network error",
      };
      setCronResults((prev) => [result, ...prev].slice(0, 20));
      showToast("Cron sweep failed", "error");
    }
    setCronRunning(false);
  };

  const handleForceSettle = async (oathId: string, verdict: "completed" | "failed") => {
    if (isMockMode()) {
      setAllOaths((prev) =>
        prev.map((o) => (o.id === oathId ? { ...o, status: verdict } : o))
      );
      addAuditEntry("FORCE_SETTLE", `Oath #${oathId}`, `Force-settled as ${verdict}`);
      showToast(`Oath force-settled as ${verdict}`, "success");
      return;
    }

    const { error } = await supabase
      .from("oaths")
      .update({ status: verdict, updated_at: new Date().toISOString() })
      .eq("id", oathId);

    if (error) {
      showToast(error.message, "error");
    } else {
      addAuditEntry("FORCE_SETTLE", `Oath #${oathId}`, `Force-settled as ${verdict}`);
      showToast(`Oath force-settled as ${verdict}`, "success");
      fetchAdminData();
    }
  };

  const handleToggleFlag = (flag: keyof FeatureFlags) => {
    setFeatureFlags((prev) => {
      const newVal = !prev[flag];
      addAuditEntry("TOGGLE_FLAG", undefined, `${flag}: ${newVal ? "ON" : "OFF"}`);
      return { ...prev, [flag]: newVal };
    });
    showToast(`Feature flag "${flag}" toggled`, "success");
  };

  // ============================================================
  // FILTERS
  // ============================================================
  const filteredUsers = users.filter(
    (u) =>
      !userSearch ||
      u.username?.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.id?.toLowerCase().includes(userSearch.toLowerCase())
  );

  const filteredOaths = allOaths
    .filter((o) => oathStatusFilter === "all" || o.status === oathStatusFilter)
    .filter(
      (o) =>
        !oathSearch ||
        o.oath_statement?.toLowerCase().includes(oathSearch.toLowerCase()) ||
        o.id?.toLowerCase().includes(oathSearch.toLowerCase()) ||
        o.creator?.username?.toLowerCase().includes(oathSearch.toLowerCase())
    );

  // ============================================================
  // LOADING / UNAUTHORIZED
  // ============================================================
  if (isAdmin === null || loading) {
    return (
      <div className="h-screen bg-zinc-50 dark:bg-[#09090b] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (isAdmin === false) {
    return (
      <div className="h-screen bg-zinc-50 dark:bg-[#09090b] flex flex-col items-center justify-center p-4">
        <Shield className="w-16 h-16 text-red-500 mb-4" />
        <h1 className="text-2xl font-black uppercase text-zinc-950 dark:text-zinc-100">
          Access Denied
        </h1>
        <p className="text-zinc-500 font-mono mt-2 text-center">
          You are not authorized to view the admin panel.
        </p>
        <Link
          href="/"
          className="mt-8 px-6 py-2 bg-zinc-950 text-white font-black uppercase text-sm"
        >
          Return to Oath
        </Link>
      </div>
    );
  }

  // ============================================================
  // STAT CARD SUB-COMPONENT
  // ============================================================
  const StatCard = ({
    icon,
    label,
    value,
    color = "text-zinc-950 dark:text-zinc-100",
    sub,
  }: {
    icon: React.ReactNode;
    label: string;
    value: string | number;
    color?: string;
    sub?: string;
  }) => (
    <div className="p-4 border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-[10px] font-mono font-bold uppercase tracking-[0.15em] text-zinc-500">
          {label}
        </span>
      </div>
      <p className={`text-2xl font-black font-mono ${color}`}>{value}</p>
      {sub && <p className="text-[10px] font-mono text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  );

  // ============================================================
  // TAB NAVIGATION
  // ============================================================
  const tabs: { id: AdminTab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: "analytics", label: "Analytics", icon: <BarChart3 className="w-3.5 h-3.5" /> },
    { id: "users", label: "Users", icon: <Users className="w-3.5 h-3.5" />, badge: users.length },
    { id: "oaths", label: "Oaths", icon: <Eye className="w-3.5 h-3.5" />, badge: allOaths.length },
    {
      id: "disputes",
      label: "Disputes",
      icon: <Scale className="w-3.5 h-3.5" />,
      badge: disputes.filter((d) => d.status === "disputed").length,
    },
    { id: "cron", label: "Cron", icon: <Clock className="w-3.5 h-3.5" /> },
    { id: "broadcast", label: "Broadcast", icon: <Megaphone className="w-3.5 h-3.5" /> },
    { id: "flags", label: "Flags", icon: <Settings className="w-3.5 h-3.5" /> },
    { id: "audit", label: "Audit", icon: <FileText className="w-3.5 h-3.5" />, badge: auditLog.length },
  ];

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="h-screen overflow-y-auto bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-100 font-sans pb-24">
      {/* Emergency Pause Banner */}
      {isEmergencyPaused && (
        <div className="p-4 bg-red-600 text-white font-mono flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 animate-pulse" />
            <div>
              <span className="font-black text-sm uppercase tracking-wider block">
                EMERGENCY SYSTEM HALT ACTIVE
              </span>
              <span className="text-xs text-red-100">
                All automated escrow slashing, contract settlements, and withdrawals are globally
                paused.
              </span>
            </div>
          </div>
          <button
            onClick={toggleEmergencyPause}
            className="px-4 py-2 bg-white text-red-700 text-xs font-black uppercase tracking-widest hover:bg-zinc-100 transition-colors shrink-0"
          >
            Resume Platform
          </button>
        </div>
      )}

      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b-2 border-zinc-950 dark:border-zinc-800 flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/"
              className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors rounded-full"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-3xl font-black uppercase tracking-tight flex items-center gap-2">
                <Shield className="w-6 h-6 text-red-600" />
                God Mode
              </h1>
              <p className="text-xs font-mono text-zinc-500">
                {user?.email || "admin@oath.app"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleEmergencyPause}
              className={`flex items-center gap-2 px-4 py-2 text-xs font-mono font-black uppercase tracking-wider border-2 transition-all ${
                isEmergencyPaused
                  ? "border-red-600 bg-red-600 text-white"
                  : "border-red-600 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20"
              }`}
            >
              <Power className="w-3.5 h-3.5" />
              {isEmergencyPaused ? "System Paused" : "Emergency Pause"}
            </button>
            <button
              onClick={fetchAdminData}
              className="flex items-center gap-1.5 px-4 py-2 bg-zinc-200 dark:bg-zinc-800 text-xs font-bold uppercase hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex flex-wrap gap-1 border-b-2 border-zinc-200 dark:border-zinc-800 pb-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono font-bold uppercase tracking-wider transition-all border-b-2 -mb-[3px] ${
                activeTab === tab.id
                  ? "border-red-600 text-red-600"
                  : "border-transparent text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-[9px] bg-zinc-200 dark:bg-zinc-800 rounded-full font-bold">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ============================================================ */}
        {/* TAB: ANALYTICS */}
        {/* ============================================================ */}
        {activeTab === "analytics" && (
          <div className="space-y-6 fade-in">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                icon={<Users className="w-4 h-4 text-blue-500" />}
                label="Total Users"
                value={stats.totalUsers.toLocaleString()}
                sub={`${stats.activeUsers7d} active (7d)`}
              />
              <StatCard
                icon={<Activity className="w-4 h-4 text-emerald-500" />}
                label="Total Oaths"
                value={stats.totalOaths.toLocaleString()}
                sub={`${stats.activeOaths} active, ${stats.pendingOaths} pending`}
              />
              <StatCard
                icon={<Trophy className="w-4 h-4 text-amber-500" />}
                label="Success Rate"
                value={`${stats.successRate}%`}
                color={stats.successRate >= 50 ? "text-emerald-600" : "text-red-600"}
                sub={`${stats.completedOaths} completed / ${stats.failedOaths} failed`}
              />
              <StatCard
                icon={<DollarSign className="w-4 h-4 text-green-500" />}
                label="Escrow Locked"
                value={`$${stats.totalEscrowLocked.toLocaleString()}`}
                color="text-amber-600"
                sub="Currently held"
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                icon={<Skull className="w-4 h-4 text-red-500" />}
                label="Total Burned"
                value={`$${stats.totalMoneyLost.toLocaleString()}`}
                color="text-red-600"
                sub="Lifetime user losses"
              />
              <StatCard
                icon={<Flame className="w-4 h-4 text-orange-500" />}
                label="Platform Revenue"
                value={`$${stats.platformRevenue.toLocaleString()}`}
                color="text-orange-600"
                sub="10% house cut estimate"
              />
              <StatCard
                icon={<Plus className="w-4 h-4 text-green-500" />}
                label="Total Deposited"
                value={`$${stats.totalDeposited.toLocaleString()}`}
              />
              <StatCard
                icon={<Minus className="w-4 h-4 text-blue-500" />}
                label="Total Withdrawn"
                value={`$${stats.totalWithdrawn.toLocaleString()}`}
              />
            </div>

            {/* Withdrawals + Feedback */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <h3 className="text-sm font-black uppercase border-l-4 border-blue-600 pl-3 mb-3">
                  Recent Withdrawals
                </h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {withdrawals.length === 0 ? (
                    <p className="text-xs font-mono text-zinc-500">No requests found.</p>
                  ) : (
                    withdrawals.slice(0, 10).map((tx: any) => (
                      <div
                        key={tx.id}
                        className="p-3 border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex justify-between items-center"
                      >
                        <div>
                          <p className="text-xs font-bold">
                            @{tx.wallets?.profiles?.username || "unknown"}
                          </p>
                          <p className="text-[10px] font-mono text-zinc-500 line-clamp-1">
                            {tx.description}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-black text-red-500">
                            {formatCurrency(tx.amount, "global")}
                          </p>
                          <p className="text-[10px] font-mono text-zinc-400">
                            {formatRelativeTime(tx.created_at)}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-black uppercase border-l-4 border-amber-500 pl-3 mb-3">
                  User Feedback
                </h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {feedbacks.length === 0 ? (
                    <p className="text-xs font-mono text-zinc-500">No feedback yet.</p>
                  ) : (
                    feedbacks.slice(0, 10).map((fb: any) => (
                      <div
                        key={fb.id}
                        className="p-3 border-2 border-zinc-950 dark:border-zinc-800 bg-amber-50 dark:bg-amber-950/10"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Mail className="w-3 h-3 text-amber-600" />
                          <span className="text-[10px] font-bold">
                            @{fb.user?.username || "Unknown"}
                          </span>
                          <span className="text-[10px] font-mono text-zinc-500 ml-auto">
                            {formatRelativeTime(fb.created_at)}
                          </span>
                        </div>
                        <p className="text-xs italic text-zinc-700 dark:text-zinc-300 line-clamp-2">
                          &quot;{fb.message}&quot;
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB: USERS */}
        {/* ============================================================ */}
        {activeTab === "users" && (
          <div className="space-y-4 fade-in">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                placeholder="Search by username or user ID..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm font-mono"
              />
            </div>

            <div className="space-y-3">
              {filteredUsers.map((u) => {
                const wallet = u.wallets?.[0];
                const balance = wallet?.balance ?? 0;
                const isBlocked = u.is_blocked;
                const isExpanded = expandedUser === u.id;

                return (
                  <div
                    key={u.id}
                    className={`border-2 ${
                      isBlocked
                        ? "border-red-600 bg-red-50 dark:bg-red-950/20"
                        : "border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900"
                    } shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none`}
                  >
                    {/* Main row */}
                    <div className="p-4 flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
                      <div
                        className="flex items-center gap-3 cursor-pointer flex-1"
                        onClick={() => setExpandedUser(isExpanded ? null : u.id)}
                      >
                        <div className="w-10 h-10 bg-zinc-200 dark:bg-zinc-800 rounded-full flex items-center justify-center font-bold font-mono shrink-0">
                          {u.username?.substring(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-black text-sm flex items-center gap-2">
                            @{u.username}
                            {isBlocked && (
                              <span className="text-[9px] bg-red-600 text-white px-1.5 py-0.5 rounded font-mono">
                                BLOCKED
                              </span>
                            )}
                          </p>
                          <p className="text-[10px] font-mono text-zinc-500 truncate">{u.id}</p>
                          <p className="text-xs font-bold text-green-600 dark:text-green-500 mt-0.5">
                            Balance: {formatCurrency(balance, "global")}
                          </p>
                        </div>
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-zinc-400 ml-auto shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-zinc-400 ml-auto shrink-0" />
                        )}
                      </div>

                      <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                        <input
                          type="number"
                          placeholder="Amt ($)"
                          value={fundAmount[u.id] || ""}
                          onChange={(e) =>
                            setFundAmount((prev) => ({ ...prev, [u.id]: e.target.value }))
                          }
                          className="w-20 px-2 py-1.5 text-xs border-2 border-zinc-950 dark:border-zinc-700 bg-transparent"
                        />
                        <button
                          onClick={() => handleAddFunds(u.id)}
                          disabled={funding[u.id]}
                          className="px-3 py-1.5 bg-green-600 text-white text-[10px] font-bold uppercase hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
                        >
                          {funding[u.id] ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Plus className="w-3 h-3" />
                          )}
                          Fund
                        </button>
                        <button
                          onClick={() => handleToggleBlock(u.id, isBlocked)}
                          disabled={blocking[u.id]}
                          className={`px-3 py-1.5 text-white text-[10px] font-bold uppercase disabled:opacity-50 flex items-center gap-1 ${
                            isBlocked
                              ? "bg-zinc-600 hover:bg-zinc-700"
                              : "bg-red-600 hover:bg-red-700"
                          }`}
                        >
                          {blocking[u.id] ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : isBlocked ? (
                            <CheckCircle className="w-3 h-3" />
                          ) : (
                            <Ban className="w-3 h-3" />
                          )}
                          {isBlocked ? "Unblock" : "Block"}
                        </button>
                      </div>
                    </div>

                    {/* Expanded user deep-dive */}
                    {isExpanded && (
                      <div className="border-t-2 border-zinc-200 dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-950/50 space-y-3">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="text-center p-2 border border-zinc-300 dark:border-zinc-700">
                            <p className="text-[10px] font-mono text-zinc-500 uppercase">Created</p>
                            <p className="text-sm font-black">{u.oaths_created ?? 0}</p>
                          </div>
                          <div className="text-center p-2 border border-zinc-300 dark:border-zinc-700">
                            <p className="text-[10px] font-mono text-zinc-500 uppercase">Completed</p>
                            <p className="text-sm font-black text-emerald-600">{u.oaths_completed ?? 0}</p>
                          </div>
                          <div className="text-center p-2 border border-zinc-300 dark:border-zinc-700">
                            <p className="text-[10px] font-mono text-zinc-500 uppercase">Failed</p>
                            <p className="text-sm font-black text-red-600">{u.oaths_failed ?? 0}</p>
                          </div>
                          <div className="text-center p-2 border border-zinc-300 dark:border-zinc-700">
                            <p className="text-[10px] font-mono text-zinc-500 uppercase">Win Rate</p>
                            <p className="text-sm font-black">
                              {(u.oaths_completed ?? 0) + (u.oaths_failed ?? 0) > 0
                                ? `${Math.round(
                                    ((u.oaths_completed ?? 0) /
                                      ((u.oaths_completed ?? 0) + (u.oaths_failed ?? 0))) *
                                      100
                                  )}%`
                                : "N/A"}
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="text-center p-2 border border-zinc-300 dark:border-zinc-700">
                            <p className="text-[10px] font-mono text-zinc-500 uppercase">Total Staked</p>
                            <p className="text-sm font-black">${u.total_staked ?? 0}</p>
                          </div>
                          <div className="text-center p-2 border border-zinc-300 dark:border-zinc-700">
                            <p className="text-[10px] font-mono text-zinc-500 uppercase">Total Won</p>
                            <p className="text-sm font-black text-emerald-600">${u.total_won ?? 0}</p>
                          </div>
                          <div className="text-center p-2 border border-zinc-300 dark:border-zinc-700">
                            <p className="text-[10px] font-mono text-zinc-500 uppercase">Total Lost</p>
                            <p className="text-sm font-black text-red-600">${u.total_lost ?? 0}</p>
                          </div>
                          <div className="text-center p-2 border border-zinc-300 dark:border-zinc-700">
                            <p className="text-[10px] font-mono text-zinc-500 uppercase">Escrow</p>
                            <p className="text-sm font-black text-amber-600">
                              ${wallet?.escrow_locked ?? 0}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500">
                          <span>Joined: {u.created_at ? new Date(u.created_at).toLocaleDateString() : "Unknown"}</span>
                          <span>•</span>
                          <span>Deposited: ${wallet?.total_deposited ?? 0}</span>
                          <span>•</span>
                          <span>Withdrawn: ${wallet?.total_withdrawn ?? 0}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB: OATHS (Inspector) */}
        {/* ============================================================ */}
        {activeTab === "oaths" && (
          <div className="space-y-4 fade-in">
            <div className="flex gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                  type="text"
                  placeholder="Search oath statement, ID, or creator..."
                  value={oathSearch}
                  onChange={(e) => setOathSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm font-mono"
                />
              </div>
              <select
                value={oathStatusFilter}
                onChange={(e) => setOathStatusFilter(e.target.value)}
                className="px-3 py-2.5 border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-xs font-mono font-bold uppercase"
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="disputed">Disputed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <p className="text-xs font-mono text-zinc-500">
              Showing {filteredOaths.length} of {allOaths.length} oaths
            </p>

            <div className="space-y-3">
              {filteredOaths.slice(0, 50).map((oath: any) => {
                const isExpanded = expandedOath === oath.id;
                const statusColor: Record<string, string> = {
                  active: "border-emerald-500 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20",
                  pending: "border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-950/20",
                  completed: "border-blue-500 text-blue-600 bg-blue-50 dark:bg-blue-950/20",
                  failed: "border-red-500 text-red-600 bg-red-50 dark:bg-red-950/20",
                  disputed: "border-orange-500 text-orange-600 bg-orange-50 dark:bg-orange-950/20",
                  cancelled: "border-zinc-400 text-zinc-500 bg-zinc-100 dark:bg-zinc-800",
                };

                return (
                  <div
                    key={oath.id}
                    className="border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                  >
                    <div
                      className="p-4 cursor-pointer flex items-start gap-3"
                      onClick={() => setExpandedOath(isExpanded ? null : oath.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span
                            className={`text-[10px] font-mono font-black uppercase px-2 py-0.5 border ${
                              statusColor[oath.status] || statusColor.cancelled
                            }`}
                          >
                            {oath.status}
                          </span>
                          <span className="text-[10px] font-mono text-zinc-500 uppercase">
                            {oath.oath_type}
                          </span>
                          <span className="text-[10px] font-mono text-zinc-400">
                            {oath.verification_method}
                          </span>
                        </div>
                        <p className="text-sm font-black truncate">
                          &ldquo;{oath.oath_statement}&rdquo;
                        </p>
                        <p className="text-[10px] font-mono text-zinc-500 mt-1">
                          Creator: @{oath.creator?.username || "unknown"} · Stake: $
                          {oath.stake_amount} · Deadline:{" "}
                          {new Date(oath.deadline).toLocaleDateString()}
                        </p>
                      </div>
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4 text-zinc-400 shrink-0 mt-1" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0 mt-1" />
                      )}
                    </div>

                    {isExpanded && (
                      <div className="border-t-2 border-zinc-200 dark:border-zinc-800 p-4 bg-zinc-50 dark:bg-zinc-950/50 space-y-4">
                        {/* ID */}
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono text-zinc-500">ID:</span>
                          <code className="text-[10px] font-mono bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5">
                            {oath.id}
                          </code>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(oath.id);
                              showToast("Oath ID copied", "info");
                            }}
                            className="text-zinc-400 hover:text-zinc-600"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Members */}
                        {oath.members && oath.members.length > 0 && (
                          <div>
                            <p className="text-[10px] font-mono font-bold text-zinc-500 uppercase mb-1">
                              Members ({oath.members.length})
                            </p>
                            <div className="space-y-1">
                              {oath.members.map((m: any, i: number) => (
                                <div
                                  key={i}
                                  className="flex items-center gap-2 text-xs font-mono"
                                >
                                  <span
                                    className={`w-2 h-2 rounded-full ${
                                      m.status === "completed"
                                        ? "bg-emerald-500"
                                        : m.status === "failed"
                                        ? "bg-red-500"
                                        : "bg-amber-500"
                                    }`}
                                  />
                                  <span>@{m.user?.username || m.user_id}</span>
                                  <span className="text-zinc-400">({m.status})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Opponent */}
                        {oath.opponent && (
                          <p className="text-xs font-mono">
                            <span className="text-zinc-500">Opponent: </span>
                            <span className="font-bold">@{oath.opponent.username}</span>
                          </p>
                        )}

                        {/* Proofs */}
                        <div>
                          <p className="text-[10px] font-mono font-bold text-zinc-500 uppercase mb-1">
                            Proofs ({oath.proofs?.length || 0})
                          </p>
                          {(oath.proofs?.length || 0) === 0 ? (
                            <p className="text-[10px] font-mono text-zinc-400 italic">
                              No proofs submitted yet
                            </p>
                          ) : (
                            oath.proofs.map((p: any, i: number) => (
                              <div
                                key={i}
                                className="flex items-center gap-2 text-xs font-mono"
                              >
                                <span
                                  className={`w-2 h-2 rounded-full ${
                                    p.status === "verified"
                                      ? "bg-emerald-500"
                                      : p.status === "rejected"
                                      ? "bg-red-500"
                                      : "bg-amber-500"
                                  }`}
                                />
                                <span>{p.proof_type}</span>
                                <span className="text-zinc-400">({p.status})</span>
                                <span className="text-zinc-400 ml-auto">
                                  {formatRelativeTime(p.created_at)}
                                </span>
                              </div>
                            ))
                          )}
                        </div>

                        {/* Force Settle */}
                        {(oath.status === "active" ||
                          oath.status === "disputed" ||
                          oath.status === "pending") && (
                          <div className="flex items-center gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                            <button
                              onClick={() => handleForceSettle(oath.id, "completed")}
                              className="flex-1 py-2 bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider hover:bg-emerald-700 flex items-center justify-center gap-1"
                            >
                              <CheckCircle className="w-3 h-3" />
                              Force Complete
                            </button>
                            <button
                              onClick={() => handleForceSettle(oath.id, "failed")}
                              className="flex-1 py-2 bg-red-600 text-white text-[10px] font-bold uppercase tracking-wider hover:bg-red-700 flex items-center justify-center gap-1"
                            >
                              <XCircle className="w-3 h-3" />
                              Force Fail
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB: DISPUTES */}
        {/* ============================================================ */}
        {activeTab === "disputes" && (
          <div className="space-y-4 fade-in">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black uppercase border-l-4 border-amber-500 pl-3 flex items-center gap-2">
                <Scale className="w-5 h-5 text-amber-500" />
                Dispute Resolution Panel
              </h2>
              <span className="text-xs font-mono text-zinc-500 font-bold">
                {disputes.filter((d) => d.status === "disputed").length} unresolved
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {disputes.map((dispute) => (
                <div
                  key={dispute.id}
                  className="p-4 border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 border border-zinc-300 dark:border-zinc-700">
                        Dispute #{dispute.id}
                      </span>
                      <span
                        className={`text-[10px] font-mono font-black uppercase px-2 py-0.5 border ${
                          dispute.status === "disputed"
                            ? "border-amber-500 text-amber-600 bg-amber-50 dark:bg-amber-950/20"
                            : dispute.status === "resolved_swearer"
                            ? "border-emerald-600 text-emerald-600"
                            : "border-red-600 text-red-600"
                        }`}
                      >
                        {dispute.status.replace(/_/g, " ")}
                      </span>
                    </div>

                    <p className="text-sm font-black text-zinc-950 dark:text-zinc-100 mb-1">
                      &ldquo;{dispute.oath_statement}&rdquo;
                    </p>
                    <p className="text-xs font-mono text-zinc-500 mb-2">
                      Swearer: <strong>@{dispute.creator_username}</strong> · Referee:{" "}
                      <strong>@{dispute.referee_username}</strong> · Stake:{" "}
                      <strong>${dispute.stake_amount}</strong>
                    </p>

                    <div className="p-2.5 bg-zinc-100 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-800 text-xs font-mono mb-4 text-zinc-700 dark:text-zinc-300">
                      <span className="font-bold text-red-600">Dispute Claim:</span>{" "}
                      {dispute.reason}
                    </div>
                  </div>

                  {dispute.status === "disputed" ? (
                    <div className="flex items-center gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                      <button
                        onClick={() => handleResolveDispute(dispute.id, "swearer")}
                        className="flex-1 py-2 bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider hover:bg-emerald-700 flex items-center justify-center gap-1 transition-colors"
                      >
                        <CheckCircle className="w-3 h-3" />
                        Rule for Swearer
                      </button>
                      <button
                        onClick={() => handleResolveDispute(dispute.id, "counterparty")}
                        className="flex-1 py-2 bg-red-600 text-white text-[10px] font-bold uppercase tracking-wider hover:bg-red-700 flex items-center justify-center gap-1 transition-colors"
                      >
                        <XCircle className="w-3 h-3" />
                        Slash & Forfeit
                      </button>
                    </div>
                  ) : (
                    <p className="text-[10px] font-mono text-zinc-500 italic text-right pt-2 border-t border-zinc-200 dark:border-zinc-800">
                      Arbitration decision finalized.
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB: CRON MONITOR */}
        {/* ============================================================ */}
        {activeTab === "cron" && (
          <div className="space-y-6 fade-in">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black uppercase border-l-4 border-purple-500 pl-3 flex items-center gap-2">
                <Clock className="w-5 h-5 text-purple-500" />
                Cron Job Monitor
              </h2>
              <button
                onClick={handleManualCron}
                disabled={cronRunning}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white text-xs font-bold uppercase hover:bg-purple-700 disabled:opacity-50 transition-colors"
              >
                {cronRunning ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Run Sweep Now
              </button>
            </div>

            <div className="p-4 border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-mono font-bold">Schedule:</span>
                <code className="text-xs font-mono bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5">
                  0 0 * * * (Daily at Midnight UTC)
                </code>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold">Endpoint:</span>
                <code className="text-xs font-mono bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5">
                  /api/cron/sweep
                </code>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold">Sweeps:</span>
                <span className="text-xs font-mono text-zinc-500">
                  auto_resolve_ghosted_proofs + auto_resolve_expired_oaths
                </span>
              </div>
            </div>

            <h3 className="text-sm font-black uppercase border-l-4 border-zinc-400 pl-3">
              Run History
            </h3>
            {cronResults.length === 0 ? (
              <p className="text-xs font-mono text-zinc-500 italic">
                No runs yet. Click &quot;Run Sweep Now&quot; to trigger manually.
              </p>
            ) : (
              <div className="space-y-2">
                {cronResults.map((result, i) => (
                  <div
                    key={i}
                    className={`p-3 border-2 ${
                      result.success
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/10"
                        : "border-red-500 bg-red-50 dark:bg-red-950/10"
                    } font-mono text-xs`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-black">
                        {result.success ? "[OK] SUCCESS" : "[X] FAILED"}
                      </span>
                      <span className="text-zinc-500">
                        {new Date(result.timestamp).toLocaleString()}
                      </span>
                    </div>
                    {result.success ? (
                      <p>
                        Ghosted proofs resolved:{" "}
                        <strong>{result.ghostedProofs}</strong> · Expired oaths resolved:{" "}
                        <strong>{result.expiredOaths}</strong>
                      </p>
                    ) : (
                      <p className="text-red-600">{result.error}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB: BROADCAST */}
        {/* ============================================================ */}
        {activeTab === "broadcast" && (
          <div className="space-y-6 fade-in">
            <h2 className="text-xl font-black uppercase border-l-4 border-orange-500 pl-3 flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-orange-500" />
              Push Notification Broadcast
            </h2>

            <div className="p-6 border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none space-y-4">
              <div>
                <label className="text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-zinc-500 block mb-2">
                  Message (sent as in-app notification to ALL users)
                </label>
                <textarea
                  value={broadcastMsg}
                  onChange={(e) => setBroadcastMsg(e.target.value)}
                  placeholder="e.g., Oath v2.1 just dropped. New squad modes available. Update now."
                  rows={4}
                  className="w-full px-4 py-3 border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-950 text-sm font-mono resize-none"
                />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-mono text-zinc-500">
                  This will create a system notification for{" "}
                  <strong>{stats.totalUsers}</strong> users.
                </p>
                <button
                  onClick={handleBroadcast}
                  disabled={broadcastSending || !broadcastMsg.trim()}
                  className="flex items-center gap-2 px-6 py-2.5 bg-orange-600 text-white text-xs font-black uppercase tracking-wider hover:bg-orange-700 disabled:opacity-50 transition-colors"
                >
                  {broadcastSending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  Send Broadcast
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB: FEATURE FLAGS */}
        {/* ============================================================ */}
        {activeTab === "flags" && (
          <div className="space-y-6 fade-in">
            <h2 className="text-xl font-black uppercase border-l-4 border-cyan-500 pl-3 flex items-center gap-2">
              <Settings className="w-5 h-5 text-cyan-500" />
              Feature Flags & Kill Switches
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(
                [
                  { key: "duoMode" as const, label: "Duo Mode", desc: "Enable head-to-head challenges" },
                  { key: "squadMode" as const, label: "Squad Mode", desc: "Enable private group oaths" },
                  { key: "lobbyMode" as const, label: "Lobby Mode", desc: "Enable public lobby/feed" },
                  { key: "newSignups" as const, label: "New Signups", desc: "Allow new user registrations" },
                  { key: "withdrawals" as const, label: "Withdrawals", desc: "Allow users to withdraw funds" },
                ] as const
              ).map((flag) => (
                <div
                  key={flag.key}
                  className="p-4 border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none flex items-center justify-between"
                >
                  <div>
                    <p className="text-sm font-black">{flag.label}</p>
                    <p className="text-[10px] font-mono text-zinc-500">{flag.desc}</p>
                  </div>
                  <button
                    onClick={() => handleToggleFlag(flag.key)}
                    className={`transition-colors ${
                      featureFlags[flag.key] ? "text-emerald-600" : "text-red-500"
                    }`}
                  >
                    {featureFlags[flag.key] ? (
                      <ToggleRight className="w-8 h-8" />
                    ) : (
                      <ToggleLeft className="w-8 h-8" />
                    )}
                  </button>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
                <label className="text-sm font-black block mb-2">Minimum Stake ($)</label>
                <input
                  type="number"
                  value={featureFlags.minStake}
                  onChange={(e) =>
                    setFeatureFlags((prev) => ({
                      ...prev,
                      minStake: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="w-full px-3 py-2 border-2 border-zinc-950 dark:border-zinc-700 bg-transparent text-sm font-mono"
                />
              </div>
              <div className="p-4 border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
                <label className="text-sm font-black block mb-2">Maximum Stake ($)</label>
                <input
                  type="number"
                  value={featureFlags.maxStake}
                  onChange={(e) =>
                    setFeatureFlags((prev) => ({
                      ...prev,
                      maxStake: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="w-full px-3 py-2 border-2 border-zinc-950 dark:border-zinc-700 bg-transparent text-sm font-mono"
                />
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* TAB: AUDIT LOG */}
        {/* ============================================================ */}
        {activeTab === "audit" && (
          <div className="space-y-4 fade-in">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-black uppercase border-l-4 border-zinc-600 pl-3 flex items-center gap-2">
                <FileText className="w-5 h-5 text-zinc-500" />
                Admin Audit Log
              </h2>
              <span className="text-xs font-mono text-zinc-500">{auditLog.length} entries</span>
            </div>

            {auditLog.length === 0 ? (
              <div className="p-8 border-2 border-dashed border-zinc-300 dark:border-zinc-700 text-center">
                <FileText className="w-8 h-8 text-zinc-300 dark:text-zinc-600 mx-auto mb-2" />
                <p className="text-xs font-mono text-zinc-500">
                  No actions recorded yet. Every admin action (funding, blocking, disputes,
                  broadcasts, cron runs) will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {auditLog.map((entry) => {
                  const actionColor: Record<string, string> = {
                    ADD_FUNDS: "text-green-600",
                    BLOCK_USER: "text-red-600",
                    UNBLOCK_USER: "text-emerald-600",
                    RESOLVE_DISPUTE: "text-amber-600",
                    EMERGENCY_PAUSE: "text-red-600",
                    EMERGENCY_RESUME: "text-emerald-600",
                    BROADCAST: "text-orange-600",
                    MANUAL_CRON: "text-purple-600",
                    FORCE_SETTLE: "text-blue-600",
                    TOGGLE_FLAG: "text-cyan-600",
                  };

                  return (
                    <div
                      key={entry.id}
                      className="flex items-start gap-3 py-2 px-3 border-b border-zinc-200 dark:border-zinc-800 last:border-b-0 font-mono text-xs"
                    >
                      <span className="text-zinc-400 shrink-0 w-[130px]">
                        {new Date(entry.timestamp).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                      <span
                        className={`font-black uppercase shrink-0 w-[140px] ${
                          actionColor[entry.action] || "text-zinc-600"
                        }`}
                      >
                        {entry.action}
                      </span>
                      {entry.targetUser && (
                        <span className="font-bold text-zinc-700 dark:text-zinc-300 shrink-0">
                          {entry.targetUser}
                        </span>
                      )}
                      <span className="text-zinc-500 truncate">{entry.details}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
