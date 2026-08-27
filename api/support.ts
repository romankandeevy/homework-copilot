import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleSupportRequest } from '../server/support.ts'

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  await handleSupportRequest(request, response)
}
