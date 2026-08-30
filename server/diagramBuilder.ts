// Построитель чертежа по плану построения.
//
// Идея: модель описывает не координаты, а ПОРЯДОК ПОСТРОЕНИЯ («треугольник ABC
// равнобедренный», «M — середина AC», «BM — медиана»), а координаты вычисляет
// этот файл. Поэтому геометрические связи выполняются по построению, а не
// «случайно совпадают» — чертёж корректен by construction и проходит
// проверку constraintIssue из geometrySolutionEngine.ts.
//
// Формат результата — ровно тот HomeworkDiagramScene, который уже умеет рисовать
// GeometryNotebookLayoutV1. Ни формат сцены, ни рендерер здесь не меняются.

import type { HomeworkDiagram, HomeworkDiagramScene } from '../src/lib/homeworkContract.ts'

// ─── Язык построения ────────────────────────────────────────────────────────

export const diagramOps = [
  // точки
  'point',
  'point-at-angle',
  'point-on-segment',
  'point-on-line',
  'point-on-circle',
  'midpoint',
  // линии
  'segment',
  'line',
  'ray',
  'polyline',
  'polygon',
  // окружности
  'circle',
  'circle-radius',
  // треугольники
  'triangle',
  'triangle-isosceles',
  'triangle-right',
  'triangle-equilateral',
  // четырёхугольники
  'parallelogram',
  'rectangle',
  'square',
  'rhombus',
  'trapezoid',
  // замечательные линии
  'median',
  'bisector',
  'altitude',
  'perpendicular',
  'parallel',
  'midline',
  // пересечения
  'intersection',
  'intersection-line-circle',
  'intersection-circles',
  // окружности треугольника
  'incircle',
  'circumcircle',
  // пометки-утверждения (рисуются и проверяются численно)
  'mark-equal',
  'mark-parallel',
  'mark-right-angle',
  'mark-angle',
] as const

export type DiagramOp = typeof diagramOps[number]

export type DiagramCommand = {
  /** Операция построения. */
  op: DiagramOp
  /** Имена точек, которые команда создаёт. */
  names: string[]
  /** Имена уже построенных точек — аргументы команды. */
  args: string[]
  /** Числовые параметры: длины и углы в градусах. */
  values: number[]
  /** Подпись объекта на чертеже: «a» для прямой, «60°» для угла. */
  label: string
  /** Рисовать вспомогательной (тонкой) линией. */
  auxiliary: boolean
  /** Не подписывать созданные точки (технические точки построения). */
  hidden: boolean
}

export type DiagramPlan = {
  description: string
  commands: DiagramCommand[]
}

/** Справка по командам — идёт в системный промпт вместе со схемой. */
export const diagramPlanInstructions = [
  'План построения описывает, КАК построить чертёж. Координаты вычисляет сервер, поэтому их указывать не нужно.',
  'Каждая команда: op — операция, names — создаваемые точки, args — уже построенные точки, values — числа (длины и углы в градусах).',
  'Если values пустой, берутся школьные значения по умолчанию: чертёж всё равно верен, меняется только масштаб.',
  'Команды точек: point [P] (values пусты или [x, y] — подсказка положения); point-at-angle [C] ← args [A, B], values [угол, длина]: от луча BA поворот на угол против часовой стрелки и откладывание длины от B;',
  'point-on-segment [P] ← args [A, B], values [доля от A, 0<t<1]; point-on-line [P] ← args [A, B], values [t] (t<0 или t>1 — точка вне отрезка); midpoint [M] ← args [A, B]; point-on-circle [P] ← args [O, Q], values [угол].',
  'Команды линий: segment, line, ray ← args [A, B]; polyline, polygon ← args — цепочка точек. Подпись прямой задаётся полем label.',
  'Окружности: circle ← args [O, P] — центр O через точку P; circle-radius [P] ← args [O], values [радиус] — созданная точка P лежит на окружности, обычно hidden=true.',
  'Треугольники: triangle, triangle-isosceles, triangle-right, triangle-equilateral ← names [A, B, C]. Средняя буква — вершина: у равнобедренного при ней равные стороны BA = BC и основание AC, у прямоугольного при ней прямой угол.',
  'values треугольников: triangle [AB, BC, CA]; triangle-isosceles [основание AC, боковая сторона]; triangle-right [катет AB, катет BC]; triangle-equilateral [сторона].',
  'Четырёхугольники ← names [A, B, C, D] в порядке обхода: parallelogram [AB, AD, угол при A]; rectangle [AB, AD]; square [сторона]; rhombus [сторона, угол при A]; trapezoid [AB, DC, высота] — основания AB ∥ DC.',
  'Замечательные линии: median [M] ← args [A, B, C] — медиана из B к AC; bisector [D] ← args [A, B, C] — биссектриса угла ABC, D на AC; altitude [H] ← args [A, B, C] — высота из B к AC;',
  'perpendicular [H] ← args [P, A, B] — перпендикуляр из P к прямой AB; parallel [Q] ← args [P, A, B] — прямая через P параллельно AB, Q — техническая точка этой прямой;',
  'midline [M, N] ← args [A, B, C] — средняя линия треугольника, параллельная AC, или args [A, B, C, D] — средняя линия трапеции с основаниями AB ∥ DC.',
  'Пересечения: intersection [X] ← args [A, B, C, D] — прямые AB и CD; intersection-line-circle [X] или [X, Y] ← args [A, B, O, P]; intersection-circles [X] или [X, Y] ← args [O1, P1, O2, P2].',
  'Окружности треугольника: incircle [O] ← args [A, B, C] — вписанная; circumcircle [O] ← args [A, B, C] — описанная.',
  'Пометки: mark-equal ← args [A, B, C, D] (AB = CD); mark-parallel ← args [A, B, C, D]; mark-right-angle ← args [A, B, C] (прямой угол при B); mark-angle ← args [A, B, C] с подписью в label.',
  'Пометка — это утверждение: сервер проверяет её численно и отклоняет план, если она неверна.',
].join(' ')

