/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // 深色主题配色
        bg: {
          primary: '#1a1b1e',
          secondary: '#25262b',
          tertiary: '#2c2e33',
          hover: '#373a40',
          active: '#3a3d44'
        },
        border: {
          DEFAULT: '#373a40',
          light: '#2c2e33'
        },
        accent: {
          DEFAULT: '#3b82f6',
          hover: '#2563eb',
          light: '#60a5fa'
        },
        text: {
          primary: '#e4e4e7',
          secondary: '#a1a1aa',
          muted: '#71717a'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'monospace']
      }
    }
  },
  plugins: []
}
