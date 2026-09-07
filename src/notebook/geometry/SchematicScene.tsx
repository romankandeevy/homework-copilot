import type { HomeworkSchematic } from '../../lib/homeworkContract'
import { geometryNotebookLayoutV1 as layout } from '../layouts/geometryNotebookLayoutV1'
import { keyed } from '../../lib/listKeys'

/* Схема из условных обозначений.

   Физика и химия чертят не координаты, а знаки: резистор - прямоугольник,
   лампа - кружок с крестом, линза - отрезок со стрелками, колба - колба.
   Модель выбирает знак из библиотеки и ставит его в поле 0..100; сам
   значок рисует лист, одинаково у всех задач. Поле то же, что у
   геометрической сцены, поэтому картинка ложится в ту же зону листа. */

const sceneLayout = layout.zones.diagram.scene
const labelMargin = 24

type Element = HomeworkSchematic['elements'][number]

function projection() {
  const drawableWidth = sceneLayout.width - (sceneLayout.padding + labelMargin) * 2
  const drawableHeight = sceneLayout.height - (sceneLayout.padding + labelMargin) * 2
  const scale = Math.min(drawableWidth, drawableHeight) / 100
  return {
    scale,
    x: (value: number) => sceneLayout.x + sceneLayout.width / 2 + (value - 50) * scale,
    y: (value: number) => sceneLayout.y + sceneLayout.height / 2 + (value - 50) * scale,
  }
}

type Projection = ReturnType<typeof projection>

/* Размер значка в единицах поля: элемент занимает квадрат 10×10, длинные
   элементы (vector, ray, incline, rope, tube) тянутся на length. */
const symbolSize = 10

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
        {Array.from({ length: Math.max(3, Math.round(length / (s * 0.35))) }, (_, index) => {
          const x = -length / 2 + (index + 0.5) * (length / Math.max(3, Math.round(length / (s * 0.35))))
          return <path className="diagram-mark" d={`M ${x} 0 L ${x - half * 0.4} ${half * 0.5}`} key={x} />
        })}
      </>
    case 'wall':
      return <>
        <path className={stroke} d={`M 0 ${-length / 2} L 0 ${length / 2}`} />
        {Array.from({ length: Math.max(3, Math.round(length / (s * 0.35))) }, (_, index) => {
          const y = -length / 2 + (index + 0.5) * (length / Math.max(3, Math.round(length / (s * 0.35))))
          return <path className="diagram-mark" d={`M 0 ${y} L ${-half * 0.5} ${y + half * 0.4}`} key={y} />
        })}
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
        {Array.from({ length: Math.max(3, Math.round(length / (s * 0.3))) }, (_, index) => {
          const y = -length / 2 + index * (length / Math.max(3, Math.round(length / (s * 0.3))))
          return <path className="diagram-mark" d={`M 0 ${y} L ${half * 0.4} ${y + half * 0.4}`} key={y} />
        })}
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

/* Куда ставить подпись элемента: у длинных и повёрнутых - рядом с
   серединой, у остальных - над значком. */
function labelPlacement(element: Element, scale: number) {
  const vertical = Math.abs(((element.rotation % 360) + 360) % 360 - 90) < 45 || Math.abs(((element.rotation % 360) + 360) % 360 - 270) < 45
  const size = symbolSize * scale
  if (element.symbol === 'text') return { dx: 0, dy: 0, anchor: 'middle' as const }
  if (element.symbol === 'vector' || element.symbol === 'ray' || element.symbol === 'arrow') {
    return { dx: 0, dy: -size * 0.4, anchor: 'start' as const }
  }
  if (vertical) return { dx: size * 0.7, dy: 4, anchor: 'start' as const }
  return { dx: 0, dy: -size * 0.75, anchor: 'middle' as const }
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
  const project = projection()
  const elements = new Map(schematic.elements.map((element) => [element.id, element]))

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
          {connection.label && <text className="diagram-angle-label" textAnchor="middle" x={middle.x} y={middle.y - 8}>{connection.label}</text>}
        </g>
      })}
      {keyed(schematic.elements, (element) => element.id).map(({ key, item: element }) => {
        const place = labelPlacement(element, project.scale)
        const x = project.x(element.x)
        const y = project.y(element.y)
        return <g key={key}>
          {/* Провод проходит через центр значка; чтобы линия не
              просвечивала сквозь резистор, под значок кладётся бумага. */}
          {element.symbol !== 'text' && element.symbol !== 'node' && !['vector', 'ray', 'arrow', 'ground', 'wall', 'rope', 'tube', 'incline'].includes(element.symbol) && (
            <rect className="diagram-paper" x={x - symbolSize * project.scale * 0.45} y={y - symbolSize * project.scale * 0.45} width={symbolSize * project.scale * 0.9} height={symbolSize * project.scale * 0.9} transform={`rotate(${element.rotation} ${x} ${y})`} />
          )}
          <g transform={`translate(${x} ${y}) rotate(${element.rotation})`}>
            <Symbol element={element} scale={project.scale} />
          </g>
          {element.label && (
            <text className="diagram-angle-label" textAnchor={place.anchor} x={x + place.dx} y={y + place.dy}>{element.label}</text>
          )}
        </g>
      })}
    </g>
  )
}
