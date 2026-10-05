"use client";

import React, { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { X, Check, XCircle, Bell, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Notification } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@/lib/utils";
import { joinSquad, acceptDuoChallenge } from "@/lib/data-hooks";
import { showToast } from "./Toast";

interface NotificationsPanelProps {
  onClose: () => void;
}

export default function NotificationsPanel({ onClose }: NotificationsPanelProps) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);

  const fetchNotifications = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("notifications")
      .select("*, oath:oaths(*)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setNotifications(data as unknown as Notification[]);
    }
    setLoading(false);
  }, [user, supabase]);

  useEffect(() => {
    if (!user) return;
    fetchNotifications();

    const channel = supabase
      .channel(`notifications_panel:${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (_payload: unknown) => {
          fetchNotifications(); // Simple refresh strategy
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, fetchNotifications, supabase]);

  const handleAction = async (notif: Notification, status: "accepted" | "rejected" | "read") => {
    setProcessingId(notif.id);
    try {
      if (status === "accepted" && notif.oath_id) {
        if (notif.type === "invite_duo") {
          const { error } = await acceptDuoChallenge(notif.oath_id);
          if (error) {
            if (error.toLowerCase().includes("insufficient") || error.toLowerCase().includes("balance")) {
              showToast("Insufficient balance. Put money first, then only you can approve.", "error");
            } else {
              showToast(error, "error");
            }
            return;
          }
          showToast("Accepted Duo Challenge! Stay accountable.", "success");
        } else if (notif.type === "invite_squad" || notif.type === "invite_lobby" || notif.type === "invite") {
          const { error } = await joinSquad(notif.oath_id, notif.oath?.stake_amount ?? 0);
          if (error) {
            if (error.toLowerCase().includes("insufficient") || error.toLowerCase().includes("balance")) {
              showToast("Insufficient balance. Put money first, then only you can approve.", "error");
            } else {
              showToast(error, "error");
            }
            return;
          }
          showToast("Joined Accountability Squad!", "success");
        }
      } else if (status === "rejected") {
        showToast("Invitation declined.", "info");
      }

      await supabase.from("notifications").update({ status }).eq("id", notif.id);
      setNotifications((prev) => prev.map((n) => (n.id === notif.id ? { ...n, status } : n)));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update notification";
      showToast(msg, "error");
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 transition-opacity" onClick={onClose} />
      <div className="fixed top-0 right-0 h-full w-full max-w-md bg-white dark:bg-[#0a0a0f] border-l-4 border-zinc-950 dark:border-zinc-800 z-50 shadow-2xl flex flex-col transform transition-transform duration-300 translate-x-0">
        <div className="flex items-center justify-between px-5 py-4 border-b-2 border-zinc-950 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-zinc-950 dark:text-zinc-100" />
            <h3 className="text-sm font-black text-zinc-950 dark:text-zinc-100 tracking-tight uppercase">INBOX</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-zinc-500">
              <Bell className="w-8 h-8 mb-3 opacity-20" />
              <p className="text-xs font-mono font-bold uppercase tracking-wider">No active notifications</p>
            </div>
          ) : (
            notifications.map((notif) => (
              <div key={notif.id} className={`border-2 border-zinc-950 dark:border-zinc-800 p-4 ${notif.status === 'pending' ? 'bg-zinc-100 dark:bg-zinc-900/50' : 'bg-transparent opacity-50'}`}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-black text-zinc-950 dark:text-zinc-100">{notif.title || "Alert"}</h4>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-1">{notif.message}</p>
                    <p className="text-[10px] font-mono text-zinc-500 mt-2">{formatRelativeTime(notif.created_at)}</p>
                  </div>
                </div>

                {notif.status === "pending" && (notif.type === "invite_duo" || notif.type === "invite_squad" || notif.type === "invite_lobby" || notif.type === "invite") && (
                  <div className="flex items-center gap-2 mt-4">
                    <button
                      onClick={() => handleAction(notif, "accepted")}
                      disabled={processingId === notif.id}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs font-bold uppercase hover:bg-zinc-800 dark:hover:bg-white disabled:opacity-50"
                    >
                      {processingId === notif.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Accept
                    </button>
                    <button
                      onClick={() => handleAction(notif, "rejected")}
                      disabled={processingId === notif.id}
                      className="flex items-center justify-center p-1.5 border-2 border-zinc-950 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-red-600 hover:border-red-600 disabled:opacity-50"
                      title="Reject"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {notif.status === "pending" && notif.type === "invite_nominee" && (
                  <div className="flex items-center gap-2 mt-4">
                    <Link
                      href={`/verify?token=${notif.oath_id}`}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs font-bold uppercase hover:bg-zinc-800 dark:hover:bg-white"
                    >
                      View Assigned Oath &rarr;
                    </Link>
                    <button
                      onClick={() => handleAction(notif, "read")}
                      className="px-2.5 py-1 text-[10px] font-mono border border-zinc-400 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-800 uppercase"
                    >
                      Acknowledge
                    </button>
                  </div>
                )}

                {notif.status === "pending" && notif.type === "verify_proof" && (
                  <div className="flex items-center gap-2 mt-4">
                    <Link
                      href={`/verify?token=${notif.oath_id}`}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-red-600 text-white text-xs font-bold uppercase hover:bg-red-700 transition-colors"
                    >
                      Review Proof Evidence &rarr;
                    </Link>
                    <button
                      onClick={() => handleAction(notif, "read")}
                      className="px-2.5 py-1 text-[10px] font-mono border border-zinc-400 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-800 uppercase"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {notif.status === "pending" && notif.type === "system" && (
                  <div className="flex justify-end mt-3">
                    <button
                      onClick={() => handleAction(notif, "read")}
                      className="px-2.5 py-1 text-[10px] font-mono font-bold uppercase border border-zinc-400 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-800"
                    >
                      Mark as Read
                    </button>
                  </div>
                )}

                {notif.status !== "pending" && (
                  <div className="mt-3 text-[10px] font-mono font-bold uppercase text-zinc-500 tracking-wider">
                    Status: {notif.status}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
