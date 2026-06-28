/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/**/*.{html,ts,js}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand palette – matches the LinkedIn-AI gradient.
        brand: {
          50:  '#eef2ff',
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
        accent: {
          500: '#7c3aed',
          600: '#6d28d9',
        },
        linkedin: '#0a66c2',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 1px 3px rgba(0, 0, 0, 0.1)',
      },
      keyframes: {
        'status-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.5' },
        },
      },
      animation: {
        'status-pulse': 'status-pulse 2s infinite',
      },
    },
  },
  plugins: [],
};
