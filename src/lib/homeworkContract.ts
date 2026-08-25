export const homeworkDiagramKinds = [
  'triangle',
  'three-point-lines',
  'isosceles-triangle',
  'median-triangle',
  'right-triangle',
  'intersecting-segments',
  'parallel-line-triangle',
  'parallelogram',
  'rectangle',
  'rhombus',
  'square',
  'trapezoid',
  'circle',
  'none',
] as const

export type HomeworkDiagramKind = typeof homeworkDiagramKinds[number]
export type HomeworkSource = 'number' | 'photo'

export type HomeworkDiagram = {
  kind: HomeworkDiagramKind
  description: string
  vertices: string[]
  apexAngle?: string
  auxiliaryKind?: 'median' | 'bisector' | 'height'
  auxiliaryLabel?: string
  rightAngleAt?: string
  parallelTo?: string
  exteriorAngle?: string
}

export type HomeworkSolution = {
  textbookId: string
  task: string
  source: HomeworkSource
  textbookEdition: string
  sourceUrl: string
  sourcePage?: number
  conditionNormalized: string
  subject: string
  textbookTitle: string
  condition: string
  given: string[]
  goal: {
    title: 'Найти' | 'Доказать'
    text: string
  }
  steps: string[]
  answer: string
  diagram: HomeworkDiagram
  sourceVerified: boolean
  createdAt: string
  ownerId?: string
}

export type SolveHomeworkRequest = {
  textbookId: string
  task: string
  source: HomeworkSource
  subject: string
  grade: string
  textbookTitle: string
  authors: string
  edition: string
  condition?: string
  sourceUrl?: string
  sourcePage?: number
  imageDataUrl?: string
  idempotencyKey: string
}
