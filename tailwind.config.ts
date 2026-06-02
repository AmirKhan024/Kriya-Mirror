import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'selector',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'var(--color-background)',
        foreground: 'var(--color-foreground)',
        primary: {
          DEFAULT: 'var(--color-primary)',
          light: 'var(--color-primary-light)',
        },
        surface: {
          DEFAULT: 'var(--color-surface)',
          '2': 'var(--color-surface-2)',
          '3': 'var(--color-surface-3)',
        },
        muted: {
          DEFAULT: 'var(--color-muted)',
          foreground: 'var(--color-muted-foreground)',
        },
        accent: {
          teal: {
            DEFAULT: 'var(--color-accent-teal)',
            hover: 'var(--color-accent-teal-hover)',
            soft: 'var(--color-accent-teal-soft)',
            border: 'var(--color-accent-teal-border)',
            glow: 'var(--color-accent-teal-glow)',
          },
          amber: {
            DEFAULT: 'var(--color-accent-amber)',
            soft: 'var(--color-accent-amber-soft)',
            border: 'var(--color-accent-amber-border)',
          },
          danger: {
            DEFAULT: 'var(--color-accent-danger)',
            soft: 'var(--color-accent-danger-soft)',
            border: 'var(--color-accent-danger-border)',
          },
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        heading: ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Rule C tokens — readable from 2 m away
        'hud-xl': ['3rem', { lineHeight: '1', fontWeight: '700' }],          // 48 px
        'hud-md': ['2.25rem', { lineHeight: '1.1', fontWeight: '700' }],     // 36 px
        'warning': ['1.5rem', { lineHeight: '1.2', fontWeight: '700' }],     // 24 px
        'rest-xxl': ['6rem', { lineHeight: '1', fontWeight: '800' }],        // 96 px
      },
      keyframes: {
        fadeUp: { '0%': { opacity: '0', transform: 'translateY(10px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        slideInUp: { '0%': { opacity: '0', transform: 'translateY(20px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        'fade-up': 'fadeUp 0.4s ease-out',
        'slide-in-up': 'slideInUp 0.3s ease-out',
      },
    },
  },
  plugins: [],
};
export default config;
