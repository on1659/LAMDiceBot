tailwind.config = {
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        surface: {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
        },
        // Game accent colors
        dice: { DEFAULT: '#6366f1', light: '#a5b4fc', dark: '#4338ca' },
        roulette: { DEFAULT: '#8b5cf6', light: '#c4b5fd', dark: '#6d28d9' },
        horse: { DEFAULT: '#d97706', light: '#fcd34d', dark: '#b45309' },
        team: { DEFAULT: '#0ea5e9', light: '#7dd3fc', dark: '#0369a1' },
      },
      fontFamily: {
        display: ['Jua', 'system-ui', 'sans-serif'],
        body: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'card': '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
        'card-hover': '0 4px 12px 0 rgb(0 0 0 / 0.08), 0 2px 4px -2px rgb(0 0 0 / 0.06)',
        'elevated': '0 10px 25px -5px rgb(0 0 0 / 0.08), 0 8px 10px -6px rgb(0 0 0 / 0.04)',
      },
      borderRadius: {
        'card': '16px',
      },
    },
  },
}
