import { describe, expect, it } from 'vitest'
import type { HomeworkDiagram, HomeworkDiagramScene, HomeworkSolution } from '../src/lib/homeworkContract.ts'
import { validateSolutionQuality } from './geometrySolutionEngine.ts'
import { buildDiagram, buildDiagramFromModelPlan } from './diagramBuilder.ts'
import type { DiagramCommand, DiagramOp, DiagramPlan } from './diagramBuilder.ts'

type CommandDraft = {
  op: DiagramOp
  names?: string[]
  args?: string[]
  values?: number[]
  label?: string
  auxiliary?: boolean
  hidden?: boolean
}

function command(draft: CommandDraft): DiagramCommand {
  return {
    op: draft.op,
    names: draft.names ?? [],
    args: draft.args ?? [],
    values: draft.values ?? [],
    label: draft.label ?? '',
    auxiliary: draft.auxiliary ?? false,
    hidden: draft.hidden ?? false,
  }
}

function plan(description: string, drafts: CommandDraft[]): DiagramPlan {
  return { description, commands: drafts.map(command) }
}

/** Строит чертёж и падает с понятным сообщением, если план не исполнился. */
function build(description: string, drafts: CommandDraft[]) {
  const result = buildDiagram(plan(description, drafts))
  if (!result.ok) throw new Error(`план не построился: ${result.errors.join('; ')}`)
  return result
}

type Vec = { x: number; y: number }

function at(scene: HomeworkDiagramScene, id: string): Vec {
  const point = scene.points.find((entry) => entry.id === id)
  if (!point) throw new Error(`точка ${id} отсутствует на чертеже`)
  return { x: point.x, y: point.y }
}

const span = (scene: HomeworkDiagramScene, from: string, to: string) => Math.hypot(
  at(scene, to).x - at(scene, from).x,
  at(scene, to).y - at(scene, from).y,
)

