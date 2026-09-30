"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import TopNav from "@/components/TopNav";
import ActiveOathsView from "@/components/ActiveOathsView";
import CreateOathView from "@/components/CreateOathView";
import LobbiesView from "@/components/LobbiesView";
import WallView from "@/components/WallView";
import ProfileView from "@/components/ProfileView";
import LandingView from "@/components/LandingView";
import WalletModal from "@/components/WalletModal";
import DuoChallengeModal from "@/components/DuoChallengeModal";
import NomineeInboxView from "@/components/NomineeInboxView";
import { ToastContainer } from "@/components/Toast";
import { useAuth } from "@/lib/auth-context";
import { useOaths, useSquadLobbies, useWall, useTransactions, useNomineeRequests } from "@/lib/data-hooks";
import { mockProfile, mockWallet } from "@/lib/mock-data";

type View = "active" | "create" | "lobbies" | "reviews" | "wall_shame" | "wall_honor" | "profile";

export default function Home() {
  const [currentView, setCurrentView] = useState<View>("active");
  const [showWalletModal, setShowWalletModal] = useState(false);
  const [showDuoModal, setShowDuoModal] = useState(false);

  const { user, profile, wallet, loading, signOut, refreshWallet } = useAuth();
  const router = useRouter();

  // Real data hooks (only fire when user is logged in)
  const { oaths, refresh: refreshOaths } = useOaths();
  const { lobbies } = useSquadLobbies();
  const { entries: shameEntries } = useWall("shame");
  const { entries: honorEntries } = useWall("honor");
  const { transactions } = useTransactions();
  const { requests: nomineeRequests, loading: nomineeRequestsLoading, refresh: refreshNomineeRequests } = useNomineeRequests();

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

  // Never present sample records or a sample balance as live account data.
  const activeProfile = profile ?? { ...mockProfile, username: "Member", display_name: "Member", oaths_created: 0, oaths_completed: 0, oaths_failed: 0, total_staked: 0, total_lost: 0, total_won: 0, reputation_score: 0 };
  const activeWallet = wallet ?? { ...mockWallet, balance: 0, escrow_locked: 0 };
  const activeOaths = oaths;
  const activeLobbies = lobbies;
  const activeShame = shameEntries;
  const activeHonor = honorEntries;
  const activeTx = transactions;

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
        onDuoClick={() => setShowDuoModal(true)}
        reviewCount={nomineeRequests.length}
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
            onOathCreated={() => { setCurrentView("active"); refreshOaths(); refreshWallet(); }}
          />
        )}
        {currentView === "lobbies" && (
          <LobbiesView squads={activeLobbies} wallet={activeWallet} onJoined={() => { refreshOaths(); refreshWallet(); }} />
        )}
        {currentView === "reviews" && (
          <NomineeInboxView requests={nomineeRequests} loading={nomineeRequestsLoading} onResolved={() => { refreshNomineeRequests(); refreshOaths(); refreshWallet(); }} />
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
      {showDuoModal && (
        <DuoChallengeModal
          wallet={activeWallet}
          onClose={() => setShowDuoModal(false)}
          onSuccess={() => { refreshOaths(); setCurrentView("active"); }}
          onCreateSharedAlternative={() => { setShowDuoModal(false); setCurrentView("create"); }}
        />
      )}

      {/* Global Toast */}
      <ToastContainer />
    </div>
  );
}
