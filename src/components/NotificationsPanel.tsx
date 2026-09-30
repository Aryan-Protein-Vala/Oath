"use client";

import React, { useEffect, useState } from "react";
import { X, Check, XCircle, Bell, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Notification } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@/lib/utils";

interface NotificationsPanelProps {
  onClose: () => void;
}

export default function NotificationsPanel({ onClose }: NotificationsPanelProps) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    if (!user) return;
    fetchNotifications();

    const channel = supabase
      .channel("public:notifications")
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
  }, [user]);

  const fetchNotifications = async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (!error && data) {
      setNotifications(data);
    }
    setLoading(false);
  };

  const handleAction = async (id: string, status: "accepted" | "rejected") => {
    await supabase.from("notifications").update({ status }).eq("id", id);
    // Ideally this also handles the RPC calls to join squad/duo
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, status } : n)));
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

                {notif.status === "pending" && notif.type.startsWith("invite_") && (
                  <div className="flex items-center gap-2 mt-4">
                    <button
                      onClick={() => handleAction(notif.id, "accepted")}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 text-xs font-bold uppercase hover:bg-zinc-800 dark:hover:bg-white"
                    >
                      <Check className="w-3.5 h-3.5" /> Accept
                    </button>
                    <button
                      onClick={() => handleAction(notif.id, "rejected")}
                      className="flex items-center justify-center p-1.5 border-2 border-zinc-950 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400 hover:text-red-600 hover:border-red-600"
                    >
                      <XCircle className="w-4 h-4" />
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
