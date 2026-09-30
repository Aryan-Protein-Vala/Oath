"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { formatCurrency as utilsFormatCurrency } from "./utils";

export type Region = "global" | "in";
const REGION_STORAGE_KEY = "oath_region";

interface RegionContextType {
  region: Region;
  setRegion: (r: Region) => void;
  isInitializing: boolean;
  formatCurrency: (usdAmount: number) => string;
}

const RegionContext = createContext<RegionContextType>({
  region: "global",
  setRegion: () => {},
  isInitializing: true,
  formatCurrency: (amt) => `$${amt}`,
});

function getBrowserRegion(): Region {
  try {
    const saved = window.localStorage.getItem(REGION_STORAGE_KEY);
    if (saved === "global" || saved === "in") return saved;

    const locale = window.navigator.language.toLowerCase();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return locale.endsWith("-in") || timeZone === "Asia/Kolkata" || timeZone === "Asia/Calcutta"
      ? "in"
      : "global";
  } catch {
    return "global";
  }
}

export function RegionProvider({ children }: { children: React.ReactNode }) {
  const [region, setRegionState] = useState<Region>("global");
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setRegionState(getBrowserRegion());
      setIsInitializing(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const setRegion = useCallback((nextRegion: Region) => {
    setRegionState(nextRegion);
    try {
      window.localStorage.setItem(REGION_STORAGE_KEY, nextRegion);
    } catch {
      // Region selection still works in private browsing when storage is unavailable.
    }
  }, []);

  const formatCurrency = useCallback(
    (usdAmount: number) => utilsFormatCurrency(usdAmount, region),
    [region],
  );

  const value = useMemo(
    () => ({ region, setRegion, isInitializing, formatCurrency }),
    [region, setRegion, isInitializing, formatCurrency],
  );

  return <RegionContext.Provider value={value}>{children}</RegionContext.Provider>;
}

export function useRegion() {
  return useContext(RegionContext);
}