/** Строгая схема для response_format — в том же стиле, что схемы движка. */
export const diagramPlanSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['description', 'commands'],
  properties: {
    description: { type: 'string', description: 'Короткое описание чертежа для подписи под рисунком.' },
    commands: {
      type: 'array',
      minItems: 1,
      maxItems: 32,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op', 'names', 'args', 'values', 'label', 'auxiliary', 'hidden'],
        properties: {
          op: { type: 'string', enum: [...diagramOps], description: 'Операция построения.' },
          names: {
            type: 'array',
            minItems: 0,
            maxItems: 4,
            items: { type: 'string' },
            description: 'Имена создаваемых точек, заглавными буквами: A, B, M, O.',
          },
          args: {
            type: 'array',
            minItems: 0,
            maxItems: 6,
            items: { type: 'string' },
            description: 'Имена уже построенных точек — аргументы команды.',
          },
          values: {
            type: 'array',
            minItems: 0,
            maxItems: 4,
            items: { type: 'number' },
            description: 'Числовые параметры: длины в условных единицах, углы в градусах. Можно оставить пустым.',
          },
          label: { type: 'string', description: 'Подпись объекта на чертеже, например «a» или «60°».' },
          auxiliary: { type: 'boolean', description: 'Вспомогательная линия построения.' },
          hidden: { type: 'boolean', description: 'Не подписывать созданные точки.' },
        },
      },
    },
  },
} as const

export type DiagramBuildResult =
  | { ok: true; diagram: HomeworkDiagram; scene: HomeworkDiagramScene }
  | { ok: false; errors: string[] }

// ─── Векторная арифметика ───────────────────────────────────────────────────

type Vec = { x: number; y: number }

const vec = (x: number, y: number): Vec => ({ x, y })
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y })
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y })
const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k })
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y
const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x
const length = (a: Vec) => Math.hypot(a.x, a.y)
const gap = (a: Vec, b: Vec) => Math.hypot(b.x - a.x, b.y - a.y)

function unit(a: Vec): Vec {
  const size = length(a)
  if (size === 0) throw new DiagramPlanError('вырожденное направление: точки совпадают')
  return { x: a.x / size, y: a.y / size }
}

/** Поворот против часовой стрелки во внутренней системе координат (ось y вверх). */
function rotate(a: Vec, degrees: number): Vec {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return { x: a.x * cos - a.y * sin, y: a.x * sin + a.y * cos }
}

function pointLineDistance(point: Vec, start: Vec, end: Vec) {
  const base = gap(start, end)
  return base > 0 ? Math.abs(cross(sub(end, start), sub(point, start))) / base : Number.POSITIVE_INFINITY
}

/** Основание перпендикуляра из point на прямую (start, end). */
function foot(point: Vec, start: Vec, end: Vec): Vec {
  const direction = sub(end, start)
  const square = dot(direction, direction)
  if (square === 0) throw new DiagramPlanError('вырожденная прямая: точки совпадают')
  return add(start, mul(direction, dot(sub(point, start), direction) / square))
}

function lineIntersection(a: Vec, b: Vec, c: Vec, d: Vec): Vec | null {
  const first = sub(b, a)
  const second = sub(d, c)
  const denominator = cross(first, second)
  const scale = length(first) * length(second)
  // Почти параллельные прямые дают численно неустойчивую точку далеко за полем.
  if (scale === 0 || Math.abs(denominator) / scale < 0.02) return null
  return add(a, mul(first, cross(sub(c, a), second) / denominator))
}

/** Корни пересечения прямой (a, b) с окружностью, упорядоченные по параметру вдоль ab. */
function lineCircleIntersection(a: Vec, b: Vec, center: Vec, radius: number): Vec[] {
  const direction = sub(b, a)
  const shift = sub(a, center)
  const quadratic = dot(direction, direction)
  const linear = 2 * dot(shift, direction)
  const constant = dot(shift, shift) - radius * radius
  const discriminant = linear * linear - 4 * quadratic * constant
  if (quadratic === 0 || discriminant < 0) return []
  const root = Math.sqrt(discriminant)
  const first = (-linear - root) / (2 * quadratic)
  const second = (-linear + root) / (2 * quadratic)
  if (root === 0) return [add(a, mul(direction, first))]
  return [add(a, mul(direction, first)), add(a, mul(direction, second))]
}

/** Пересечение двух окружностей: первая точка — слева от направления O₁→O₂. */
function circleIntersection(first: Vec, firstRadius: number, second: Vec, secondRadius: number): Vec[] {
  const between = sub(second, first)
  const span = length(between)
  if (span === 0 || span > firstRadius + secondRadius || span < Math.abs(firstRadius - secondRadius)) return []
  // Проекция точек пересечения на линию центров и полухорда, ей перпендикулярная.
  const projection = (firstRadius * firstRadius - secondRadius * secondRadius + span * span) / (2 * span)
  const halfChord = Math.sqrt(Math.max(0, firstRadius * firstRadius - projection * projection))
  const base = add(first, mul(between, projection / span))
  const normal = vec(-between.y / span, between.x / span)
  if (halfChord === 0) return [base]
  return [add(base, mul(normal, halfChord)), add(base, mul(normal, -halfChord))]
}

// ─── Поле чертежа и допуски ─────────────────────────────────────────────────

const fieldSize = 100
const fieldMargin = 8
// Движок отбраковывает чертёж, если две точки ближе 3. Держим запас.
const minimumPointGap = 3.5
// Допуски строже, чем в constraintIssue: если проходит здесь, пройдёт и там.
const tolerance = {
  collinear: 1,
  notCollinear: 6,
  between: 1.2,
  parallel: 0.03,
  equalLength: 0.03,
  midpoint: 1,
  onCircle: 0.03,
}

const sceneLimits = { points: 18, objects: 24, marks: 16, constraints: 24 }

class DiagramPlanError extends Error {}

// ─── Состояние построения ───────────────────────────────────────────────────

type SceneObject = HomeworkDiagramScene['objects'][number]
type SceneMark = HomeworkDiagramScene['marks'][number]
type SceneConstraint = HomeworkDiagramScene['constraints'][number]

type BuilderPoint = { id: string; position: Vec; visible: boolean }

/** Техническая точка, задающая направление прямой: её можно двигать вдоль прямой. */
type LineAnchor = { id: string; origin: Vec; direction: Vec }
/** Техническая точка на окружности: её можно двигать по окружности. */
type CircleAnchor = { id: string; center: Vec; radius: number }

type BuildState = {
  points: BuilderPoint[]
  index: Map<string, BuilderPoint>
  objects: SceneObject[]
  marks: SceneMark[]
  constraints: SceneConstraint[]
  lineAnchors: LineAnchor[]
  circleAnchors: CircleAnchor[]
  reserved: Set<string>
  freePlacements: number
}

const freePointPlacements: readonly Vec[] = [
  vec(0, 0), vec(60, 0), vec(60, 55), vec(0, 55), vec(30, 28),
  vec(85, 28), vec(30, 82), vec(-25, 28), vec(30, -25),
]

