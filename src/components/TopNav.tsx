"use client";

import { Wallet, Plus, Minus } from "lucide-react";
import { formatCurrencyPrecise } from "@/lib/utils";
import type { Wallet as WalletType } from "@/lib/types";

interface TopNavProps {
  wallet: WalletType;
  currentView: string;
  onViewChange: (view: string) => void;
  username: string;
}

export default function TopNav({ wallet, currentView, onViewChange, username }: TopNavProps) {
  return (
    <nav className="w-full border-b border-zinc-800/80 bg-[#09090b]/95 backdrop-blur-sm">
      <div className="flex items-center justify-between h-14 px-5">
        {/* Logo / Brand */}
        <div className="flex items-center gap-6">
          <button
            onClick={() => onViewChange("active")}
            className="flex items-center gap-2 group"
          >
            <span className="text-lg font-black tracking-[-0.08em] text-zinc-50 group-hover:text-zinc-300 transition-colors">
              OATH
            </span>
            <span className="text-[9px] font-mono text-zinc-600 tracking-widest uppercase mt-0.5">
              v0.1
            </span>
          </button>

          {/* Primary Nav Tabs */}
          <div className="hidden sm:flex items-center gap-0 border border-zinc-800 divide-x divide-zinc-800">
            <NavTab
              label="Active"
              isActive={currentView === "active"}
              onClick={() => onViewChange("active")}
            />
            <NavTab
              label="Create"
              isActive={currentView === "create"}
              onClick={() => onViewChange("create")}
            />
            <NavTab
              label="Lobbies"
              isActive={currentView === "lobbies"}
              onClick={() => onViewChange("lobbies")}
            />
            <NavTab
              label="Shame"
              isActive={currentView === "wall_shame"}
              onClick={() => onViewChange("wall_shame")}
              accent
            />
            <NavTab
              label="Honor"
              isActive={currentView === "wall_honor"}
              onClick={() => onViewChange("wall_honor")}
            />
          </div>
        </div>

        {/* Right Side — Wallet & User */}
        <div className="flex items-center gap-4">
          {/* Wallet Balance */}
          <div className="flex items-center gap-3 border border-zinc-800 px-3 py-1.5 bg-zinc-950">
            <Wallet className="w-3.5 h-3.5 text-zinc-500" />
            <div className="flex flex-col">
              <span className="text-xs font-mono font-bold text-zinc-50 stake-number leading-none">
                {formatCurrencyPrecise(wallet.balance)}
              </span>
              <span className="text-[9px] font-mono text-zinc-600 leading-none mt-0.5">
                {formatCurrencyPrecise(wallet.escrow_locked)} locked
              </span>
            </div>
            <div className="flex items-center gap-0.5 ml-1">
              <button className="p-1 hover:bg-zinc-800 transition-colors text-zinc-500 hover:text-zinc-300">
                <Plus className="w-3 h-3" />
              </button>
              <button className="p-1 hover:bg-zinc-800 transition-colors text-zinc-500 hover:text-zinc-300">
                <Minus className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* User */}
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-7 h-7 bg-zinc-800 border border-zinc-700 flex items-center justify-center">
              <span className="text-[10px] font-mono font-bold text-zinc-400 uppercase">
                {username.substring(0, 2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Nav — Bottom of header on small screens */}
      <div className="flex sm:hidden items-center border-t border-zinc-800/50 divide-x divide-zinc-800/50">
        <NavTab
          label="Active"
          isActive={currentView === "active"}
          onClick={() => onViewChange("active")}
          mobile
        />
        <NavTab
          label="Create"
          isActive={currentView === "create"}
          onClick={() => onViewChange("create")}
          mobile
        />
        <NavTab
          label="Lobbies"
          isActive={currentView === "lobbies"}
          onClick={() => onViewChange("lobbies")}
          mobile
        />
        <NavTab
          label="Shame"
          isActive={currentView === "wall_shame"}
          onClick={() => onViewChange("wall_shame")}
          accent
          mobile
        />
        <NavTab
          label="Honor"
          isActive={currentView === "wall_honor"}
          onClick={() => onViewChange("wall_honor")}
          mobile
        />
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
        text-[11px] font-medium tracking-wide uppercase transition-all
        ${
          isActive
            ? accent
              ? "bg-red-950/40 text-red-400"
              : "bg-zinc-800/50 text-zinc-50"
            : accent
            ? "text-red-600/60 hover:text-red-400 hover:bg-red-950/20"
            : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
        }
      `}
    >
      {label}
    </button>
  );
}
