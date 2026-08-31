import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // Рабочие копии агентов лежат внутри проекта, и без этого исключения
    // vitest прогоняет их тесты вместе с нашими и рапортует о чужих падениях.
    exclude: ['tests/**', 'sites-homework-copilot/**', '.claude/worktrees/**', '**/node_modules/**'],
  },
})
