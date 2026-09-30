"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { createClient } from "@/lib/supabase/client";
import { Shield, Ban, CheckCircle, Plus, Search, Mail, Loader2, ArrowLeft } from "lucide-react";
import { showToast } from "@/components/Toast";
import Link from "next/link";
import { formatCurrency, formatRelativeTime } from "@/lib/utils";

export default function AdminDashboard() {
  const { user } = useAuth();
  const supabase = createClient();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  
  const [users, setUsers] = useState<any[]>([]);
  const [withdrawals, setWithdrawals] = useState<any[]>([]);
  const [feedbacks, setFeedbacks] = useState<any[]>([]);
  
  const [loading, setLoading] = useState(true);
  
  const [fundAmount, setFundAmount] = useState<Record<string, string>>({});
  const [funding, setFunding] = useState<Record<string, boolean>>({});
  const [blocking, setBlocking] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!user) return;
    if (user.email === "aryansharma24112003@gmail.com") {
      setIsAdmin(true);
      fetchAdminData();
    } else {
      setIsAdmin(false);
      setLoading(false);
    }
  }, [user]);

  const fetchAdminData = async () => {
    setLoading(true);
    
    // 1. Fetch Users
    const { data: profiles } = await supabase
      .from("profiles")
      .select("*, wallets(*)")
      .order("created_at", { ascending: false });
      
    // 2. Fetch Withdrawals (transactions type = 'withdrawal')
    const { data: wTxs } = await supabase
      .from("transactions")
      .select("*, wallets(user_id, profiles!inner(username, display_name))")
      .eq("type", "withdrawal")
      .order("created_at", { ascending: false });
      
    // 3. Fetch Feedbacks
    const { data: fbs } = await supabase
      .from("feedbacks")
      .select("*, user:profiles(username)")
      .order("created_at", { ascending: false });
      
    if (profiles) setUsers(profiles);
    if (wTxs) setWithdrawals(wTxs);
    if (fbs) setFeedbacks(fbs);
    
    setLoading(false);
  };

  const handleAddFunds = async (userId: string) => {
    const amount = parseFloat(fundAmount[userId]);
    if (!amount || amount <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    
    setFunding(prev => ({ ...prev, [userId]: true }));
    const { error } = await supabase.rpc("admin_add_funds", {
      p_user_id: userId,
      p_amount: amount,
    });
    
    setFunding(prev => ({ ...prev, [userId]: false }));
    if (error) {
      showToast(error.message, "error");
    } else {
      showToast(`Added $${amount} to user`, "success");
      setFundAmount(prev => ({ ...prev, [userId]: "" }));
      fetchAdminData();
    }
  };

  const handleToggleBlock = async (userId: string, currentlyBlocked: boolean) => {
    setBlocking(prev => ({ ...prev, [userId]: true }));
    const { error } = await supabase.rpc("admin_set_blocked", {
      p_user_id: userId,
      p_blocked: !currentlyBlocked,
    });
    setBlocking(prev => ({ ...prev, [userId]: false }));
    
    if (error) {
      showToast(error.message, "error");
    } else {
      showToast(`User ${currentlyBlocked ? 'unblocked' : 'blocked'} successfully`, "success");
      fetchAdminData();
    }
  };

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
        <h1 className="text-2xl font-black uppercase text-zinc-950 dark:text-zinc-100">Access Denied</h1>
        <p className="text-zinc-500 font-mono mt-2 text-center">You are not authorized to view the admin panel.</p>
        <Link href="/" className="mt-8 px-6 py-2 bg-zinc-950 text-white font-black uppercase text-sm">
          Return to Oath
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-100 font-sans p-6 pb-24">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-6 border-b-2 border-zinc-950 dark:border-zinc-800">
          <div className="flex items-center gap-4">
            <Link href="/" className="p-2 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors rounded-full">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-3xl font-black uppercase tracking-tight flex items-center gap-2">
                <Shield className="w-6 h-6 text-red-600" />
                God Mode
              </h1>
              <p className="text-xs font-mono text-zinc-500">Welcome, aryansharma24112003@gmail.com</p>
            </div>
          </div>
          <button onClick={fetchAdminData} className="px-4 py-2 bg-zinc-200 dark:bg-zinc-800 text-xs font-bold uppercase hover:bg-zinc-300 dark:hover:bg-zinc-700">
            Refresh Data
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Column 1: Users & Wallets */}
          <div className="lg:col-span-2 space-y-6">
            <h2 className="text-xl font-black uppercase border-l-4 border-zinc-950 dark:border-zinc-500 pl-3">
              User Management
            </h2>
            
            <div className="space-y-4">
              {users.map(u => {
                const wallet = u.wallets?.[0];
                const balance = wallet?.balance ?? 0;
                const isBlocked = u.is_blocked;

                return (
                  <div key={u.id} className={`p-4 border-2 ${isBlocked ? 'border-red-600 bg-red-50 dark:bg-red-950/20' : 'border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900'} shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center`}>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-zinc-200 dark:bg-zinc-800 rounded-full flex items-center justify-center font-bold font-mono">
                        {u.username?.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-black text-sm flex items-center gap-2">
                          @{u.username}
                          {isBlocked && <span className="text-[9px] bg-red-600 text-white px-1.5 py-0.5 rounded font-mono">BLOCKED</span>}
                        </p>
                        <p className="text-[10px] font-mono text-zinc-500">{u.id}</p>
                        <p className="text-xs font-bold text-green-600 dark:text-green-500 mt-1">
                          Balance: {formatCurrency(balance, 'global')}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <input 
                        type="number"
                        placeholder="Amt ($)"
                        value={fundAmount[u.id] || ""}
                        onChange={(e) => setFundAmount(prev => ({...prev, [u.id]: e.target.value}))}
                        className="w-20 px-2 py-1.5 text-xs border-2 border-zinc-950 dark:border-zinc-700 bg-transparent"
                      />
                      <button
                        onClick={() => handleAddFunds(u.id)}
                        disabled={funding[u.id]}
                        className="px-3 py-1.5 bg-green-600 text-white text-[10px] font-bold uppercase hover:bg-green-700 disabled:opacity-50 flex items-center gap-1"
                      >
                        {funding[u.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                        Fund
                      </button>
                      <button
                        onClick={() => handleToggleBlock(u.id, isBlocked)}
                        disabled={blocking[u.id]}
                        className={`px-3 py-1.5 text-white text-[10px] font-bold uppercase disabled:opacity-50 flex items-center gap-1 ${isBlocked ? 'bg-zinc-600 hover:bg-zinc-700' : 'bg-red-600 hover:bg-red-700'}`}
                      >
                        {blocking[u.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : (isBlocked ? <CheckCircle className="w-3 h-3" /> : <Ban className="w-3 h-3" />)}
                        {isBlocked ? "Unblock" : "Block"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          
          {/* Column 2: Withdrawals & Feedback */}
          <div className="space-y-8">
            
            {/* Withdrawals */}
            <div>
              <h2 className="text-xl font-black uppercase border-l-4 border-blue-600 pl-3 mb-4">
                Withdrawal Requests
              </h2>
              <div className="space-y-3">
                {withdrawals.length === 0 ? (
                  <p className="text-xs font-mono text-zinc-500">No requests found.</p>
                ) : (
                  withdrawals.map(tx => (
                    <div key={tx.id} className="p-3 border-2 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                      <p className="text-xs font-bold">@{tx.wallets?.profiles?.username}</p>
                      <p className="text-sm font-black text-red-500">{formatCurrency(tx.amount, 'global')}</p>
                      <p className="text-[10px] font-mono text-zinc-500 mt-1 line-clamp-2">{tx.description}</p>
                      <p className="text-[10px] font-mono text-zinc-400 mt-2">{formatRelativeTime(tx.created_at)}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Feedback */}
            <div>
              <h2 className="text-xl font-black uppercase border-l-4 border-amber-500 pl-3 mb-4">
                Feedback
              </h2>
              <div className="space-y-3">
                {feedbacks.length === 0 ? (
                  <p className="text-xs font-mono text-zinc-500">No feedback yet.</p>
                ) : (
                  feedbacks.map(fb => (
                    <div key={fb.id} className="p-3 border-2 border-zinc-950 dark:border-zinc-800 bg-amber-50 dark:bg-amber-950/10">
                      <div className="flex items-center gap-2 mb-2">
                        <Mail className="w-3 h-3 text-amber-600" />
                        <span className="text-[10px] font-bold">@{fb.user?.username || 'Unknown'}</span>
                        <span className="text-[10px] font-mono text-zinc-500 ml-auto">{formatRelativeTime(fb.created_at)}</span>
                      </div>
                      <p className="text-sm italic text-zinc-700 dark:text-zinc-300">"{fb.message}"</p>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
