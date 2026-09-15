import type { HomeworkDiagram, HomeworkDiagramScene } from '../src/lib/homeworkContract.ts'

/* Чертёж стоит так, как его чертят в тетради.

   Аудит 15 сентября 2026: равнобедренный треугольник ABC с основанием AC
   пришёл вершиной B вниз - «стоит на конусе». Ось y локального поля сцены
   направлена вниз (0 - верх, 100 - низ), а модель считала её математической
   и поставила вершину на y = 90. Ответ верный, чертёж вверх ногами.

   Просить модель «ставь фигуру прямо» промпт просил и до этого. Промпт -
   просьба; здесь правило: если условие называет основание, код сам кладёт
   его горизонтально и вниз, а вершину поднимает над ним. Поворот и
   отражение не меняют ни одной связи между точками, поэтому constraints
   и marks остаются верными.

   Заодно чертёж получает школьные значки, которых модель не поставила:
   у равнобедренного треугольника равные боковые стороны отмечают
   штрихами, равные углы при основании - дугами. Значки сверяются с
   координатами той же проверкой, что и остальные: чертёж, где помеченные
   равными углы нарисованы разными, перерисовывается по плану. */

type Vec = { x: number; y: number }

export type NamedFigure = {
  kind: 'isosceles' | 'trapezoid'
  vertices: string[]
  /** Основания: у треугольника одно, у трапеции два. Первая буква - левый конец. */
  bases: Array<[string, string]>
  /** Вершина равнобедренного треугольника, противоположная основанию. */
  apex?: string
}

const fieldSize = 100
const fieldMargin = 8
const horizontalTolerance = 0.03

/* Фигура с названным основанием.

   Читаем условие, а не чертёж: «равнобедренный треугольник ABC с
   основанием AC», «в равнобедренном треугольнике ABC AB = BC», «трапеция
   ABCD с основаниями AD и BC». Без названного основания ориентировать
   нечего - тогда чертёж остаётся таким, каким его отдала модель. */
export function namedFigure(condition: string): NamedFigure | null {
  const text = condition.replace(/\s+/gu, ' ')

  const isosceles = text.match(/[Рр]авнобедренн\p{L}*\s+(?:треугольник\p{L}*\s+)?([A-Z]{3})(?![A-Z])/u)
  if (isosceles) {
    const vertices = [...isosceles[1]]
    const tail = text.slice((isosceles.index ?? 0) + isosceles[0].length).split(/[.;]/u)[0]
    const named = tail.match(/основани\p{L}*\s+([A-Z])([A-Z])(?![A-Z])/u)
    const sides = tail.match(/(?<![A-Z])([A-Z])([A-Z])\s*=\s*([A-Z])([A-Z])(?![A-Z])/u)
    let base: [string, string] | null = null
    if (named) base = [named[1], named[2]]
    else if (sides) {
      const first = [sides[1], sides[2]]
      const second = [sides[3], sides[4]]
      const shared = first.find((letter) => second.includes(letter))
      if (shared) {
        const ends = [...first, ...second].filter((letter) => letter !== shared)
        if (ends.length === 2) base = [ends[0], ends[1]]
      }
    }
    if (base && base.every((letter) => vertices.includes(letter))) {
      const apex = vertices.find((letter) => !base.includes(letter))
      if (apex) return { kind: 'isosceles', vertices, bases: [base], apex }
    }
  }

  const trapezoid = text.match(/[Тт]рапеци\p{L}*\s+([A-Z]{4})(?![A-Z])[^.;]*?основани\p{L}*\s+([A-Z])([A-Z])\s+и\s+([A-Z])([A-Z])(?![A-Z])/u)
  if (trapezoid) {
    const vertices = [...trapezoid[1]]
    const bases: Array<[string, string]> = [[trapezoid[2], trapezoid[3]], [trapezoid[4], trapezoid[5]]]
    if (bases.flat().every((letter) => vertices.includes(letter))) return { kind: 'trapezoid', vertices, bases }
  }

  return null
}

function findPoint(scene: HomeworkDiagramScene, letter: string) {
  return scene.points.find((point) => point.id === letter)
    ?? scene.points.find((point) => point.label === letter)
    ?? null
}

function rotate(point: Vec, angle: number): Vec {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos }
}

/* Точки вписываются в поле заново: после поворота они уходят за 0..100.
   Масштаб общий по обеим осям - иначе прямой угол перестанет быть прямым. */
function fitToField(points: readonly Vec[]): Vec[] {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const width = Math.max(maxX - minX, 1e-6)
  const height = Math.max(maxY - minY, 1e-6)
  const scale = (fieldSize - fieldMargin * 2) / Math.max(width, height)
  const offsetX = fieldSize / 2 - ((minX + maxX) / 2) * scale
  const offsetY = fieldSize / 2 - ((minY + maxY) / 2) * scale
  const round = (value: number) => Math.round(value * 100) / 100
  return points.map((point) => ({
    x: round(point.x * scale + offsetX),
    y: round(point.y * scale + offsetY),
  }))
}

