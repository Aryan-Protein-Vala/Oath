"use client";

import React from "react";

import { useSyncExternalStore } from "react";
import { Wallet, Plus, Swords, Sun, Moon, Zap, PenLine, Users, Skull, Crown, User } from "lucide-react";
import { useTheme } from "next-themes";
import { formatCurrencyPrecise } from "@/lib/utils";
import { useRegion } from "@/lib/region-context";
import { Globe, MapPin } from "lucide-react";
import type { Wallet as WalletType } from "@/lib/types";

const emptySubscribe = () => () => {};

interface TopNavProps {
  wallet: WalletType;
  currentView: string;
  onViewChange: (view: string) => void;
  username: string;
  onWalletClick: () => void;
  onDuoClick: () => void;
}

export default function TopNav({
  wallet,
  currentView,
  onViewChange,
  username,
  onWalletClick,
  onDuoClick,
}: TopNavProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const { region, setRegion } = useRegion();
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  return (
    <nav className="w-full border-b-2 sm:border-b-4 border-zinc-950 dark:border-zinc-800/80 bg-zinc-50/95 dark:bg-[#09090b]/95 backdrop-blur-md transition-colors duration-300">
      <div className="flex items-center justify-between h-14 sm:h-16 px-5 max-w-7xl mx-auto w-full">
        {/* Logo / Brand */}
        <div className="flex items-center gap-5">
          <button
            onClick={() => onViewChange("active")}
            className="flex items-center gap-2 group"
          >
            <span className="text-xl sm:text-2xl font-black tracking-tighter text-zinc-950 dark:text-zinc-50 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors">
              OATH
            </span>
            <span className="hidden sm:inline-flex px-1.5 py-0.5 text-[9px] font-mono text-zinc-950 dark:text-zinc-400 font-bold tracking-widest uppercase border-2 border-zinc-950 dark:border-zinc-800 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none bg-red-500/10 dark:bg-transparent">
              v0.2
            </span>
          </button>

          {/* Primary Nav Tabs */}
          <div className="hidden sm:flex items-center gap-0 border-2 border-zinc-950 dark:border-zinc-800 divide-x-2 divide-zinc-950 dark:divide-zinc-800 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
            <NavTab label="Active" isActive={currentView === "active"} onClick={() => onViewChange("active")} />
            <NavTab label="Create" isActive={currentView === "create"} onClick={() => onViewChange("create")} />
            <NavTab label="Lobbies" isActive={currentView === "lobbies"} onClick={() => onViewChange("lobbies")} />
            <NavTab label="Shame" isActive={currentView === "wall_shame"} onClick={() => onViewChange("wall_shame")} accent />
            <NavTab label="Honor" isActive={currentView === "wall_honor"} onClick={() => onViewChange("wall_honor")} />
          </div>
        </div>

        {/* Right Side */}
        <div className="flex items-center gap-3">
          {/* Region Toggle Button */}
          {mounted && (
            <button
              onClick={() => setRegion(region === "global" ? "in" : "global")}
              className="p-2 border-2 border-zinc-950 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none flex items-center gap-1"
              aria-label="Toggle region"
              title={region === "global" ? "Switch to India" : "Switch to Global"}
            >
              {region === "global" ? (
                <Globe className="w-4 h-4 text-zinc-800 dark:text-zinc-300" />
              ) : (
                <MapPin className="w-4 h-4 text-zinc-800 dark:text-zinc-300" />
              )}
              <span className="text-[10px] font-mono font-bold uppercase hidden sm:inline-block">
                {region === "global" ? "GLB" : "IN"}
              </span>
            </button>
          )}

          {/* Theme Toggle Button */}
          {mounted && (
            <button
              onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
              className="p-2 border-2 border-zinc-950 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
              aria-label="Toggle theme"
              title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {resolvedTheme === "dark" ? <Sun className="w-4 h-4 text-zinc-300" /> : <Moon className="w-4 h-4 text-zinc-800" />}
            </button>
          )}

          {/* Duo Challenge Button */}
          <button
            onClick={onDuoClick}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 border-2 border-zinc-950 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all text-[10px] font-mono font-bold uppercase tracking-wide shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none hover:translate-y-[-2px] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-none active:translate-y-0 active:shadow-none"
            title="Duo Challenge"
          >
            <Swords className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Challenge</span>
          </button>

          {/* Wallet Balance */}
          <button
            onClick={onWalletClick}
            className="flex items-center gap-3 border-2 border-zinc-950 dark:border-zinc-800 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none hover:translate-y-[-2px] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-none active:translate-y-0 active:shadow-none"
          >
            <Wallet className="w-4 h-4 text-zinc-950 dark:text-zinc-500" />
            <div className="flex flex-col text-left">
              <span className="text-xs font-mono font-black text-zinc-950 dark:text-zinc-50 stake-number leading-none">
                {formatCurrencyPrecise(wallet.balance, region)}
              </span>
              <span className="text-[9px] font-mono font-bold text-zinc-600 dark:text-zinc-500 leading-none mt-0.5">
                {formatCurrencyPrecise(wallet.escrow_locked, region)} locked
              </span>
            </div>
            <div className="flex items-center gap-0.5 ml-0.5">
              <span className="p-1 text-zinc-950 dark:text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors">
                <Plus className="w-3.5 h-3.5" />
              </span>
            </div>
          </button>

          {/* User / Profile */}
          <button
            onClick={() => onViewChange("profile")}
            className={`w-9 h-9 border-2 flex items-center justify-center transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none hover:translate-y-[-2px] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-none active:translate-y-0 active:shadow-none ${
              currentView === "profile"
                ? "border-zinc-950 bg-zinc-950 text-white dark:border-zinc-500 dark:bg-zinc-800 dark:text-zinc-300"
                : "border-zinc-950 bg-zinc-50 text-zinc-950 dark:border-zinc-800 dark:bg-[#09090b] dark:text-zinc-400"
            }`}
          >
            <span className="text-[11px] font-mono font-black uppercase">
              {username.substring(0, 2)}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile Nav */}
      <div className="flex sm:hidden items-center border-t-2 border-zinc-950 dark:border-zinc-800/50 divide-x-2 divide-zinc-950 dark:divide-zinc-800/50 bg-zinc-50 dark:bg-[#09090b]">
        <MobileNavTab icon={<Zap className="w-3.5 h-3.5" />} label="Active" isActive={currentView === "active"} onClick={() => onViewChange("active")} />
        <MobileNavTab icon={<PenLine className="w-3.5 h-3.5" />} label="Create" isActive={currentView === "create"} onClick={() => onViewChange("create")} />
        <MobileNavTab icon={<Users className="w-3.5 h-3.5" />} label="Lobbies" isActive={currentView === "lobbies"} onClick={() => onViewChange("lobbies")} />
        <MobileNavTab icon={<Skull className="w-3.5 h-3.5" />} label="Shame" isActive={currentView === "wall_shame"} onClick={() => onViewChange("wall_shame")} accent />
        <MobileNavTab icon={<Crown className="w-3.5 h-3.5" />} label="Honor" isActive={currentView === "wall_honor"} onClick={() => onViewChange("wall_honor")} />
        <MobileNavTab icon={<User className="w-3.5 h-3.5" />} label="Me" isActive={currentView === "profile"} onClick={() => onViewChange("profile")} />
      </div>
    </nav>
  );
}