function normalizePointName(raw: string) {
  const upper = raw.trim().toLocaleUpperCase('ru-RU')
  const cleaned = [...upper].filter((symbol) => /[A-ZА-ЯЁ0-9₀-₉']/u.test(symbol)).join('').slice(0, 4)
  if (!/^[A-ZА-ЯЁ][A-ZА-ЯЁ0-9₀-₉']{0,3}$/u.test(cleaned)) {
    throw new DiagramPlanError(`недопустимое имя точки «${raw}»: нужна заглавная буква, например A или M₁`)
  }
  return cleaned
}

function definePoint(state: BuildState, raw: string, position: Vec, visible: boolean) {
  const id = normalizePointName(raw)
  if (state.index.has(id)) throw new DiagramPlanError(`точка ${id} определяется второй раз`)
  const point: BuilderPoint = { id, position, visible }
  state.points.push(point)
  state.index.set(id, point)
  return point
}

function readPoint(state: BuildState, raw: string) {
  const id = normalizePointName(raw)
  const point = state.index.get(id)
  if (!point) throw new DiagramPlanError(`точка ${id} ещё не построена`)
  return point
}

/** Свободный идентификатор для технической точки, не занятый планом. */
function technicalName(state: BuildState) {
  const subscripts = '₀₁₂₃₄₅₆₇₈₉'
  for (let index = 1; index < 40; index += 1) {
    const candidate = `T${[...String(index)].map((digit) => subscripts[Number(digit)]).join('')}`
    if (!state.index.has(candidate) && !state.reserved.has(candidate)) return candidate
  }
  throw new DiagramPlanError('не осталось свободных имён для технических точек')
}

function addObject(state: BuildState, object: SceneObject) {
  state.objects.push(object)
}

function addMark(state: BuildState, mark: SceneMark) {
  const key = `${mark.kind}:${mark.points.join(':')}`
  if (!state.marks.some((entry) => `${entry.kind}:${entry.points.join(':')}` === key)) state.marks.push(mark)
}

function addConstraint(state: BuildState, kind: SceneConstraint['kind'], points: string[]) {
  const key = `${kind}:${points.join(':')}`
  if (!state.constraints.some((entry) => `${entry.kind}:${entry.points.join(':')}` === key)) {
    state.constraints.push({ kind, points })
  }
}

// ─── Разбор аргументов команды ──────────────────────────────────────────────

function takeNames(command: DiagramCommand, count: number) {
  if (command.names.length < count) {
    throw new DiagramPlanError(`${command.op}: нужно ${count} имён создаваемых точек, дано ${command.names.length}`)
  }
  return command.names.slice(0, count)
}

function takeArgs(state: BuildState, command: DiagramCommand, count: number) {
  if (command.args.length < count) {
    throw new DiagramPlanError(`${command.op}: нужно ${count} точек-аргументов, дано ${command.args.length}`)
  }
  return command.args.slice(0, count).map((name) => readPoint(state, name))
}

/** values либо пуст (тогда школьные значения по умолчанию), либо задан целиком. */
function takeValues(command: DiagramCommand, fallback: readonly number[]) {
  if (command.values.length === 0) return [...fallback]
  if (command.values.length < fallback.length) {
    throw new DiagramPlanError(`${command.op}: нужно ${fallback.length} числовых параметров или ни одного`)
  }
  const values = command.values.slice(0, fallback.length)
  if (values.some((value) => !Number.isFinite(value))) throw new DiagramPlanError(`${command.op}: числовой параметр не число`)
  return values
}

function requirePositive(command: DiagramCommand, values: readonly number[], count: number) {
  for (let index = 0; index < count; index += 1) {
    if (values[index] <= 0) throw new DiagramPlanError(`${command.op}: длина должна быть больше нуля`)
  }
}

function requireAngle(command: DiagramCommand, angle: number) {
  if (angle <= 1 || angle >= 179) throw new DiagramPlanError(`${command.op}: угол ${angle}° невозможен в треугольнике или четырёхугольнике`)
}

// ─── Команды ────────────────────────────────────────────────────────────────

/**
 * Треугольник по трём сторонам: основание AC кладём на ось x, вершину B
 * находим как пересечение двух окружностей. x = (AB² − BC² + AC²) / (2·AC)
 * получается вычитанием уравнений |AB|² = x² + y² и |BC|² = (x − AC)² + y².
 */
function triangleBySides(ab: number, bc: number, ca: number): [Vec, Vec, Vec] {
  const sides = [ab, bc, ca]
  if (sides.some((side) => side <= 0)) throw new DiagramPlanError('triangle: сторона должна быть больше нуля')
  const perimeter = ab + bc + ca
  // Строгое неравенство треугольника с запасом: почти вырожденный треугольник
  // не пройдёт проверку not-collinear, поэтому отбраковываем сразу.
  for (const side of sides) {
    if (side >= (perimeter - side) * 0.985) {
      throw new DiagramPlanError(`triangle: стороны ${ab}, ${bc}, ${ca} не образуют треугольник (неравенство треугольника)`)
    }
  }
  const x = (ab * ab - bc * bc + ca * ca) / (2 * ca)
  const y = Math.sqrt(Math.max(0, ab * ab - x * x))
  return [vec(0, 0), vec(x, y), vec(ca, 0)]
}

function placeTriangle(state: BuildState, command: DiagramCommand, corners: [Vec, Vec, Vec]) {
  const [first, second, third] = takeNames(command, 3)
  const visible = !command.hidden
  const a = definePoint(state, first, corners[0], visible)
  const b = definePoint(state, second, corners[1], visible)
  const c = definePoint(state, third, corners[2], visible)
  addObject(state, { kind: 'polygon', points: [a.id, b.id, c.id], label: command.label, auxiliary: command.auxiliary })
  addConstraint(state, 'not-collinear', [a.id, b.id, c.id])
  return [a, b, c] as const
}

function placeQuadrilateral(state: BuildState, command: DiagramCommand, corners: readonly [Vec, Vec, Vec, Vec]) {
  const [first, second, third, fourth] = takeNames(command, 4)
  const visible = !command.hidden
  const a = definePoint(state, first, corners[0], visible)
  const b = definePoint(state, second, corners[1], visible)
  const c = definePoint(state, third, corners[2], visible)
  const d = definePoint(state, fourth, corners[3], visible)
  addObject(state, { kind: 'polygon', points: [a.id, b.id, c.id, d.id], label: command.label, auxiliary: command.auxiliary })
  return [a, b, c, d] as const
}

/** Углы параллелограмма ABCD: A в начале, B по оси x, D под углом α, C = B + D − A. */
function parallelogramCorners(side: number, other: number, angle: number): [Vec, Vec, Vec, Vec] {
  const a = vec(0, 0)
  const b = vec(side, 0)
  const d = mul(vec(Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)), other)
  return [a, b, add(b, d), d]
}

function addParallelogramConstraints(state: BuildState, ids: readonly [string, string, string, string]) {
  const [a, b, c, d] = ids
  addConstraint(state, 'parallel', [a, b, d, c])
  addConstraint(state, 'parallel', [a, d, b, c])
  addConstraint(state, 'equal-length', [a, b, d, c])
  addConstraint(state, 'equal-length', [a, d, b, c])
  addMark(state, { kind: 'parallel', points: [a, b, d, c], label: '' })
}

/** Если основание перпендикуляра вне отрезка, дорисовываем продолжение стороны. */
function extendBase(state: BuildState, start: BuilderPoint, end: BuilderPoint, footPoint: BuilderPoint) {
  const base = gap(start.position, end.position)
  const parameter = dot(sub(footPoint.position, start.position), sub(end.position, start.position)) / (base * base)
  if (parameter >= 0 && parameter <= 1) return
  const nearest = parameter < 0 ? start : end
  if (gap(nearest.position, footPoint.position) < base * 0.1) return
  addObject(state, { kind: 'segment', points: [nearest.id, footPoint.id], label: '', auxiliary: true })
}

function runCommand(state: BuildState, command: DiagramCommand) {
  const op = command.op
  const visible = !command.hidden

  if (op === 'point') {
    const [name] = takeNames(command, 1)
    const hint = command.values.length >= 2 ? vec(command.values[0], command.values[1]) : null
    const position = hint ?? freePointPlacements[state.freePlacements % freePointPlacements.length]
    if (!hint) state.freePlacements += 1
    definePoint(state, name, position, visible)
    return
  }

  if (op === 'point-at-angle') {
    const [name] = takeNames(command, 1)
    const [a, b] = takeArgs(state, command, 2)
    const [angle, distance] = takeValues(command, [60, 50])
    if (distance <= 0) throw new DiagramPlanError('point-at-angle: длина должна быть больше нуля')
    definePoint(state, name, add(b.position, mul(rotate(unit(sub(a.position, b.position)), angle), distance)), visible)
    return
  }

  if (op === 'point-on-segment' || op === 'point-on-line') {
    const [name] = takeNames(command, 1)
    const [a, b] = takeArgs(state, command, 2)
    const [ratio] = takeValues(command, [op === 'point-on-segment' ? 0.5 : 1.35])
    if (op === 'point-on-segment' && (ratio <= 0.02 || ratio >= 0.98)) {
      throw new DiagramPlanError('point-on-segment: доля должна лежать строго между 0 и 1')
    }
    const point = definePoint(state, name, add(a.position, mul(sub(b.position, a.position), ratio)), visible)
    addConstraint(state, 'collinear', [a.id, b.id, point.id])
    if (ratio > 0 && ratio < 1) addConstraint(state, 'between', [point.id, a.id, b.id])
    return
  }

  if (op === 'point-on-circle') {
    const [name] = takeNames(command, 1)
    const [center, through] = takeArgs(state, command, 2)
    const [angle] = takeValues(command, [50])
    if (gap(center.position, through.position) === 0) throw new DiagramPlanError('point-on-circle: вырожденная окружность')
    const point = definePoint(state, name, add(center.position, rotate(sub(through.position, center.position), angle)), visible)
    addConstraint(state, 'on-circle', [point.id, center.id, through.id])
    return
  }

  if (op === 'midpoint') {
    const [name] = takeNames(command, 1)
    const [a, b] = takeArgs(state, command, 2)
    const point = definePoint(state, name, mul(add(a.position, b.position), 0.5), visible)
    addConstraint(state, 'midpoint', [point.id, a.id, b.id])
    return
  }

  if (op === 'segment' || op === 'line' || op === 'ray') {
    const [a, b] = takeArgs(state, command, 2)
    addObject(state, { kind: op, points: [a.id, b.id], label: command.label, auxiliary: command.auxiliary })
    return
  }

  if (op === 'polyline' || op === 'polygon') {
    const minimum = op === 'polygon' ? 3 : 2
    if (command.args.length < minimum) throw new DiagramPlanError(`${op}: нужно не менее ${minimum} точек`)
    const chain = command.args.map((name) => readPoint(state, name).id)
    if (new Set(chain).size !== chain.length) throw new DiagramPlanError(`${op}: вершины повторяются`)
    addObject(state, { kind: op, points: chain, label: command.label, auxiliary: command.auxiliary })
    return
  }

  if (op === 'circle') {
    const [center, through] = takeArgs(state, command, 2)
    addObject(state, { kind: 'circle', points: [center.id, through.id], label: command.label, auxiliary: command.auxiliary })
    return
  }

  if (op === 'circle-radius') {
    const [center] = takeArgs(state, command, 1)
    const [radius] = takeValues(command, [35])
    if (radius <= 0) throw new DiagramPlanError('circle-radius: радиус должен быть больше нуля')
    const name = command.names[0] ?? technicalName(state)
    const anchor = definePoint(state, name, add(center.position, vec(radius, 0)), command.names.length > 0 && visible)
    state.circleAnchors.push({ id: anchor.id, center: center.position, radius })
    addObject(state, { kind: 'circle', points: [center.id, anchor.id], label: command.label, auxiliary: command.auxiliary })
    return
  }

  if (op === 'triangle') {
    const [ab, bc, ca] = takeValues(command, [52, 58, 70])
    placeTriangle(state, command, triangleBySides(ab, bc, ca))
    return
  }

  if (op === 'triangle-isosceles') {
    const [base, side] = takeValues(command, [60, 55])
    requirePositive(command, [base, side], 2)
    if (side <= base / 2) throw new DiagramPlanError(`triangle-isosceles: боковая сторона ${side} не больше половины основания ${base}`)
    const [a, b, c] = placeTriangle(state, command, triangleBySides(side, side, base))
    addConstraint(state, 'equal-length', [b.id, a.id, b.id, c.id])
    addMark(state, { kind: 'equal-segment', points: [b.id, a.id, b.id, c.id], label: '' })
    return
  }

  if (op === 'triangle-right') {
    const [firstLeg, secondLeg] = takeValues(command, [60, 45])
    requirePositive(command, [firstLeg, secondLeg], 2)
    // Прямой угол при B — второй вершине: B в начале, A по оси x, C по оси y.
    const [a, b, c] = placeTriangle(state, command, [vec(firstLeg, 0), vec(0, 0), vec(0, secondLeg)])
    addConstraint(state, 'perpendicular', [a.id, b.id, c.id, b.id])
    addMark(state, { kind: 'right-angle', points: [a.id, b.id, c.id], label: '' })
    return
  }

  if (op === 'triangle-equilateral') {
    const [side] = takeValues(command, [62])
    requirePositive(command, [side], 1)
    const [a, b, c] = placeTriangle(state, command, triangleBySides(side, side, side))
    addConstraint(state, 'equal-length', [a.id, b.id, b.id, c.id])
    addConstraint(state, 'equal-length', [b.id, c.id, c.id, a.id])
    addMark(state, { kind: 'equal-segment', points: [a.id, b.id, b.id, c.id], label: '' })
    return
  }

  if (op === 'parallelogram' || op === 'rectangle' || op === 'square' || op === 'rhombus') {
    const defaults = op === 'parallelogram'
      ? [62, 42, 62]
      : op === 'rectangle' ? [64, 42, 90] : op === 'square' ? [54, 54, 90] : [52, 52, 62]
    const raw = command.values.length === 0
      ? defaults
      : op === 'square'
        ? [command.values[0], command.values[0], 90]
        : op === 'rectangle'
          ? [command.values[0], command.values[1] ?? command.values[0], 90]
          : op === 'rhombus'
            ? [command.values[0], command.values[0], command.values[1] ?? defaults[2]]
            : [command.values[0], command.values[1] ?? defaults[1], command.values[2] ?? defaults[2]]
    const [side, other, angle] = raw
    if (!Number.isFinite(side) || !Number.isFinite(other) || !Number.isFinite(angle)) {
      throw new DiagramPlanError(`${op}: не хватает числовых параметров`)
    }
    requirePositive(command, [side, other], 2)
    requireAngle(command, angle)
    const [a, b, c, d] = placeQuadrilateral(state, command, parallelogramCorners(side, other, angle))
    const ids = [a.id, b.id, c.id, d.id] as const
    addParallelogramConstraints(state, ids)
    if (op === 'rectangle' || op === 'square') {
      addConstraint(state, 'perpendicular', [b.id, a.id, d.id, a.id])
      addMark(state, { kind: 'right-angle', points: [b.id, a.id, d.id], label: '' })
    }
    if (op === 'square' || op === 'rhombus') {
      addConstraint(state, 'equal-length', [a.id, b.id, b.id, c.id])
      addMark(state, { kind: 'equal-segment', points: [a.id, b.id, b.id, c.id], label: '' })
    }
    return
  }

  if (op === 'trapezoid') {
    const [lower, upper, height] = takeValues(command, [72, 40, 42])
    requirePositive(command, [lower, upper, height], 3)
    if (Math.abs(lower - upper) < Math.max(lower, upper) * 0.1) {
      throw new DiagramPlanError(`trapezoid: основания ${lower} и ${upper} почти равны — это параллелограмм, а не трапеция`)
    }
    // Смещение верхнего основания выбрано так, чтобы трапеция оставалась
    // выпуклой и при этом не выглядела равнобедренной по умолчанию.
    const shift = (lower - upper) * 0.35
    const corners: [Vec, Vec, Vec, Vec] = [vec(0, 0), vec(lower, 0), vec(shift + upper, height), vec(shift, height)]
    const [a, b, c, d] = placeQuadrilateral(state, command, corners)
    addConstraint(state, 'parallel', [a.id, b.id, d.id, c.id])
    addMark(state, { kind: 'parallel', points: [a.id, b.id, d.id, c.id], label: '' })
    return
  }

  if (op === 'median') {
    const [name] = takeNames(command, 1)
    const [a, b, c] = takeArgs(state, command, 3)
    const middle = definePoint(state, name, mul(add(a.position, c.position), 0.5), visible)
    addObject(state, { kind: 'segment', points: [b.id, middle.id], label: command.label, auxiliary: command.auxiliary })
    addConstraint(state, 'midpoint', [middle.id, a.id, c.id])
    addMark(state, { kind: 'equal-segment', points: [a.id, middle.id, middle.id, c.id], label: '' })
    return
  }

  if (op === 'bisector') {
    const [name] = takeNames(command, 1)
    const [a, b, c] = takeArgs(state, command, 3)
    const toA = gap(b.position, a.position)
    const toC = gap(b.position, c.position)
    if (toA === 0 || toC === 0) throw new DiagramPlanError('bisector: стороны угла вырождены')
    // Биссектриса делит противоположную сторону в отношении прилежащих сторон.
    const share = toA / (toA + toC)
    const point = definePoint(state, name, add(a.position, mul(sub(c.position, a.position), share)), visible)
    addObject(state, { kind: 'segment', points: [b.id, point.id], label: command.label, auxiliary: command.auxiliary })
    addConstraint(state, 'between', [point.id, a.id, c.id])
    addMark(state, { kind: 'angle', points: [a.id, b.id, point.id], label: '' })
    addMark(state, { kind: 'angle', points: [point.id, b.id, c.id], label: '' })
    return
  }

  if (op === 'altitude' || op === 'perpendicular') {
    const [name] = takeNames(command, 1)
    const [apex, start, end] = takeArgs(state, command, 3)
    // altitude: args = [A, B, C], высота из B к AC. perpendicular: args = [P, A, B].
    const [from, lineStart, lineEnd] = op === 'altitude' ? [start, apex, end] : [apex, start, end]
    const base = definePoint(state, name, foot(from.position, lineStart.position, lineEnd.position), visible)
    addObject(state, { kind: 'segment', points: [from.id, base.id], label: command.label, auxiliary: command.auxiliary })
    addConstraint(state, 'perpendicular', [from.id, base.id, lineStart.id, lineEnd.id])
    addConstraint(state, 'collinear', [lineStart.id, lineEnd.id, base.id])
    addMark(state, { kind: 'right-angle', points: [from.id, base.id, lineStart.id], label: '' })
    extendBase(state, lineStart, lineEnd, base)
    return
  }

  if (op === 'parallel') {
    const [through, start, end] = takeArgs(state, command, 3)
    const direction = sub(end.position, start.position)
    const name = command.names[0] ?? technicalName(state)
    const anchor = definePoint(state, name, add(through.position, direction), command.names.length > 0 && visible)
    state.lineAnchors.push({ id: anchor.id, origin: through.position, direction })
    addObject(state, { kind: 'line', points: [through.id, anchor.id], label: command.label, auxiliary: command.auxiliary })
    addConstraint(state, 'parallel', [through.id, anchor.id, start.id, end.id])
    addMark(state, { kind: 'parallel', points: [through.id, anchor.id, start.id, end.id], label: '' })
    return
  }

  if (op === 'midline') {
    const [firstName, secondName] = takeNames(command, 2)
    if (command.args.length >= 4) {
      // Трапеция ABCD с основаниями AB ∥ DC: средняя линия соединяет середины боковых сторон.
      const [a, b, c, d] = takeArgs(state, command, 4)
      const first = definePoint(state, firstName, mul(add(a.position, d.position), 0.5), visible)
      const second = definePoint(state, secondName, mul(add(b.position, c.position), 0.5), visible)
      addObject(state, { kind: 'segment', points: [first.id, second.id], label: command.label, auxiliary: command.auxiliary })
      addConstraint(state, 'midpoint', [first.id, a.id, d.id])
      addConstraint(state, 'midpoint', [second.id, b.id, c.id])
      addConstraint(state, 'parallel', [first.id, second.id, a.id, b.id])
      return
    }
    // Треугольник ABC: средняя линия соединяет середины AB и BC и параллельна AC.
    const [a, b, c] = takeArgs(state, command, 3)
    const first = definePoint(state, firstName, mul(add(a.position, b.position), 0.5), visible)
    const second = definePoint(state, secondName, mul(add(b.position, c.position), 0.5), visible)
    addObject(state, { kind: 'segment', points: [first.id, second.id], label: command.label, auxiliary: command.auxiliary })
    addConstraint(state, 'midpoint', [first.id, a.id, b.id])
    addConstraint(state, 'midpoint', [second.id, b.id, c.id])
    addConstraint(state, 'parallel', [first.id, second.id, a.id, c.id])
    return
  }

  if (op === 'intersection') {
    const [name] = takeNames(command, 1)
    const [a, b, c, d] = takeArgs(state, command, 4)
    const crossing = lineIntersection(a.position, b.position, c.position, d.position)
    if (!crossing) throw new DiagramPlanError(`intersection: прямые ${a.id}${b.id} и ${c.id}${d.id} параллельны и не пересекаются`)
    const point = definePoint(state, name, crossing, visible)
    addConstraint(state, 'collinear', [a.id, b.id, point.id])
    addConstraint(state, 'collinear', [c.id, d.id, point.id])
    return
  }

  if (op === 'intersection-line-circle') {
    const wanted = takeNames(command, 1).length === 1 ? Math.min(command.names.length, 2) : 1
    const [a, b, center, through] = takeArgs(state, command, 4)
    const radius = gap(center.position, through.position)
    const roots = lineCircleIntersection(a.position, b.position, center.position, radius)
    if (roots.length < wanted) {
      throw new DiagramPlanError(`intersection-line-circle: прямая ${a.id}${b.id} и окружность с центром ${center.id} не дают ${wanted} общих точек`)
    }
    command.names.slice(0, wanted).forEach((name, position) => {
      const point = definePoint(state, name, roots[position], visible)
      addConstraint(state, 'collinear', [a.id, b.id, point.id])
      addConstraint(state, 'on-circle', [point.id, center.id, through.id])
    })
    return
  }

  if (op === 'intersection-circles') {
    const wanted = takeNames(command, 1).length === 1 ? Math.min(command.names.length, 2) : 1
    const [firstCenter, firstThrough, secondCenter, secondThrough] = takeArgs(state, command, 4)
    const roots = circleIntersection(
      firstCenter.position,
      gap(firstCenter.position, firstThrough.position),
      secondCenter.position,
      gap(secondCenter.position, secondThrough.position),
    )
    if (roots.length < wanted) {
      throw new DiagramPlanError(`intersection-circles: окружности с центрами ${firstCenter.id} и ${secondCenter.id} не дают ${wanted} общих точек`)
    }
    command.names.slice(0, wanted).forEach((name, position) => {
      const point = definePoint(state, name, roots[position], visible)
      addConstraint(state, 'on-circle', [point.id, firstCenter.id, firstThrough.id])
      addConstraint(state, 'on-circle', [point.id, secondCenter.id, secondThrough.id])
    })
    return
  }

  if (op === 'incircle') {
    const [name] = takeNames(command, 1)
    const [a, b, c] = takeArgs(state, command, 3)
    // Центр вписанной окружности — среднее вершин с весами, равными
    // длинам противолежащих сторон.
    const sideA = gap(b.position, c.position)
    const sideB = gap(c.position, a.position)
    const sideC = gap(a.position, b.position)
    const perimeter = sideA + sideB + sideC
    if (perimeter === 0) throw new DiagramPlanError('incircle: треугольник вырожден')
    const center = mul(add(add(mul(a.position, sideA), mul(b.position, sideB)), mul(c.position, sideC)), 1 / perimeter)
    const centerPoint = definePoint(state, name, center, visible)
    const touch = definePoint(state, command.names[1] ?? technicalName(state), foot(center, a.position, b.position), command.names.length > 1 && visible)
    addObject(state, { kind: 'circle', points: [centerPoint.id, touch.id], label: command.label, auxiliary: command.auxiliary })
    addConstraint(state, 'collinear', [a.id, b.id, touch.id])
    addConstraint(state, 'perpendicular', [centerPoint.id, touch.id, a.id, b.id])
    return
  }

  if (op === 'circumcircle') {
    const [name] = takeNames(command, 1)
    const [a, b, c] = takeArgs(state, command, 3)
    // Центр описанной окружности — пересечение серединных перпендикуляров.
    const firstMiddle = mul(add(a.position, b.position), 0.5)
    const secondMiddle = mul(add(b.position, c.position), 0.5)
    const firstNormal = rotate(sub(b.position, a.position), 90)
    const secondNormal = rotate(sub(c.position, b.position), 90)
    const center = lineIntersection(firstMiddle, add(firstMiddle, firstNormal), secondMiddle, add(secondMiddle, secondNormal))
    if (!center) throw new DiagramPlanError(`circumcircle: точки ${a.id}, ${b.id}, ${c.id} лежат на одной прямой`)
    const centerPoint = definePoint(state, name, center, visible)
    addObject(state, { kind: 'circle', points: [centerPoint.id, a.id], label: command.label, auxiliary: command.auxiliary })
    addConstraint(state, 'on-circle', [b.id, centerPoint.id, a.id])
    addConstraint(state, 'on-circle', [c.id, centerPoint.id, a.id])
    return
  }

  if (op === 'mark-equal') {
    const [a, b, c, d] = takeArgs(state, command, 4)
    addMark(state, { kind: 'equal-segment', points: [a.id, b.id, c.id, d.id], label: command.label })
    addConstraint(state, 'equal-length', [a.id, b.id, c.id, d.id])
    return
  }

  if (op === 'mark-parallel') {
    const [a, b, c, d] = takeArgs(state, command, 4)
    addMark(state, { kind: 'parallel', points: [a.id, b.id, c.id, d.id], label: command.label })
    addConstraint(state, 'parallel', [a.id, b.id, c.id, d.id])
    return
  }

  if (op === 'mark-right-angle') {
    const [a, b, c] = takeArgs(state, command, 3)
    addMark(state, { kind: 'right-angle', points: [a.id, b.id, c.id], label: command.label })
    addConstraint(state, 'perpendicular', [a.id, b.id, c.id, b.id])
    return
  }

  if (op === 'mark-angle') {
    const [a, b, c] = takeArgs(state, command, 3)
    const declared = command.label.match(/^(\d+(?:[.,]\d+)?)\s*°?$/u)
    if (declared) {
      // Числовая подпись угла — тоже утверждение: сверяем её с построением.
      const measured = angleBetween(a.position, b.position, c.position)
      const expected = Number(declared[1].replace(',', '.'))
      if (!Number.isFinite(measured) || Math.abs(measured - expected) > 1) {
        throw new DiagramPlanError(`mark-angle: угол ${a.id}${b.id}${c.id} равен ${measured.toFixed(1)}°, а подписан как ${expected}°`)
      }
    }
    addMark(state, { kind: 'angle', points: [a.id, b.id, c.id], label: command.label })
    return
  }

  // Все операции разобраны выше: op здесь имеет тип never.
  throw new DiagramPlanError(`неизвестная операция ${String(op)}`)
}

function angleBetween(first: Vec, vertex: Vec, second: Vec) {
  const left = sub(first, vertex)
  const right = sub(second, vertex)
  const scale = length(left) * length(right)
  if (scale === 0) return Number.NaN
  return (Math.acos(Math.min(1, Math.max(-1, dot(left, right) / scale))) * 180) / Math.PI
}

// ─── Размещение на поле 0..100 ──────────────────────────────────────────────

/** Технические точки можно двигать вдоль своей прямой или окружности — разводим их от остальных. */
function relocateAnchors(state: BuildState) {
  for (const anchor of state.lineAnchors) {
    const point = state.index.get(anchor.id)
    if (!point) continue
    const others = state.points.filter((entry) => entry.id !== anchor.id)
    const candidates = [1, -1, 0.7, -0.7, 1.3, -1.3].map((factor) => add(anchor.origin, mul(anchor.direction, factor)))
    point.position = bestSeparated(candidates, others)
  }
  for (const anchor of state.circleAnchors) {
    const point = state.index.get(anchor.id)
    if (!point) continue
    const others = state.points.filter((entry) => entry.id !== anchor.id)
    const candidates = Array.from({ length: 12 }, (_, step) => add(anchor.center, rotate(vec(anchor.radius, 0), step * 30)))
    point.position = bestSeparated(candidates, others)
  }
}

function bestSeparated(candidates: readonly Vec[], others: readonly BuilderPoint[]) {
  let best = candidates[0]
  let bestGap = -1
  for (const candidate of candidates) {
    const nearest = others.reduce((minimum, other) => Math.min(minimum, gap(candidate, other.position)), Number.POSITIVE_INFINITY)
    if (nearest > bestGap) {
      bestGap = nearest
      best = candidate
    }
  }
  return best
}

/**
 * Единый масштаб и центрирование: фигура занимает почти всё поле, но не выходит
 * за его границы. Ось y переворачивается — во внутренних формулах она смотрит
 * вверх, а в сцене растёт вниз, как в SVG. Отражение сохраняет длины, углы,
 * параллельность и середины, поэтому все связи остаются верными.
 */
function fitToField(state: BuildState) {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  const extend = (position: Vec, radius: number) => {
    minX = Math.min(minX, position.x - radius)
    minY = Math.min(minY, position.y - radius)
    maxX = Math.max(maxX, position.x + radius)
    maxY = Math.max(maxY, position.y + radius)
  }
  for (const point of state.points) extend(point.position, 0)
  for (const object of state.objects) {
    if (object.kind !== 'circle') continue
    const center = state.index.get(object.points[0])
    const through = state.index.get(object.points[1])
    if (center && through) extend(center.position, gap(center.position, through.position))
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) throw new DiagramPlanError('план не построил ни одной точки')

  const drawable = fieldSize - fieldMargin * 2
  const width = Math.max(maxX - minX, 1e-6)
  const height = Math.max(maxY - minY, 1e-6)
  const scale = Math.min(drawable / width, drawable / height)
  const offsetX = fieldSize / 2 - ((minX + maxX) / 2) * scale
  const offsetY = fieldSize / 2 - ((minY + maxY) / 2) * scale
  // Округление до шести знаков: JSON остаётся читаемым, а погрешность (1e-6 на
  // поле 100) на порядки меньше допусков constraintIssue.
  const round = (value: number) => Math.round(value * 1e6) / 1e6
  for (const point of state.points) {
    point.position = {
      x: round(point.position.x * scale + offsetX),
      // Переворот оси y: внутри вверх, в сцене вниз.
      y: round(fieldSize - (point.position.y * scale + offsetY)),
    }
  }
}

// ─── Проверка результата ────────────────────────────────────────────────────

/** Повторяет constraintIssue движка, но с более строгими допусками. */
function constraintIssue(constraint: SceneConstraint, positions: Map<string, Vec>) {
  const resolved = constraint.points.map((id) => positions.get(id))
  if (resolved.some((point) => !point)) return `${constraint.kind}: ссылка на отсутствующую точку`
  const p = resolved as Vec[]
  const names = constraint.points.join('')

  if (constraint.kind === 'collinear') {
    return p.slice(2).every((point) => pointLineDistance(point, p[0], p[1]) <= tolerance.collinear)
      ? '' : `collinear ${names}: точки не лежат на одной прямой`
  }
  if (constraint.kind === 'not-collinear' || constraint.kind === 'not-on-line') {
    const [first, second, third] = constraint.kind === 'not-collinear' ? [p[2], p[0], p[1]] : [p[0], p[1], p[2]]
    return pointLineDistance(first, second, third) >= tolerance.notCollinear
      ? '' : `${constraint.kind} ${names}: точки почти на одной прямой, чертёж вырожден`
  }
  if (constraint.kind === 'between') {
    const error = Math.abs(gap(p[1], p[0]) + gap(p[0], p[2]) - gap(p[1], p[2]))
    return pointLineDistance(p[0], p[1], p[2]) <= tolerance.collinear && error <= tolerance.between
      ? '' : `between ${names}: точка не лежит между концами отрезка`
  }
  if (constraint.kind === 'parallel' || constraint.kind === 'perpendicular') {
    const first = sub(p[1], p[0])
    const second = sub(p[3], p[2])
    const scale = length(first) * length(second)
    if (scale === 0) return `${constraint.kind} ${names}: вырожденная прямая`
    const value = Math.abs(constraint.kind === 'parallel' ? cross(first, second) : dot(first, second)) / scale
    return value <= tolerance.parallel ? '' : `${constraint.kind} ${names}: связь не выполняется`
  }
  if (constraint.kind === 'equal-length') {
    const first = gap(p[0], p[1])
    const second = gap(p[2], p[3])
    return Math.abs(first - second) / Math.max(first, second, 1) <= tolerance.equalLength
      ? '' : `equal-length ${names}: отрезки разной длины`
  }
  if (constraint.kind === 'midpoint') {
    return gap(p[0], mul(add(p[1], p[2]), 0.5)) <= tolerance.midpoint ? '' : `midpoint ${names}: точка не середина отрезка`
  }
  if (constraint.kind === 'on-circle') {
    const radius = gap(p[2], p[1])
    return Math.abs(gap(p[0], p[1]) - radius) / Math.max(radius, 1) <= tolerance.onCircle
      ? '' : `on-circle ${names}: точка не лежит на окружности`
  }
  return ''
}

function verifyScene(state: BuildState) {
  const issues: string[] = []
  const positions = new Map(state.points.map((point) => [point.id, point.position]))

  if (state.points.length < 2) issues.push('на чертеже меньше двух точек')
  if (state.objects.length === 0) issues.push('на чертеже нет ни одного объекта')
  if (state.points.length > sceneLimits.points) issues.push(`на чертеже ${state.points.length} точек, допустимо не больше ${sceneLimits.points}`)
  if (state.objects.length > sceneLimits.objects) issues.push(`на чертеже ${state.objects.length} объектов, допустимо не больше ${sceneLimits.objects}`)

  for (const point of state.points) {
    if (!Number.isFinite(point.position.x) || !Number.isFinite(point.position.y)) {
      issues.push(`точка ${point.id}: координаты не вычислились`)
      continue
    }
    if (point.position.x < 0 || point.position.x > fieldSize || point.position.y < 0 || point.position.y > fieldSize) {
      issues.push(`точка ${point.id} вышла за поле чертежа`)
    }
  }

  for (let index = 0; index < state.points.length; index += 1) {
    for (let other = index + 1; other < state.points.length; other += 1) {
      const first = state.points[index]
      const second = state.points[other]
      if (gap(first.position, second.position) < minimumPointGap) {
        issues.push(`точки ${first.id} и ${second.id} на чертеже сливаются`)
      }
    }
  }

  for (const object of state.objects) {
    if (object.points.some((id) => !positions.has(id))) issues.push(`${object.kind}: ссылка на отсутствующую точку`)
  }

  for (const constraint of state.constraints) {
    const issue = constraintIssue(constraint, positions)
    if (issue) issues.push(issue)
  }

  return [...new Set(issues)]
}

// ─── Точка входа ────────────────────────────────────────────────────────────

function describeScene(description: string, state: BuildState) {
  const trimmed = description.trim().slice(0, 240)
  if (trimmed.length >= 8) return trimmed
  const visible = state.points.filter((point) => point.visible).map((point) => point.id)
  return visible.length > 0 ? `Чертёж: точки ${visible.join(', ')}.` : 'Чертёж по плану построения.'
}

/**
 * Исполняет план построения и возвращает готовую сцену.
 * Никогда не бросает: противоречивый план возвращается как { ok: false, errors }.
 */
export function buildDiagram(plan: DiagramPlan): DiagramBuildResult {
  const state: BuildState = {
    points: [],
    index: new Map(),
    objects: [],
    marks: [],
    constraints: [],
    lineAnchors: [],
    circleAnchors: [],
    reserved: new Set(),
    freePlacements: 0,
  }

  if (plan.commands.length === 0) return { ok: false, errors: ['план построения пуст'] }

  // Имена, которые план собирается занять: технические точки их не трогают.
  for (const command of plan.commands) {
    for (const name of command.names) {
      try {
        state.reserved.add(normalizePointName(name))
      } catch {
        // Некорректное имя всплывёт при исполнении команды с понятной ошибкой.
      }
    }
  }

  try {
    for (const [position, command] of plan.commands.entries()) {
      try {
        runCommand(state, command)
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'неизвестная ошибка'
        throw new DiagramPlanError(`шаг ${position + 1} (${command.op}): ${reason}`)
      }
    }
    relocateAnchors(state)
    fitToField(state)
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : 'план построения не исполнился'] }
  }

  const issues = verifyScene(state)
  if (issues.length > 0) return { ok: false, errors: issues }

  const scene: HomeworkDiagramScene = {
    points: state.points.map((point) => ({
      id: point.id,
      label: point.visible ? point.id : '',
      x: point.position.x,
      y: point.position.y,
      visible: point.visible,
    })),
    objects: state.objects,
    marks: state.marks.slice(0, sceneLimits.marks),
    constraints: state.constraints.slice(0, sceneLimits.constraints),
  }

  return {
    ok: true,
    scene,
    diagram: {
      kind: 'construction',
      description: describeScene(plan.description, state),
      vertices: state.points.filter((point) => point.visible).map((point) => point.id),
      scene,
    },
  }
}

