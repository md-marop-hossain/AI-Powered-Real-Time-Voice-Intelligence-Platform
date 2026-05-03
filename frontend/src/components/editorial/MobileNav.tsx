import { useState, useEffect } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

import { cn } from "@/lib/utils";
import { Eyebrow } from "./Eyebrow";
import { HairlineDivider } from "./HairlineDivider";
import { ThemeToggle } from "./ThemeToggle";
import { ConfirmDialog } from "./ConfirmDialog";
import { useAuthStore } from "@/store/auth";
import { easeEditorial, durations } from "@/lib/motion";

const navLinks = [
  { to: "/upload", label: "Practice" },
  { to: "/dashboard", label: "History" },
  { to: "/invites", label: "Invites" },
  { to: "/account", label: "Account" },
];

export function MobileNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, clear } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const handleSignOut = () => {
    clear();
    setOpen(false);
    navigate("/login");
  };

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="relative z-50 flex h-10 w-10 flex-col items-center justify-center gap-[5px]"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
      >
        <motion.span
          animate={
            open
              ? { rotate: 45, y: 7, width: 20 }
              : { rotate: 0, y: 0, width: 18 }
          }
          transition={
            reduce ? { duration: 0 } : { duration: 0.25, ease: easeEditorial }
          }
          className="block h-[1.5px] bg-ink"
          style={{ width: 18 }}
        />
        <motion.span
          animate={open ? { opacity: 0, scaleX: 0 } : { opacity: 1, scaleX: 1 }}
          transition={
            reduce ? { duration: 0 } : { duration: 0.2, ease: easeEditorial }
          }
          className="block h-[1.5px] w-[18px] bg-ink"
        />
        <motion.span
          animate={
            open
              ? { rotate: -45, y: -7, width: 20 }
              : { rotate: 0, y: 0, width: 18 }
          }
          transition={
            reduce ? { duration: 0 } : { duration: 0.25, ease: easeEditorial }
          }
          className="block h-[1.5px] bg-ink"
          style={{ width: 18 }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduce ? undefined : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
            className="fixed inset-0 z-40 bg-canvas/95 backdrop-blur-[12px]"
          >
            <motion.nav
              initial={reduce ? undefined : { y: -20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -20, opacity: 0 }}
              transition={{
                duration: reduce ? 0 : durations.base,
                ease: easeEditorial,
              }}
              className="flex h-full flex-col items-center justify-center gap-2 px-8"
              aria-label="Mobile navigation"
            >
              {navLinks.map((link, i) => (
                <motion.div
                  key={link.to}
                  initial={reduce ? undefined : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: reduce ? 0 : durations.base,
                    ease: easeEditorial,
                    delay: reduce ? 0 : i * 0.05,
                  }}
                  className="w-full max-w-xs"
                >
                  <NavLink
                    to={link.to}
                    className={({ isActive }) =>
                      cn(
                        "block py-4 text-center font-display text-[1.75rem] leading-tight tracking-tight transition-colors",
                        isActive ? "text-ink" : "text-ink-muted hover:text-ink",
                      )
                    }
                  >
                    {link.label}
                  </NavLink>
                  {i < navLinks.length - 1 && <HairlineDivider />}
                </motion.div>
              ))}

              <HairlineDivider className="my-4 w-full max-w-xs" />

              <div className="flex items-center gap-6">
                {user && (
                  <button
                    onClick={() => setConfirmingSignOut(true)}
                    className="font-mono text-eyebrow text-ink-muted hover:text-ink"
                  >
                    SIGN OUT
                  </button>
                )}
                <ThemeToggle />
              </div>
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmingSignOut}
        eyebrow="Sign out"
        title="Sign out of this browser?"
        body="Your transcripts and reports stay saved on your account — you can sign back in any time."
        confirmLabel="Sign out"
        confirmTone="ink"
        onClose={() => setConfirmingSignOut(false)}
        onConfirm={handleSignOut}
      />
    </div>
  );
}
