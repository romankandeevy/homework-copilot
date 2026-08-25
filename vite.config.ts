import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handleHomeworkSolverRequest } from './server/homeworkSolver.ts'

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')

  return {
  base: process.env.GITHUB_ACTIONS && !process.env.GITHUB_PAGES_CUSTOM_DOMAIN
    ? `/${process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'homework-copilot'}/`
    : '/',
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
      },
    },
  ],
  }
})
