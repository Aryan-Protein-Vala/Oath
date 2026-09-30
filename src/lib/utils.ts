// ============================================================
// OATH — Utility Functions
// ============================================================

const EXCHANGE_RATE_USD_TO_INR = 90;

export function convertToLocal(usdAmount: number, region: "global" | "in" = "global"): number {
  return region === "in" ? usdAmount * EXCHANGE_RATE_USD_TO_INR : usdAmount;
}

export function convertToUSD(localAmount: number, region: "global" | "in" = "global"): number {
  const usd = region === "in" ? localAmount / EXCHANGE_RATE_USD_TO_INR : localAmount;
  return Math.round(usd * 100) / 100;
}

/**
 * Format a number as currency (USD or INR)
 */
export function formatCurrency(amount: number, region: "global" | "in" = "global"): string {
  const localAmount = convertToLocal(amount, region);
  if (region === "in") {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(localAmount);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(localAmount);
}

/**
 * Format currency with cents
 */
export function formatCurrencyPrecise(amount: number, region: "global" | "in" = "global"): string {
  const localAmount = convertToLocal(amount, region);
  if (region === "in") {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(localAmount);
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(localAmount);
}

/**
 * Calculate time remaining from a deadline
 */
export function getTimeRemaining(deadline: string): {
  total: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
  isUrgent: boolean;
} {
  const deadlineTime = new Date(deadline).getTime();
  if (isNaN(deadlineTime)) {
    return { total: 0, days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true, isUrgent: false };
  }
  const total = deadlineTime - Date.now();
  const isExpired = total <= 0;

  if (isExpired) {
    return { total: 0, days: 0, hours: 0, minutes: 0, seconds: 0, isExpired: true, isUrgent: true };
  }

  return {
    total,
    days: Math.floor(total / (1000 * 60 * 60 * 24)),
    hours: Math.floor((total / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((total / (1000 * 60)) % 60),
    seconds: Math.floor((total / 1000) % 60),
    isExpired: false,
    isUrgent: total < 24 * 60 * 60 * 1000, // Less than 24 hours
  };
}

/**
 * Format time remaining as a string
 */
export function formatTimeRemaining(deadline: string): string {
  const { days, hours, minutes, seconds, isExpired } = getTimeRemaining(deadline);
  
  if (isExpired) return "EXPIRED";
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/**
 * Format a date relative to now
 */
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Generate a unique ID (for client-side mock operations)
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Calculate house cut
 */
export function calculateHouseCut(amount: number, percent: number = 10): number {
  return Math.round((amount * percent) / 100 * 100) / 100;
}

/**
 * Calculate net payout after house cut
 */
export function calculateNetPayout(amount: number, percent: number = 10): number {
  return amount - calculateHouseCut(amount, percent);
}

/**
 * Pad a number with leading zeros
 */
export function padZero(n: number, length: number = 2): string {
  return n.toString().padStart(length, "0");
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}

/**
 * Clamp a number between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
