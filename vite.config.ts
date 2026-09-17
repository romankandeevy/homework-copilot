import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { handleHomeworkSolverRequest } from './server/homeworkSolver.ts'
import { handleSupportRequest, handleTelegramWebhook } from './server/support.ts'
import { handleAdminRequest } from './server/admin.ts'
import { handleChatRequest } from './server/chat.ts'
import { handlePaymentRequest } from './server/payments.ts'
import { robokassaConfigFromEnv } from './server/robokassa.ts'
import { handleYandexAuthRequest, yandexAuthConfigFromEnv } from './server/yandexAuth.ts'
import { handleSmsHookRequest, smsHookConfigFromEnv } from './server/smsHook.ts'

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), '')
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY || environment.SUPABASE_SECRET_KEY

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
            serviceRoleKey,
            kieApiKey: environment.KIE_API_KEY,
            model: environment.KIE_MODEL,
            telegramBotToken: environment.TELEGRAM_BOT_TOKEN,
            telegramOwnerChatId: environment.TELEGRAM_OWNER_CHAT_ID,
            telegramWebhookSecret: environment.TELEGRAM_WEBHOOK_SECRET,
            resendApiKey: environment.RESEND_API_KEY,
            resendFrom: environment.RESEND_FROM,
            robokassa: robokassaConfigFromEnv(environment),
          })
        })
        // Те же обёртки, что api/*.ts на Vercel: без ключей из .env.local
        // каждая отвечает своим понятным отказом (503), а не заглушкой Vite.
        server.middlewares.use('/api/chat', (request, response) => {
          void handleChatRequest(request, response, {
            apiKey: environment.KIE_API_KEY,
            supabaseUrl: environment.VITE_SUPABASE_URL,
            supabasePublishableKey: environment.VITE_SUPABASE_PUBLISHABLE_KEY,
            serviceRoleKey,
          })
        })
        server.middlewares.use('/api/payment', (request, response) => {
          void handlePaymentRequest(request, response, {
            supabaseUrl: environment.VITE_SUPABASE_URL,
            supabasePublishableKey: environment.VITE_SUPABASE_PUBLISHABLE_KEY,
            serviceRoleKey,
            robokassa: robokassaConfigFromEnv(environment),
          })
        })
        server.middlewares.use('/api/auth-yandex', (request, response) => {
          void handleYandexAuthRequest(request, response, {
            supabaseUrl: environment.VITE_SUPABASE_URL,
            serviceRoleKey,
            yandex: yandexAuthConfigFromEnv(environment),
          })
        })
        server.middlewares.use('/api/sms-hook', (request, response) => {
          void handleSmsHookRequest(request, response, smsHookConfigFromEnv(environment))
        })
      },
    },
  ],
  }
})
