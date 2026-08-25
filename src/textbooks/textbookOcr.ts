import type { PDFDocumentProxy } from 'pdfjs-dist'

export type TextbookOcrBlock = {
  text: string
  heading: boolean
}

export type TextbookOcrPage = {
  pageNumber: number
  confidence: number
  blocks: TextbookOcrBlock[]
  /** The scan remains the visual source for figures, formulas and page geometry. */
  visualSource?: {
    kind: 'pdf-scan'
    sourceUrl: string
    width: number
    height: number
  }
}

type ProgressHandler = (message: string, progress: number) => void
type TextRecognitionWorker = Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>>

const cachePrefix = 'homework-copilot:textbook-ocr-v1'
const pageCache = new Map<string, TextbookOcrPage>()
let workerPromise: Promise<TextRecognitionWorker> | null = null
let activeProgressHandler: ProgressHandler | null = null
let recognitionQueue: Promise<void> = Promise.resolve()

function getCacheKey(sourceUrl: string, pageNumber: number) {
  return `${cachePrefix}:${sourceUrl}:${pageNumber}`
}

function normalizeParagraph(value: string) {
  return value
    .replace(/([\p{L}])-[\r\n]+([\p{L}])/gu, '$1$2')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isHeading(value: string) {
  if (value.length > 82) return false
  if (/^(?:§\s*\d+|глава\s+\d+|параграф\s+\d+)/iu.test(value)) return true
  const letters = value.match(/\p{L}/gu) ?? []
  const uppercaseLetters = value.match(/\p{Lu}/gu) ?? []
  return letters.length >= 5 && uppercaseLetters.length / letters.length >= 0.72
}

export function getCachedTextbookPage(sourceUrl: string, pageNumber: number): TextbookOcrPage | null {
  const key = getCacheKey(sourceUrl, pageNumber)
  const inMemory = pageCache.get(key)
  if (inMemory) return inMemory

  try {
    const stored = window.localStorage.getItem(key)
    if (!stored) return null
    const parsed = JSON.parse(stored) as TextbookOcrPage
    if (parsed.pageNumber !== pageNumber || !Array.isArray(parsed.blocks)) return null
    pageCache.set(key, parsed)
    return parsed
  } catch {
    return null
  }
}

function cacheRecognizedPage(sourceUrl: string, result: TextbookOcrPage) {
  const key = getCacheKey(sourceUrl, result.pageNumber)
  pageCache.set(key, result)
  try {
    window.localStorage.setItem(key, JSON.stringify(result))
  } catch {
    // In-memory caching keeps the reader usable when browser storage is full.
  }
}

function getProgressMessage(status: string) {
  if (status === 'loading language traineddata') return 'Загружаем русский язык'
  if (status === 'recognizing text') return 'Распознаём текст страницы'
  if (status === 'initializing tesseract' || status === 'initializing api') return 'Настраиваем распознавание'
  return 'Подготавливаем страницу'
}

async function getRecognitionWorker(onProgress: ProgressHandler) {
  activeProgressHandler = onProgress

  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import('tesseract.js')
      const worker = await createWorker(['rus', 'eng'], undefined, {
        logger: ({ progress, status }) => {
          const normalized = status === 'recognizing text'
            ? 0.28 + (progress || 0) * 0.68
            : Math.min(0.26, Math.max(0.04, (progress || 0) * 0.24))
          activeProgressHandler?.(getProgressMessage(status), normalized)
        },
      })

      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
        preserve_interword_spaces: '0',
        user_defined_dpi: '300',
      })

      return worker
    })().catch((error: unknown) => {
      workerPromise = null
      throw error
    })
  }

  return workerPromise
}

function enqueueRecognition<T>(run: () => Promise<T>) {
  const result = recognitionQueue.then(run, run)
  recognitionQueue = result.then(() => undefined, () => undefined)
  return result
}

export function recognizeTextbookPage(
  document: PDFDocumentProxy,
  sourceUrl: string,
  pageNumber: number,
  onProgress: ProgressHandler,
): Promise<TextbookOcrPage> {
  const cached = getCachedTextbookPage(sourceUrl, pageNumber)
  if (cached) return Promise.resolve(cached)

  return enqueueRecognition(async () => {
    const alreadyRecognized = getCachedTextbookPage(sourceUrl, pageNumber)
    if (alreadyRecognized) return alreadyRecognized

    onProgress('Подготавливаем чёткое изображение', 0.02)
    const page = await document.getPage(pageNumber)
    const initialViewport = page.getViewport({ scale: 1 })
    const renderScale = Math.min(2.8, 2400 / initialViewport.width, 3200 / initialViewport.height)
    const viewport = page.getViewport({ scale: renderScale })
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.max(1, Math.floor(viewport.width))
    canvas.height = Math.max(1, Math.floor(viewport.height))
    await page.render({ canvas, viewport }).promise

    const worker = await getRecognitionWorker(onProgress)
    activeProgressHandler = onProgress
    const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true })

    const recognizedParagraphs = (data.blocks ?? [])
      .flatMap((block) => block.paragraphs)
      .map((paragraph) => normalizeParagraph(paragraph.text))
      .filter((paragraph) => paragraph.length > 1)

    const fallbackParagraphs = data.text
      .split(/\n\s*\n/g)
      .map(normalizeParagraph)
      .filter((paragraph) => paragraph.length > 1)

    const paragraphs = recognizedParagraphs.length > 0 ? recognizedParagraphs : fallbackParagraphs
    const result: TextbookOcrPage = {
      pageNumber,
      confidence: Math.round(data.confidence),
      blocks: paragraphs.map((text) => ({ text, heading: isHeading(text) })),
      visualSource: {
        kind: 'pdf-scan',
        sourceUrl,
        width: initialViewport.width,
        height: initialViewport.height,
      },
    }

    cacheRecognizedPage(sourceUrl, result)
    onProgress('Страница готова', 1)
    return result
  })
}
