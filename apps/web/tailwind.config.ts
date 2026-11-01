import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  corePlugins: {
    // Custos' existing styled-components theme owns the global reset.
    // Keep Tailwind utilities available for the migrated Custos surfaces
    // without letting Tailwind rewrite the V2 interface globally.
    preflight: false,
  },
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config
