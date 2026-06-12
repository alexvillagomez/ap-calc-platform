import type { Config } from "tailwindcss";

/**
 * Lodera.ai design tokens
 * ───────────────────────────────────────────────────────────────────────────
 * Brand blues  : brand-50 … brand-900  (primary ~brand-500 = #3B82F6, rich
 *                accent ~brand-600 = #4F46E5 indigo tint)
 * Neutrals     : neutral-* mirrors Tailwind slate but with a faint blue cast
 * Success      : success-* (emerald family, #10B981 base)
 * Error        : error-*   (rose family, soft — #F43F5E base)
 * ───────────────────────────────────────────────────────────────────────────
 */
const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Brand blue ramp ─────────────────────────────────────────────────
        brand: {
          50:  "#eff6ff",  // near-white blue tint
          100: "#dbeafe",  // very light
          200: "#bfdbfe",  // light
          300: "#93c5fd",  // soft blue
          400: "#60a5fa",  // sky-leaning blue
          500: "#3b82f6",  // PRIMARY — blue-500
          600: "#4f46e5",  // PRIMARY DARK — indigo-600 (hover / rich accent)
          700: "#4338ca",  // dark indigo
          800: "#3730a3",  // deeper indigo
          900: "#312e81",  // near-navy
        },
        // ── Success ─────────────────────────────────────────────────────────
        success: {
          50:  "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          400: "#34d399",
          500: "#10b981",  // base success
          600: "#059669",
          700: "#047857",
        },
        // ── Error (soft rose, not harsh red) ────────────────────────────────
        error: {
          50:  "#fff1f2",
          100: "#ffe4e6",
          200: "#fecdd3",
          400: "#fb7185",
          500: "#f43f5e",  // base error
          600: "#e11d48",
          700: "#be123c",
        },
      },
      borderRadius: {
        // Default feel: rounded-xl (12px). Scale for cards, buttons, etc.
        sm:   "6px",
        DEFAULT: "8px",
        md:   "10px",
        lg:   "12px",
        xl:   "14px",
        "2xl": "18px",
        "3xl": "24px",
      },
      boxShadow: {
        // Very subtle — Lodera uses depth through color, not heavy shadows
        "brand-xs": "0 1px 3px 0 rgb(59 130 246 / 0.08)",
        "brand-sm": "0 2px 8px 0 rgb(59 130 246 / 0.10)",
        "brand-md": "0 4px 16px 0 rgb(59 130 246 / 0.12)",
        "brand-lg": "0 8px 32px 0 rgb(79 70 229 / 0.14)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "'Segoe UI'",
          "system-ui",
          "sans-serif",
        ],
      },
      keyframes: {
        // Correct-answer pop
        "correct-pop": {
          "0%":   { transform: "scale(1)",    boxShadow: "0 0 0 0 rgb(16 185 129 / 0)" },
          "40%":  { transform: "scale(1.04)", boxShadow: "0 0 0 6px rgb(16 185 129 / 0.18)" },
          "70%":  { transform: "scale(0.98)", boxShadow: "0 0 0 10px rgb(16 185 129 / 0.06)" },
          "100%": { transform: "scale(1)",    boxShadow: "0 0 0 14px rgb(16 185 129 / 0)" },
        },
        // Star sparkle particle
        "sparkle-out": {
          "0%":   { transform: "translate(0,0) scale(1)",   opacity: "1" },
          "100%": { transform: "translate(var(--tx),var(--ty)) scale(0)", opacity: "0" },
        },
        // Progress bar fill
        "progress-fill": {
          "0%":   { width: "0%" },
          "100%": { width: "var(--progress-pct)" },
        },
        // Gentle fade-in
        "fade-in": {
          "0%":   { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "correct-pop":    "correct-pop 320ms cubic-bezier(0.34,1.56,0.64,1) forwards",
        "sparkle-out":    "sparkle-out 400ms ease-out forwards",
        "progress-fill":  "progress-fill 500ms cubic-bezier(0.4,0,0.2,1) forwards",
        "fade-in":        "fade-in 200ms ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
