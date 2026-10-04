"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import TopNav from "@/components/TopNav";
import ActiveOathsView from "@/components/ActiveOathsView";
import CreateOathView from "@/components/CreateOathView";
import CommunityView from "@/components/CommunityView";
import ProfileView from "@/components/ProfileView";
import LandingView from "@/components/LandingView";
import WalletModal from "@/components/WalletModal";
import NotificationsPanel from "@/components/NotificationsPanel";
import { showToast } from "@/components/Toast";
import { useAuth } from "@/lib/auth-context";
import { useOaths, useSquadLobbies, useWall, useTransactions, isMockMode } from "@/lib/data-hooks";
import { createClient } from "@/lib/supabase/client";
import {
  mockProfile,
  mockWallet,
  mockSquadOaths,
  mockWallOfShame,
  mockWallOfHonor,
  mockTransactions,
} from "@/lib/mock-data";

type View = "active" | "create" | "community" | "profile";

export default function Home() {
  const [currentView, setCurrentView] = useState<View>("active");
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const [unreadCount, setUnreadCount] = useState(0);

  const { user, profile, wallet, loading, signOut, refreshWallet } = useAuth();
  const router = useRouter();

  // Real data hooks (only fire when user is logged in)
  const { oaths, refresh: refreshOaths } = useOaths();
  const { lobbies, refresh: refreshLobbies } = useSquadLobbies();
  const { entries: shameEntries } = useWall("shame");
  const { entries: honorEntries } = useWall("honor");
  const { transactions } = useTransactions();

  useEffect(() => {
    if (!user || isMockMode()) {
      setUnreadCount(0);
      return;
    }
    const supabase = createClient();
    const fetchUnread = async () => {
      const { count } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "pending");
      setUnreadCount(count ?? 0);
    };
    fetchUnread();

    const channel = supabase
      .channel(`notifs_badge:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => fetchUnread()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Handle return from PayPal redirect
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const paypalSuccess = params.get("paypal_success");
    const orderId = params.get("order_id");

    if (paypalSuccess === "true" && orderId) {
      window.history.replaceState({}, "", window.location.pathname);
      (async () => {
        try {
          const supabase = createClient();
          const { data: { session } } = await supabase.auth.getSession();
          const token = session?.access_token;

          const res = await fetch("/api/paypal/verify", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { "Authorization": `Bearer ${token}` } : {})
            },
            body: JSON.stringify({ paypal_order_id: orderId }),
          });
          const data = await res.json();
          if (res.ok && data.success) {
            showToast("PayPal deposit completed successfully!", "success");
            refreshWallet();
          } else {
            showToast(data.error || "PayPal verification failed", "error");
          }
        } catch {
          showToast("Failed to verify PayPal payment", "error");
        }
      })();
    }
  }, [refreshWallet]);

  // Show loading state while auth resolves
  if (loading) {
    return (
      <div className="h-[100dvh] flex items-center justify-center bg-zinc-50 dark:bg-[#09090b] transition-colors duration-300">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-zinc-950 dark:border-zinc-800 animate-spin border-t-zinc-400 dark:border-t-zinc-500 rounded-full" />
          <span className="text-[10px] font-mono font-bold text-zinc-600 dark:text-zinc-500 uppercase tracking-widest">Loading</span>
        </div>
      </div>
    );
  }

  // Show marketing landing page if not logged in
  if (!user) {
    return <LandingView />;
  }

  // Use real data when Supabase is configured; fallback to mock data only in demo mock mode
  const activeProfile = profile ?? mockProfile;
  const activeWallet = wallet ?? mockWallet;
  const activeOaths = oaths;
  const activeLobbies = (isMockMode() ? (lobbies.length > 0 ? lobbies : mockSquadOaths) : lobbies).filter((s) => s.oath_type === "lobby");
  const activeShame = isMockMode() ? (shameEntries.length > 0 ? shameEntries : mockWallOfShame) : shameEntries;
  const activeHonor = isMockMode() ? (honorEntries.length > 0 ? honorEntries : mockWallOfHonor) : honorEntries;
  const activeTx = isMockMode() ? (transactions.length > 0 ? transactions : mockTransactions) : transactions;

  const handleSignOut = async () => {
    await signOut();
    router.push("/auth");
  };

  const isPenaltyBoxActive = Boolean(
    activeProfile?.penalty_box_until && new Date(activeProfile.penalty_box_until).getTime() > Date.now()
  );

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 transition-colors duration-300">
      {/* Top Navigation */}
      <TopNav
        wallet={activeWallet}
        currentView={currentView}
        onViewChange={(v) => setCurrentView(v as View)}
        username={activeProfile.username}
        onWalletClick={() => setShowWalletModal(true)}
        onNotificationsClick={() => setShowNotifications(true)}
        unreadCount={unreadCount}
      />

      {/* Penalty Box Global Alert */}
      {isPenaltyBoxActive && (
        <div className="bg-red-600 text-white px-4 py-2 text-xs font-mono font-bold flex flex-wrap items-center justify-between gap-2 shrink-0 shadow-inner z-20">
          <div className="flex items-center gap-2">
            <span className="bg-black text-red-500 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider">
              PENALTY BOX
            </span>
            <span>
              Account locked for 3 consecutive failures. Creating oaths and joining lobbies is suspended.
            </span>
          </div>
          <span className="text-[11px] font-mono tracking-tight font-black">
            Expires {new Date(activeProfile.penalty_box_until!).toLocaleDateString()} {new Date(activeProfile.penalty_box_until!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      )}

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {currentView === "active" && (
          <ActiveOathsView
            oaths={activeOaths}
            onProofSubmitted={() => { refreshOaths(); refreshWallet(); }}
            onCreateClick={() => setCurrentView("create")}
          />
        )}
        {currentView === "create" && (
          <CreateOathView
            walletBalance={activeWallet.balance}
            penaltyBoxUntil={activeProfile.penalty_box_until}
            onOathCreated={() => { setCurrentView("active"); refreshOaths(); refreshLobbies(); refreshWallet(); }}
          />
        )}
        {currentView === "community" && (
          <CommunityView
            lobbiesProps={{
              squads: activeLobbies,
              wallet: activeWallet,
              penaltyBoxUntil: activeProfile.penalty_box_until,
              onJoined: () => { refreshOaths(); refreshLobbies(); refreshWallet(); },
              onCreateLobby: () => setCurrentView("create"),
            }}
            shameEntries={activeShame}
            honorEntries={activeHonor}
          />
        )}
        {currentView === "profile" && (
          <ProfileView
            profile={activeProfile}
            wallet={activeWallet}
            transactions={activeTx}
            onSignOut={handleSignOut}
          />
        )}
      </main>

      {/* Modals */}
      {showWalletModal && (
        <WalletModal
          wallet={activeWallet}
          transactions={activeTx}
          onClose={() => setShowWalletModal(false)}
          onRefresh={refreshWallet}
        />
      )}
      {showNotifications && (
        <NotificationsPanel
          onClose={() => setShowNotifications(false)}
        />
      )}
    </div>
  );
}
