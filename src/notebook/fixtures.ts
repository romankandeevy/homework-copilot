import { verifiedTextbookTasks } from '../textbooks/taskCatalog'
import type { GeometryNotebookPageSpec } from './geometry/types'

export const geometryFixtures: readonly GeometryNotebookPageSpec[] = verifiedTextbookTasks
  .filter((task) => task.textbookId === 'geometry')
  .map((task): GeometryNotebookPageSpec => ({
    id: `verified-${task.textbookId}-${task.task}`,
    number: task.task,
    condition: task.condition,
    given: task.given,
    goal: task.goal,
    diagram: task.diagram,
    solution: task.solution,
    answer: task.answer,
  }))
