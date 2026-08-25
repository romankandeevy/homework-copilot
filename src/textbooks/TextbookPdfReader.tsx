import { useEffect, useRef, useState } from 'react'
import { CaretLeft, CaretRight, FileText, ImageSquare, MagnifyingGlassMinus, MagnifyingGlassPlus } from '@phosphor-icons/react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { getCachedTextbookPage, recognizeTextbookPage, type TextbookOcrPage } from './textbookOcr'
import { getTextbookScanManifest } from './textbookScanManifest'

const minimumZoom = 0.75
const maximumZoom = 2
const zoomStep = 0.25

export default function TextbookPdfReader({ sourceUrl, title }: { sourceUrl: string, title: string }) {
  const scanManifest = getTextbookScanManifest(sourceUrl)
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [pageNumber, setPageNumber] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [isRendering, setIsRendering] = useState(true)
  const [error, setError] = useState('')
  // The raster page is the source of truth: it preserves every glyph, figure,
  // caption, margin and printed page number exactly as it appears in the book.
  // OCR is an optional reading aid and must never replace that composition.
  const [readingMode, setReadingMode] = useState<'original' | 'text'>('original')
  const [recognizedPage, setRecognizedPage] = useState<TextbookOcrPage | null>(null)
  const [recognitionMessage, setRecognitionMessage] = useState('Подготавливаем страницу')
  const [recognitionProgress, setRecognitionProgress] = useState(0)
  const [recognitionError, setRecognitionError] = useState('')
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const recognitionRunRef = useRef(0)

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const updateSize = () => {
      const width = Math.max(0, Math.floor(viewport.clientWidth))
      const height = Math.max(0, Math.floor(viewport.clientHeight))
      setViewportSize((current) => current.width === width && current.height === height ? current : { width, height })
    }
    updateSize()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateSize)
      return () => window.removeEventListener('resize', updateSize)
    }

    const observer = new ResizeObserver(updateSize)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    let loadingTask: PDFDocumentLoadingTask | null = null

    setDocument(null)
    setPageNumber(1)
    setPageCount(0)
    setZoom(1)
    setIsRendering(true)
    setError('')

    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        if (cancelled) return

        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
        loadingTask = pdfjs.getDocument({ url: sourceUrl })
        const nextDocument = await loadingTask.promise

        if (cancelled) {
          void loadingTask.destroy().catch(() => {})
          return
        }

        setDocument(nextDocument)
        setPageCount(nextDocument.numPages)
      } catch {
        if (cancelled) return
        setError('Не получилось открыть учебник. Проверь, что PDF не повреждён.')
        setIsRendering(false)
      }
    })()

    return () => {
      cancelled = true
      if (loadingTask) void loadingTask.destroy().catch(() => {})
    }
  }, [sourceUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    const readerViewport = viewportRef.current
    if (!document || !canvas || !readerViewport || viewportSize.width === 0 || viewportSize.height === 0) return

    let cancelled = false
    let renderTask: RenderTask | null = null
    setIsRendering(true)

    void (async () => {
      try {
        const page = await document.getPage(pageNumber)
        if (cancelled) return

        const initialViewport = page.getViewport({ scale: 1 })
        const horizontalPadding = viewportSize.width < 420 ? 24 : 48
        const viewportStyles = window.getComputedStyle(readerViewport)
        const verticalPadding = Number.parseFloat(viewportStyles.paddingTop) + Number.parseFloat(viewportStyles.paddingBottom)
        const availableWidth = Math.max(1, viewportSize.width - horizontalPadding)
        const availableHeight = Math.max(1, viewportSize.height - verticalPadding)
        const fittedScale = Math.min(availableWidth / initialViewport.width, availableHeight / initialViewport.height, 1.6)
        const viewport = page.getViewport({ scale: fittedScale * zoom })
        const pixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3)

        canvas.width = Math.max(1, Math.floor(viewport.width * pixelRatio))
        canvas.height = Math.max(1, Math.floor(viewport.height * pixelRatio))
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = `${Math.floor(viewport.height)}px`

        renderTask = page.render({
          canvas,
          viewport,
          transform: pixelRatio === 1 ? undefined : [pixelRatio, 0, 0, pixelRatio, 0, 0],
        })

        await renderTask.promise
        if (!cancelled) setIsRendering(false)
      } catch (renderError) {
        if (cancelled || (renderError instanceof Error && renderError.name === 'RenderingCancelledException')) return
        setError('Не получилось показать страницу учебника.')
        setIsRendering(false)
      }
    })()

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [document, pageNumber, viewportSize, zoom, readingMode])

  useEffect(() => {
    if (!document || readingMode !== 'text') return

    const runId = recognitionRunRef.current + 1
    recognitionRunRef.current = runId
    const cached = getCachedTextbookPage(sourceUrl, pageNumber)

    setRecognizedPage(cached)
    setRecognitionError('')
    setRecognitionProgress(cached ? 1 : 0.02)
    setRecognitionMessage(cached ? 'Страница готова' : 'Подготавливаем страницу')
    if (cached) return

    void recognizeTextbookPage(document, sourceUrl, pageNumber, (message, progress) => {
      if (recognitionRunRef.current !== runId) return
      setRecognitionMessage(message)
      setRecognitionProgress(progress)
    }).then((result) => {
      if (recognitionRunRef.current !== runId) return
      setRecognizedPage(result)
      setRecognitionProgress(1)
    }).catch(() => {
      if (recognitionRunRef.current !== runId) return
      setRecognitionError('Не получилось распознать страницу. Открой оригинал и попробуй ещё раз.')
    })

    return () => {
      recognitionRunRef.current += 1
    }
  }, [document, pageNumber, readingMode, sourceUrl])

  const hasDocument = Boolean(document && pageCount > 0 && !error)

  return (
    <section className="textbook-pdf-reader" aria-label={`Учебник: ${title}`} data-pdf-source={sourceUrl}>
      <div className="textbook-pdf-toolbar" role="toolbar" aria-label="Управление учебником" data-scan-type={scanManifest?.scanType ?? 'uploaded-pdf'}>
        <div className="textbook-pdf-page-controls">
          <button type="button" aria-label="Предыдущая страница" disabled={!hasDocument || pageNumber <= 1} onClick={() => setPageNumber((current) => Math.max(1, current - 1))}>
            <CaretLeft size={18} weight="bold" aria-hidden="true" />
          </button>
          <label className="textbook-pdf-page-number">
            <span className="textbook-pdf-visually-hidden">Номер страницы</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={pageCount || 1}
              value={pageNumber}
              disabled={!hasDocument}
              onChange={(event) => {
                const nextPage = Number.parseInt(event.currentTarget.value, 10)
                if (Number.isFinite(nextPage)) setPageNumber(Math.max(1, Math.min(nextPage, pageCount)))
              }}
            />
            <span>из {pageCount || '—'}</span>
          </label>
          <button type="button" aria-label="Следующая страница" disabled={!hasDocument || pageNumber >= pageCount} onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))}>
            <CaretRight size={18} weight="bold" aria-hidden="true" />
          </button>
        </div>

        <div className="textbook-pdf-mode-controls" role="group" aria-label="Вид учебника">
          <button type="button" aria-label="Показать точный скан" aria-pressed={readingMode === 'original'} onClick={() => setReadingMode('original')}>
            <ImageSquare size={17} weight="duotone" aria-hidden="true" />
            <span>Точный скан</span>
          </button>
          <button type="button" aria-label="Показать читаемый текст" aria-pressed={readingMode === 'text'} onClick={() => setReadingMode('text')}>
            <FileText size={17} weight="duotone" aria-hidden="true" />
            <span>Читаемый текст</span>
          </button>
        </div>

        <div className="textbook-pdf-zoom-controls">
          <button type="button" aria-label="Уменьшить страницу" disabled={!hasDocument || zoom <= minimumZoom} onClick={() => setZoom((current) => Math.max(minimumZoom, current - zoomStep))}>
            <MagnifyingGlassMinus size={18} weight="bold" aria-hidden="true" />
          </button>
          <span aria-label={`Масштаб ${Math.round(zoom * 100)} процентов`}>{Math.round(zoom * 100)}%</span>
          <button type="button" aria-label="Увеличить страницу" disabled={!hasDocument || zoom >= maximumZoom} onClick={() => setZoom((current) => Math.min(maximumZoom, current + zoomStep))}>
            <MagnifyingGlassPlus size={18} weight="bold" aria-hidden="true" />
          </button>
        </div>
        <span className="textbook-pdf-scan-status" title="Каждая страница показывается из исходного PDF без перестановки элементов">
          {scanManifest ? `Полный скан · ${scanManifest.pageCount} страниц` : 'Скан PDF'}
        </span>
      </div>

      <div className={`textbook-pdf-viewport${readingMode === 'text' ? ' is-reading-text' : ''}`} ref={viewportRef}>
        <div className={`textbook-scan-page${readingMode === 'text' ? ' is-reading-text' : ''}`} data-page-number={pageNumber}>
          <canvas
            ref={canvasRef}
            className={`textbook-pdf-page${document && !error ? ' is-visible' : ''}`}
            role="img"
            aria-label={`Точный скан страницы ${pageNumber} учебника «${title}» с исходными картинками, схемами, формулами, подписями и номером страницы`}
          />
          {readingMode === 'text' ? (
            <article className="textbook-ocr-page" aria-label={`Читаемый текст страницы ${pageNumber}`}>
            <header className="textbook-ocr-page-header">
              <span>Текст страницы {String(pageNumber).padStart(3, '0')}</span>
              <span>{recognizedPage ? 'Распознано' : 'Распознавание'}</span>
            </header>

            {recognitionError ? (
              <p className="textbook-ocr-error" role="alert">{recognitionError}</p>
            ) : recognizedPage ? (
              recognizedPage.blocks.length > 0 ? (
                <div className="textbook-ocr-content">
                  {recognizedPage.blocks.map((block, index) => block.heading
                    ? <h3 key={`${pageNumber}-${index}`}>{block.text}</h3>
                    : <p key={`${pageNumber}-${index}`}>{block.text}</p>)}
                </div>
              ) : (
                <p className="textbook-ocr-empty">На этой странице нет текста. Иллюстрации и формулы доступны в оригинале.</p>
              )
            ) : (
              <div className="textbook-ocr-loading" role="status">
                <strong>{recognitionMessage}</strong>
                <progress aria-label="Прогресс распознавания страницы" max={1} value={recognitionProgress} />
                <span>Русский текст станет чётким и удобным для чтения.</span>
              </div>
            )}
              <p className="textbook-ocr-source-note">Это распознанный текст для удобного чтения. Точный порядок, отступы, рисунки, формулы, подписи и номер страницы сохранены в скане выше.</p>
            </article>
          ) : null}
        </div>
        {error ? (
          <p className="textbook-pdf-status is-error" role="alert">{error}</p>
        ) : isRendering && readingMode === 'original' ? (
          <p className="textbook-pdf-status" role="status">{document ? 'Открываем страницу…' : 'Открываем учебник…'}</p>
        ) : null}
      </div>
    </section>
  )
}