function NavTab({
  label,
  isActive,
  onClick,
  accent,
  mobile,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  accent?: boolean;
  mobile?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`
        ${mobile ? "flex-1 py-2.5" : "px-3.5 py-2"}
        text-[11px] font-black tracking-widest uppercase transition-all border-b-2
        ${
          isActive
            ? accent
              ? "bg-red-600 text-white border-red-600 dark:border-transparent dark:bg-red-950/40 dark:text-red-400"
              : "bg-zinc-950 text-white border-zinc-950 dark:bg-zinc-800/50 dark:text-zinc-50 dark:border-transparent"
            : accent
            ? "border-transparent text-red-600 hover:text-red-500 hover:bg-red-50 dark:text-red-600/60 dark:hover:text-red-400 dark:hover:bg-red-950/20"
            : "border-transparent text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-900"
        }
      `}
    >
      {label}
    </button>
  );
}

function MobileNavTab({
  icon,
  label,
  isActive,
  onClick,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
  accent?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-all border-b-2
        ${
          isActive
            ? accent
              ? "bg-red-600 text-white border-red-600 dark:border-transparent dark:bg-red-950/40 dark:text-red-400"
              : "bg-zinc-950 text-white border-zinc-950 dark:bg-zinc-800/50 dark:text-zinc-50 dark:border-transparent"
            : accent
            ? "border-transparent text-red-600 hover:bg-red-50 dark:text-red-600/60 dark:hover:bg-red-950/20"
            : "border-transparent text-zinc-500 hover:text-zinc-950 hover:bg-zinc-100 dark:text-zinc-600 dark:hover:text-zinc-300 dark:hover:bg-zinc-900"
        }
      `}
    >
      {icon}
      <span className="text-[8px] font-black tracking-widest uppercase">{label}</span>
    </button>
  );
}
