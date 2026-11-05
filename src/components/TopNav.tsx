"use client";

import React from "react";
import Link from "next/link";

import { useSyncExternalStore } from "react";
import { Wallet, Plus, Bell, Sun, Moon, Zap, PenLine, Users, Globe, MapPin, Mail, User } from "lucide-react";
import { useTheme } from "next-themes";
import { formatCurrencyPrecise } from "@/lib/utils";
import { useRegion } from "@/lib/region-context";
import type { Wallet as WalletType } from "@/lib/types";

const emptySubscribe = () => () => {};

interface TopNavProps {
  wallet: WalletType;
  currentView: string;
  onViewChange: (view: string) => void;
  username: string;
  onWalletClick: () => void;
  onNotificationsClick: () => void;
  unreadCount?: number;
}

export default function TopNav({
  wallet,
  currentView,
  onViewChange,
  username,
  onWalletClick,
  onNotificationsClick,
  unreadCount,
}: TopNavProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const { region, setRegion } = useRegion();
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  return (
    <>
      <nav className="w-full shrink-0 border-b-2 lg:border-b-4 border-zinc-950 dark:border-zinc-800/80 bg-zinc-50/95 dark:bg-[#09090b]/95 backdrop-blur-md transition-colors duration-300 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between h-12 lg:h-16 px-3 lg:px-5 max-w-7xl mx-auto w-full">
          {/* Logo / Brand */}
          <div className="flex items-center gap-3 lg:gap-5">
            <button
              onClick={() => onViewChange("active")}
              className="flex items-center gap-2 group"
            >
              <span className="text-lg lg:text-2xl font-black tracking-tighter text-zinc-950 dark:text-zinc-50 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors">
                OATH
              </span>
              <span className="hidden lg:inline-flex px-1.5 py-0.5 text-[9px] font-mono text-zinc-950 dark:text-zinc-400 font-bold tracking-widest uppercase border-2 border-zinc-950 dark:border-zinc-800 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none bg-red-500/10 dark:bg-transparent">
                v0.2
              </span>
            </button>

            {/* Primary Nav Tabs (Desktop Only — unchanged) */}
            <div className="hidden lg:flex items-center gap-0 border-2 border-zinc-950 dark:border-zinc-800 divide-x-2 divide-zinc-950 dark:divide-zinc-800 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none">
              <NavTab label="Active" isActive={currentView === "active"} onClick={() => onViewChange("active")} />
              <NavTab label="Create" isActive={currentView === "create"} onClick={() => onViewChange("create")} />
              <NavTab label="Community & Lobbies" isActive={currentView === "community"} onClick={() => onViewChange("community")} />
            </div>
          </div>

          {/* Right Side Desktop (unchanged) */}
          <div className="hidden lg:flex items-center gap-3">
            {/* Region Toggle Button */}
            {mounted && (
              <button
                onClick={() => setRegion(region === "global" ? "in" : "global")}
                className="p-2 border-2 border-zinc-950 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none flex items-center gap-1 shrink-0"
                aria-label="Toggle region"
                title={region === "global" ? "Switch to India" : "Switch to Global"}
              >
                {region === "global" ? (
                  <Globe className="w-4 h-4 text-zinc-800 dark:text-zinc-300" />
                ) : (
                  <MapPin className="w-4 h-4 text-zinc-800 dark:text-zinc-300" />
                )}
                <span className="text-[10px] font-mono font-bold uppercase inline-block">
                  {region === "global" ? "GLB" : "IN"}
                </span>
              </button>
            )}

            {/* Theme Toggle Button */}
            {mounted && (
              <button
                onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
                className="p-2 border-2 border-zinc-950 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none shrink-0"
                aria-label="Toggle theme"
                title={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              >
                {resolvedTheme === "dark" ? <Sun className="w-4 h-4 text-zinc-300" /> : <Moon className="w-4 h-4 text-zinc-800" />}
              </button>
            )}

            {/* Notifications Button */}
            <button
              onClick={onNotificationsClick}
              className="relative flex items-center justify-center p-2 border-2 border-zinc-950 dark:border-zinc-800 text-zinc-950 dark:text-zinc-100 bg-white dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none hover:translate-y-[-2px] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-none active:translate-y-0 active:shadow-none shrink-0"
              title="Notifications"
            >
              <Bell className="w-4 h-4" />
              {typeof unreadCount === "number" && unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] px-1 items-center justify-center bg-red-600 text-white text-[9px] font-black font-mono rounded-full border border-zinc-950 dark:border-zinc-900 animate-pulse">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>

            {/* Contact Us Button */}
            <Link
              href="/contact"
              className="relative flex items-center justify-center p-2 border-2 border-zinc-950 dark:border-zinc-800 text-zinc-950 dark:text-zinc-100 bg-white dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none hover:translate-y-[-2px] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-none active:translate-y-0 active:shadow-none shrink-0"
              title="Contact Us"
            >
              <Mail className="w-4 h-4 text-zinc-800 dark:text-zinc-300" />
            </Link>

            {/* Wallet Balance */}
            <button
              onClick={onWalletClick}
              className="flex items-center gap-2 border-2 border-zinc-950 dark:border-zinc-800 px-3 py-1.5 bg-zinc-50 dark:bg-zinc-950 hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none hover:translate-y-[-2px] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-none active:translate-y-0 active:shadow-none shrink-0"
            >
              <Wallet className="w-4 h-4 text-zinc-950 dark:text-zinc-300 shrink-0" />
              <div className="flex flex-col text-left min-w-0">
                <span className="text-xs font-mono font-black text-zinc-950 dark:text-zinc-50 stake-number leading-none truncate max-w-none">
                  {formatCurrencyPrecise(wallet.balance, region)}
                </span>
                <span className="text-[9px] font-mono font-bold text-zinc-600 dark:text-zinc-400 leading-none mt-0.5 inline-block">
                  {formatCurrencyPrecise(wallet.escrow_locked, region)} locked
                </span>
              </div>
              <div className="flex items-center gap-0.5 ml-0.5">
                <span className="p-0.5 text-zinc-950 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors">
                  <Plus className="w-3 h-3" />
                </span>
              </div>
            </button>

            {/* User / Profile */}
            <button
              onClick={() => onViewChange("profile")}
              className={`w-9 h-9 border-2 flex items-center justify-center transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none hover:translate-y-[-2px] hover:shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:hover:shadow-none active:translate-y-0 active:shadow-none shrink-0 ${
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

          {/* Right Side Mobile: Slim 48px utility bar with direct 1-tap Wallet Pill + Notifications Bell */}
          <div className="flex lg:hidden items-center gap-2">
            {/* Compact Wallet Pill */}
            <button
              onClick={onWalletClick}
              className="flex items-center gap-1.5 border-2 border-zinc-950 dark:border-zinc-800 px-2.5 py-1 bg-white dark:bg-zinc-950 active:translate-y-0.5 transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
              aria-label="Open Wallet"
            >
              <Wallet className="w-3.5 h-3.5 text-zinc-950 dark:text-zinc-300 shrink-0" />
              <span className="text-xs font-mono font-black text-zinc-950 dark:text-zinc-50 stake-number leading-none">
                {formatCurrencyPrecise(wallet.balance, region)}
              </span>
              <Plus className="w-3 h-3 text-red-600 dark:text-red-500 shrink-0" />
            </button>

            {/* Direct Notifications Bell */}
            <button
              onClick={onNotificationsClick}
              className="relative flex items-center justify-center w-8 h-8 border-2 border-zinc-950 dark:border-zinc-800 text-zinc-950 dark:text-zinc-100 bg-white dark:bg-zinc-950 active:translate-y-0.5 transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none shrink-0"
              aria-label="Notifications"
            >
              <Bell className="w-4 h-4" />
              {typeof unreadCount === "number" && unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] px-1 items-center justify-center bg-red-600 text-white text-[9px] font-black font-mono rounded-full border border-zinc-950 dark:border-zinc-900 animate-pulse">
                  {unreadCount > 99 ? "99+" : unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* Fixed Bottom Navigation Bar (Mobile & Tablet <lg Only) */}
      <nav
        aria-label="Primary mobile navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t-2 border-zinc-950 dark:border-zinc-800 bg-zinc-50/95 dark:bg-[#09090b]/95 backdrop-blur-md pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.08)]"
      >
        <div className="grid grid-cols-4 h-14 divide-x-2 divide-zinc-950/15 dark:divide-zinc-800/60">
          <MobileNavTab
            icon={<Zap className="w-4 h-4" />}
            label="Oaths"
            isActive={currentView === "active"}
            onClick={() => onViewChange("active")}
          />
          <MobileNavTab
            icon={<PenLine className="w-4 h-4" />}
            label="+ Oath"
            isActive={currentView === "create"}
            onClick={() => onViewChange("create")}
            accent
          />
          <MobileNavTab
            icon={<Users className="w-4 h-4" />}
            label="Lobbies"
            isActive={currentView === "community"}
            onClick={() => onViewChange("community")}
          />
          <MobileNavTab
            icon={<User className="w-4 h-4" />}
            label="Profile"
            isActive={currentView === "profile"}
            onClick={() => onViewChange("profile")}
          />
        </div>
      </nav>
    </>
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
      className={`flex flex-col items-center justify-center gap-1 py-1.5 transition-all relative
        ${
          isActive
            ? accent
              ? "bg-red-600 text-white"
              : "bg-zinc-950 text-white dark:bg-zinc-800 dark:text-zinc-50"
            : accent
            ? "text-red-600 dark:text-red-400 bg-red-500/5"
            : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-200"
        }
      `}
    >
      {isActive && (
        <span className="absolute top-0 inset-x-0 h-0.5 bg-red-500" />
      )}
      {icon}
      <span className="text-[9px] font-mono font-black tracking-wider uppercase leading-none">
        {label}
      </span>
    </button>
  );
}
