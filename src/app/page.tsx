"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import TopNav from "@/components/TopNav";
import ActiveOathsView from "@/components/ActiveOathsView";
import CreateOathView from "@/components/CreateOathView";
import LobbiesView from "@/components/LobbiesView";
import WallView from "@/components/WallView";
import ProfileView from "@/components/ProfileView";
import LandingView from "@/components/LandingView";
import WalletModal from "@/components/WalletModal";
import NotificationsPanel from "@/components/NotificationsPanel";
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

type View = "active" | "create" | "lobbies" | "wall_shame" | "wall_honor" | "profile";

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

  // Show loading state while auth resolves
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-zinc-50 dark:bg-[#09090b] transition-colors duration-300">
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
  const activeLobbies = isMockMode() ? (lobbies.length > 0 ? lobbies : mockSquadOaths) : lobbies;
  const activeShame = isMockMode() ? (shameEntries.length > 0 ? shameEntries : mockWallOfShame) : shameEntries;
  const activeHonor = isMockMode() ? (honorEntries.length > 0 ? honorEntries : mockWallOfHonor) : honorEntries;
  const activeTx = isMockMode() ? (transactions.length > 0 ? transactions : mockTransactions) : transactions;

  const handleSignOut = async () => {
    await signOut();
    router.push("/auth");
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 transition-colors duration-300">
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
            onOathCreated={() => { setCurrentView("active"); refreshOaths(); refreshLobbies(); refreshWallet(); }}
          />
        )}
        {currentView === "lobbies" && (
          <LobbiesView squads={activeLobbies} wallet={activeWallet} onJoined={() => { refreshOaths(); refreshLobbies(); refreshWallet(); }} onCreateLobby={() => setCurrentView("create")} />
        )}
        {currentView === "wall_shame" && (
          <WallView entries={activeShame} type="shame" />
        )}
        {currentView === "wall_honor" && (
          <WallView entries={activeHonor} type="honor" />
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
