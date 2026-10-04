"use client";

import React, { useState, useEffect, useCallback, ReactNode } from "react";
import { AlertTriangle, AlertCircle, ShieldAlert, Check, X, Loader2 } from "lucide-react";

// ============================================================
// Confirmation Dialog Options & Global State
// ============================================================

export interface ConfirmOptions {
  id?: string;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "default";
  dangerWarning?: string;
}

type ConfirmResolver = (value: boolean) => void;

interface ActiveConfirmDialog extends ConfirmOptions {
  id: string;
  resolve: ConfirmResolver;
}

let activeConfirmDialog: ActiveConfirmDialog | null = null;
let listeners: ((dialog: ActiveConfirmDialog | null) => void)[] = [];

function notifyListeners() {
  listeners.forEach((fn) => fn(activeConfirmDialog));
}

/**
 * Programmatic confirmation popup returning a Promise<boolean>.
 * Replaces native browser `window.confirm()` with an on-brand brutalist modal.
 *
 * Example:
 * ```ts
 * const ok = await confirmAction({
 *   title: "Cancel Oath?",
 *   message: "Are you sure you want to cancel and reclaim your stake?",
 *   confirmLabel: "Yes, Cancel",
 *   cancelLabel: "Keep Oath",
 *   variant: "danger",
 * });
 * if (!ok) return;
 * ```
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    activeConfirmDialog = {
      ...options,
      id: options.id || `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      resolve: (result: boolean) => {
        activeConfirmDialog = null;
        notifyListeners();
        resolve(result);
      },
    };
    notifyListeners();
  });
}

export function closeActiveConfirm(result = false) {
  if (activeConfirmDialog) {
    activeConfirmDialog.resolve(result);
  }
}

// ============================================================
// Hook to subscribe to active confirm dialog
// ============================================================

export function useConfirmDialog(): ActiveConfirmDialog | null {
  const [dialog, setDialog] = useState<ActiveConfirmDialog | null>(activeConfirmDialog);

  useEffect(() => {
    listeners.push(setDialog);
    return () => {
      listeners = listeners.filter((fn) => fn !== setDialog);
    };
  }, []);

  return dialog;
}

// ============================================================
// Global Confirmation Dialog Container (Mounted in Root Layout)
// ============================================================

export function ConfirmationDialogContainer() {
  const dialog = useConfirmDialog();

  const handleCancel = useCallback(() => {
    if (dialog) dialog.resolve(false);
  }, [dialog]);

  const handleConfirm = useCallback(() => {
    if (dialog) dialog.resolve(true);
  }, [dialog]);

  useEffect(() => {
    if (!dialog) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
      } else if (e.key === "Enter" && !e.shiftKey) {
        // Only confirm on Enter if active element is not a textarea or cancel button
        const target = e.target as HTMLElement | null;
        if (target?.tagName === "TEXTAREA" || target?.getAttribute("data-cancel-btn") === "true") {
          return;
        }
        e.preventDefault();
        handleConfirm();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dialog, handleCancel, handleConfirm]);

  if (!dialog) return null;

  const variant = dialog.variant || "danger";
  const confirmText = dialog.confirmLabel || (variant === "danger" ? "Confirm Action" : "Proceed");
  const cancelText = dialog.cancelLabel || "Cancel";

  const borderColor =
    variant === "danger"
      ? "border-red-600 shadow-[8px_8px_0px_0px_rgba(220,38,38,1)] dark:shadow-none"
      : variant === "warning"
      ? "border-yellow-500 shadow-[8px_8px_0px_0px_rgba(234,179,8,1)] dark:shadow-none"
      : "border-zinc-950 dark:border-zinc-700 shadow-[8px_8px_0px_0px_rgba(9,9,11,1)] dark:shadow-none";

  const confirmBtnBg =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-700 text-white"
      : variant === "warning"
      ? "bg-yellow-500 hover:bg-yellow-600 text-zinc-950"
      : "bg-zinc-950 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-950";

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-desc"
      className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleCancel();
      }}
    >
      <div
        className={`w-full max-w-md bg-white dark:bg-[#0a0a0f] border-4 ${borderColor} p-6 text-left transition-all duration-200`}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            {variant === "danger" && <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />}
            {variant === "warning" && <AlertCircle className="w-5 h-5 text-yellow-500 shrink-0" />}
            {variant === "default" && <ShieldAlert className="w-5 h-5 text-zinc-900 dark:text-zinc-100 shrink-0" />}
            <h3
              id="confirm-dialog-title"
              className="text-base font-black uppercase tracking-tight text-zinc-950 dark:text-zinc-50"
            >
              {dialog.title}
            </h3>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            aria-label="Close"
            className="p-1 -mr-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Optional Danger Warning Banner */}
        {dialog.dangerWarning && (
          <div className="mb-4 px-3 py-2 bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-900/50 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
            <span className="text-[10px] font-mono font-bold uppercase text-red-700 dark:text-red-400 tracking-wider">
              {dialog.dangerWarning}
            </span>
          </div>
        )}

        {/* Message */}
        <div
          id="confirm-dialog-desc"
          className="text-xs font-mono text-zinc-600 dark:text-zinc-300 leading-relaxed mb-6"
        >
          {dialog.message}
        </div>

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-center gap-2.5">
          <button
            type="button"
            data-cancel-btn="true"
            onClick={handleCancel}
            className="w-full sm:w-auto sm:flex-1 py-2.5 px-4 border-2 border-zinc-950 dark:border-zinc-700 text-xs font-mono font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            autoFocus
            className={`w-full sm:w-auto sm:flex-1 py-2.5 px-4 text-xs font-black uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none ${confirmBtnBg}`}
          >
            <Check className="w-3.5 h-3.5" />
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Declarative Component (Direct JSX Usage)
// ============================================================

