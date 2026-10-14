/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
      colors: {
        ink: { DEFAULT: "#0F1F17", 800: "#1A3226", 700: "#33493D", 500: "#62766B", 300: "#A5B8AD" },
        brand: { DEFAULT: "#16935C", 600: "#127E4F", 700: "#0D6540", 50: "#ECF8F1", 100: "#D4F0E0" },
        mint: { 50: "#F2FAF5", DEFAULT: "#E3F4EA", 200: "#C9EBD7", 300: "#A9DFC0", 400: "#7FCFA2" },
        leaf: "#5CC697",     // chart: in progress
        lime: "#A8D86A",     // chart: waiting
        sun: "#F2C53D",      // chart: failed / attention
        paper: "#F4F9F5",
      },
      borderRadius: { "4xl": "2rem" },
      boxShadow: {
        card: "0 1px 2px rgba(15,31,23,0.04), 0 8px 24px rgba(15,31,23,0.06)",
        float: "0 10px 30px rgba(15,31,23,0.14)",
      },
      spacing: { "safe-bottom": "env(safe-area-inset-bottom)" },
    },
  },
  plugins: [],
};