/** Угол в градусах при вершине vertex между лучами на first и second. */
function angle(scene: HomeworkDiagramScene, first: string, vertex: string, second: string) {
  const origin = at(scene, vertex)
  const left = { x: at(scene, first).x - origin.x, y: at(scene, first).y - origin.y }
  const right = { x: at(scene, second).x - origin.x, y: at(scene, second).y - origin.y }
  const scale = Math.hypot(left.x, left.y) * Math.hypot(right.x, right.y)
  const cosine = (left.x * right.x + left.y * right.y) / scale
  return (Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI
}

/** Синус угла между направлениями: 0 — параллельны. */
function skew(scene: HomeworkDiagramScene, first: string, second: string, third: string, fourth: string) {
  const left = { x: at(scene, second).x - at(scene, first).x, y: at(scene, second).y - at(scene, first).y }
  const right = { x: at(scene, fourth).x - at(scene, third).x, y: at(scene, fourth).y - at(scene, third).y }
  const scale = Math.hypot(left.x, left.y) * Math.hypot(right.x, right.y)
  return Math.abs(left.x * right.y - left.y * right.x) / scale
}

/**
 * Оборачивает построенный чертёж в готовое решение и прогоняет боевую проверку
 * движка: она включает constraintIssue по координатам сцены.
 */
function qualityIssues(diagram: HomeworkDiagram, condition: string, steps: string[]) {
  const solution: HomeworkSolution = {
    engineVersion: 2,
    textbookId: 'geometry',
    task: '1',
    source: 'number',
    textbookEdition: '14-е издание, Просвещение, 2023',
    sourceUrl: '/textbooks/geometry-7-9-atanasyan.pdf',
    conditionNormalized: 'diagram-builder-fixture',
    subject: 'Геометрия',
    textbookTitle: 'Геометрия. 7-9 классы',
    condition,
    given: [],
    goal: { title: 'Построить', text: 'чертёж по условию' },
    steps,
    answer: '',
    diagram,
    sourceVerified: true,
    taskType: 'construction',
    quality: { diagramRequired: true, reviewPassed: true, symbolicShare: 1 },
    createdAt: '2026-08-30T09:00:00.000Z',
  }
  return validateSolutionQuality(solution)
}

function fieldSpan(scene: HomeworkDiagramScene) {
  const xs = scene.points.map((point) => point.x)
  const ys = scene.points.map((point) => point.y)
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
}

describe('построитель чертежа по плану', () => {
  it('равнобедренный треугольник с медианой к основанию', () => {
    const { scene, diagram } = build('Равнобедренный треугольник ABC, BM — медиана к основанию AC.', [
      { op: 'triangle-isosceles', names: ['A', 'B', 'C'], values: [60, 55] },
      { op: 'median', names: ['M'], args: ['A', 'B', 'C'] },
      { op: 'mark-right-angle', args: ['B', 'M', 'A'] },
    ])

    // Боковые стороны равны, медиана делит основание пополам и ему перпендикулярна.
    expect(span(scene, 'B', 'A')).toBeCloseTo(span(scene, 'B', 'C'), 6)
    expect(span(scene, 'A', 'M')).toBeCloseTo(span(scene, 'M', 'C'), 6)
    expect(span(scene, 'A', 'M') + span(scene, 'M', 'C')).toBeCloseTo(span(scene, 'A', 'C'), 6)
    expect(angle(scene, 'B', 'M', 'A')).toBeCloseTo(90, 4)
    // Отношение боковой к основанию сохранилось после масштабирования.
    expect(span(scene, 'B', 'A') / span(scene, 'A', 'C')).toBeCloseTo(55 / 60, 4)

    expect(qualityIssues(diagram, 'Постройте равнобедренный треугольник ABC и медиану BM к основанию AC.', ['△ABC: AB = BC; AM = MC; BM ⟂ AC.'])).toEqual([])
  })

  it('прямоугольный треугольник с высотой из прямого угла', () => {
    const { scene, diagram } = build('Прямоугольный треугольник ABC, BH — высота из прямого угла.', [
      { op: 'triangle-right', names: ['A', 'B', 'C'], values: [60, 45] },
      { op: 'altitude', names: ['H'], args: ['A', 'B', 'C'] },
    ])

    expect(angle(scene, 'A', 'B', 'C')).toBeCloseTo(90, 4)
    expect(angle(scene, 'B', 'H', 'A')).toBeCloseTo(90, 4)
    // H лежит между A и C.
    expect(span(scene, 'A', 'H') + span(scene, 'H', 'C')).toBeCloseTo(span(scene, 'A', 'C'), 4)
    // Школьное соотношение: BH² = AH · HC.
    expect(span(scene, 'B', 'H') ** 2).toBeCloseTo(span(scene, 'A', 'H') * span(scene, 'H', 'C'), 2)
    // И катет как среднее пропорциональное: AB² = AH · AC.
    expect(span(scene, 'A', 'B') ** 2).toBeCloseTo(span(scene, 'A', 'H') * span(scene, 'A', 'C'), 2)

    expect(qualityIssues(diagram, 'Постройте прямоугольный треугольник ABC и высоту BH из прямого угла.', ['△ABC: ∠B = 90°; BH ⟂ AC; BH² = AH · HC.'])).toEqual([])
  })

  it('параллелограмм с биссектрисой угла', () => {
    // Биссектриса угла A параллелограмма отсекает на стороне BC точку K,
    // причём BK = AB. Строим её как пересечение луча AP со стороной BC.
    const { scene, diagram } = build('Параллелограмм ABCD, AK — биссектриса угла A.', [
      { op: 'parallelogram', names: ['A', 'B', 'C', 'D'], values: [42, 62, 62] },
      { op: 'bisector', names: ['P'], args: ['B', 'A', 'D'], hidden: true },
      { op: 'intersection', names: ['K'], args: ['A', 'P', 'B', 'C'] },
      { op: 'segment', args: ['A', 'K'] },
    ])

    expect(skew(scene, 'A', 'B', 'D', 'C')).toBeLessThan(1e-6)
    expect(skew(scene, 'A', 'D', 'B', 'C')).toBeLessThan(1e-6)
    expect(span(scene, 'A', 'B')).toBeCloseTo(span(scene, 'D', 'C'), 6)
    // Биссектриса делит угол A пополам.
    expect(angle(scene, 'B', 'A', 'K')).toBeCloseTo(angle(scene, 'K', 'A', 'D'), 4)
    expect(angle(scene, 'B', 'A', 'D')).toBeCloseTo(62, 4)
    // Треугольник ABK равнобедренный: BK = AB.
    expect(span(scene, 'B', 'K')).toBeCloseTo(span(scene, 'A', 'B'), 4)

    expect(qualityIssues(diagram, 'Постройте параллелограмм ABCD и биссектрису угла A.', ['ABCD: AB ∥ DC, AD ∥ BC; ∠BAK = ∠KAD; BK = AB.'])).toEqual([])
  })

  it('ромб с диагоналями', () => {
    const { scene, diagram } = build('Ромб ABCD с диагоналями AC и BD.', [
      { op: 'rhombus', names: ['A', 'B', 'C', 'D'], values: [52, 62] },
      { op: 'segment', args: ['A', 'C'] },
      { op: 'segment', args: ['B', 'D'] },
      { op: 'intersection', names: ['O'], args: ['A', 'C', 'B', 'D'] },
      { op: 'mark-right-angle', args: ['A', 'O', 'B'] },
    ])

    const side = span(scene, 'A', 'B')
    for (const [from, to] of [['B', 'C'], ['C', 'D'], ['D', 'A']]) {
      expect(span(scene, from, to)).toBeCloseTo(side, 5)
    }
    // Диагонали ромба перпендикулярны и делятся точкой пересечения пополам.
    expect(angle(scene, 'A', 'O', 'B')).toBeCloseTo(90, 4)
    expect(span(scene, 'A', 'O')).toBeCloseTo(span(scene, 'O', 'C'), 5)
    expect(span(scene, 'B', 'O')).toBeCloseTo(span(scene, 'O', 'D'), 5)

    expect(qualityIssues(diagram, 'Постройте ромб ABCD и его диагонали.', ['ABCD: AB = BC = CD = DA; AC ⟂ BD; AO = OC, BO = OD.'])).toEqual([])
  })

  it('трапеция со средней линией', () => {
    const { scene, diagram } = build('Трапеция ABCD со средней линией MN.', [
      { op: 'trapezoid', names: ['A', 'B', 'C', 'D'], values: [72, 40, 42] },
      { op: 'midline', names: ['M', 'N'], args: ['A', 'B', 'C', 'D'] },
    ])

    expect(skew(scene, 'A', 'B', 'D', 'C')).toBeLessThan(1e-6)
    expect(skew(scene, 'M', 'N', 'A', 'B')).toBeLessThan(1e-6)
    // Средняя линия равна полусумме оснований.
    expect(span(scene, 'M', 'N')).toBeCloseTo((span(scene, 'A', 'B') + span(scene, 'D', 'C')) / 2, 4)
    expect(span(scene, 'A', 'M')).toBeCloseTo(span(scene, 'M', 'D'), 5)
    expect(span(scene, 'B', 'N')).toBeCloseTo(span(scene, 'N', 'C'), 5)
    expect(span(scene, 'A', 'B') / span(scene, 'D', 'C')).toBeCloseTo(72 / 40, 4)

    expect(qualityIssues(diagram, 'Постройте трапецию ABCD и её среднюю линию.', ['ABCD: AB ∥ DC; MN ∥ AB; MN = (AB + DC)/2.'])).toEqual([])
  })

  it('окружность с вписанным треугольником', () => {
    const { scene, diagram } = build('Треугольник ABC, вписанный в окружность с центром O.', [
      { op: 'triangle', names: ['A', 'B', 'C'], values: [52, 58, 70] },
      { op: 'circumcircle', names: ['O'], args: ['A', 'B', 'C'], auxiliary: true },
    ])

    const radius = span(scene, 'O', 'A')
    expect(span(scene, 'O', 'B')).toBeCloseTo(radius, 5)
    expect(span(scene, 'O', 'C')).toBeCloseTo(radius, 5)
    // Стороны сохранили заданные отношения.
    expect(span(scene, 'A', 'B') / span(scene, 'C', 'A')).toBeCloseTo(52 / 70, 4)
    expect(span(scene, 'B', 'C') / span(scene, 'C', 'A')).toBeCloseTo(58 / 70, 4)
    // Вся окружность помещается в поле чертежа.
    const center = at(scene, 'O')
    expect(center.x - radius).toBeGreaterThanOrEqual(0)
    expect(center.x + radius).toBeLessThanOrEqual(100)
    expect(center.y - radius).toBeGreaterThanOrEqual(0)
    expect(center.y + radius).toBeLessThanOrEqual(100)
    expect(scene.objects.some((object) => object.kind === 'circle')).toBe(true)

    expect(qualityIssues(diagram, 'Постройте треугольник ABC и описанную около него окружность.', ['△ABC ⊂ ⊙(O); OA = OB = OC = R.'])).toEqual([])
  })

  it('вписанная окружность касается стороны', () => {
    const { scene } = build('Треугольник ABC и вписанная окружность с центром I.', [
      { op: 'triangle', names: ['A', 'B', 'C'], values: [52, 58, 70] },
      { op: 'incircle', names: ['I'], args: ['A', 'B', 'C'], auxiliary: true },
    ])

    const touch = scene.points.find((point) => !point.visible)
    expect(touch).toBeDefined()
    if (!touch) return
    // Радиус в точку касания перпендикулярен стороне, а сама точка на стороне AB.
    expect(angle(scene, 'I', touch.id, 'A')).toBeCloseTo(90, 4)
    expect(span(scene, 'A', touch.id) + span(scene, touch.id, 'B')).toBeCloseTo(span(scene, 'A', 'B'), 4)
  })

  it('прямая, точка на отрезке и параллельная через точку', () => {
    const { scene, diagram } = build('Прямая a, точка M на отрезке AB и прямая b, параллельная a.', [
      { op: 'point', names: ['A'], values: [0, 0] },
      { op: 'point', names: ['B'], values: [80, 0] },
      { op: 'line', args: ['A', 'B'], label: 'a' },
      { op: 'point-on-segment', names: ['M'], args: ['A', 'B'], values: [0.35] },
      { op: 'point', names: ['R'], values: [26, 44] },
      { op: 'parallel', args: ['R', 'A', 'B'], label: 'b' },
    ])

    expect(span(scene, 'A', 'M') / span(scene, 'A', 'B')).toBeCloseTo(0.35, 5)
    expect(span(scene, 'A', 'M') + span(scene, 'M', 'B')).toBeCloseTo(span(scene, 'A', 'B'), 4)
    const parallelLine = scene.objects.find((object) => object.label === 'b')
    expect(parallelLine?.kind).toBe('line')
    const anchor = parallelLine?.points[1] ?? ''
    expect(scene.points.find((point) => point.id === anchor)?.visible).toBe(false)
    expect(skew(scene, 'R', anchor, 'A', 'B')).toBeLessThan(1e-6)

    expect(qualityIssues(diagram, 'Проведите прямую и постройте параллельную ей прямую через данную точку.', ['a ∥ b; M ∈ [AB]; AM : AB = 0,35.'])).toEqual([])
  })

  it('окружность по центру и радиусу пересекается с прямой', () => {
    const { scene, diagram } = build('Окружность с центром O радиуса R и секущая PQ.', [
      { op: 'point', names: ['O'], values: [0, 0] },
      { op: 'circle-radius', names: ['K'], args: ['O'], values: [40], hidden: true },
      { op: 'point', names: ['P'], values: [-70, 14] },
      { op: 'point', names: ['Q'], values: [70, 14] },
      { op: 'line', args: ['P', 'Q'] },
      { op: 'intersection-line-circle', names: ['X', 'Y'], args: ['P', 'Q', 'O', 'K'] },
    ])

    const radius = span(scene, 'O', 'K')
    expect(span(scene, 'O', 'X')).toBeCloseTo(radius, 4)
    expect(span(scene, 'O', 'Y')).toBeCloseTo(radius, 4)
    // X и Y лежат на прямой PQ.
    expect(skew(scene, 'P', 'Q', 'X', 'Y')).toBeLessThan(1e-6)

    expect(qualityIssues(diagram, 'Постройте окружность и её секущую.', ['⊙(O; R) ∩ PQ = {X, Y}; OX = OY = R.'])).toEqual([])
  })

  it('средняя линия треугольника и угол, отложенный по величине', () => {
    const { scene } = build('Треугольник со средней линией и отложенным углом.', [
      { op: 'point', names: ['A'], values: [0, 0] },
      { op: 'point', names: ['B'], values: [70, 0] },
      { op: 'point-at-angle', names: ['C'], args: ['B', 'A'], values: [40, 62] },
      { op: 'polygon', args: ['A', 'B', 'C'] },
      { op: 'mark-angle', args: ['B', 'A', 'C'], label: '40°' },
      { op: 'midline', names: ['M', 'N'], args: ['A', 'C', 'B'] },
    ])

    expect(angle(scene, 'B', 'A', 'C')).toBeCloseTo(40, 4)
    // Средняя линия соединяет середины AC и CB и вдвое короче AB.
    expect(skew(scene, 'M', 'N', 'A', 'B')).toBeLessThan(1e-6)
    expect(span(scene, 'M', 'N')).toBeCloseTo(span(scene, 'A', 'B') / 2, 4)
    expect(span(scene, 'A', 'M')).toBeCloseTo(span(scene, 'M', 'C'), 5)
  })

  it('фигура центрируется и занимает разумную часть поля', () => {
    const { scene } = build('Квадрат ABCD.', [
      { op: 'square', names: ['A', 'B', 'C', 'D'], values: [4] },
      { op: 'intersection', names: ['O'], args: ['A', 'C', 'B', 'D'] },
    ])

    // Маленький квадрат со стороной 4 масштабируется до почти всего поля.
    expect(fieldSpan(scene)).toBeGreaterThan(60)
    for (const point of scene.points) {
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(100)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(100)
    }
    // Центр фигуры совпадает с центром поля.
    expect(at(scene, 'O').x).toBeCloseTo(50, 4)
    expect(at(scene, 'O').y).toBeCloseTo(50, 4)
    // Точки не сливаются друг с другом.
    for (const point of scene.points) {
      for (const other of scene.points) {
        if (point.id === other.id) continue
        expect(Math.hypot(point.x - other.x, point.y - other.y)).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('противоречивый план отклоняется с внятной ошибкой', () => {
    const impossible = buildDiagram(plan('Треугольник с невозможными сторонами.', [
      { op: 'triangle', names: ['A', 'B', 'C'], values: [10, 10, 40] },
    ]))
    expect(impossible.ok).toBe(false)
    if (impossible.ok) return
    expect(impossible.errors.join(' ')).toContain('неравенство треугольника')

    const isosceles = buildDiagram(plan('Невозможный равнобедренный треугольник.', [
      { op: 'triangle-isosceles', names: ['A', 'B', 'C'], values: [80, 30] },
    ]))
    expect(isosceles.ok).toBe(false)

    const missing = buildDiagram(plan('Медиана без треугольника.', [
      { op: 'median', names: ['M'], args: ['A', 'B', 'C'] },
    ]))
    expect(missing.ok).toBe(false)
    if (missing.ok) return
    expect(missing.errors.join(' ')).toContain('ещё не построена')

    const parallels = buildDiagram(plan('Пересечение параллельных прямых.', [
      { op: 'parallelogram', names: ['A', 'B', 'C', 'D'] },
      { op: 'intersection', names: ['X'], args: ['A', 'B', 'D', 'C'] },
    ]))
    expect(parallels.ok).toBe(false)
    if (parallels.ok) return
    expect(parallels.errors.join(' ')).toContain('параллельны')

    const wrongAngle = buildDiagram(plan('Неверно подписанный угол.', [
      { op: 'triangle-equilateral', names: ['A', 'B', 'C'] },
      { op: 'mark-angle', args: ['A', 'B', 'C'], label: '45°' },
    ]))
    expect(wrongAngle.ok).toBe(false)
    if (wrongAngle.ok) return
    expect(wrongAngle.errors.join(' ')).toContain('60.0°')

    const collision = buildDiagram(plan('Две совпадающие точки.', [
      { op: 'triangle-isosceles', names: ['A', 'B', 'C'] },
      { op: 'median', names: ['M'], args: ['A', 'B', 'C'] },
      { op: 'altitude', names: ['H'], args: ['A', 'B', 'C'] },
    ]))
    expect(collision.ok).toBe(false)
    if (collision.ok) return
    expect(collision.errors.join(' ')).toContain('сливаются')
  })

  it('план модели разбирается защитно', () => {
    const result = buildDiagramFromModelPlan({
      description: 'Равносторонний треугольник ABC.',
      commands: [
        { op: 'triangle-equilateral', names: ['a', 'b', 'c'], args: [], values: [], label: '', auxiliary: false, hidden: false },
        { op: 'teleport', names: ['X'], args: [], values: [], label: '', auxiliary: false, hidden: false },
        { op: 'mark-equal', names: [], args: ['A', 'B', 'B', 'C'], values: [], label: '', auxiliary: false, hidden: false },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Строчные имена приводятся к заглавным, неизвестная команда отбрасывается.
    expect(result.scene.points.map((point) => point.id)).toEqual(['A', 'B', 'C'])
    expect(span(result.scene, 'A', 'B')).toBeCloseTo(span(result.scene, 'B', 'C'), 5)
    expect(span(result.scene, 'B', 'C')).toBeCloseTo(span(result.scene, 'C', 'A'), 5)
    expect(result.diagram.kind).toBe('construction')
    expect(result.diagram.description).toBe('Равносторонний треугольник ABC.')
  })
})
