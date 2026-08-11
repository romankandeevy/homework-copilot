export type GeometryDiagramSpec = {
  kind: 'isosceles-triangle' | 'median-triangle' | 'right-triangle'
  description: string
  vertices: readonly ['A', 'B', 'C']
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
