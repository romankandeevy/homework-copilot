import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleTelegramWebhook } from '../server/support.ts'

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  await handleTelegramWebhook(request, response)
}
