"use client";

import React, { useEffect, useState, useRef } from "react";
import { X, Send, Camera, Info, ShieldAlert, BadgeCheck, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Message, Oath, Profile, Proof } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@/lib/utils";

interface ChatRoomProps {
  oath: Oath;
  onClose: () => void;
}

export default function ChatRoom({ oath, onClose }: ChatRoomProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  useEffect(() => {
    if (!user) return;
    fetchMessages();

    const channel = supabase
      .channel(`chat:oath:${oath.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `oath_id=eq.${oath.id}` },
        (payload: { new: Message }) => {
          setMessages((prev) => [...prev, payload.new as Message]);
          scrollToBottom();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user, oath.id]);

  const scrollToBottom = () => {
    setTimeout(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, 100);
  };

  const fetchMessages = async () => {
    const { data, error } = await supabase
      .from("messages")
      .select("*, sender:profiles!messages_sender_id_fkey(id, username, display_name, avatar_url)")
      .eq("oath_id", oath.id)
      .order("created_at", { ascending: true });

    if (!error && data) {
      setMessages(data as unknown as Message[]);
      scrollToBottom();
    }
    setLoading(false);
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !user) return;

    const newMessage = {
      oath_id: oath.id,
      sender_id: user.id,
      content: inputText.trim(),
      type: "text",
    };

    setInputText("");
    await supabase.from("messages").insert(newMessage);
  };

  const isLobby = oath.oath_type === "lobby";

  return (
    <>
      <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 transition-opacity" onClick={onClose} />
      <div className="fixed inset-4 md:inset-x-[10%] md:inset-y-[5%] bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 z-50 shadow-[16px_16px_0px_0px_rgba(9,9,11,1)] dark:shadow-none flex flex-col fade-in">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-5 py-4 border-b-4 border-zinc-950 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900/40 shrink-0 gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className={`px-2 py-0.5 text-[10px] font-mono font-black uppercase tracking-widest ${isLobby ? 'bg-indigo-500 text-white' : 'bg-zinc-950 text-white'}`}>
                {oath.oath_type}
              </span>
              <h2 className="text-xl font-black text-zinc-950 dark:text-zinc-100 tracking-tight uppercase line-clamp-1">
                {oath.oath_statement}
              </h2>
            </div>
            <p className="text-xs font-mono font-bold text-zinc-600 dark:text-zinc-400">
              {isLobby ? "GLOBAL LOBBY" : `DEADLINE: ${new Date(oath.deadline).toLocaleDateString()}`}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close chat" className="p-2 border-2 border-zinc-950 dark:border-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-950 dark:text-zinc-300 transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Warning Banner */}
        <div className="bg-yellow-400 dark:bg-yellow-500/20 px-5 py-2 flex items-center justify-center gap-2 border-b-2 border-zinc-950 dark:border-zinc-800 shrink-0">
          <ShieldAlert className="w-4 h-4 text-yellow-950 dark:text-yellow-500" />
          <span className="text-[10px] font-mono font-black text-yellow-950 dark:text-yellow-500 uppercase tracking-widest">Motivational chats only. No personal talks.</span>
        </div>

        {/* Chat Area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4 bg-zinc-50 dark:bg-transparent">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-8 h-8 animate-spin text-zinc-300" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-zinc-400">
              <Info className="w-12 h-12 mb-4 opacity-20" />
              <p className="font-mono font-bold uppercase tracking-wider text-sm">No messages yet</p>
              <p className="text-xs mt-2 max-w-sm text-center">Post your proofs here and wait for verification from your peers.</p>
            </div>
          ) : (
            messages.map((msg) => {
              const isMine = msg.sender_id === user?.id;
              return (
                <div key={msg.id} className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
                  <span className="text-[9px] font-mono font-bold text-zinc-500 mb-1 px-1">
                    {isMine ? "YOU" : (msg.sender?.username ? `@${msg.sender.username}` : "MEMBER")} • {formatRelativeTime(msg.created_at)}
                  </span>
                  <div className={`max-w-[80%] border-2 border-zinc-950 dark:border-zinc-800 p-3 shadow-[4px_4px_0px_0px_rgba(9,9,11,1)] dark:shadow-none ${
                    isMine ? "bg-zinc-950 text-white dark:bg-zinc-800" : "bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-100"
                  }`}>
                    {msg.type === "proof" ? (
                      <div className="flex flex-col items-center gap-3">
                        <div className="flex items-center gap-2 text-indigo-400">
                          <Camera className="w-5 h-5" />
                          <span className="font-mono font-bold uppercase text-xs">Proof Submitted</span>
                        </div>
                        <button className="px-4 py-2 bg-indigo-600 text-white text-xs font-black uppercase tracking-wider hover:bg-indigo-700 w-full flex items-center justify-center gap-2">
                          <BadgeCheck className="w-4 h-4" /> Verify
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm font-medium whitespace-pre-wrap">{msg.content}</p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white dark:bg-[#0a0a0f] border-t-4 border-zinc-950 dark:border-zinc-800 shrink-0">
          <form onSubmit={handleSend} className="flex gap-2">
            <button
              type="button"
              className="p-3 border-2 border-zinc-950 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900 hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-950 dark:text-zinc-100 transition-colors"
              title="Submit Proof"
            >
              <Camera className="w-5 h-5" />
            </button>
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Send motivation or proof..."
              className="flex-1 px-4 py-3 border-2 border-zinc-950 dark:border-zinc-800 bg-transparent text-zinc-950 dark:text-zinc-100 font-mono text-sm focus:outline-none focus:bg-zinc-50 dark:focus:bg-zinc-900/50"
            />
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="px-6 py-3 bg-zinc-950 dark:bg-zinc-100 text-white dark:text-zinc-950 border-2 border-zinc-950 dark:border-zinc-100 hover:bg-zinc-800 dark:hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-black uppercase tracking-wider text-sm flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">Send</span>
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
