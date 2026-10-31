"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useAuth } from "@/lib/auth-context";
import {
  ArrowLeft,
  Paperclip,
  X,
  Send,
  Loader2,
  Sun,
  Moon,
  Bug,
  Flame,
  Lightbulb,
  ShieldAlert,
  HelpCircle,
  Terminal,
  User,
  Mail,
  FileText,
  AlertCircle,
} from "lucide-react";

const CONTACT_EMAIL = "aryansharma24112003@gmail.com";

const TOPICS = [
  {
    value: "bug",
    label: "Bug / Broken Flow",
    icon: Bug,
    iconColor: "text-red-600 dark:text-red-400",
  },
  {
    value: "feedback",
    label: "Beta Roast & Feedback",
    icon: Flame,
    iconColor: "text-amber-500",
  },
  {
    value: "feature",
    label: "Feature Request",
    icon: Lightbulb,
    iconColor: "text-yellow-500 dark:text-yellow-400",
  },
  {
    value: "exploit",
    label: "Security & Exploit",
    icon: ShieldAlert,
    iconColor: "text-purple-600 dark:text-purple-400",
  },
  {
    value: "other",
    label: "General Question",
    icon: HelpCircle,
    iconColor: "text-zinc-500",
  },
];

export default function ContactPage() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [topic, setTopic] = useState("bug");
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-fill username and email from auth state
  useEffect(() => {
    if (profile?.username && !username) {
      setUsername(`@${profile.username}`);
    }
    if (user?.email && !email) {
      setEmail(user.email);
    }
  }, [profile, user, username, email]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      // Limit file to 10MB
      if (selected.size > 10 * 1024 * 1024) {
        setError("Attachment must be smaller than 10MB.");
        return;
      }
      setError(null);
      setFile(selected);
    }
  };

  const removeFile = () => {
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!username.trim()) {
      setError("Please drop your username or name.");
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setError("Please provide a valid email so we can reach you.");
      return;
    }
    if (!message.trim() || message.trim().length < 5) {
      setError("Please write a message before sending.");
      return;
    }

    setLoading(true);

    const selectedTopic = TOPICS.find((t) => t.value === topic);
    const subjectLine = `[OATH BETA] ${selectedTopic?.label || "Message"} from ${username}`;

    const formData = new FormData();
    formData.append("username", username.trim());
    formData.append("email", email.trim());
    formData.append("topic", selectedTopic?.label || topic);
    formData.append("message", message.trim());
    formData.append("_subject", subjectLine);
    formData.append("_captcha", "false");
    formData.append("_template", "table");

    if (file) {
      formData.append("attachment", file);
    }

    try {
      // Send directly to FormSubmit endpoint via AJAX
      const res = await fetch(`https://formsubmit.co/ajax/${CONTACT_EMAIL}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
        },
        body: formData,
      });

      if (res.ok) {
        router.push("/contact/success");
        return;
      }

      // If AJAX returned non-ok, fallback to standard HTML submit
      if (formRef.current) {
        formRef.current.submit();
        return;
      }
      throw new Error("FormSubmit did not accept transmission");
    } catch {
      // Fallback: submit standard multipart form
      if (formRef.current) {
        formRef.current.submit();
      } else {
        setLoading(false);
        setError("Failed to send transmission. Check your connection or retry.");
      }
    }
  };

  const currentOrigin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="min-h-[100dvh] w-full bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 flex flex-col font-sans transition-colors duration-200">
      {/* Top Bar with Generous Spacing */}
      <header className="w-full max-w-2xl mx-auto px-6 pt-8 pb-4 flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-xs font-mono font-bold text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-100 uppercase tracking-wider transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-red-600" />
          <span>Back to Dashboard</span>
        </Link>

        {mounted && (
          <button
            type="button"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="p-2 border-2 border-zinc-950 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
            aria-label="Toggle theme"
          >
            {resolvedTheme === "dark" ? (
              <Sun className="w-4 h-4 text-zinc-300" />
            ) : (
              <Moon className="w-4 h-4 text-zinc-800" />
            )}
          </button>
        )}
      </header>

      {/* Main Container */}
      <main className="flex-1 w-full max-w-2xl mx-auto px-6 pb-20 pt-4 flex flex-col justify-center">
        {/* Simple Headline and Joke with pretty SVG icon */}
        <div className="mb-10 text-left">
          <div className="inline-flex items-center gap-2 px-2.5 py-1 text-[10px] font-mono font-black uppercase tracking-widest text-red-600 dark:text-red-400 border border-red-500/30 bg-red-50 dark:bg-red-950/20 mb-4">
            <Terminal className="w-3.5 h-3.5" />
            <span>BETA HQ // DIRECT LINE</span>
          </div>
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight uppercase leading-tight text-zinc-950 dark:text-zinc-50 mb-3">
            TALK TO THE DEVS.
          </h1>
          <p className="text-sm font-mono text-zinc-600 dark:text-zinc-400 leading-relaxed max-w-lg">
            Found a bug? Broke the app? Or just want to tell us our UX hurt your feelings?
            Spill it here. We read every single ticket.
          </p>
        </div>

        {/* Clean, Sexy Form with Ample Whitespace */}
        <div className="border-4 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-[#0c0c11] p-6 sm:p-10 shadow-[8px_8px_0px_0px_rgba(9,9,11,1)] dark:shadow-none">
          {error && (
            <div className="mb-6 p-3.5 border-2 border-red-600 bg-red-500/10 text-red-600 dark:text-red-400 font-mono text-xs font-bold flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form
            ref={formRef}
            action={`https://formsubmit.co/${CONTACT_EMAIL}`}
            method="POST"
            encType="multipart/form-data"
            onSubmit={handleSubmit}
            className="space-y-6"
          >
            <input
              type="hidden"
              name="_next"
              value={`${currentOrigin}/contact/success`}
            />
            <input
              type="hidden"
              name="_subject"
              value={`[OATH BETA] Message from ${username || "Anonymous"}`}
            />
            <input type="hidden" name="_captcha" value="false" />
            <input type="hidden" name="_template" value="table" />
            <input type="hidden" name="topic" value={topic} />

            {/* Username & Email Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label
                  htmlFor="contact-username"
                  className="flex items-center gap-1.5 text-[11px] font-mono font-black uppercase text-zinc-800 dark:text-zinc-200 tracking-wider mb-2"
                >
                  <User className="w-3.5 h-3.5 text-zinc-500" />
                  <span>Your Handle / Name</span>
                </label>
                <input
                  id="contact-username"
                  type="text"
                  name="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="@iron_will"
                  required
                  className="w-full px-4 py-3 font-mono font-bold text-sm border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-950 dark:text-zinc-50 focus:border-red-600 dark:focus:border-red-500 focus:outline-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                />
              </div>

              <div>
                <label
                  htmlFor="contact-email"
                  className="flex items-center gap-1.5 text-[11px] font-mono font-black uppercase text-zinc-800 dark:text-zinc-200 tracking-wider mb-2"
                >
                  <Mail className="w-3.5 h-3.5 text-zinc-500" />
                  <span>Your Email</span>
                </label>
                <input
                  id="contact-email"
                  type="email"
                  name="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@domain.com"
                  required
                  className="w-full px-4 py-3 font-mono font-bold text-sm border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-950 dark:text-zinc-50 focus:border-red-600 dark:focus:border-red-500 focus:outline-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none"
                />
              </div>
            </div>

            {/* Category Selector with Pretty SVG Icons */}
            <div>
              <span className="block text-[11px] font-mono font-black uppercase text-zinc-800 dark:text-zinc-200 tracking-wider mb-2.5">
                What do you want to tell us?
              </span>

              {/* Responsive SVG Pill Selector */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {TOPICS.map((t) => {
                  const Icon = t.icon;
                  const isSelected = topic === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setTopic(t.value)}
                      className={`flex items-center gap-2.5 px-3 py-2.5 border-2 text-left font-mono text-xs font-bold transition-all cursor-pointer ${
                        isSelected
                          ? "border-red-600 bg-red-500/10 text-red-600 dark:text-red-400 shadow-[2px_2px_0px_0px_rgba(220,38,38,1)] dark:shadow-none"
                          : "border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 text-zinc-700 dark:text-zinc-300 hover:border-zinc-950 dark:hover:border-zinc-600"
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${isSelected ? "text-red-600 dark:text-red-400" : t.iconColor}`} />
                      <span className="truncate">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Message Box */}
            <div>
              <label
                htmlFor="contact-message"
                className="block text-[11px] font-mono font-black uppercase text-zinc-800 dark:text-zinc-200 tracking-wider mb-2"
              >
                Message
              </label>
              <textarea
                id="contact-message"
                name="message"
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What happened? What were you doing? Be as blunt or funny as you want..."
                required
                className="w-full px-4 py-3 font-mono font-medium text-sm border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-950 dark:text-zinc-50 focus:border-red-600 dark:focus:border-red-500 focus:outline-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none resize-y leading-relaxed"
              />
            </div>

            {/* Attachment Option with Clean SVG */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                name="attachment"
                onChange={handleFileChange}
                accept="image/*,.pdf,.txt,.log"
                className="hidden"
                id="file-upload-input"
              />

              {!file ? (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3.5 py-2 border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-zinc-950 dark:hover:border-zinc-400 text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100 text-xs font-mono font-bold transition-colors cursor-pointer"
                >
                  <Paperclip className="w-3.5 h-3.5 text-zinc-500" />
                  <span>Attach screenshot or log (optional)</span>
                </button>
              ) : (
                <div className="inline-flex items-center gap-2 px-3.5 py-2 border-2 border-zinc-950 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900 text-xs font-mono font-bold">
                  <FileText className="w-4 h-4 text-red-600" />
                  <span className="truncate max-w-[200px] sm:max-w-xs">{file.name}</span>
                  <button
                    type="button"
                    onClick={removeFile}
                    className="p-1 hover:text-red-600 transition-colors ml-1 cursor-pointer"
                    title="Remove attachment"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Submit Action */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className="w-full py-4 px-6 bg-red-600 hover:bg-red-700 text-white font-black text-xs sm:text-sm uppercase tracking-widest transition-all border-2 sm:border-4 border-zinc-950 dark:border-zinc-100 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] dark:shadow-none hover:shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>SENDING...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>SEND TO DEVS</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
