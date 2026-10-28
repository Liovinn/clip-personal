/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Clipedit studio — values mirror tokens.css (kept literal so
        // Tailwind alpha modifiers like bg-brass/10 compile)
        paper: "rgb(11 16 24 / <alpha-value>)",
        paper2: "rgb(18 27 41 / <alpha-value>)",
        paper3: "rgb(28 41 60 / <alpha-value>)",
        ink: "rgb(242 246 255 / <alpha-value>)",
        ink2: "rgb(202 214 231 / <alpha-value>)",
        muted: "rgb(143 159 182 / <alpha-value>)",
        brass: "rgb(138 180 255 / <alpha-value>)",
        brassink: "rgb(13 29 56 / <alpha-value>)",
        coral: "oklch(68% 0.16 18 / <alpha-value>)",
        ok: "oklch(75% 0.11 150 / <alpha-value>)",
        warn: "oklch(78% 0.14 75 / <alpha-value>)",
        danger: "oklch(66% 0.18 25 / <alpha-value>)",
        // legacy aliases so untouched files degrade gracefully
        background: "rgb(11 16 24 / <alpha-value>)",
        surface: "rgb(18 27 41 / <alpha-value>)",
        primary: "rgb(138 180 255 / <alpha-value>)",
        accent: "oklch(68% 0.16 18 / <alpha-value>)",
      },
      fontFamily: {
        display: "var(--font-display)",
        body: "var(--font-body)",
        sans: "var(--font-body)",
        serif: "var(--font-display)",
        mono: "var(--font-mono)",
      },
      borderColor: {
        rule: "var(--color-rule)",
        rule2: "var(--color-rule-2)",
      },
      borderRadius: {
        card: "var(--radius-card)",
        input: "var(--radius-input)",
      },
      fontSize: {
        micro: ["10.5px", { letterSpacing: "0.10em" }],
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade': 'fadeIn 0.4s var(--ease-out)',
        // mobile shell: the nav drawer flies in from the edge, sheets rise
        'slide-in-left': 'slideInLeft 0.24s var(--ease-out)',
        'sheet-up': 'sheetUp 0.26s var(--ease-out)',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        slideInLeft: {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        sheetUp: {
          from: { transform: 'translateY(12px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
