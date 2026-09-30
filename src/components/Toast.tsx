"use client";

import { useState, useEffect } from "react";
import type { ToastMessage } from "@/lib/types";

// ============================================================
// Toast Context — Global toast notifications
// ============================================================

let toastListeners: ((toasts: ToastMessage[]) => void)[] = [];
let toastQueue: ToastMessage[] = [];

function notifyListeners() {
  toastListeners.forEach((fn) => fn([...toastQueue]));
}

export type ToastOptions = {
  title?: string;
  description?: string;
  message?: string;
  type?: ToastMessage["type"];
  duration?: number;
};

export function showToast(
  messageOrOptions: string | ToastOptions,
  type: ToastMessage["type"] = "error",
  duration = 4000
) {
  const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
  let message = "";
  let title: string | undefined;
  let resolvedType = type;
  let resolvedDuration = duration;

  if (typeof messageOrOptions === "object" && messageOrOptions !== null) {
    title = messageOrOptions.title;
    message = messageOrOptions.description || messageOrOptions.message || messageOrOptions.title || "";
    if (messageOrOptions.type) resolvedType = messageOrOptions.type;
    if (messageOrOptions.duration) resolvedDuration = messageOrOptions.duration;
  } else {
    message = String(messageOrOptions);
  }

  const toast: ToastMessage = { id, message, title, type: resolvedType, duration: resolvedDuration };
  toastQueue = [...toastQueue, toast];
  notifyListeners();

  setTimeout(() => {
    dismissToast(id);
  }, resolvedDuration);
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
    <div className="toast-container fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-[90vw] sm:max-w-md">
      <div className="flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`slide-up cursor-pointer flex items-start gap-3 px-5 py-3 border ${
              toast.type === "error"
                ? "bg-red-950/90 border-red-800 text-red-200"
                : toast.type === "success"
                ? "bg-zinc-900/90 border-zinc-700 text-zinc-200"
                : "bg-zinc-900/90 border-zinc-700 text-zinc-300"
            } backdrop-blur-sm min-w-[280px] max-w-[480px] shadow-lg`}
            onClick={() => dismissToast(toast.id)}
          >
            {toast.type === "error" && (
              <span className="text-red-500 text-lg font-mono font-bold shrink-0 mt-0.5">✕</span>
            )}
            {toast.type === "success" && (
              <span className="text-zinc-400 text-lg font-mono font-bold shrink-0 mt-0.5">✓</span>
            )}
            {toast.type === "info" && (
              <span className="text-zinc-400 text-lg font-mono font-bold shrink-0 mt-0.5">ℹ</span>
            )}
            <div className="flex flex-col min-w-0">
              {toast.title && toast.title !== toast.message && (
                <span className="text-xs font-mono font-bold tracking-tight uppercase mb-0.5">{toast.title}</span>
              )}
              <span className="text-sm font-medium tracking-tight break-words">{toast.message}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
