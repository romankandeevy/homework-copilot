import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleChatRequest } from '../server/chat.ts'

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  await handleChatRequest(request, response, {
    apiKey: process.env.KIE_API_KEY,
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    supabasePublishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
  })
}
