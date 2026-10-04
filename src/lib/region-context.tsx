"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { formatCurrency as utilsFormatCurrency } from "./utils";

export type Region = "global" | "in";

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

export function RegionProvider({ children }: { children: React.ReactNode }) {
  const [region, setRegionState] = useState<Region>("global");
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    // 1. If user previously chose a region preference, prioritize it unconditionally
    try {
      const saved = typeof window !== "undefined" ? (localStorage.getItem("oath_region") as Region | null) : null;
      if (saved === "global" || saved === "in") {
        setRegionState(saved);
        setIsInitializing(false);
        return;
      }
    } catch {
      // Ignore localStorage read errors in private browsing
    }

    const detectRegion = async () => {
      try {
        // 2. Instant Timezone Check (Zero latency, no rate limits)
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") {
          setRegionState("in");
          return;
        }
        
        // 3. Fallback to IP check if timezone isn't strictly India
        const res = await fetch("https://ipapi.co/json/");
        const data = await res.json();
        if (data.country_code === "IN" || data.country === "IN") {
          setRegionState("in");
        } else {
          setRegionState("global");
        }
      } catch (err) {
        console.error("Failed to detect region:", err);
        setRegionState("global");
      } finally {
        setIsInitializing(false);
      }
    };

    detectRegion();
  }, []);

  const setRegion = (newRegion: Region) => {
    setRegionState(newRegion);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("oath_region", newRegion);
      }
    } catch (e) {
      console.warn("Could not save region preference to localStorage", e);
    }
  };

  const formatCurrency = (usdAmount: number) => {
    return utilsFormatCurrency(usdAmount, region);
  };

  return (
    <RegionContext.Provider value={{ region, setRegion, isInitializing, formatCurrency }}>
      {children}
    </RegionContext.Provider>
  );
}

export function useRegion() {
  return useContext(RegionContext);
}
