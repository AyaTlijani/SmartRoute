/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      colors: {
        // Deep forest ink for text and dark surfaces, one green for the brand,
        // mint for the sidebar and selected states.
        ink: { DEFAULT: "#12291E", 800: "#1B3A2B", 700: "#2E4F3F", 500: "#5F766A", 300: "#A7BAAF" },
        brand: { DEFAULT: "#16855A", 600: "#12734D", 700: "#0E5E3F", 50: "#EAF6EF", 100: "#D2EDDD" },
        mint: { DEFAULT: "#E4F3EA", 200: "#CBE9D8" },
        paper: "#F3F7F2",
      },
      boxShadow: {
        card: "0 1px 2px rgba(18,41,30,0.04), 0 6px 20px rgba(18,41,30,0.06)",
      },
      spacing: { "safe-bottom": "env(safe-area-inset-bottom)" },
    },
  },
  plugins: [],
};
