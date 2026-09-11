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

/* Тело со скрытыми рёбрами: куб ABCDA₁B₁C₁D₁ так, как его строит
   diagramBuilder (кабинетная проекция, box 50×50×50). Закрыта вершина D,
   её три ребра - пунктиром.

   В geometryFixtures не входит: тот список обходят снимки тетради, а новый
   снимок заводится только с согласованием. До тех пор этот лист проверяет
   юнит-тест: 11 сентября выяснилось, что стиля у скрытого ребра на
   странице не было вовсе и куб выходил без задних рёбер. */
export const solidGeometryFixture: GeometryNotebookPageSpec = {
  id: 'solid-cube-hidden-edges',
  number: '1',
  condition: 'Ребро куба ABCDA₁B₁C₁D₁ равно 4 см. Найдите диагональ куба AC₁.',
  given: ['куб ABCDA₁B₁C₁D₁', 'AB = 4 см'],
  goal: { title: 'Найти', text: 'AC₁' },
  diagram: {
    kind: 'construction',
    description: 'Куб ABCDA₁B₁C₁D₁, скрытые рёбра при вершине D пунктиром, диагональ AC₁.',
    vertices: ['A', 'B', 'C', 'D', 'A₁', 'B₁', 'C₁', 'D₁'],
    scene: {
      points: [
        { id: 'A', label: 'A', x: 8, y: 92, visible: true },
        { id: 'B', label: 'B', x: 70.06, y: 92, visible: true },
        { id: 'C', label: 'C', x: 92, y: 70.06, visible: true },
        { id: 'D', label: 'D', x: 29.94, y: 70.06, visible: true },
        { id: 'A₁', label: 'A₁', x: 8, y: 29.94, visible: true },
        { id: 'B₁', label: 'B₁', x: 70.06, y: 29.94, visible: true },
        { id: 'C₁', label: 'C₁', x: 92, y: 8, visible: true },
        { id: 'D₁', label: 'D₁', x: 29.94, y: 8, visible: true },
      ],
      objects: [
        { kind: 'segment', points: ['A', 'B'], label: '', auxiliary: false },
        { kind: 'segment', points: ['B', 'C'], label: '', auxiliary: false },
        { kind: 'segment', points: ['C', 'D'], label: '', auxiliary: false, hidden: true },
        { kind: 'segment', points: ['D', 'A'], label: '', auxiliary: false, hidden: true },
        { kind: 'segment', points: ['A₁', 'B₁'], label: '', auxiliary: false },
        { kind: 'segment', points: ['B₁', 'C₁'], label: '', auxiliary: false },
        { kind: 'segment', points: ['C₁', 'D₁'], label: '', auxiliary: false },
        { kind: 'segment', points: ['D₁', 'A₁'], label: '', auxiliary: false },
        { kind: 'segment', points: ['A', 'A₁'], label: '', auxiliary: false },
        { kind: 'segment', points: ['B', 'B₁'], label: '', auxiliary: false },
        { kind: 'segment', points: ['C', 'C₁'], label: '', auxiliary: false },
        { kind: 'segment', points: ['D', 'D₁'], label: '', auxiliary: false, hidden: true },
        { kind: 'segment', points: ['A', 'C₁'], label: '', auxiliary: true },
      ],
      marks: [],
      constraints: [],
    },
  },
  solution: [
    'AC = AB·√2 = 4√2 см (диагональ квадрата)',
    'CC₁ ⟂ (ABC), △ACC₁ - прямоугольный',
    'AC₁² = AC² + CC₁² = 32 + 16 = 48',
    'AC₁ = √48 = 4√3 см',
  ],
  answer: 'AC₁ = 4√3 см',
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
