import type { HomeworkDiagramKind } from '../../lib/homeworkContract'

export type GeometryDiagramSpec = {
  kind: HomeworkDiagramKind
  description: string
  vertices: readonly string[]
  apexAngle?: string
  equalSides?: readonly ['AB', 'BC']
}

export type GeometryNotebookPageSpec = {
  id: string
  number: string
  condition: string
  given: readonly string[]
  goal: {
    title: 'Найти' | 'Доказать'
    text: string
  }
  diagram: GeometryDiagramSpec
  solution: readonly string[]
  answer?: string
}
