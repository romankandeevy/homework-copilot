import {
  findVerifiedTextbookTask,
  type TextbookTaskDiagramRegion,
  type TextbookTaskSourceRegion,
  type VerifiedTextbookTaskSource,
} from './taskCatalog'

type TextbookIdentity = Pick<VerifiedTextbookTaskSource, 'textbookId' | 'subject' | 'grade' | 'textbookTitle' | 'authors' | 'edition' | 'sourceUrl'>

type LookupRow = {
  condition: string
  condition_normalized: string
  source_url: string
  source_page: number | null
  source_region: unknown
  diagram_regions: unknown
  ocr_confidence: number
  has_diagram: boolean
}

function parseDiagramRegions(value: unknown): TextbookTaskDiagramRegion[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const figure = Number((entry as Record<string, unknown>).figure)
    const region = parseSourceRegion(entry)
    return Number.isInteger(figure) && figure > 0 && region ? [{ figure, ...region }] : []
  })
}

function parseSourceRegion(value: unknown): TextbookTaskSourceRegion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const fields = ['page', 'x', 'y', 'width', 'height', 'sourceWidth', 'sourceHeight'] as const
  if (fields.some((field) => !Number.isFinite(source[field]) || Number(source[field]) <= 0)) return null
  return Object.fromEntries(fields.map((field) => [field, Number(source[field])])) as unknown as TextbookTaskSourceRegion
}

export async function lookupVerifiedTextbookTask(textbook: TextbookIdentity, task: string): Promise<VerifiedTextbookTaskSource | null> {
  const localTask = findVerifiedTextbookTask(textbook.textbookId, textbook.edition, task)
  if (import.meta.env.MODE === 'test') return localTask

  const { supabase } = await import('../lib/supabase')
  if (!supabase) return localTask

  const { data, error } = await supabase.rpc('get_verified_homework_task', {
    p_edition: textbook.edition,
    p_source_url: textbook.sourceUrl,
    p_task: task,
    p_textbook_id: textbook.textbookId,
  })

  if (error) throw new Error('Не получилось проверить номер в учебнике. Попробуй ещё раз')
  const row = (Array.isArray(data) ? data[0] : data) as LookupRow | null
  if (!row) return null
  const sourceRegion = parseSourceRegion(row.source_region)
  const diagramRegions = parseDiagramRegions(row.diagram_regions)
  if (!sourceRegion || !row.condition || !row.condition_normalized || row.source_url !== textbook.sourceUrl) {
    throw new Error('В базе найдено неполное условие. Добавь фото задачи')
  }
  if (row.has_diagram !== (diagramRegions.length > 0)) {
    throw new Error('В базе не удалось проверить чертёж. Добавь фото задачи')
  }

  return {
    ...textbook,
    task,
    sourcePage: row.source_page ?? sourceRegion.page,
    condition: row.condition,
    conditionNormalized: row.condition_normalized,
    sourceRegion,
    diagramRegions,
    ocrConfidence: row.ocr_confidence,
    hasDiagram: row.has_diagram,
  }
}
