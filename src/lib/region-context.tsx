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
  const [region, setRegion] = useState<Region>("global");
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    const detectRegion = async () => {
      try {
        // 1. Instant Timezone Check (Zero latency, no rate limits)
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") {
          setRegion("in");
          return;
        }
        
        // 2. Fallback to IP check if timezone isn't strictly India but they might be
        const res = await fetch("https://ipapi.co/json/");
        const data = await res.json();
        if (data.country_code === "IN" || data.country === "IN") {
          setRegion("in");
        } else {
          setRegion("global");
        }
      } catch (err) {
        console.error("Failed to detect region:", err);
        // Fallback to global if everything fails
        setRegion("global");
      } finally {
        setTimeout(() => setIsInitializing(false), 500);
      }
    };

    detectRegion();
  }, []);

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
