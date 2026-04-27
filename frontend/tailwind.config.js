/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        "canvas-elevated": "var(--canvas-elevated)",
        "canvas-sunken": "var(--canvas-sunken)",
        ink: "var(--ink)",
        "ink-soft": "var(--ink-soft)",
        "ink-muted": "var(--ink-muted)",
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        success: "var(--success)",
        warning: "var(--warning)",
        error: "var(--error)",
        rule: "var(--rule)",
        "rule-strong": "var(--rule-strong)",
      },
      borderColor: {
        DEFAULT: "var(--rule)",
        rule: "var(--rule)",
        "rule-strong": "var(--rule-strong)",
      },
      borderRadius: {
        none: "0",
        DEFAULT: "2px",
        sharp: "0",
        soft: "2px",
      },
      fontFamily: {
        display: ["Fraunces Variable", "Fraunces", "Georgia", "serif"],
        body: ["Geist Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono Variable", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      transitionTimingFunction: {
        editorial: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      transitionDuration: {
        quick: "200ms",
        base: "400ms",
        slow: "700ms",
      },
      maxWidth: {
        prose: "720px",
        editorial: "1440px",
      },
    },
  },
  plugins: [],
};
