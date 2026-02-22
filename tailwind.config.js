/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'slate-950': '#030712',
        'purple-950': '#2d1b4e',
        'purple-900': '#2e1065',
        'slate-900': '#0f172a',
      }
    },
  },
  plugins: [],
}
