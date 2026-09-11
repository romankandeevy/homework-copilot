import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleAdminRequest } from '../server/admin.ts'

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  await handleAdminRequest(request, response, {
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    supabasePublishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
    kieApiKey: process.env.KIE_API_KEY,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramOwnerChatId: process.env.TELEGRAM_OWNER_CHAT_ID,
    resendApiKey: process.env.RESEND_API_KEY,
    resendFrom: process.env.RESEND_FROM,
  })
}
