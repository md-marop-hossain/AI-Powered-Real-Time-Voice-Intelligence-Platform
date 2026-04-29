import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const applyAttribute = (theme: Theme) => {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
};

const detectInitial = (): Theme => {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: detectInitial(),
      setTheme: (theme) => {
        applyAttribute(theme);
        set({ theme });
      },
      toggleTheme: () => {
        const next: Theme = get().theme === "dark" ? "light" : "dark";
        applyAttribute(next);
        set({ theme: next });
      },
    }),
    {
      name: "rehearsal-theme",
      // After Zustand reads the persisted value, mirror it to the DOM in case
      // the inline boot script was skipped or stale.
      onRehydrateStorage: () => (state) => {
        if (state?.theme) applyAttribute(state.theme);
      },
    },
  ),
);
