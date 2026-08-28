import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { reactCompatAliases } from './vite.optimization.ts'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: reactCompatAliases,
  },
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://stalled.supabase.co'),
    'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': JSON.stringify('performance-test-key'),
  },
  build: {
    outDir: 'dist-performance',
  },
})
