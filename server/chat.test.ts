import type { IncomingMessage, ServerResponse } from 'node:http'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/* Деньги и блокировка чата на пути ответа.

   14 сентября 2026 на проде три поломки подряд оказались одной цепочкой:
   расчёт `settle_chat_generation` падал в базе, сервер ошибку не смотрел,
   ученик получал ответ бесплатно с подписью «Списано 0 ₽, баланс 0 ₽», а
   генерация оставалась `reserved` и пять минут запирала чат фразой
   «Дождись, пока закончится предыдущий ответ». Здесь проверяется обработчик
   целиком: база и телеметрия подменены, поток модели - настоящий разбор. */

const fake = vi.hoisted(() => {
  type RpcResult = { data: unknown; error: { message: string } | null }
  const state = {
    rpcCalls: [] as Array<{ name: string; args: Record<string, unknown> }>,
    settleResults: [] as RpcResult[],
    errors: [] as string[],
    messageCount: 0,
  }

  const builder = () => {
    const chain: Record<string, unknown> = {}
    for (const method of ['insert', 'select', 'eq', 'order', 'limit', 'update']) chain[method] = () => chain
    chain.single = async () => {
      state.messageCount += 1
      return { data: { id: `message-${state.messageCount}` }, error: null }
    }
    // Ожидание без .single() - это история диалога.
    chain.then = (resolve: (value: unknown) => void) => resolve({
      data: [{ id: 'message-1', role: 'user', content: 'Как высыпаться в восьмом классе?', attachments: [] }],
      error: null,
    })
    return chain
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    rpc: async (name: string, args: Record<string, unknown>): Promise<RpcResult> => {
      state.rpcCalls.push({ name, args })
      if (name === 'reserve_chat_generation') {
        return { data: { generationId: 'generation-1', reservedKopecks: 0, answerCharacterBudget: 20000 }, error: null }
      }
      if (name === 'settle_chat_generation') {
        return state.settleResults.shift()
          ?? { data: { settled: true, chargedKopecks: 0, refundedKopecks: 0, balanceKopecks: 5360 }, error: null }
      }
      return { data: null, error: null }
    },
    from: () => builder(),
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: 'нет файла' } }) }) },
  }

  return { state, client }
})

vi.mock('@supabase/supabase-js', () => ({ createClient: () => fake.client }))

vi.mock('./telemetry.ts', () => ({
  browserOriginAllowed: (origin: string | undefined) => Boolean(origin),
  clientAddress: () => '127.0.0.1',
  flagEnabled: () => true,
  loadSolverContext: async () => ({ flags: {} }),
  recordError: async (_options: unknown, entry: { message: string }) => {
    fake.state.errors.push(entry.message)
  },
  recordRequestLog: async () => undefined,
  requestIdOf: () => 'request-1',
  requestUserAgent: () => 'vitest',
}))

const { handleChatRequest, readSettlement } = await import('./chat.ts')

function chatRequest(modelId = 'gpt-5-6-luna') {
  return {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:4173', authorization: 'Bearer token-1' },
    body: {
      conversationId: 'conversation-1',
      modelId,
      text: 'Как высыпаться в восьмом классе?',
      attachments: [],
      useWebSearch: false,
      idempotencyKey: 'idempotency-1',
    },
  } as unknown as IncomingMessage
}

function chatResponse() {
  const chunks: string[] = []
  const response = {
    statusCode: 0,
    setHeader: () => undefined,
    flushHeaders: () => undefined,
    write: (chunk: string) => {
      chunks.push(chunk)
      return true
    },
    end: (chunk?: string) => {
      if (chunk) chunks.push(chunk)
    },
  }
  return { response: response as unknown as ServerResponse, text: () => chunks.join('') }
}