export interface ConfirmationModalProps {
  isOpen: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "default";
  dangerWarning?: string;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmationModal({
  isOpen,
  title,
  message,
  confirmLabel,
  cancelLabel,
  variant = "danger",
  dangerWarning,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) {
        e.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, loading, onCancel]);

  if (!isOpen) return null;

  const confirmText = confirmLabel || (variant === "danger" ? "Confirm Action" : "Proceed");
  const cancelText = cancelLabel || "Cancel";

  const borderColor =
    variant === "danger"
      ? "border-red-600 shadow-[8px_8px_0px_0px_rgba(220,38,38,1)] dark:shadow-none"
      : variant === "warning"
      ? "border-yellow-500 shadow-[8px_8px_0px_0px_rgba(234,179,8,1)] dark:shadow-none"
      : "border-zinc-950 dark:border-zinc-700 shadow-[8px_8px_0px_0px_rgba(9,9,11,1)] dark:shadow-none";

  const confirmBtnBg =
    variant === "danger"
      ? "bg-red-600 hover:bg-red-700 text-white"
      : variant === "warning"
      ? "bg-yellow-500 hover:bg-yellow-600 text-zinc-950"
      : "bg-zinc-950 hover:bg-zinc-800 text-white dark:bg-zinc-100 dark:hover:bg-zinc-200 dark:text-zinc-950";

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="standalone-confirm-title"
      aria-describedby="standalone-confirm-desc"
      className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) onCancel();
      }}
    >
      <div
        className={`w-full max-w-md bg-white dark:bg-[#0a0a0f] border-4 ${borderColor} p-6 text-left transition-all duration-200`}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2.5">
            {variant === "danger" && <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />}
            {variant === "warning" && <AlertCircle className="w-5 h-5 text-yellow-500 shrink-0" />}
            {variant === "default" && <ShieldAlert className="w-5 h-5 text-zinc-900 dark:text-zinc-100 shrink-0" />}
            <h3
              id="standalone-confirm-title"
              className="text-base font-black uppercase tracking-tight text-zinc-950 dark:text-zinc-50"
            >
              {title}
            </h3>
          </div>
          {!loading && (
            <button
              type="button"
              onClick={onCancel}
              aria-label="Close"
              className="p-1 -mr-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {dangerWarning && (
          <div className="mb-4 px-3 py-2 bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-900/50 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
            <span className="text-[10px] font-mono font-bold uppercase text-red-700 dark:text-red-400 tracking-wider">
              {dangerWarning}
            </span>
          </div>
        )}

        <div
          id="standalone-confirm-desc"
          className="text-xs font-mono text-zinc-600 dark:text-zinc-300 leading-relaxed mb-6"
        >
          {message}
        </div>

        <div className="flex flex-col-reverse sm:flex-row items-center gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="w-full sm:w-auto sm:flex-1 py-2.5 px-4 border-2 border-zinc-950 dark:border-zinc-700 text-xs font-mono font-bold uppercase tracking-wider text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`w-full sm:w-auto sm:flex-1 py-2.5 px-4 text-xs font-black uppercase tracking-wider transition-colors flex items-center justify-center gap-1.5 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none disabled:opacity-50 ${confirmBtnBg}`}
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
