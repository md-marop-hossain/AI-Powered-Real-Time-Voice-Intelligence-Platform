import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/utils";
import { easeEditorial } from "@/lib/motion";

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > 600);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollUp = () => {
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={reduce ? undefined : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={
            reduce ? { duration: 0 } : { duration: 0.3, ease: easeEditorial }
          }
          onClick={scrollUp}
          className={cn(
            "fixed bottom-8 right-8 z-50",
            "flex h-10 w-10 items-center justify-center",
            "border border-rule-strong bg-canvas-elevated/90 backdrop-blur-[6px]",
            "text-ink-muted hover:text-ink hover:border-ink",
            "transition-colors duration-base ease-editorial",
            "rounded-[2px]",
          )}
          aria-label="Scroll to top"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M7 12V2M2 6l5-4 5 4" />
          </svg>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
