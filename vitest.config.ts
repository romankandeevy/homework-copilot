import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    testTimeout: 15_000,
    exclude: ['tests/**', 'performance-tests/**', 'sites-homework-copilot/**', '**/node_modules/**'],
  },
})
