import { verifiedTextbookTasks } from '../textbooks/taskCatalog'
import type { GeometryNotebookPageSpec } from './geometry/types'

/* Эталон записи в тетради: задача № 274 про ромб.

   Это та самая запись, которую видно на витрине и в ролике, и по ней
   равняется решение любой задачи: слева «Дано» и «Найти», справа чертёж,
   ниже ход решения пронумерованными строками, в конце — «Ответ».
   Номера строк ставит сама тетрадь, поэтому здесь их нет.

   Чертёж описан сценой, как его отдаёт движок для настоящей задачи:
   ромб, обе диагонали вспомогательными линиями, точка пересечения O,
   прямой угол при O и равные стороны. Локальные координаты сжаты по
   горизонтали, потому что зона чертежа шире, чем выше: на странице AC
   и BD выходят в честном отношении 10 к 24. */
export const approvedGeometryNotebookLayoutV1Fixture: GeometryNotebookPageSpec = {
  id: 'approved-geometry-notebook-layout-v1',
  number: '274',
  condition: 'Диагонали ромба ABCD равны 10 см и 24 см. Найдите сторону ромба.',
  given: ['ромб ABCD', 'AC = 10 см', 'BD = 24 см'],
  goal: { title: 'Найти', text: 'AB' },
  diagram: {
    kind: 'construction',
    description: 'Ромб ABCD с диагоналями AC и BD, пересекающимися под прямым углом в точке O.',
    vertices: ['A', 'B', 'C', 'D', 'O'],
    scene: {
      points: [
        { id: 'A', label: 'A', x: 36.2, y: 50, visible: true },
        { id: 'B', label: 'B', x: 50, y: 7, visible: true },
        { id: 'C', label: 'C', x: 63.8, y: 50, visible: true },
        { id: 'D', label: 'D', x: 50, y: 93, visible: true },
        { id: 'O', label: 'O', x: 50, y: 50, visible: true },
      ],
      objects: [
        { kind: 'polygon', points: ['A', 'B', 'C', 'D'], label: '', auxiliary: false },
        { kind: 'segment', points: ['A', 'C'], label: '', auxiliary: true },
        { kind: 'segment', points: ['B', 'D'], label: '', auxiliary: true },
      ],
      marks: [
        { kind: 'right-angle', points: ['A', 'O', 'B'], label: '' },
        { kind: 'equal-segment', points: ['A', 'B', 'B', 'C'], label: '' },
        { kind: 'equal-segment', points: ['C', 'D', 'D', 'A'], label: '' },
      ],
      constraints: [
        { kind: 'midpoint', points: ['O', 'A', 'C'] },
        { kind: 'midpoint', points: ['O', 'B', 'D'] },
        { kind: 'perpendicular', points: ['A', 'C', 'B', 'D'] },
        { kind: 'equal-length', points: ['A', 'B', 'B', 'C'] },
        { kind: 'equal-length', points: ['C', 'D', 'D', 'A'] },
      ],
    },
  },
  solution: [
    'Диагонали ромба делятся пополам и ⟂.',
    'AO = AC:2 = 5 см, BO = BD:2 = 12 см',
    '△AOB — прямоугольный, ∠AOB = 90°',
    'AB² = AO² + BO² = 5² + 12² = 169',
    'AB = √169 = 13 см',
  ],
  answer: 'AB = 13 см',
}

export const geometryFixtures: readonly GeometryNotebookPageSpec[] = [
  approvedGeometryNotebookLayoutV1Fixture,
  ...verifiedTextbookTasks
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
  })),
]
