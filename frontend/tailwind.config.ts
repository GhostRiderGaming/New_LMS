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
          void: '#050510',
          primary: '#080818',
          secondary: '#0c0c24',
          card: '#10102a',
          elevated: '#181840',
          glass: 'rgba(16, 16, 42, 0.65)',
        },
        accent: {
          purple: '#8b5cf6',
          'purple-light': '#a78bfa',
          cyan: '#22d3ee',
          pink: '#f472b6',
          'pink-light': '#f9a8d4',
          gold: '#fbbf24',
        },
        border: {
          DEFAULT: 'rgba(139, 92, 246, 0.15)',
          active: 'rgba(139, 92, 246, 0.4)',
          glow: 'rgba(139, 92, 246, 0.5)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        display: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      backgroundImage: {
        'gradient-game': 'linear-gradient(135deg, #8b5cf6, #22d3ee, #f472b6)',
        'gradient-card': 'linear-gradient(135deg, #10102a, #181840)',
        'gradient-hero': 'radial-gradient(ellipse at top, #1a0a2e 0%, #050510 60%)',
        'gradient-cinematic': 'radial-gradient(ellipse at 30% 50%, rgba(139, 92, 246, 0.1) 0%, transparent 50%), radial-gradient(ellipse at 70% 30%, rgba(34, 211, 238, 0.08) 0%, transparent 50%)',
      },
      animation: {
        'float': 'float 4s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'shimmer': 'shimmer 1.5s infinite',
        'fadeInUp': 'fadeInUp 0.5s ease-out forwards',
        'slideInRight': 'slideInRight 0.4s ease-out forwards',
        'slideInBottom': 'slideInBottom 0.3s ease-out forwards',
        'breathe': 'breathe 3s ease-in-out infinite',
        'border-flow': 'border-flow 4s ease-in-out infinite',
        'spin-slow': 'spin 3s linear infinite',
      },
      boxShadow: {
        'glow-purple': '0 0 25px rgba(139, 92, 246, 0.5), 0 0 50px rgba(139, 92, 246, 0.2)',
        'glow-cyan': '0 0 25px rgba(34, 211, 238, 0.4), 0 0 50px rgba(34, 211, 238, 0.15)',
        'glow-pink': '0 0 25px rgba(244, 114, 182, 0.4), 0 0 50px rgba(244, 114, 182, 0.15)',
        'card': '0 8px 40px rgba(0, 0, 0, 0.5)',
        'card-hover': '0 20px 60px rgba(0, 0, 0, 0.4), 0 0 40px rgba(139, 92, 246, 0.3)',
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '24px',
      },
    },
  },
  plugins: [],
}

export default config
