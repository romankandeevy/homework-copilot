import type { HomeworkSchematic } from '../../lib/homeworkContract'
import { geometryNotebookLayoutV1 as layout } from '../layouts/geometryNotebookLayoutV1'
import { keyed } from '../../lib/listKeys'
import { LabelLayout, labelRect, placementScore } from './labelLayout'
import type { Anchor, Segment } from './labelLayout'

/* Схема из условных обозначений.

   Физика и химия чертят не координаты, а знаки: резистор - прямоугольник,
   лампа - кружок с крестом, линза - отрезок со стрелками, колба - колба.
   Модель выбирает знак из библиотеки и ставит его в поле 0..100; сам
   значок рисует лист, одинаково у всех задач. Поле то же, что у
   геометрической сцены, поэтому картинка ложится в ту же зону листа. */

const sceneLayout = layout.zones.diagram.scene
const labelMargin = 24

type Element = HomeworkSchematic['elements'][number]

/* Схема вписывается в поле по своим границам, как и геометрическая сцена.

   7 сентября первая схема с прода: модель поставила цепь в квадрат
   30..70, и при проекции всего поля 0..100 значки вышли с горошину, а
   подписи - крупнее самой цепи. Теперь масштаб берётся по занятому
   прямоугольнику с запасом под значки, минимальный размах не даёт
   одному элементу растянуться на весь лист. */
const minimumSpan = 40

function projection(elements: readonly Element[]) {
  const drawableWidth = sceneLayout.width - (sceneLayout.padding + labelMargin) * 2
  const drawableHeight = sceneLayout.height - (sceneLayout.padding + labelMargin) * 2
  const centerX = sceneLayout.x + sceneLayout.width / 2
  const centerY = sceneLayout.y + sceneLayout.height / 2
  const reach = (element: Element) => Math.max(symbolSize, element.length) / 2
  const xs = elements.flatMap((element) => [element.x - reach(element), element.x + reach(element)])
  const ys = elements.flatMap((element) => [element.y - reach(element), element.y + reach(element)])
  const minX = xs.length > 0 ? Math.min(...xs) : 0
  const maxX = xs.length > 0 ? Math.max(...xs) : 100
  const minY = ys.length > 0 ? Math.min(...ys) : 0
  const maxY = ys.length > 0 ? Math.max(...ys) : 100
  const spanX = Math.max(maxX - minX, minimumSpan)
  const spanY = Math.max(maxY - minY, minimumSpan)
  const scale = Math.min(drawableWidth / spanX, drawableHeight / spanY)
  const localCenterX = (minX + maxX) / 2
  const localCenterY = (minY + maxY) / 2
  return {
    scale,
    x: (value: number) => centerX + (value - localCenterX) * scale,
    y: (value: number) => centerY + (value - localCenterY) * scale,
  }
}

type Projection = ReturnType<typeof projection>

/* Размер значка в единицах поля: элемент занимает квадрат 10×10, длинные
   элементы (vector, ray, incline, rope, tube) тянутся на length. */
const symbolSize = 13

const hatchLayout = layout.zones.diagram.hatch

/* Штриховка опоры, стены и зеркала - одна на всех.

   Копий было три - у ground, wall и mirror, - и каждая считала по-своему:
   шаг 0,35 против 0,3 от значка, начало с полушага против начала с нуля,
   наклон в разные стороны. На проде 7 сентября штриховка рельсов в задаче
   про электромагнитную индукцию вышла вразнобой именно поэтому.

   Штрихи идут по отрезку от `from` к `to` с равным шагом и одинаковым
   наклоном к нему: сторона задаётся знаком `side`. */
