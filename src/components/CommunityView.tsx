"use client";

import { useState } from "react";
import type { ComponentProps } from "react";
import LobbiesView from "./LobbiesView";
import WallView from "./WallView";

type LobbiesProps = ComponentProps<typeof LobbiesView>;
type WallEntries = ComponentProps<typeof WallView>["entries"];

interface CommunityViewProps {
  lobbiesProps: LobbiesProps;
  shameEntries: WallEntries;
  honorEntries: WallEntries;
}

type SubTab = "lobbies" | "shame" | "honor";

const SUB_TABS: { id: SubTab; label: string; accent?: boolean }[] = [
  { id: "lobbies", label: "Lobbies" },
  { id: "shame", label: "Wall of Shame", accent: true },
  { id: "honor", label: "Wall of Honor" },
];

export default function CommunityView({ lobbiesProps, shameEntries, honorEntries }: CommunityViewProps) {
  const [subTab, setSubTab] = useState<SubTab>("lobbies");

  return (
    <div>
      <div
        role="tablist"
        aria-label="Community sections"
        className="flex overflow-x-auto border-2 border-zinc-950 dark:border-zinc-800 divide-x-2 divide-zinc-950 dark:divide-zinc-800 mb-6 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
      >
        {SUB_TABS.map((t) => {
          const isActive = subTab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => setSubTab(t.id)}
              className={`flex-1 min-h-[44px] px-3 sm:px-5 whitespace-nowrap text-[11px] font-black tracking-widest uppercase transition-all ${
                isActive
                  ? t.accent
                    ? "bg-red-600 text-white dark:bg-red-950/40 dark:text-red-400"
                    : "bg-zinc-950 text-white dark:bg-zinc-800/50 dark:text-zinc-50"
                  : t.accent
                  ? "text-red-600 hover:bg-red-50 dark:text-red-600/60 dark:hover:bg-red-950/20"
                  : "text-zinc-600 hover:text-zinc-950 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:text-zinc-300 dark:hover:bg-zinc-900"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {subTab === "lobbies" && <LobbiesView {...lobbiesProps} />}
      {subTab === "shame" && <WallView entries={shameEntries} type="shame" />}
      {subTab === "honor" && <WallView entries={honorEntries} type="honor" />}
    </div>
  );
}
