import { motion, AnimatePresence } from "framer-motion";
import { Moon, Sun } from "lucide-react";

import { useThemeStore } from "@/store/theme";
import { cn } from "@/lib/utils";
import { easeEditorial, durations } from "@/lib/motion";

interface Props {
  className?: string;
}

/**
 * Editorial theme toggle — a single circular icon button. Click cycles
 * between light and dark. The icon cross-fades and rotates so the swap
 * feels physical, not like a CSS class flip.
 */
export function ThemeToggle({ className }: Props) {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const isDark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      title={isDark ? "Light mode" : "Dark mode"}
      className={cn(
        "relative inline-flex items-center justify-center",
        "h-9 w-9 rounded-full",
        "border border-rule text-ink-muted",
        "hover:border-ink hover:text-ink",
        "transition-colors duration-base ease-editorial",
        "focus-visible:outline-none focus-visible:border-ink focus-visible:text-ink",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={isDark ? "sun" : "moon"}
          initial={{ rotate: -45, opacity: 0, scale: 0.7 }}
          animate={{ rotate: 0, opacity: 1, scale: 1 }}
          exit={{ rotate: 45, opacity: 0, scale: 0.7 }}
          transition={{ duration: durations.base, ease: easeEditorial }}
          className="inline-flex"
          aria-hidden="true"
        >
          {isDark ? <Sun size={16} strokeWidth={1.5} /> : <Moon size={16} strokeWidth={1.5} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
