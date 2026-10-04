"use client";

import { useState, useEffect } from "react";
import { Check, X } from "lucide-react";
import type { ToastMessage } from "@/lib/types";

// ============================================================
// Toast Context — Global toast notifications
// ============================================================

let toastListeners: ((toasts: ToastMessage[]) => void)[] = [];
let toastQueue: ToastMessage[] = [];

function notifyListeners() {
  toastListeners.forEach((fn) => fn([...toastQueue]));
}

export function showToast(message: string, type: ToastMessage["type"] = "error", duration = 4000) {
  const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  const toast: ToastMessage = { id, message, type, duration };
  toastQueue = [...toastQueue, toast];
  notifyListeners();

  setTimeout(() => {
    dismissToast(id);
  }, duration);
}

export function dismissToast(id: string) {
  toastQueue = toastQueue.filter((t) => t.id !== id);
  notifyListeners();
}

export function useToasts(): ToastMessage[] {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    toastListeners.push(setToasts);
    return () => {
      toastListeners = toastListeners.filter((fn) => fn !== setToasts);
    };
  }, []);

  return toasts;
}

// ============================================================
// Toast Display Component
// ============================================================

export function ToastContainer() {
  const toasts = useToasts();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      <div className="flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`slide-up cursor-pointer flex items-center gap-3 px-4 sm:px-5 py-3 border ${
              toast.type === "error"
                ? "bg-red-950/90 border-red-800 text-red-200"
                : toast.type === "success"
                ? "bg-zinc-900/90 border-zinc-700 text-zinc-200"
                : "bg-zinc-900/90 border-zinc-700 text-zinc-300"
            } backdrop-blur-sm w-[calc(100vw-2rem)] sm:w-auto min-w-0 sm:min-w-[320px] max-w-[480px] shadow-lg`}
            onClick={() => dismissToast(toast.id)}
          >
            {toast.type === "error" && (
              <X className="w-4 h-4 text-red-500 shrink-0" />
            )}
            {toast.type === "success" && (
              <Check className="w-4 h-4 text-zinc-300 shrink-0" />
            )}
            <span className="text-sm font-medium tracking-tight">{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