function stringList(value: unknown, limit: number) {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim().slice(0, 24) : ''))
    .filter(Boolean)
    .slice(0, limit)
}

function numberList(value: unknown, limit: number) {
  if (!Array.isArray(value)) return []
  return value.map((entry) => Number(entry)).filter((entry) => Number.isFinite(entry)).slice(0, limit)
}

/** Защитный разбор ответа модели: неизвестные команды отбрасываются. */
export function normalizeDiagramPlan(value: unknown): DiagramPlan {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const rawCommands = Array.isArray(candidate.commands) ? candidate.commands : []

  return {
    description: typeof candidate.description === 'string' ? candidate.description.trim().slice(0, 240) : '',
    commands: rawCommands.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      const command = entry as Record<string, unknown>
      const op = diagramOps.find((item) => item === command.op)
      if (!op) return []
      return [{
        op,
        names: stringList(command.names, 4),
        args: stringList(command.args, 6),
        values: numberList(command.values, 4),
        label: typeof command.label === 'string' ? command.label.trim().slice(0, 12) : '',
        auxiliary: command.auxiliary === true,
        hidden: command.hidden === true,
      }]
    }).slice(0, 32),
  }
}

/** Разбор ответа модели и построение одним вызовом. */
export function buildDiagramFromModelPlan(value: unknown): DiagramBuildResult {
  return buildDiagram(normalizeDiagramPlan(value))
}