function hatchPaths(args: {
  from: { x: number; y: number }
  to: { x: number; y: number }
  size: number
  side: 1 | -1
}) {
  const { from, to, size, side } = args
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  if (length === 0) return []
  const direction = { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
  const normal = { x: -direction.y * side, y: direction.x * side }
  const strokes = Math.max(hatchLayout.minimumStrokes, Math.round(length / (size * hatchLayout.stepRatio)))
  const step = length / strokes
  const reach = size * hatchLayout.lengthRatio
  return Array.from({ length: strokes }, (_, index) => {
    const at = (index + 0.5) * step
    const base = { x: from.x + direction.x * at, y: from.y + direction.y * at }
    // Штрих уходит назад по отрезку и в сторону: так штрихуют опору в тетради.
    const tip = {
      x: base.x + (normal.x - direction.x) * reach,
      y: base.y + (normal.y - direction.y) * reach,
    }
    return `M ${base.x.toFixed(2)} ${base.y.toFixed(2)} L ${tip.x.toFixed(2)} ${tip.y.toFixed(2)}`
  })
}

function Hatch({ from, to, size, side }: {
  from: { x: number; y: number }
  to: { x: number; y: number }
  size: number
  side: 1 | -1
}) {
  return <>
    {keyed(hatchPaths({ from, to, size, side }), (path) => path)
      .map(({ key, item: path }) => <path className="diagram-mark" d={path} key={key} />)}
  </>
}

function Symbol({ element, scale }: { element: Element; scale: number }) {
  const s = symbolSize * scale
  const half = s / 2
  const length = Math.max(element.length, symbolSize) * scale
  const stroke = 'diagram-line'
  switch (element.symbol) {
    case 'battery':
      return <>
        <path className={stroke} d={`M ${-half} 0 L ${-s * 0.12} 0 M ${s * 0.12} 0 L ${half} 0`} />
        <path className={stroke} d={`M ${-s * 0.12} ${-half * 0.9} L ${-s * 0.12} ${half * 0.9}`} />
        <path className="diagram-mark" d={`M ${s * 0.12} ${-half * 0.45} L ${s * 0.12} ${half * 0.45}`} />
      </>
    case 'resistor':
      return <>
        <path className={stroke} d={`M ${-half} 0 L ${-half * 0.7} 0 M ${half * 0.7} 0 L ${half} 0`} />
        <rect className={stroke} x={-half * 0.7} y={-half * 0.35} width={s * 0.7} height={s * 0.35} />
      </>
    case 'lamp':
      return <>
        <path className={stroke} d={`M ${-half} 0 L ${-half * 0.5} 0 M ${half * 0.5} 0 L ${half} 0`} />
        <circle className={stroke} r={half * 0.5} />
        <path className="diagram-mark" d={`M ${-half * 0.35} ${-half * 0.35} L ${half * 0.35} ${half * 0.35} M ${-half * 0.35} ${half * 0.35} L ${half * 0.35} ${-half * 0.35}`} />
      </>
    case 'switch':
      return <>
        <path className={stroke} d={`M ${-half} 0 L ${-half * 0.5} 0 M ${half * 0.5} 0 L ${half} 0`} />
        <path className={stroke} d={`M ${-half * 0.5} 0 L ${half * 0.45} ${-half * 0.55}`} />
        <circle className="diagram-point" cx={-half * 0.5} r={2.5} />
        <circle className="diagram-point" cx={half * 0.5} r={2.5} />
      </>
    case 'ammeter':
    case 'voltmeter':
      return <>
        <path className={stroke} d={`M ${-half} 0 L ${-half * 0.55} 0 M ${half * 0.55} 0 L ${half} 0`} />
        <circle className={stroke} r={half * 0.55} />
        <text className="diagram-angle-label" textAnchor="middle" dominantBaseline="central">{element.symbol === 'ammeter' ? 'A' : 'V'}</text>
      </>
    case 'capacitor':
      return <>
        <path className={stroke} d={`M ${-half} 0 L ${-s * 0.1} 0 M ${s * 0.1} 0 L ${half} 0`} />
        <path className={stroke} d={`M ${-s * 0.1} ${-half * 0.6} L ${-s * 0.1} ${half * 0.6} M ${s * 0.1} ${-half * 0.6} L ${s * 0.1} ${half * 0.6}`} />
      </>
    case 'bell':
      return <>
        <path className={stroke} d={`M ${-half} 0 L ${-half * 0.5} 0 M ${half * 0.5} 0 L ${half} 0`} />
        <path className={stroke} d={`M ${-half * 0.5} ${half * 0.3} A ${half * 0.5} ${half * 0.5} 0 0 1 ${half * 0.5} ${half * 0.3} Z`} />
      </>
    case 'motor':
      return <>
        <path className={stroke} d={`M ${-half} 0 L ${-half * 0.55} 0 M ${half * 0.55} 0 L ${half} 0`} />
        <circle className={stroke} r={half * 0.55} />
        <text className="diagram-angle-label" textAnchor="middle" dominantBaseline="central">M</text>
      </>
    case 'node':
      return <circle className="diagram-point" r={3.5} />
    case 'body':
      return <rect className={stroke} x={-half * 0.7} y={-half * 0.7} width={s * 0.7} height={s * 0.7} />
    case 'ground':
      return <>
        <path className={stroke} d={`M ${-length / 2} 0 L ${length / 2} 0`} />
        <Hatch from={{ x: -length / 2, y: 0 }} to={{ x: length / 2, y: 0 }} size={s} side={1} />
      </>
    case 'wall':
      return <>
        <path className={stroke} d={`M 0 ${-length / 2} L 0 ${length / 2}`} />
        <Hatch from={{ x: 0, y: -length / 2 }} to={{ x: 0, y: length / 2 }} size={s} side={1} />
      </>
    case 'incline':
      return <path className={stroke} d={`M ${-length / 2} ${half * 0.6} L ${length / 2} ${half * 0.6} L ${length / 2} ${-length * 0.45} Z`} />
    case 'spring': {
      const coils = 6
      const step = length / (coils * 2)
      const path = Array.from({ length: coils * 2 + 1 }, (_, index) => `${index === 0 ? 'M' : 'L'} ${-length / 2 + index * step} ${index % 2 === 0 ? 0 : (index % 4 === 1 ? -half * 0.4 : half * 0.4)}`).join(' ')
      return <path className={stroke} d={path} />
    }
    case 'pulley':
      return <>
        <circle className={stroke} r={half * 0.7} />
        <circle className="diagram-point" r={2.5} />
      </>
    case 'rope':
    case 'tube':
      return <path className={element.symbol === 'tube' ? stroke : 'diagram-mark'} d={`M ${-length / 2} 0 L ${length / 2} 0`} />
    case 'vector':
    case 'ray':
    case 'arrow':
      return <>
        <path className={element.symbol === 'ray' ? 'diagram-mark' : stroke} d={`M 0 0 L ${length} 0`} />
        <path className={stroke} d={`M ${length - s * 0.35} ${-s * 0.18} L ${length} 0 L ${length - s * 0.35} ${s * 0.18}`} />
      </>
    case 'object-arrow':
      return <>
        <path className={stroke} d={`M 0 0 L 0 ${-length}`} />
        <path className={stroke} d={`M ${-s * 0.18} ${-length + s * 0.35} L 0 ${-length} L ${s * 0.18} ${-length + s * 0.35}`} />
      </>
    case 'lens-converging':
      return <>
        <path className={stroke} d={`M 0 ${-length / 2} L 0 ${length / 2}`} />
        <path className={stroke} d={`M ${-s * 0.2} ${-length / 2 + s * 0.35} L 0 ${-length / 2} L ${s * 0.2} ${-length / 2 + s * 0.35}`} />
        <path className={stroke} d={`M ${-s * 0.2} ${length / 2 - s * 0.35} L 0 ${length / 2} L ${s * 0.2} ${length / 2 - s * 0.35}`} />
      </>
    case 'lens-diverging':
      return <>
        <path className={stroke} d={`M 0 ${-length / 2} L 0 ${length / 2}`} />
        <path className={stroke} d={`M ${-s * 0.2} ${-length / 2 - s * 0.35} L 0 ${-length / 2} L ${s * 0.2} ${-length / 2 - s * 0.35}`} />
        <path className={stroke} d={`M ${-s * 0.2} ${length / 2 + s * 0.35} L 0 ${length / 2} L ${s * 0.2} ${length / 2 + s * 0.35}`} />
      </>
    case 'mirror':
      return <>
        <path className={stroke} d={`M 0 ${-length / 2} L 0 ${length / 2}`} />
        <Hatch from={{ x: 0, y: -length / 2 }} to={{ x: 0, y: length / 2 }} size={s} side={-1} />
      </>
    case 'prism':
      return <path className={stroke} d={`M ${-half * 0.8} ${half * 0.7} L ${half * 0.8} ${half * 0.7} L 0 ${-half * 0.7} Z`} />
    case 'eye':
      return <>
        <path className={stroke} d={`M ${-half * 0.8} 0 Q 0 ${-half * 0.7} ${half * 0.8} 0 Q 0 ${half * 0.7} ${-half * 0.8} 0`} />
        <circle className="diagram-point" r={half * 0.22} />
      </>
    case 'beaker':
      return <path className={stroke} d={`M ${-half * 0.6} ${-half * 0.8} L ${-half * 0.6} ${half * 0.8} L ${half * 0.6} ${half * 0.8} L ${half * 0.6} ${-half * 0.8} M ${-half * 0.6} ${half * 0.2} L ${half * 0.6} ${half * 0.2}`} />
    case 'flask':
      return <path className={stroke} d={`M ${-half * 0.2} ${-half * 0.9} L ${-half * 0.2} ${-half * 0.2} L ${-half * 0.8} ${half * 0.8} L ${half * 0.8} ${half * 0.8} L ${half * 0.2} ${-half * 0.2} L ${half * 0.2} ${-half * 0.9} Z M ${-half * 0.55} ${half * 0.35} L ${half * 0.55} ${half * 0.35}`} />
    case 'test-tube':
      return <path className={stroke} d={`M ${-half * 0.25} ${-half * 0.9} L ${-half * 0.25} ${half * 0.6} A ${half * 0.25} ${half * 0.25} 0 0 0 ${half * 0.25} ${half * 0.6} L ${half * 0.25} ${-half * 0.9} M ${-half * 0.25} ${half * 0.1} L ${half * 0.25} ${half * 0.1}`} />
    case 'burner':
      return <>
        <path className={stroke} d={`M ${-half * 0.5} ${half * 0.9} L ${half * 0.5} ${half * 0.9} L ${half * 0.2} ${half * 0.2} L ${-half * 0.2} ${half * 0.2} Z`} />
        <path className="diagram-mark" d={`M ${-half * 0.3} ${half * 0.2} Q 0 ${-half * 0.9} ${half * 0.3} ${half * 0.2}`} />
      </>
    case 'gas-bubbles':
      return <>
        <circle className="diagram-mark" cx={-half * 0.3} cy={half * 0.2} r={half * 0.15} />
        <circle className="diagram-mark" cx={half * 0.2} cy={-half * 0.2} r={half * 0.2} />
        <circle className="diagram-mark" cx={-half * 0.1} cy={-half * 0.6} r={half * 0.12} />
      </>
    case 'funnel':
      return <path className={stroke} d={`M ${-half * 0.8} ${-half * 0.8} L ${half * 0.8} ${-half * 0.8} L ${half * 0.15} ${half * 0.1} L ${half * 0.15} ${half * 0.9} L ${-half * 0.15} ${half * 0.9} L ${-half * 0.15} ${half * 0.1} Z`} />
    case 'thermometer':
      return <>
        <path className={stroke} d={`M ${-half * 0.15} ${-half * 0.9} L ${-half * 0.15} ${half * 0.4} M ${half * 0.15} ${-half * 0.9} L ${half * 0.15} ${half * 0.4}`} />
        <circle className={stroke} cy={half * 0.6} r={half * 0.3} />
      </>
    case 'text':
      return null
    default:
      return null
  }
}

/* Куда ставить подпись элемента.

   Подпись примеряется с четырёх сторон значка и встаёт туда, где дальше
   всего от других элементов, проводов и уже поставленных подписей:
   на первой схеме с прода «R₁ = 4 Ом» и «R₂ = 6 Ом» легли одна на
   другую, а «U = 20 В» - поверх провода. */
type Spot = { x: number; y: number; anchor: Anchor }

const labelFontSize = Math.round(layout.typography.bodySize * 0.72)
const labelClearance = 26

function labelPlacement(
  element: Element,
  at: { x: number; y: number },
  scale: number,
  others: readonly { x: number; y: number }[],
  wires: readonly Segment[],
  labels: LabelLayout,
): Spot {
  const size = symbolSize * scale
  if (element.symbol === 'text') return { x: at.x, y: at.y, anchor: 'middle' }

  /* Подпись стрелки стоит у её острия и уходит вбок от самой стрелки.

     Смещение раньше считалось как «cos по обеим осям»: по вертикали это
     давало сдвиг вдоль стрелки вместо сдвига поперёк неё, и «F_A» садилась
     на собственное древко. Поперечное направление - это нормаль
     (-sin; cos), её и берём. */
  if (element.symbol === 'vector' || element.symbol === 'ray' || element.symbol === 'arrow') {
    const angle = (element.rotation * Math.PI) / 180
    const along = { x: Math.cos(angle), y: Math.sin(angle) }
    const across = { x: -Math.sin(angle), y: Math.cos(angle) }
    const tip = { x: at.x + along.x * element.length * scale, y: at.y + along.y * element.length * scale }
    const candidates: Spot[] = [1, -1].flatMap((side) => [8, 20].map((reach) => ({
      x: tip.x + along.x * 8 + across.x * reach * side,
      y: tip.y + along.y * 8 + across.y * reach * side + labelFontSize * 0.35,
      anchor: 'middle' as const,
    })))
    return bestSpot(candidates, element.label, others, wires, labels, at)
  }

  const candidates: Spot[] = [
    { x: at.x, y: at.y - size * 0.75, anchor: 'middle' },
    { x: at.x, y: at.y + size * 0.75 + 14, anchor: 'middle' },
    { x: at.x + size * 0.7, y: at.y + 5, anchor: 'start' },
    { x: at.x - size * 0.7, y: at.y + 5, anchor: 'end' },
  ]
  return bestSpot(candidates, element.label, others, wires, labels, at)
}

/* Лучшее из примеренных мест.

   Считает тот же счёт, что и геометрическая сцена: подпись занимает
   прямоугольник по своей длине, наложение на чужую подпись весит тяжелее
   близости к проводу. Наружу от схемы - предпочтительно: подпись резистора
   на верхней стороне контура пишут над проводом, а не внутри рамки. */
function bestSpot(
  candidates: readonly Spot[],
  label: string,
  others: readonly { x: number; y: number }[],
  wires: readonly Segment[],
  labels: LabelLayout,
  at: { x: number; y: number },
): Spot {
  const center = others.length > 0
    ? { x: others.reduce((sum, other) => sum + other.x, 0) / others.length, y: others.reduce((sum, other) => sum + other.y, 0) / others.length }
    : at
  const fromCenter = Math.hypot(at.x - center.x, at.y - center.y)

  let best = candidates[0]
  let bestScore = -Infinity
  for (const spot of candidates) {
    const rect = labelRect(spot.x, spot.y, label, labelFontSize, spot.anchor)
    const outward = Math.hypot(spot.x - center.x, spot.y - center.y) > fromCenter ? labelClearance : 0
    const score = placementScore({ rect, layout: labels, edges: wires, points: others, clearance: labelClearance }) + outward
    if (score > bestScore) {
      bestScore = score
      best = spot
    }
  }
  return best
}

/* Двухполюсник ложится вдоль своего провода.

   Источник на левой стороне контура модель отдала с rotation=0, и его
   пластины легли поперёк вертикального провода. Если оба соседа элемента
   по проводам стоят с ним на одной вертикали, значок поворачивается сам. */
const twoTerminal = new Set(['battery', 'resistor', 'lamp', 'switch', 'ammeter', 'voltmeter', 'capacitor', 'bell', 'motor'])

function orientedRotation(element: Element, schematic: HomeworkSchematic, elements: Map<string, Element>) {
  if (!twoTerminal.has(element.symbol)) return element.rotation
  const neighbours = schematic.connections
    .filter((connection) => connection.from === element.id || connection.to === element.id)
    .map((connection) => elements.get(connection.from === element.id ? connection.to : connection.from))
    .filter((neighbour): neighbour is Element => Boolean(neighbour))
  if (neighbours.length === 0) return element.rotation
  const vertical = neighbours.every((neighbour) => Math.abs(neighbour.x - element.x) < 3)
  const horizontal = neighbours.every((neighbour) => Math.abs(neighbour.y - element.y) < 3)
  if (vertical && !horizontal) return 90
  if (horizontal && !vertical) return 0
  return element.rotation
}

/* Провод идёт под прямыми углами: сначала по горизонтали, потом по
   вертикали, как чертят цепь в тетради. Прямая и пунктир - напрямую. */
function connectionPath(from: Element, to: Element, kind: 'wire' | 'line' | 'dashed', project: Projection) {
  const start = { x: project.x(from.x), y: project.y(from.y) }
  const end = { x: project.x(to.x), y: project.y(to.y) }
  if (kind !== 'wire' || Math.abs(start.x - end.x) < 1 || Math.abs(start.y - end.y) < 1) {
    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`
  }
  return `M ${start.x} ${start.y} L ${end.x} ${start.y} L ${end.x} ${end.y}`
}

export function SchematicScene({ schematic, description }: { schematic: HomeworkSchematic; description: string }) {
  const project = projection(schematic.elements)
  const elements = new Map(schematic.elements.map((element) => [element.id, element]))
  const centers = schematic.elements.map((element) => ({ id: element.id, x: project.x(element.x), y: project.y(element.y) }))
  const wires: Segment[] = schematic.connections.flatMap((connection) => {
    const from = elements.get(connection.from)
    const to = elements.get(connection.to)
    if (!from || !to) return []
    const start = { x: project.x(from.x), y: project.y(from.y) }
    const end = { x: project.x(to.x), y: project.y(to.y) }
    if (connection.kind !== 'wire') return [[start, end] as Segment]
    const corner = { x: end.x, y: start.y }
    return [[start, corner] as Segment, [corner, end] as Segment]
  })

  /* Стрелка выходит из тела, к которому приложена.

     Раньше она рисовалась от собственной точки, и модель ставила эту точку
     подальше от тела - иначе проверка схемы ругалась на наложение. На проде
     7 сентября так и вышло: F_A и m·g висели рядом со стержнем, ни на что
     не опираясь. */
  const originOf = (element: Element) => {
    const anchor = element.anchor ? elements.get(element.anchor) : undefined
    const at = anchor ?? element
    return { x: project.x(at.x), y: project.y(at.y) }
  }

  /* Раскладка считается до отрисовки: подписи проводов места не выбирают -
     они привязаны к середине провода, - поэтому занимают его первыми. */
  const labels = new LabelLayout()
  for (const connection of schematic.connections) {
    const from = elements.get(connection.from)
    const to = elements.get(connection.to)
    if (!from || !to || !connection.label) continue
    const middle = { x: (project.x(from.x) + project.x(to.x)) / 2, y: (project.y(from.y) + project.y(to.y)) / 2 }
    labels.reserveText(middle.x, middle.y - 8, connection.label, labelFontSize, 'middle')
  }

  const places = new Map(schematic.elements.map((element) => {
    const origin = originOf(element)
    const rotation = orientedRotation(element, schematic, elements)
    const place = labelPlacement(
      { ...element, rotation },
      origin,
      project.scale,
      centers.filter((center) => center.id !== element.id),
      wires,
      labels,
    )
    if (element.label) labels.reserveText(place.x, place.y, element.label, labelFontSize, place.anchor)
    return [element.id, { place, origin, rotation }] as const
  }))

  return (
    <g className="geometry-diagram geometry-schematic" data-testid="geometry-schematic" role="img" aria-label={description}>
      {keyed(schematic.connections, (connection) => `${connection.from}-${connection.to}-${connection.kind}`).map(({ key, item: connection }) => {
        const from = elements.get(connection.from)
        const to = elements.get(connection.to)
        if (!from || !to) return null
        const path = connectionPath(from, to, connection.kind, project)
        const middle = { x: (project.x(from.x) + project.x(to.x)) / 2, y: (project.y(from.y) + project.y(to.y)) / 2 }
        return <g key={key}>
          <path className={connection.kind === 'dashed' ? 'diagram-auxiliary' : 'diagram-line'} d={path} />
          {connection.label && <text className="diagram-tick-label" textAnchor="middle" x={middle.x} y={middle.y - 8}>{connection.label}</text>}
        </g>
      })}
      {keyed(schematic.elements, (element) => element.id).map(({ key, item: element }) => {
        const placement = places.get(element.id)
        if (!placement) return null
        const { place, origin, rotation } = placement
        const { x, y } = origin
        return <g key={key}>
          {/* Провод проходит через центр значка; чтобы линия не
              просвечивала сквозь резистор, под значок кладётся бумага. */}
          {element.symbol !== 'text' && element.symbol !== 'node' && !['vector', 'ray', 'arrow', 'ground', 'wall', 'rope', 'tube', 'incline'].includes(element.symbol) && (
            <rect className="diagram-paper" x={x - symbolSize * project.scale * 0.45} y={y - symbolSize * project.scale * 0.45} width={symbolSize * project.scale * 0.9} height={symbolSize * project.scale * 0.9} transform={`rotate(${rotation} ${x} ${y})`} />
          )}
          <g transform={`translate(${x} ${y}) rotate(${rotation})`}>
            <Symbol element={{ ...element, rotation }} scale={project.scale} />
          </g>
          {element.label && (
            <text className="diagram-tick-label" textAnchor={place.anchor} x={place.x} y={place.y}>{element.label}</text>
          )}
        </g>
      })}
    </g>
  )
}
