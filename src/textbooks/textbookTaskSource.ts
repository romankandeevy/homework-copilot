import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { TextbookTaskSourceRegion } from './taskCatalog'

const documentCache = new Map<string, Promise<PDFDocumentProxy>>()
const imageCache = new Map<string, Promise<string>>()
const evidenceCache = new Map<string, Promise<string>>()

async function loadDocument(sourceUrl: string) {
  const cached = documentCache.get(sourceUrl)
  if (cached) return cached

  const loading = (async () => {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
    const loadingTask: PDFDocumentLoadingTask = pdfjs.getDocument({ url: sourceUrl })
    return loadingTask.promise
  })()
  documentCache.set(sourceUrl, loading)
  return loading
}

export function renderTextbookTaskSourceImage(sourceUrl: string, region: TextbookTaskSourceRegion) {
  const cacheKey = `${sourceUrl}:${region.page}:${region.x}:${region.y}:${region.width}:${region.height}`
  const cached = imageCache.get(cacheKey)
  if (cached) return cached

  const rendering = (async () => {
    const document = await loadDocument(sourceUrl)
    const page = await document.getPage(region.page)
    const baseViewport = page.getViewport({ scale: 1 })
    const normalizedWidth = region.width / region.sourceWidth
    const targetScale = Math.min(3, Math.max(1.6, 1400 / Math.max(1, baseViewport.width * normalizedWidth)))
    const viewport = page.getViewport({ scale: targetScale })
    const cropX = Math.floor((region.x / region.sourceWidth) * viewport.width)
    const cropY = Math.floor((region.y / region.sourceHeight) * viewport.height)
    const cropWidth = Math.max(1, Math.ceil((region.width / region.sourceWidth) * viewport.width))
    const cropHeight = Math.max(1, Math.ceil((region.height / region.sourceHeight) * viewport.height))
    const canvas = window.document.createElement('canvas')
    canvas.width = cropWidth
    canvas.height = cropHeight

    let renderTask: RenderTask | null = null
    try {
      renderTask = page.render({
        canvas,
        viewport,
        transform: [1, 0, 0, 1, -cropX, -cropY],
      })
      await renderTask.promise
      return canvas.toDataURL('image/jpeg', 0.9)
    } finally {
      renderTask = null
      page.cleanup()
    }
  })().catch((error) => {
    imageCache.delete(cacheKey)
    throw error
  })

  imageCache.set(cacheKey, rendering)
  return rendering
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Не получилось собрать чертёж из учебника'))
    image.src = source
  })
}

export function renderTextbookTaskEvidenceImage(sourceUrl: string, regions: readonly TextbookTaskSourceRegion[]) {
  if (regions.length === 0) return Promise.reject(new Error('В задаче не найден исходный чертёж'))
  if (regions.length === 1) return renderTextbookTaskSourceImage(sourceUrl, regions[0])

  const cacheKey = `${sourceUrl}:${regions.map((region) => `${region.page}:${region.x}:${region.y}:${region.width}:${region.height}`).join('|')}`
  const cached = evidenceCache.get(cacheKey)
  if (cached) return cached

  const rendering = (async () => {
    const sources = await Promise.all(regions.map((region) => renderTextbookTaskSourceImage(sourceUrl, region)))
    const images = await Promise.all(sources.map(loadImage))
    const padding = 24
    const gap = 24
    const width = Math.max(...images.map((image) => image.naturalWidth)) + padding * 2
    const height = images.reduce((sum, image) => sum + image.naturalHeight, padding * 2 + gap * (images.length - 1))
    const canvas = window.document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Не получилось собрать чертёж из учебника')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    let y = padding
    for (const image of images) {
      context.drawImage(image, padding, y)
      y += image.naturalHeight + gap
    }
    return canvas.toDataURL('image/jpeg', 0.9)
  })().catch((error) => {
    evidenceCache.delete(cacheKey)
    throw error
  })

  evidenceCache.set(cacheKey, rendering)
  return rendering
}
