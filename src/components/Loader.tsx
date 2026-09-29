"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Skull } from "lucide-react";
import { useRegion } from "@/lib/region-context";

export default function Loader() {
  const { isInitializing } = useRegion();
  const [show, setShow] = useState(true);

  useEffect(() => {
    if (!isInitializing) {
      // Small delay so the exit animation looks intentional
      const t = setTimeout(() => setShow(false), 500);
      return () => clearTimeout(t);
    }
  }, [isInitializing]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="loader"
          initial={{ y: 0 }}
          exit={{ y: "-100%" }}
          transition={{ duration: 0.8, ease: [0.76, 0, 0.24, 1] }}
          className="fixed inset-0 z-[9999] bg-zinc-950 text-zinc-50 flex flex-col items-center justify-center overflow-hidden"
        >
          {/* Background Noise */}
          <div className="absolute inset-0 opacity-20 mix-blend-overlay pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]"></div>

          <motion.div
            animate={{ scale: [1, 1.1, 1], rotate: [0, -5, 5, 0] }}
            transition={{ duration: 0.5, repeat: Infinity, repeatDelay: 0.5 }}
            className="relative z-10"
          >
            <Skull className="w-24 h-24 text-red-600 mb-8 mx-auto" />
          </motion.div>
          
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="relative z-10 text-center"
          >
            <h1 className="text-5xl md:text-7xl font-black uppercase tracking-tighter mb-4">
              OATH
            </h1>
            <div className="flex items-center gap-4 justify-center">
              <div className="w-16 h-1 bg-zinc-800 overflow-hidden relative">
                <motion.div
                  className="absolute inset-y-0 left-0 bg-red-600 w-full"
                  initial={{ x: "-100%" }}
                  animate={{ x: "0%" }}
                  transition={{ duration: 1.5, ease: "easeInOut" }}
                />
              </div>
              <span className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-400">
                Verifying Target
              </span>
              <div className="w-16 h-1 bg-zinc-800 overflow-hidden relative">
                <motion.div
                  className="absolute inset-y-0 right-0 bg-red-600 w-full"
                  initial={{ x: "100%" }}
                  animate={{ x: "0%" }}
                  transition={{ duration: 1.5, ease: "easeInOut" }}
                />
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
