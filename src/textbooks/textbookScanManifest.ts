export type TextbookScanManifest = {
  sourceUrl: string
  pageCount: number
  scanType: 'source-pdf-raster'
  fidelity: 'exact-page-composition'
}

/**
 * The three supplied books are image-only PDFs. Their page raster is the
 * authoritative scan: keeping the PDF intact preserves every printed glyph,
 * illustration, formula, margin, caption and page number without OCR
 * reflowing the page into a different layout.
 */
export const textbookScanManifest: readonly TextbookScanManifest[] = [
  { sourceUrl: '/textbooks/geometry-7-9-atanasyan.pdf', pageCount: 417, scanType: 'source-pdf-raster', fidelity: 'exact-page-composition' },
  { sourceUrl: '/textbooks/physics-8-peryshkin-2026.pdf', pageCount: 255, scanType: 'source-pdf-raster', fidelity: 'exact-page-composition' },
  { sourceUrl: '/textbooks/chemistry-8-gabrielyan-2025.pdf', pageCount: 176, scanType: 'source-pdf-raster', fidelity: 'exact-page-composition' },
]

export function getTextbookScanManifest(sourceUrl: string) {
  return textbookScanManifest.find((item) => item.sourceUrl === sourceUrl) ?? null
}
