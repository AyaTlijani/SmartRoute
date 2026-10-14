/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      colors: {
        // Deep ink for structure and text, Sidi Bou Said blue as the one brand colour.
        ink: { DEFAULT: "#0F1C2E", 800: "#1A2B42", 700: "#2A3D57", 500: "#5B6B80", 300: "#A9B4C2" },
        brand: { DEFAULT: "#0B65A6", 600: "#0A5A94", 700: "#084C7D", 50: "#EAF3FA", 100: "#D3E6F4" },
        paper: "#F4F6F8",
      },
      spacing: { "safe-bottom": "env(safe-area-inset-bottom)" },
    },
  },
  plugins: [],
};
