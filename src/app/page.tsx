"use client";

import { useState } from "react";
import TopNav from "@/components/TopNav";
import ActiveOathsView from "@/components/ActiveOathsView";
import CreateOathView from "@/components/CreateOathView";
import LobbiesView from "@/components/LobbiesView";
import WallView from "@/components/WallView";
import { ToastContainer } from "@/components/Toast";
import {
  mockProfile,
  mockWallet,
  mockActiveOaths,
  mockSquadOaths,
  mockWallOfShame,
  mockWallOfHonor,
} from "@/lib/mock-data";

export default function Home() {
  const [currentView, setCurrentView] = useState("active");

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#09090b]">
      {/* Top Navigation */}
      <TopNav
        wallet={mockWallet}
        currentView={currentView}
        onViewChange={setCurrentView}
        username={mockProfile.username}
      />

      {/* Main Content — fills remaining viewport, no scroll */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {currentView === "active" && (
          <ActiveOathsView oaths={mockActiveOaths} />
        )}
        {currentView === "create" && (
          <CreateOathView walletBalance={mockWallet.balance} />
        )}
        {currentView === "lobbies" && (
          <LobbiesView squads={mockSquadOaths} />
        )}
        {currentView === "wall_shame" && (
          <WallView entries={mockWallOfShame} type="shame" />
        )}
        {currentView === "wall_honor" && (
          <WallView entries={mockWallOfHonor} type="honor" />
        )}
      </main>

      {/* Global Toast System */}
      <ToastContainer />
    </div>
  );
}
