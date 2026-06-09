import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // NF palette — true black base, periwinkle + red as the only chromatic notes.
        bg: "#000000",
        surface: "#0B0B0E",
        "surface-2": "#141418",
        border: "#1F1F26",
        "border-strong": "#2C2C36",
        bone: {
          DEFAULT: "#F0EEEA",
          dim: "#B8B6B0",
          mute: "#7A7872",
        },
        periwinkle: {
          DEFAULT: "#625CC8",
          soft: "#7E78D6",
          dim: "#3F3A8A",
        },
        warmred: {
          DEFAULT: "#D52F31",
          soft: "#E8595B",
          dim: "#962023",
        },
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
