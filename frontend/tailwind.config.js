/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        black: 'var(--black)',
        surface: 'var(--surface)',
        'surface-raised': 'var(--surface-raised)',
        border: 'var(--border)',
        'border-visible': 'var(--border-visible)',
        'text-disabled': 'var(--text-disabled)',
        'text-secondary': 'var(--text-secondary)',
        'text-primary': 'var(--text-primary)',
        'text-display': 'var(--text-display)',
        accent: 'var(--accent)',
        'accent-subtle': 'var(--accent-subtle)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        error: 'var(--error)',
        info: 'var(--info)',
        interactive: 'var(--interactive)',
      },
      fontFamily: {
        display: ['var(--font-display)', '"Space Mono"', 'monospace'],
        body: ['var(--font-body)', '"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', '"JetBrains Mono"', '"SF Mono"', 'monospace'],
      },
      spacing: {
        '2xs': 'var(--space-2xs)',
        xs: 'var(--space-xs)',
        sm: 'var(--space-sm)',
        md: 'var(--space-md)',
        lg: 'var(--space-lg)',
        xl: 'var(--space-xl)',
        '2xl': 'var(--space-2xl)',
        '3xl': 'var(--space-3xl)',
        '4xl': 'var(--space-4xl)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
