import type { HomeworkDiagram } from '../lib/homeworkContract.ts'

export type TextbookTaskSourceRegion = {
  page: number
  x: number
  y: number
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
}

export type TextbookTaskDiagramRegion = TextbookTaskSourceRegion & {
  figure: number
}

export type VerifiedTextbookTaskSource = {
  textbookId: string
  subject: string
  grade: string
  textbookTitle: string
  authors: string
  task: string
  edition: string
  sourceUrl: string
  sourcePage?: number
  condition: string
  conditionNormalized: string
  sourceRegion: TextbookTaskSourceRegion
  diagramRegions: readonly TextbookTaskDiagramRegion[]
  ocrConfidence: number
  hasDiagram: boolean
}

export type VerifiedTextbookTask = VerifiedTextbookTaskSource & {
  given: readonly string[]
  goal: {
    title: 'Найти' | 'Доказать'
    text: string
  }
  solution: readonly string[]
  answer: string
  diagram: HomeworkDiagram
}

export function normalizeTaskCondition(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*([,.;:!?])\s*/g, '$1')
    .trim()
}

const geometrySourceUrl = '/textbooks/geometry-7-9-atanasyan.pdf'
const geometryEdition = '14-е издание, Просвещение, 2023'
const geometryTextbook = {
  textbookId: 'geometry',
  subject: 'Геометрия',
  grade: '8 класс',
  textbookTitle: 'Геометрия. 7-9 классы',
  authors: 'Л. С. Атанасян, В. Ф. Бутузов, С. Б. Кадомцев, Э. Г. Позняк, И. И. Юдина',
} as const

export const geometryTextbookIdentity = {
  ...geometryTextbook,
  edition: geometryEdition,
  sourceUrl: geometrySourceUrl,
} as const

export const verifiedTextbookTasks: readonly VerifiedTextbookTask[] = [
  {
    ...geometryTextbook,
    task: '2',
    edition: geometryEdition,
    sourceUrl: geometrySourceUrl,
    sourcePage: 9,
    condition: 'Отметьте три точки А, В и С, не лежащие на одной прямой, и через каждую пару точек проведите прямую. Сколько прямых получилось?',
    conditionNormalized: 'отметьте три точки а,в и с,не лежащие на одной прямой,и через каждую пару точек проведите прямую.сколько прямых получилось?',
    sourceRegion: { page: 9, x: 94, y: 659, width: 696, height: 78, sourceWidth: 827, sourceHeight: 1100 },
    diagramRegions: [],
    ocrConfidence: 95,
    hasDiagram: false,
    given: ['A, B, C — точки.', 'Не лежат на', 'одной прямой.'],
    goal: { title: 'Найти', text: 'число прямых.' },
    solution: [
      'Проведём AB, BC и CA.',
      'Всего 3 прямые.',
    ],
    answer: '3 прямые.',
    diagram: {
      kind: 'three-point-lines',
      description: 'Три точки A, B и C, не лежащие на одной прямой, соединены прямыми AB, BC и CA.',
      vertices: ['A', 'B', 'C'],
    },
  },
]

export function findVerifiedTextbookTask(textbookId: string, edition: string, task: string) {
  return verifiedTextbookTasks.find((entry) => entry.textbookId === textbookId && entry.edition === edition && entry.task === task) ?? null
}
