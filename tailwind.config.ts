import type { Config } from 'tailwindcss';

const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        elevated: token('elevated'),
        line: token('line'),
        fg: token('fg'),
        muted: token('muted'),
        subtle: token('subtle'),
        brand: token('brand'),
        male: token('male'),
        female: token('female'),
        ok: token('ok'),
        warn: token('warn'),
        danger: token('danger'),
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem' },
      boxShadow: {
        card: '0 1px 0 0 rgb(255 255 255 / 0.03) inset, 0 1px 2px rgb(0 0 0 / 0.2)',
        glow: '0 0 0 1px rgb(var(--brand) / 0.35), 0 8px 32px -8px rgb(var(--brand) / 0.45)',
      },
      keyframes: {
        pulseRing: { '0%': { transform: 'scale(1)', opacity: '0.6' }, '100%': { transform: 'scale(2.4)', opacity: '0' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        pulseRing: 'pulseRing 1.8s cubic-bezier(0.2, 0.6, 0.4, 1) infinite',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
