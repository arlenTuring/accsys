import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        td: {
          blue: '#1B6FD1',
          'blue-dark': '#0F2D5C',
          'blue-light': '#E8F2FC',
          apex: '#E8A838',
          'apex-dark': '#C8871E',
          'apex-light': '#FEF6E8',
          surface: '#F8FAFC',
          border: '#E2E8F0',
          muted: '#64748B',
        },
        status: {
          pending: '#1B6FD1',
          approved: '#059669',
          returned: '#D97706',
          withdrawn: '#94A3B8',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'var(--font-noto)', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 45, 92, 0.06), 0 4px 16px rgba(15, 45, 92, 0.06)',
        nav: '0 1px 0 rgba(15, 45, 92, 0.08)',
      },
      borderRadius: {
        card: '12px',
      },
      backgroundImage: {
        'login-grid':
          'linear-gradient(to right, rgba(27, 111, 209, 0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(27, 111, 209, 0.04) 1px, transparent 1px)',
      },
      backgroundSize: {
        grid: '48px 48px',
      },
    },
  },
  plugins: [],
};

export default config;
