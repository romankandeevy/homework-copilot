import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleHomeworkSolverRequest } from '../server/homeworkSolver.ts'

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  await handleHomeworkSolverRequest(request, response, {
    apiKey: process.env.KIE_API_KEY,
    model: process.env.KIE_MODEL,
    supabaseUrl: process.env.VITE_SUPABASE_URL,
    supabasePublishableKey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY,
  })
}
