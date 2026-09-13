import type { IncomingMessage, ServerResponse } from 'node:http'
import { handlePaymentRequest } from '../server/payments.ts'
import { robokassaConfigFromEnv } from '../server/robokassa.ts'

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  await handlePaymentRequest(request, response, {
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    supabasePublishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
    robokassa: robokassaConfigFromEnv(process.env),
  })
}
