import type { HomeworkDiagramKind, HomeworkDiagramScene } from '../../lib/homeworkContract'

export type GeometryDiagramSpec = {
  kind: HomeworkDiagramKind
  description: string
  vertices: readonly string[]
  apexAngle?: string
  equalSides?: readonly ['AB', 'BC']
  auxiliaryKind?: 'median' | 'bisector' | 'height'
  auxiliaryLabel?: string
  rightAngleAt?: string
  parallelTo?: string
  exteriorAngle?: string
  scene?: HomeworkDiagramScene
}

export type GeometryNotebookPageSpec = {
  id: string
  /* Номер задачи в учебнике. Его нет у задачи, которую ученик принёс текстом
     или фотографией: там номера не существует, и подставлять вместо него
     срез условия — печатать на листе «№ В прямоугольном треугольнике ABC
     угол», обрезанное краем страницы. */
  number?: string
  condition: string
  given: readonly string[]
  goal: {
    title: 'Найти' | 'Доказать' | 'Построить'
    text: string
  }
  diagram: GeometryDiagramSpec
  sourceDiagram?: {
    imageUrl: string
    alt: string
  }
  solution: readonly string[]
  answer?: string
}
