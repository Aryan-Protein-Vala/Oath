"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import {
  Skull,
  DollarSign,
  Crosshair,
  Zap,
  Moon,
  Sun,
  Shield,
  Users,
  Swords,
  Flame,
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Lock
} from "lucide-react";

const emptySubscribe = () => () => {};

export default function LandingView() {
  const { setTheme, resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  const toggleTheme = () => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  if (!mounted) return null;

  return (
    <div className="h-screen w-full bg-zinc-50 dark:bg-[#09090b] text-zinc-950 dark:text-zinc-50 overflow-y-auto overflow-x-hidden selection:bg-red-500/30 font-sans">
      
      {/* Navbar */}
      <nav className="w-full border-b-2 sm:border-b-4 border-zinc-950 dark:border-zinc-800/80 bg-zinc-50 dark:bg-[#09090b]/90 backdrop-blur-md sticky top-0 z-50 transition-colors duration-300">
        <div className="flex items-center justify-between h-16 sm:h-20 px-6 max-w-7xl mx-auto w-full">
          <div className="flex items-center gap-3">
            <span className="text-3xl font-black tracking-tighter text-zinc-950 dark:text-zinc-50">OATH</span>
            <span className="hidden sm:inline-flex items-center justify-center px-2 py-1 text-[10px] font-mono text-zinc-950 dark:text-zinc-400 font-bold tracking-widest uppercase border-2 border-zinc-950 dark:border-zinc-800 rounded-none shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-none bg-red-500/10 dark:bg-transparent">
              No Excuses
            </span>
          </div>
          <div className="flex items-center gap-6">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-none border-2 border-transparent hover:border-zinc-950 dark:hover:border-zinc-700 transition-all"
              aria-label="Toggle theme"
            >
              {resolvedTheme === "dark" ? (
                <Sun className="w-5 h-5 text-zinc-400" />
              ) : (
                <Moon className="w-5 h-5 text-zinc-950" />
              )}
            </button>
            <Link
              href="/auth"
              className="px-6 py-2.5 sm:py-3 bg-zinc-950 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-950 text-xs sm:text-sm font-black uppercase tracking-tight hover:-translate-y-1 hover:shadow-[4px_4px_0px_0px_rgba(220,38,38,1)] dark:hover:shadow-[0_0_20px_rgba(250,250,250,0.3)] active:translate-y-0 active:shadow-none transition-all border-2 border-zinc-950 dark:border-transparent"
            >
              Enter Arena
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative min-h-[90vh] flex flex-col items-center justify-center px-6 py-20 text-center w-full overflow-hidden">
        {/* Background typographic noise */}
        <div className="absolute inset-0 flex items-center justify-center opacity-5 dark:opacity-[0.02] pointer-events-none select-none z-0 overflow-hidden">
          <h1 className="text-[35vw] font-black leading-none whitespace-nowrap text-zinc-950 dark:text-white transform -rotate-12 scale-150 tracking-tighter">
            WEAKNESS
          </h1>
        </div>

        <motion.div
          className="relative z-10 max-w-6xl mx-auto w-full flex flex-col items-center"
        >
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: "easeOut" }}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-mono font-black tracking-widest uppercase text-red-600 dark:text-red-500 border-2 border-red-600 dark:border-red-500/30 bg-red-50 dark:bg-red-950/20 mb-8 rounded-none shadow-[4px_4px_0px_0px_rgba(220,38,38,1)] dark:shadow-none"
          >
            <AlertTriangle className="w-4 h-4" /> Stop running from the grind
          </motion.div>
          
          <motion.h1
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: "easeOut" }}
            className="text-6xl sm:text-8xl md:text-[8rem] lg:text-[10rem] font-black tracking-tighter leading-[0.85] mb-8 text-zinc-950 dark:text-zinc-50"
          >
            YOU ARE <br className="hidden sm:block" />
            <span className="text-red-600 dark:text-red-500 inline-block hover:scale-105 transition-transform cursor-default">TOO SOFT.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: "easeOut" }}
            className="text-xl sm:text-3xl text-zinc-800 dark:text-zinc-400 font-bold max-w-4xl mx-auto leading-tight mb-12"
          >
            I built this app because you dumbasses were procrastinating, making excuses, and running from hard work. 
            Your words mean <span className="underline decoration-red-500 decoration-4 underline-offset-4">absolutely nothing</span> if there are no consequences. 
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
            className="flex flex-col sm:flex-row items-center gap-6 w-full max-w-lg"
          >
            <Link
              href="/auth"
              className="w-full group flex items-center justify-center gap-3 py-6 bg-red-600 text-white text-xl sm:text-2xl font-black tracking-tight uppercase hover:bg-red-700 transition-all border-4 border-zinc-950 dark:border-red-600 shadow-[8px_8px_0px_0px_rgba(9,9,11,1)] dark:shadow-[0_0_30px_rgba(220,38,38,0.3)] hover:-translate-y-2 hover:shadow-[12px_12px_0px_0px_rgba(9,9,11,1)] dark:hover:shadow-[0_0_50px_rgba(220,38,38,0.5)] active:translate-y-0 active:shadow-[0px_0px_0px_0px_rgba(9,9,11,1)] dark:active:shadow-none rounded-none"
            >
              <Zap className="w-8 h-8 group-hover:rotate-12 transition-transform" />
              Lock In Your Penalty
            </Link>
          </motion.div>
        </motion.div>
      </section>

      {/* The Truth / Problem Section */}
      <section className="py-32 px-6 border-t-4 border-zinc-950 dark:border-zinc-800/60 bg-white dark:bg-zinc-900/20 relative overflow-hidden">
        {/* Abstract background shapes for light mode */}
        <div className="absolute top-0 right-0 w-1/2 h-full bg-zinc-100 dark:bg-transparent -skew-x-12 translate-x-32 z-0" />
        
        <div className="max-w-7xl mx-auto w-full relative z-10">
          <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-center">
            <motion.div
              initial={{ opacity: 0, x: -50 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.6 }}
            >
              <div className="inline-block px-3 py-1 bg-zinc-950 text-white dark:bg-zinc-800 dark:text-zinc-400 font-mono text-sm font-bold uppercase mb-6 shadow-[4px_4px_0px_0px_rgba(220,38,38,1)] dark:shadow-none">
                The Harsh Reality
              </div>
              <h2 className="text-5xl sm:text-7xl font-black tracking-tighter uppercase mb-8 text-zinc-950 dark:text-zinc-100 leading-[0.9]">
                Motivation is garbage.<br />
                <span className="text-red-600 dark:text-red-500 line-through decoration-zinc-950 dark:decoration-zinc-50 decoration-8">Inspiration</span> <br className="hidden sm:block" />
                <span className="text-zinc-950 dark:text-zinc-100 underline decoration-red-600 decoration-8 underline-offset-8">Pain is reliable.</span>
              </h2>
              <p className="text-xl sm:text-2xl text-zinc-700 dark:text-zinc-400 font-bold mb-6 leading-snug">
                You buy a $10 course and never open it. You set a goal and forget it by Tuesday. Why? Because losing $10 or hurting your own feelings isn&apos;t painful enough.
              </p>
              <p className="text-xl sm:text-2xl text-zinc-950 dark:text-zinc-300 leading-snug font-black p-6 bg-red-50 dark:bg-zinc-800/50 border-l-8 border-red-600">
                But what if you lose $500? What if we text your boss that you&apos;re a failure, or force you to do 100 burpees on video? Suddenly, you&apos;ll find the time.
              </p>
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0, scale: 0.9, rotate: 2 }}
              whileInView={{ opacity: 1, scale: 1, rotate: -2 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ duration: 0.6 }}
              className="relative aspect-square md:aspect-video lg:aspect-square bg-zinc-50 dark:bg-zinc-950 border-4 border-zinc-950 dark:border-zinc-800 p-8 sm:p-12 flex flex-col justify-center rounded-none shadow-[16px_16px_0px_0px_rgba(9,9,11,1)] dark:shadow-none group hover:rotate-0 transition-transform duration-500"
            >
              <div className="absolute top-0 left-0 bg-zinc-950 text-zinc-50 text-xs font-mono font-bold uppercase px-4 py-2 flex items-center gap-2">
                <Skull className="w-4 h-4" /> The Anatomy of a Flake
              </div>
              <div className="space-y-8 mt-6">
                <div className="flex items-center gap-6 opacity-40 line-through hover:opacity-100 transition-opacity">
                  <CheckCircle2 className="w-10 h-10 text-zinc-950 dark:text-zinc-400 shrink-0" />
                  <span className="text-2xl sm:text-3xl font-black font-mono">&ldquo;I&apos;ll do it tomorrow&rdquo;</span>
                </div>
                <div className="flex items-center gap-6 opacity-40 line-through hover:opacity-100 transition-opacity">
                  <CheckCircle2 className="w-10 h-10 text-zinc-950 dark:text-zinc-400 shrink-0" />
                  <span className="text-2xl sm:text-3xl font-black font-mono">&ldquo;I&apos;m just too busy&rdquo;</span>
                </div>
                <div className="flex items-center gap-6 opacity-40 line-through hover:opacity-100 transition-opacity">
                  <CheckCircle2 className="w-10 h-10 text-zinc-950 dark:text-zinc-400 shrink-0" />
                  <span className="text-2xl sm:text-3xl font-black font-mono">&ldquo;I need to read more&rdquo;</span>
                </div>
                <div className="flex items-center gap-6 mt-8 pt-8 border-t-4 border-zinc-950 dark:border-zinc-800">
                  <XCircle className="w-12 h-12 text-red-600 shrink-0 animate-pulse" />
                  <span className="text-3xl sm:text-4xl font-black uppercase text-zinc-950 dark:text-zinc-100 leading-tight tracking-tighter">&ldquo;I don&apos;t want to lose $1,000 or my dignity&rdquo;</span>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Big Animated Divider */}
      <div className="w-full bg-zinc-950 dark:bg-zinc-100 text-zinc-50 dark:text-zinc-950 py-8 overflow-hidden flex whitespace-nowrap border-y-4 border-zinc-950 dark:border-transparent">
        <motion.div
          animate={{ x: [0, -1000] }}
          transition={{ repeat: Infinity, duration: 15, ease: "linear" }}
          className="flex items-center gap-12 text-4xl font-black tracking-tighter uppercase"
        >
          {Array.from({ length: 15 }).map((_, i) => (
            <span key={i} className="flex items-center gap-12">
              <span>EXCUSES ARE DEAD</span>
              <Skull className="w-10 h-10" />
              <span>PUT UP OR SHUT UP</span>
              <DollarSign className="w-10 h-10" />
            </span>
          ))}
        </motion.div>
      </div>

      {/* How It Works (Step by step) */}
      <section className="py-32 px-6 bg-zinc-100 dark:bg-[#09090b] relative">
        {/* Background Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none" />

        <div className="max-w-7xl mx-auto w-full relative z-10">
          <div className="text-center mb-24">
            <h2 className="text-6xl sm:text-8xl font-black tracking-tighter uppercase text-zinc-950 dark:text-zinc-50">
              How It Works
            </h2>
            <p className="text-xl sm:text-2xl text-red-600 font-bold tracking-tight mt-4">Simple. Brutal. Effective.</p>
          </div>

          <div className="grid lg:grid-cols-3 gap-12 lg:gap-8 relative">
            {/* Connecting line for desktop */}
            <div className="hidden lg:block absolute top-16 left-[15%] right-[15%] h-2 bg-zinc-950 dark:bg-zinc-800 z-0" />
            
            {[
              {
                step: "01",
                title: "Swear The Oath",
                desc: "Declare exactly what you are going to do and when it is due. Be specific. 'Get rich' is a wish. 'Ship V1 by Friday' is an Oath.",
                icon: <Zap className="w-12 h-12" />
              },
              {
                step: "02",
                title: "Lock The Penalty",
                desc: "Lock in cash, give us your boss's phone number, or commit to a physical penalty. Whatever it is, it stays locked until the deadline hits.",
                icon: <Lock className="w-12 h-12" />
              },
              {
                step: "03",
                title: "Prove It. Or Bleed.",
                desc: "Upload proof for your referees, opponents, or the squad to verify. Succeed, and keep your pride. Fail, and the penalty is ruthlessly executed.",
                icon: <Flame className="w-12 h-12 text-red-600" />
              }
            ].map((s, i) => (
              <motion.div
                key={s.step}
                initial={{ opacity: 0, y: 50 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ duration: 0.5, delay: i * 0.2 }}
                className="relative z-10 flex flex-col items-center text-center p-10 bg-white dark:bg-[#0a0a0f] border-4 border-zinc-950 dark:border-zinc-800 shadow-[12px_12px_0px_0px_rgba(9,9,11,1)] dark:shadow-none hover:-translate-y-2 hover:shadow-[16px_16px_0px_0px_rgba(220,38,38,1)] dark:hover:shadow-[0_0_30px_rgba(220,38,38,0.15)] transition-all duration-300"
              >
                <div className="w-32 h-32 bg-zinc-100 dark:bg-zinc-900 border-4 border-zinc-950 dark:border-zinc-700 rounded-none flex items-center justify-center mb-8 text-zinc-950 dark:text-zinc-100 shadow-[inset_4px_4px_0px_0px_rgba(0,0,0,0.1)]">
                  {s.icon}
                </div>
                <div className="inline-block px-4 py-1 bg-zinc-950 text-zinc-50 dark:bg-zinc-800 dark:text-zinc-300 font-black text-sm mb-6">
                  STEP {s.step}
                </div>
                <h3 className="text-3xl font-black uppercase tracking-tight mb-4 text-zinc-950 dark:text-zinc-100">{s.title}</h3>
                <p className="text-lg text-zinc-600 dark:text-zinc-400 leading-relaxed font-bold">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* The Consequences Section */}
      <section className="py-32 px-6 bg-zinc-50 dark:bg-zinc-950 border-t-4 border-zinc-950 dark:border-zinc-800">
        <div className="max-w-7xl mx-auto w-full">
          <div className="text-center mb-24">
            <h2 className="text-6xl sm:text-8xl font-black tracking-tighter uppercase text-zinc-950 dark:text-zinc-50">
              Pick Your Penalty
            </h2>
            <p className="text-xl sm:text-2xl text-zinc-600 dark:text-zinc-400 font-bold mt-4 max-w-3xl mx-auto">
              We don&apos;t just take your money. If financial loss isn&apos;t painful enough, we offer more creative ways to ruin your day when you fail.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                title: "The Money Pit",
                desc: "The classic. You fail, you lose your locked cash. We take 10% and burn the rest.",
                icon: <DollarSign className="w-8 h-8 text-zinc-950 dark:text-zinc-50" />
              },
              {
                title: "Social Ransom",
                desc: "We text a pre-written, highly embarrassing message to your mom, boss, or ex if you fail.",
                icon: <Zap className="w-8 h-8 text-zinc-950 dark:text-zinc-50" />
              },
              {
                title: "Anti-Charity",
                desc: "Your money gets donated to a cause or political party you absolutely despise.",
                icon: <Flame className="w-8 h-8 text-red-600" />
              },
              {
                title: "Physical Debt",
                desc: "You owe 100 burpees on video before you can unlock your account again.",
                icon: <Skull className="w-8 h-8 text-zinc-950 dark:text-zinc-50" />
              }
            ].map((c, i) => (
              <motion.div
                key={c.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                className="p-8 border-4 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-[#0a0a0f] hover:-translate-y-2 hover:shadow-[8px_8px_0px_0px_rgba(9,9,11,1)] dark:hover:shadow-[0_0_20px_rgba(255,255,255,0.1)] transition-all"
              >
                <div className="mb-6">{c.icon}</div>
                <h3 className="text-2xl font-black uppercase mb-3 text-zinc-950 dark:text-zinc-100 tracking-tight">{c.title}</h3>
                <p className="text-sm font-bold text-zinc-600 dark:text-zinc-400">{c.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Modes Section */}
      <section className="py-32 px-6 border-t-4 border-zinc-950 dark:border-zinc-800/60 bg-white dark:bg-[#0a0a0f]">
        <div className="max-w-7xl mx-auto w-full">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }}
            className="mb-20 text-center sm:text-left flex flex-col sm:flex-row items-center sm:items-end justify-between gap-6"
          >
            <div>
              <h2 className="text-6xl sm:text-8xl font-black tracking-tighter uppercase mb-4 text-zinc-950 dark:text-zinc-50 leading-[0.9]">
                Choose Your <br className="hidden sm:block" /> Battlefield
              </h2>
              <p className="text-2xl font-bold text-zinc-600 dark:text-zinc-400">Play solo, or drag your friends into hell with you.</p>
            </div>
          </motion.div>

          <div className="grid lg:grid-cols-3 gap-8">
            
            {/* Solo */}
            <motion.div 
              initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 }}
              className="group border-4 border-zinc-950 dark:border-zinc-800 p-10 bg-zinc-50 dark:bg-[#09090b] hover:bg-zinc-950 dark:hover:bg-zinc-800 transition-colors duration-500 shadow-[8px_8px_0px_0px_rgba(9,9,11,1)] dark:shadow-none"
            >
              <Shield className="w-16 h-16 text-zinc-950 dark:text-zinc-400 mb-8 group-hover:text-zinc-50 transition-colors" />
              <h3 className="text-4xl font-black tracking-tight mb-4 uppercase text-zinc-950 dark:text-zinc-100 group-hover:text-zinc-50 transition-colors">Solo Mode</h3>
              <p className="text-lg text-zinc-700 dark:text-zinc-400 mb-8 font-bold group-hover:text-zinc-300 transition-colors leading-snug">
                You vs. Yourself. No one else to blame. You set the goal, you pick the penalty, you provide the proof. Pure accountability.
              </p>
              <ul className="text-sm font-mono font-bold text-zinc-600 dark:text-zinc-500 space-y-3 group-hover:text-zinc-400 transition-colors border-t-2 border-zinc-200 dark:border-zinc-700 pt-6 mt-auto">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4"/> Absolute control</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4"/> Use Social Ransom</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4"/> Nominate a referee</li>
              </ul>
            </motion.div>

            {/* Duo */}
            <motion.div 
              initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.2 }}
              className="group border-4 border-red-600 p-10 bg-red-50 dark:bg-red-950/10 hover:bg-red-600 transition-colors duration-500 relative overflow-hidden shadow-[12px_12px_0px_0px_rgba(220,38,38,1)] dark:shadow-[0_0_20px_rgba(220,38,38,0.2)]"
            >
              <div className="absolute top-0 right-0 bg-red-600 text-white text-sm font-black uppercase px-6 py-2 border-b-4 border-l-4 border-red-800 group-hover:border-red-950 group-hover:bg-red-950 transition-colors">Bloodbath</div>
              <Swords className="w-16 h-16 text-red-600 dark:text-red-500 mb-8 group-hover:text-white transition-colors" />
              <h3 className="text-4xl font-black tracking-tight mb-4 uppercase text-zinc-950 dark:text-zinc-100 group-hover:text-white transition-colors">Duo Challenge</h3>
              <p className="text-lg text-zinc-800 dark:text-zinc-300 mb-8 font-bold group-hover:text-red-100 transition-colors leading-snug">
                Head-to-head combat. You and a rival lock equal stakes. Either someone wins the pot (Direct Bounty), or you both fail and lose it all (M.A.D.).
              </p>
              <ul className="text-sm font-mono font-bold text-red-700 dark:text-red-400 space-y-3 group-hover:text-red-200 transition-colors border-t-2 border-red-200 dark:border-red-800 pt-6 mt-auto">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4"/> Direct Bounty (Winner takes all)</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4"/> Mutual Assured Destruction</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4"/> Verification by Opponent</li>
              </ul>
            </motion.div>

            {/* Squad */}
            <motion.div 
              initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.3 }}
              className="group border-4 border-zinc-950 dark:border-zinc-800 p-10 bg-zinc-50 dark:bg-[#09090b] hover:bg-zinc-950 dark:hover:bg-zinc-800 transition-colors duration-500 shadow-[8px_8px_0px_0px_rgba(9,9,11,1)] dark:shadow-none flex flex-col"
            >
              <Users className="w-16 h-16 text-zinc-950 dark:text-zinc-400 mb-8 group-hover:text-zinc-50 transition-colors" />
              <h3 className="text-4xl font-black tracking-tight mb-4 uppercase text-zinc-950 dark:text-zinc-100 group-hover:text-zinc-50 transition-colors">Squad Pool</h3>
              <p className="text-lg text-zinc-700 dark:text-zinc-400 mb-8 font-bold group-hover:text-zinc-300 transition-colors leading-snug">
                Up to 8 players commit to a shared goal. If someone slacks, they face the Deadweight Tag, or even worse: Squad Lockdown (one fails, everyone suffers).
              </p>
              <ul className="text-sm font-mono font-bold text-zinc-600 dark:text-zinc-500 space-y-3 group-hover:text-zinc-400 transition-colors border-t-2 border-zinc-200 dark:border-zinc-700 pt-6 mt-auto">
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4"/> Quorum Verification (&gt;50% vote)</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4"/> Deadweight Tag (Shaming)</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4"/> Squad Lockdown penalty</li>
              </ul>
            </motion.div>

          </div>
        </div>
      </section>

      {/* The House Cut Banner */}
      <section className="border-y-4 border-zinc-950 dark:border-red-600 bg-red-600 text-white overflow-hidden py-6 flex whitespace-nowrap">
        <motion.div
          animate={{ x: [0, -2000] }}
          transition={{ repeat: Infinity, duration: 25, ease: "linear" }}
          className="flex items-center gap-12 text-3xl sm:text-5xl font-black tracking-tighter uppercase"
        >
          {Array.from({ length: 20 }).map((_, i) => (
            <span key={i} className="flex items-center gap-12">
              <span>WE TAKE 10% OF THE CASH, OR 100% OF YOUR DIGNITY</span>
              <Skull className="w-10 h-10" />
            </span>
          ))}
        </motion.div>
      </section>

      {/* Testimonials */}
      <section className="py-32 px-6 bg-zinc-100 dark:bg-[#09090b]">
        <div className="max-w-7xl mx-auto w-full">
          <div className="text-center mb-20">
            <h2 className="text-5xl sm:text-7xl font-black tracking-tighter uppercase text-zinc-950 dark:text-zinc-50">
              Words from the Broken
            </h2>
            <p className="text-xl font-bold text-zinc-600 mt-4">Actual results from people who stopped making excuses.</p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                quote: "I lost $500 because I hit snooze instead of going for a run. I hate this app. 10/10 will use again tomorrow.",
                author: "Alex_Dev",
                result: "FAILED",
                amt: "-$500"
              },
              {
                quote: "I actually shipped my MVP because I was terrified of losing my rent money to my co-founder. Brutal but it works.",
                author: "Sarah_Ships",
                result: "SUCCESS",
                amt: "+$1000"
              },
              {
                quote: "My friends rejected my proof because my squat wasn't parallel. I lost $50. Now I have no friends and no money.",
                author: "GymBro99",
                result: "FAILED",
                amt: "-$50"
              },
              {
                quote: "If you don't have the discipline, this app forces it onto you with a sledgehammer. Highly recommended.",
                author: "CEO_Mindset",
                result: "SUCCESS",
                amt: "+$250"
              },
              {
                quote: "I put my phone number in the social ransom field. I failed. It texted my mom that I'm a failure. I am never procrastinating again.",
                author: "Anon_1337",
                result: "FAILED",
                amt: "-REP"
              },
              {
                quote: "This is the most aggressive, stressful, and toxic productivity tool I've ever used. I've never been more productive.",
                author: "DesignGod",
                result: "SUCCESS",
                amt: "+$100"
              }
            ].map((t, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="p-8 border-4 border-zinc-950 dark:border-zinc-800 bg-white dark:bg-zinc-900/40 flex flex-col justify-between shadow-[8px_8px_0px_0px_rgba(9,9,11,1)] dark:shadow-none hover:-translate-y-2 hover:shadow-[12px_12px_0px_0px_rgba(9,9,11,1)] transition-all duration-300"
              >
                <div className="text-4xl text-zinc-300 dark:text-zinc-700 mb-4 leading-none font-serif">&ldquo;</div>
                <p className="text-lg font-bold text-zinc-900 dark:text-zinc-200 mb-8 leading-snug">{t.quote}</p>
                <div className="flex items-center justify-between border-t-2 border-zinc-200 dark:border-zinc-800 pt-6 mt-auto">
                  <span className="text-sm font-mono font-black text-zinc-600 dark:text-zinc-500 uppercase">@{t.author}</span>
                  <span className={`px-3 py-1 text-xs font-mono font-black tracking-widest uppercase border-2 ${t.result === 'SUCCESS' ? 'border-zinc-950 bg-zinc-950 text-white dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' : 'border-red-600 bg-red-600 text-white'}`}>
                    {t.result} {t.amt}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-40 px-6 border-t-4 border-zinc-950 dark:border-zinc-800/60 bg-white dark:bg-[#0a0a0f] text-center relative overflow-hidden">
        {/* Background target graphic */}
        <div className="absolute inset-0 flex items-center justify-center opacity-5 dark:opacity-10 pointer-events-none z-0">
          <Crosshair className="w-[80vw] h-[80vw] sm:w-[50vw] sm:h-[50vw]" />
        </div>

        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          whileInView={{ scale: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, type: "spring", bounce: 0.4 }}
          className="max-w-4xl mx-auto relative z-10"
        >
          <div className="inline-block px-4 py-2 bg-red-600 text-white font-black uppercase tracking-widest mb-8 border-4 border-zinc-950 dark:border-transparent shadow-[4px_4px_0px_0px_rgba(9,9,11,1)] dark:shadow-none rotate-3">
            Warning: High Stakes
          </div>
          <h2 className="text-6xl sm:text-8xl md:text-9xl font-black tracking-tighter uppercase mb-8 text-zinc-950 dark:text-zinc-50 leading-[0.85]">
            TIME TO PUT UP OR SHUT UP.
          </h2>
          <p className="text-2xl sm:text-3xl text-zinc-700 dark:text-zinc-400 mb-12 font-bold max-w-2xl mx-auto leading-snug">
            Stop pretending you&apos;re going to do it &ldquo;tomorrow&rdquo;. Lock your penalty right now.
          </p>
          <Link
            href="/auth"
            className="inline-flex items-center justify-center gap-4 px-12 py-8 bg-zinc-950 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-950 text-2xl sm:text-3xl font-black tracking-tight uppercase hover:bg-zinc-800 dark:hover:bg-zinc-200 hover:-translate-y-2 active:translate-y-0 transition-all border-4 border-zinc-950 dark:border-transparent shadow-[12px_12px_0px_0px_rgba(220,38,38,1)] dark:shadow-[0_0_40px_rgba(250,250,250,0.4)] hover:shadow-[16px_16px_0px_0px_rgba(220,38,38,1)] active:shadow-none"
          >
            CREATE YOUR FIRST OATH <ArrowRight className="w-8 h-8" />
          </Link>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="py-16 px-6 border-t-4 border-zinc-950 dark:border-zinc-800 bg-zinc-100 dark:bg-[#09090b]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="flex items-center gap-3">
            <span className="text-3xl font-black tracking-tighter text-zinc-950 dark:text-zinc-50">OATH</span>
            <div className="h-6 w-1 bg-red-600" />
          </div>
          <p className="text-sm font-mono font-bold text-zinc-600 dark:text-zinc-500 uppercase tracking-widest text-center md:text-left max-w-md">
            © {new Date().getFullYear()} OATH PLATFORM. WE ARE NOT A BANK. WE JUST RUIN YOUR DAY WHEN YOU FAIL.
          </p>
          <div className="flex gap-6">
            <Link href="#" className="text-xs font-mono font-bold text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-300 uppercase tracking-widest transition-colors">Terms</Link>
            <Link href="#" className="text-xs font-mono font-bold text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-300 uppercase tracking-widest transition-colors">Privacy</Link>
            <Link href="#" className="text-xs font-mono font-bold text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-300 uppercase tracking-widest transition-colors">X / Twitter</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
