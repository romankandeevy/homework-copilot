import { describe, expect, it } from 'vitest'
import { streamModelAnswer } from './chatProviders.ts'

/* Фотография в чате доезжает до модели.

   Раньше вложения загружались, тарифицировались и сохранялись рядом с
   сообщением, а в запрос уходил один текст: школьник прикладывал снимок
   задачи и получал ответ на пустой вопрос. Здесь проверяется само тело
   запроса — по обоим протоколам KIE, потому что части сообщения они
   называют по-разному. */

// Протоколы отдают поток по-разному: chat/completions — `choices[].delta`,
// Responses API — событие `response.output_text.delta`.
const sseBody = (text: string, protocol: 'gemini' | 'responses') => new ReadableStream<Uint8Array>({
  start(controller) {
    const encoder = new TextEncoder()
    const frame = protocol === 'gemini'
      ? { choices: [{ delta: { content: text } }] }
      : { type: 'response.output_text.delta', delta: text }
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`))
    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
    controller.close()
  },
})

function captureRequest(protocol: 'gemini' | 'responses' = 'gemini') {
  const bodies: Array<Record<string, unknown>> = []
  const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
    return new Response(sseBody('ответ', protocol), { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
  }) as unknown as typeof fetch
  return { bodies, fetchImpl }
}

const dataUrl = 'data:image/png;base64,cGhvdG8='

const baseArgs = {
  apiKey: 'test-key',
  useWebSearch: false,
  maxAnswerCharacters: 2000,
  timeoutMs: 5000,
  onDelta: () => undefined,
  onCitation: () => undefined,
}

describe('вложения чата в запросе к модели', () => {
  it('уходят картинкой по протоколу chat/completions', async () => {
    const { bodies, fetchImpl } = captureRequest()

    await streamModelAnswer({
      ...baseArgs,
      modelId: 'gemini-2.5-flash',
      fetchImpl,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Реши задачу с фото' }, { type: 'image', dataUrl }] }],
    })

    const messages = bodies[0].messages as Array<{ role: string; content: unknown }>
    expect(messages[0].role).toBe('system')
    expect(messages[1].content).toEqual([
      { type: 'text', text: 'Реши задачу с фото' },
      { type: 'image_url', image_url: { url: dataUrl } },
    ])
  })

  it('уходят картинкой по протоколу Responses API', async () => {
    const { bodies, fetchImpl } = captureRequest('responses')

    await streamModelAnswer({
      ...baseArgs,
      modelId: 'gpt-5-6-luna',
      fetchImpl,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Реши задачу с фото' }, { type: 'image', dataUrl }] }],
    })

    const input = bodies[0].input as Array<{ role: string; content: unknown }>
    expect(input[0].content).toEqual([
      { type: 'input_text', text: 'Реши задачу с фото' },
      { type: 'input_image', image_url: dataUrl },
    ])
  })

  it('оставляет сообщение без картинок обычной строкой', async () => {
    const { bodies, fetchImpl } = captureRequest()

    await streamModelAnswer({
      ...baseArgs,
      modelId: 'gemini-2.5-flash',
      fetchImpl,
      messages: [{ role: 'user', content: 'Объясни дискриминант' }],
    })

    const messages = bodies[0].messages as Array<{ role: string; content: unknown }>
    // Строку принимают все семейства, включая те, что изображений не умеют.
    expect(messages[1].content).toBe('Объясни дискриминант')
  })
})
