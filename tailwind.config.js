/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      screens: {
        // Small phones (iPhone SE) vs. everything above them.
        xs: '400px',
      },
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d9eaff',
          200: '#bcdaff',
          300: '#8ec3ff',
          400: '#59a1ff',
          500: '#337dff',
          600: '#1b5cf5',
          700: '#1449e1',
          800: '#173db6',
          900: '#19388f',
          950: '#142457',
        },
        ready: {
          green: '#16a34a',
          yellow: '#d97706',
          red: '#dc2626',
        },
      },
      spacing: {
        // 18px. Tailwind has no 4.5 step by default, and the sidebar icons
        // were previously forced to this size with an inline style.
        4.5: '1.125rem',
        // Device safe areas, so notches and home indicators can be padded
        // around by class rather than by hand-written env() everywhere.
        'safe-t': 'env(safe-area-inset-top)',
        'safe-b': 'env(safe-area-inset-bottom)',
        'safe-l': 'env(safe-area-inset-left)',
        'safe-r': 'env(safe-area-inset-right)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'none' },
        },
        'pulse-ring': {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
        'overlay-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'drawer-in': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        'sheet-up': {
          from: { transform: 'translateY(100%)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in .18s ease-out',
        'pulse-ring': 'pulse-ring 2s ease-in-out infinite',
        'overlay-in': 'overlay-in .2s ease-out',
        'drawer-in': 'drawer-in .24s cubic-bezier(0.32, 0.72, 0, 1)',
        'sheet-up': 'sheet-up .28s cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [],
}