// Поток Responses API, как его шлёт шлюз для gpt-5-6-luna: текст и итог с кредитами.
function lunaAnswer() {
  const frames = [
    { type: 'response.output_text.delta', delta: 'Ложись в одно и то же время.' },
    { type: 'response.completed', response: { usage: { input_tokens: 41, output_tokens: 187 }, output: [] }, credits_consumed: 0.02 },
  ]
  return (async () => new Response(
    frames.map((frame) => `event: ${frame.type}\ndata: ${JSON.stringify(frame)}\n\n`).join(''),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )) as unknown as typeof fetch
}

const options = (fetchImpl: typeof fetch) => ({
  apiKey: 'kie-key',
  supabaseUrl: 'https://example.supabase.co',
  supabasePublishableKey: 'publishable',
  serviceRoleKey: 'service',
  fetchImpl,
})

const settleCalls = () => fake.state.rpcCalls.filter((call) => call.name === 'settle_chat_generation')

beforeEach(() => {
  fake.state.rpcCalls = []
  fake.state.settleResults = []
  fake.state.errors = []
  fake.state.messageCount = 0
})

describe('расчёт за ответ чата', () => {
  it('упавший расчёт не показывается нулём и не запирает чат', async () => {
    fake.state.settleResults.push({
      data: null,
      error: { message: 'new row for relation "chat_generations" violates check constraint "chat_generations_charge_within_reserve"' },
    })
    const { response, text } = chatResponse()

    await handleChatRequest(chatRequest(), response, options(lunaAnswer()))

    // Ответ ученик получил.
    expect(text()).toContain('event: delta')
    expect(text()).toContain('event: done')
    // «Списано 0 ₽, баланс 0 ₽» больше не бывает: придуманного итога нет.
    expect(text()).not.toContain('event: usage')
    // Генерация закрыта вторым вызовом, иначе следующий вопрос получил бы 429.
    expect(settleCalls().map((call) => call.args.p_status)).toEqual(['succeeded', 'failed'])
    expect(String(settleCalls()[1].args.p_error)).toContain('Расчёт не прошёл')
    // И это видно в журнале ошибок, с причиной из базы.
    expect(fake.state.errors.join('\n')).toContain('chat settle failed')
    expect(fake.state.errors.join('\n')).toContain('chat_generations_charge_within_reserve')
  })

  it('прошедший расчёт уходит под ответ как есть', async () => {
    fake.state.settleResults.push({
      data: { settled: true, chargedKopecks: 20, refundedKopecks: 0, balanceKopecks: 5340 },
      error: null,
    })
    const { response, text } = chatResponse()

    await handleChatRequest(chatRequest(), response, options(lunaAnswer()))

    expect(text()).toContain('event: usage\ndata: {"chargedKopecks":20,"refundedKopecks":0,"balanceKopecks":5340}')
    expect(settleCalls()).toHaveLength(1)
    expect(settleCalls()[0].args.p_credits_consumed).toBe(0.02)
    expect(fake.state.errors).toEqual([])
  })

  it('ошибка шлюза даёт понятную фразу, закрытую генерацию и строку шлюза в журнале', async () => {
    const gateway = (async () => new Response(
      JSON.stringify({ code: 500, msg: 'Network error, please try again later.' }),
      { status: 200, headers: { 'Content-Type': 'application/json;charset=UTF-8' } },
    )) as unknown as typeof fetch
    const { response, text } = chatResponse()

    await handleChatRequest(chatRequest('gemini-2.5-flash'), response, options(gateway))

    expect(text()).toContain('event: error')
    expect(text()).toContain('Модель сейчас не отвечает')
    expect(text()).not.toContain('Network error')
    expect(settleCalls().map((call) => call.args.p_status)).toEqual(['failed'])
    expect(fake.state.errors.join('\n')).toContain('Network error')
  })
})

describe('readSettlement', () => {
  it('без числа списания итога нет', () => {
    expect(readSettlement(null)).toBeNull()
    expect(readSettlement({ settled: true })).toBeNull()
  })

  it('пустой баланс остаётся пустым', () => {
    expect(readSettlement({ chargedKopecks: 20, balanceKopecks: null }))
      .toEqual({ chargedKopecks: 20, refundedKopecks: 0, balanceKopecks: null })
  })
})
