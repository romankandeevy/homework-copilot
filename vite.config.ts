import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handleHomeworkSolverRequest } from './server/homeworkSolver.ts'
import { handleSupportRequest, handleTelegramWebhook } from './server/support.ts'

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')

  return {
  base: '/',
  plugins: [
    react(),
    {
      name: 'homework-kie-solver',
      configureServer(server) {
        server.middlewares.use('/api/solve', (request, response) => {
          void handleHomeworkSolverRequest(request, response, {
            apiKey: environment.KIE_API_KEY,
            model: environment.KIE_MODEL,
            supabaseUrl: mode === 'test' ? undefined : environment.VITE_SUPABASE_URL,
            supabasePublishableKey: mode === 'test' ? undefined : environment.VITE_SUPABASE_PUBLISHABLE_KEY,
          })
        })
        server.middlewares.use('/api/support', (request, response) => {
          void handleSupportRequest(request, response)
        })
        server.middlewares.use('/api/telegram-webhook', (request, response) => {
          void handleTelegramWebhook(request, response)
        })
      },
    },
  ],
  }
})
