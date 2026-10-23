import type { Config } from "tailwindcss";

// Same design tokens as the Electro George factory system.
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: { cairo: ["Cairo", "sans-serif"] },
      colors: {
        bg:      "#0f1117",
        card:    "#1a1d27",
        card2:   "#222536",
        border:  "#2d3148",
        accent:  "#3b82f6",
        accent2: "#6366f1",
        success: "#10b981",
        warning: "#f59e0b",
        danger:  "#ef4444",
        text:    "#e2e8f0",
        subtext: "#94a3b8",
      },
    },
  },
  plugins: [],
};
export default config;
