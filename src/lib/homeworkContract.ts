export const homeworkDiagramKinds = [
  'triangle',
  'isosceles-triangle',
  'median-triangle',
  'right-triangle',
  'intersecting-segments',
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
}

export type HomeworkSolution = {
  textbookId: string
  task: string
  source: HomeworkSource
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
  imageDataUrl?: string
  idempotencyKey: string
}
