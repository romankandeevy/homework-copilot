import type { HomeworkSolution, SolveHomeworkRequest } from './homeworkContract'
import type { Json } from './database.types'

export const generatedSolutionsStorageKey = 'homework-copilot:generated-solutions-v1'

export function parseStoredHomeworkSolution(value: Json | unknown, ownerId?: string): HomeworkSolution | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null

  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.textbookId !== 'string'
    || typeof candidate.task !== 'string'
    || typeof candidate.condition !== 'string'
    || typeof candidate.textbookEdition !== 'string'
    || typeof candidate.sourceUrl !== 'string'
    || typeof candidate.conditionNormalized !== 'string'
    || !Array.isArray(candidate.steps)
  ) return null

  const solution = candidate as HomeworkSolution
  return ownerId ? { ...solution, ownerId } : solution
}

export function loadGeneratedSolutions(): HomeworkSolution[] {
  try {
    const stored = window.localStorage.getItem(generatedSolutionsStorageKey)
    const parsed: unknown = stored ? JSON.parse(stored) : []
    if (!Array.isArray(parsed)) return []

    return parsed
      .map((entry) => parseStoredHomeworkSolution(entry))
      .filter((entry): entry is HomeworkSolution => entry !== null)
  } catch {
    return []
  }
}

export function saveGeneratedSolutions(solutions: readonly HomeworkSolution[]) {
  try {
    window.localStorage.setItem(generatedSolutionsStorageKey, JSON.stringify(solutions.slice(0, 100)))
  } catch {
    // The active solution remains available when browser storage is blocked or full.
  }
}

function readFileAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Не получилось прочитать фотографию задачи'))
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Не получилось подготовить фотографию задачи'))
        return
      }
      resolve(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

export async function prepareTaskPhoto(file: File): Promise<string> {
  const maxBytes = 2_800_000
  if (file.size <= maxBytes) return readFileAsDataUrl(file)
  if (typeof createImageBitmap !== 'function') {
    throw new Error('Фотография слишком большая. Выбери изображение до 2,8 МБ')
  }

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new Error('Не получилось уменьшить фотографию задачи')
  }

  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const compressed = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
  if (!compressed || compressed.size > maxBytes) {
    throw new Error('Фотография слишком большая. Сделай снимок ближе к условию')
  }
  return readFileAsDataUrl(compressed)
}

export async function recognizeTaskPhoto(file: File): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker(['rus', 'eng'])
  try {
    const { data } = await worker.recognize(file, {}, { text: true })
    const condition = data.text.replace(/\s+/g, ' ').trim()
    if (condition.length < 12) throw new Error('Не получилось прочитать условие с фотографии. Сделай снимок ближе и чётче')
    return condition
  } finally {
    await worker.terminate()
  }
}

export async function requestHomeworkSolution(
  endpoint: string,
  request: SolveHomeworkRequest,
  accessToken?: string,
): Promise<HomeworkSolution> {
  let response: Response

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: 'Bearer ' + accessToken } : {}),
      },
      body: JSON.stringify(request),
    })
  } catch {
    throw new Error('Не получилось связаться с сервером решений. Проверь интернет и попробуй ещё раз')
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('Сервер решений вернул некорректный ответ')
  }

  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
      ? payload.error
      : 'Не получилось подготовить решение'
    throw new Error(message)
  }

  if (!payload || typeof payload !== 'object' || !('solution' in payload)) {
    throw new Error('Сервер не вернул готовое решение')
  }

  return payload.solution as HomeworkSolution
}
