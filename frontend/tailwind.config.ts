import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#0a0a0f',
          secondary: '#0f0f1a',
          card: '#13131f',
          elevated: '#1a1a2e',
        },
        accent: {
          purple: '#7c3aed',
          'purple-light': '#9d5cf6',
          cyan: '#06b6d4',
          pink: '#ec4899',
          'pink-light': '#f472b6',
        },
        border: {
          DEFAULT: '#1e1e3a',
          glow: 'rgba(124, 58, 237, 0.3)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-anime': 'linear-gradient(135deg, #7c3aed, #06b6d4, #ec4899)',
        'gradient-card': 'linear-gradient(135deg, #13131f, #1a1a2e)',
        'gradient-hero': 'radial-gradient(ellipse at top, #1a0a2e 0%, #0a0a0f 60%)',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        'shimmer': 'shimmer 1.5s infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      boxShadow: {
        'glow-purple': '0 0 20px rgba(124, 58, 237, 0.4)',
        'glow-cyan': '0 0 20px rgba(6, 182, 212, 0.4)',
        'glow-pink': '0 0 20px rgba(236, 72, 153, 0.4)',
        'card': '0 4px 24px rgba(0, 0, 0, 0.4)',
      },
    },
  },
  plugins: [],
}

export default config
