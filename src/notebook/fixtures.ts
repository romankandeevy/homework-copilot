import { verifiedTextbookTasks } from '../textbooks/taskCatalog'
import type { GeometryNotebookPageSpec } from './geometry/types'

export const approvedGeometryNotebookLayoutV1Fixture: GeometryNotebookPageSpec = {
  id: 'approved-geometry-notebook-layout-v1',
  number: '2',
  condition: 'Отметьте три точки А, В и С, не лежащие на одной прямой, и через каждую пару точек проведите прямую. Сколько прямых получилось?',
  given: ['A, B, C — точки.', 'Не лежат на', 'одной прямой.'],
  goal: { title: 'Найти', text: 'число прямых.' },
  diagram: {
    kind: 'three-point-lines',
    description: 'Три точки A, B и C, не лежащие на одной прямой, соединены прямыми AB, BC и CA.',
    vertices: ['A', 'B', 'C'],
  },
  solution: ['Проведём AB, BC и CA.', 'Всего 3 прямые.'],
  answer: '3 прямые.',
}

export const geometryFixtures: readonly GeometryNotebookPageSpec[] = [
  approvedGeometryNotebookLayoutV1Fixture,
  ...verifiedTextbookTasks
  .filter((task) => task.textbookId === 'geometry' && task.task !== '2')
  .map((task): GeometryNotebookPageSpec => ({
    id: `verified-${task.textbookId}-${task.task}`,
    number: task.task,
    condition: task.condition,
    given: task.given,
    goal: task.goal,
    diagram: task.diagram,
    solution: task.solution,
    answer: task.answer,
  })),
]
