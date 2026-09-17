import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handleHomeworkSolverRequest } from './server/homeworkSolver.ts'
import { handleSupportRequest, handleTelegramWebhook } from './server/support.ts'
import { handleAdminRequest } from './server/admin.ts'

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')

  return {
  base: process.env.GITHUB_ACTIONS && !process.env.GITHUB_PAGES_CUSTOM_DOMAIN
    ? `/${process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'homework-copilot'}/`
    : '/',
  plugins: [
    react(),
    {
      /* В разработке React Refresh вставляет в страницу свой инлайн-скрипт, а
         политика в index.html пускает только скрипты с известными хэшами
         (аудит 16 сентября, В8). Для dev-сервера - и для e2e, которые идут на
         нём, - script-src возвращается к 'unsafe-inline'. В сборку это не
         попадает: `apply: 'serve'`. */
      name: 'homework-dev-inline-scripts',
      apply: 'serve',
      transformIndexHtml: {
        order: 'post',
        handler: (html) => html.replace(/script-src [^;"]*/u, "script-src 'self' 'unsafe-inline'"),
      },
    },
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
        server.middlewares.use('/api/admin', (request, response) => {
          void handleAdminRequest(request, response, {
            supabaseUrl: environment.VITE_SUPABASE_URL,
            supabasePublishableKey: environment.VITE_SUPABASE_PUBLISHABLE_KEY,
            serviceRoleKey: environment.SUPABASE_SERVICE_ROLE_KEY || environment.SUPABASE_SECRET_KEY,
            kieApiKey: environment.KIE_API_KEY,
            telegramBotToken: environment.TELEGRAM_BOT_TOKEN,
            telegramOwnerChatId: environment.TELEGRAM_OWNER_CHAT_ID,
            resendApiKey: environment.RESEND_API_KEY,
            resendFrom: environment.RESEND_FROM,
          })
        })
      },
    },
  ],
  }
})
