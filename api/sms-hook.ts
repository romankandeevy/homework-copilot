import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleSmsHookRequest, smsHookConfigFromEnv } from '../server/smsHook.ts'

/* Send SMS Hook для Supabase Auth. Supabase зовёт его из Франкфурта сам,
   поэтому прокси на домене Supabase здесь не нужен. */
export default async function handler(request: IncomingMessage, response: ServerResponse) {
  await handleSmsHookRequest(request, response, smsHookConfigFromEnv(process.env))
}