/* Поворачивает и отражает сцену так, чтобы основание лежало горизонтально
   внизу, а противоположная вершина (у трапеции - второе основание) была
   над ним. Сцена без названного основания или с осями возвращается как есть. */
export function orientScene(scene: HomeworkDiagramScene, figure: NamedFigure | null): HomeworkDiagramScene {
  if (!figure || scene.axes || scene.points.length < 3) return scene

  const resolved = figure.bases
    .map((base) => ({ base, start: findPoint(scene, base[0]), end: findPoint(scene, base[1]) }))
    .filter((entry): entry is { base: [string, string]; start: NonNullable<ReturnType<typeof findPoint>>; end: NonNullable<ReturnType<typeof findPoint>> } => Boolean(entry.start && entry.end))
  if (resolved.length === 0) return scene

  // У трапеции внизу лежит большее основание.
  const bottom = resolved.reduce((longest, entry) => (
    Math.hypot(entry.end.x - entry.start.x, entry.end.y - entry.start.y)
      > Math.hypot(longest.end.x - longest.start.x, longest.end.y - longest.start.y)
      ? entry
      : longest
  ))

  const apex = figure.kind === 'isosceles' && figure.apex ? findPoint(scene, figure.apex) : null
  const other = resolved.find((entry) => entry !== bottom)
  const above: Vec | null = apex
    ? { x: apex.x, y: apex.y }
    : other
      ? { x: (other.start.x + other.end.x) / 2, y: (other.start.y + other.end.y) / 2 }
      : null
  if (!above) return scene

  const angle = Math.atan2(bottom.end.y - bottom.start.y, bottom.end.x - bottom.start.x)
  const needsRotation = Math.abs(Math.sin(angle)) > horizontalTolerance || Math.cos(angle) < 0
  const turn = (point: Vec): Vec => (needsRotation ? rotate(point, -angle) : { x: point.x, y: point.y })
  const rotated = scene.points.map(turn)
  const baseY = (turn(bottom.start).y + turn(bottom.end).y) / 2
  // Ось y смотрит вниз: вершина «над» основанием - это меньший y.
  const needsFlip = turn(above).y > baseY
  if (!needsRotation && !needsFlip) return scene

  const oriented = fitToField(rotated.map((point) => (needsFlip ? { x: point.x, y: -point.y } : point)))
  return {
    ...scene,
    points: scene.points.map((point, position) => ({ ...point, ...oriented[position] })),
  }
}

function sameSides(left: readonly string[], right: readonly string[]) {
  const pairs = (points: readonly string[]) => {
    const result: string[] = []
    for (let index = 0; index + 1 < points.length; index += 2) result.push([points[index], points[index + 1]].sort().join(''))
    return result.sort().join('|')
  }
  return pairs(left) === pairs(right)
}

/* Значки равнобедренного треугольника: штрихи на боковых сторонах и дуги
   на углах при основании. Ставятся только там, где модель их не поставила. */
export function withIsoscelesMarks(scene: HomeworkDiagramScene, figure: NamedFigure | null): HomeworkDiagramScene {
  if (!figure || figure.kind !== 'isosceles' || !figure.apex || scene.axes) return scene
  const [left, right] = figure.bases[0]
  const apex = findPoint(scene, figure.apex)
  const start = findPoint(scene, left)
  const end = findPoint(scene, right)
  if (!apex || !start || !end) return scene

  const sides = [apex.id, start.id, apex.id, end.id]
  const hasSides = scene.marks.some((mark) => mark.kind === 'equal-segment' && mark.points.length === 4 && sameSides(mark.points, sides))
  const hasAngles = scene.marks.some((mark) => mark.kind === 'equal-angle'
    && mark.points.length === 6
    && [mark.points[1], mark.points[4]].sort().join('') === [start.id, end.id].sort().join(''))

  const marks = [...scene.marks]
  if (!hasSides) marks.push({ kind: 'equal-segment', points: sides, label: '' })
  if (!hasAngles) marks.push({ kind: 'equal-angle', points: [apex.id, start.id, end.id, apex.id, end.id, start.id], label: '' })
  return marks.length === scene.marks.length ? scene : { ...scene, marks }
}

/** Чертёж по условию: основание вниз, вершина вверх, школьные значки на месте. */
export function orientDiagram(diagram: HomeworkDiagram, condition: string): HomeworkDiagram {
  if (diagram.kind !== 'construction' || !diagram.scene) return diagram
  const figure = namedFigure(condition)
  if (!figure) return diagram
  const scene = withIsoscelesMarks(orientScene(diagram.scene, figure), figure)
  return scene === diagram.scene ? diagram : { ...diagram, scene }
}
