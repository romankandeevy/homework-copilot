import type {
  HomeworkAnnotatedBlock,
  HomeworkAnnotationLegendEntry,
  HomeworkAnnotationMark,
} from '../lib/homeworkContract'

// Подписи по школьному стандарту. Используются в условных обозначениях,
// когда модель не объяснила значок своими словами в note.
export const markTitles: Record<HomeworkAnnotationMark, string> = {
  none: '',
  single: 'подлежащее',
  double: 'сказуемое',
  wavy: 'определение',
  dashed: 'дополнение',
  'dash-dot': 'обстоятельство',
  stem: 'основа слова',
  prefix: 'приставка',
  root: 'корень',
  suffix: 'суффикс',
  ending: 'окончание',
  box: 'выделено',
  circle: 'отмечено',
}

// Условные обозначения собираются из note токенов: подпись рядом с образцом
// значка объясняет запись без ссылки на учебник.
export function analysisLegend(blocks: HomeworkAnnotatedBlock[]): HomeworkAnnotationLegendEntry[] {
  const declared = blocks.flatMap((block) => block.legend ?? [])
  const collected = declared.length > 0
    ? declared
    : blocks.flatMap((block) => block.lines.flatMap((line) => line.tokens
      .filter((token) => token.mark && token.mark !== 'none')
      .map((token) => ({
        mark: token.mark as HomeworkAnnotationMark,
        label: token.note || markTitles[token.mark as HomeworkAnnotationMark],
      }))))

  const seen = new Set<string>()
  return collected.filter((entry) => {
    if (!entry.label || seen.has(entry.mark)) return false
    seen.add(entry.mark)
    return true
  })
}
