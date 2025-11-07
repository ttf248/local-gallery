/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'minimal-gray': '#F8F9FA',
        'minimal-border': '#E9ECEF',
        'minimal-text': '#2C3E50',
        'minimal-muted': '#6C757D',
        'minimal-blue': '#4A90E2',
        'minimal-green': '#50C878',
        'minimal-red': '#E74C3C',
        'minimal-yellow': '#F39C12',
      },
      fontFamily: {
        'minimal': ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
