import { useId } from 'react'
import type { HomeworkDiagramScene } from '../../lib/homeworkContract'
import { geometryNotebookLayoutV1 as layout } from '../layouts/geometryNotebookLayoutV1'
import { keyed } from '../../lib/listKeys'

type Point = {
  id: string
  label: string
  x: number
  y: number
  visible: boolean
}

const sceneLayout = layout.zones.diagram.scene

/* Проекция сцены на лист.

   Прежде координаты 0..100 растягивались по осям независимо: поле чертежа
   575x455, и одна и та же единица по горизонтали была длиннее, чем по
   вертикали. Квадрат выходил прямоугольником, окружность - овалом, а прямой
   угол переставал быть прямым - при том что сама сцена была построена верно.

   Теперь масштаб один на обе оси, а сцена вписывается в поле по своим
   границам: фигура занимает лист целиком, а не жмётся в угол, если модель
   разложила точки в диапазоне 30..60. Минимальный размах не даёт вырожденной
   сцене (все точки на одной прямой) растянуться до бесконечного масштаба. */
const minimumLocalSpan = 24

/* Место под подписи вершин.

   Вписывать сцену впритык нельзя: крайние точки садятся на границу поля,
   и подпись за ней обрезается клипом - на чертеже остаётся «C» без верхушки
   и «A», уехавшая за край. Поле под букву отводится заранее, а не
   отодвигается потом: сдвигать подпись внутрь фигуры значит класть её на
   линию. */
const labelMargin = 34

function sceneProjection(points: readonly HomeworkDiagramScene['points'][number][]) {
  const drawableWidth = sceneLayout.width - (sceneLayout.padding + labelMargin) * 2
  const drawableHeight = sceneLayout.height - (sceneLayout.padding + labelMargin) * 2
  const centerX = sceneLayout.x + sceneLayout.width / 2
  const centerY = sceneLayout.y + sceneLayout.height / 2

  if (points.length === 0) {
    const scale = Math.min(drawableWidth, drawableHeight) / (sceneLayout.localMax - sceneLayout.localMin)
    return { scale, localCenterX: 50, localCenterY: 50, centerX, centerY }
  }

  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const spanX = Math.max(maxX - minX, minimumLocalSpan)
  const spanY = Math.max(maxY - minY, minimumLocalSpan)

  return {
    scale: Math.min(drawableWidth / spanX, drawableHeight / spanY),
    localCenterX: (minX + maxX) / 2,
    localCenterY: (minY + maxY) / 2,
    centerX,
    centerY,
  }
}

type SceneProjection = ReturnType<typeof sceneProjection>

function mapPoint(point: HomeworkDiagramScene['points'][number], projection: SceneProjection): Point {
  return {
    ...point,
    x: projection.centerX + (point.x - projection.localCenterX) * projection.scale,
    y: projection.centerY + (point.y - projection.localCenterY) * projection.scale,
  }
}

function distance(left: Point, right: Point) {
  return Math.hypot(right.x - left.x, right.y - left.y)
}

function unit(from: Point, to: Point) {
  const length = distance(from, to)
  if (length === 0) return null
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length }
}

function average(points: readonly Point[]) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  }
}

function segmentPath(points: readonly Point[], kind: 'line' | 'segment' | 'ray') {
  const [start, end] = points
  if (!start || !end) return ''
  const vector = { x: end.x - start.x, y: end.y - start.y }
  const before = kind === 'line' ? sceneLayout.lineExtensionFactor : 0
  const after = kind === 'segment' ? 0 : sceneLayout.lineExtensionFactor
  return `M ${start.x - vector.x * before} ${start.y - vector.y * before} L ${end.x + vector.x * after} ${end.y + vector.y * after}`
}

function chainPath(points: readonly Point[], close: boolean) {
  if (points.length === 0) return ''
  return `${points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')}${close ? ' Z' : ''}`
}

function AngleMark({ points, label }: { points: readonly Point[]; label: string }) {
  const [first, vertex, second] = points
  if (!first || !vertex || !second) return null
  const firstUnit = unit(vertex, first)
  const secondUnit = unit(vertex, second)
  if (!firstUnit || !secondUnit) return null
  const start = {
    x: vertex.x + firstUnit.x * sceneLayout.angleRadius,
    y: vertex.y + firstUnit.y * sceneLayout.angleRadius,
  }
  const end = {
    x: vertex.x + secondUnit.x * sceneLayout.angleRadius,
    y: vertex.y + secondUnit.y * sceneLayout.angleRadius,
  }
  const sweep = firstUnit.x * secondUnit.y - firstUnit.y * secondUnit.x >= 0 ? 1 : 0
  const labelPoint = {
    x: vertex.x + (firstUnit.x + secondUnit.x) * sceneLayout.angleRadius,
    y: vertex.y + (firstUnit.y + secondUnit.y) * sceneLayout.angleRadius,
  }
  return <>
    <path className="diagram-mark" d={`M ${start.x} ${start.y} A ${sceneLayout.angleRadius} ${sceneLayout.angleRadius} 0 0 ${sweep} ${end.x} ${end.y}`} />
    {label && <text className="diagram-angle-label" x={labelPoint.x} y={labelPoint.y}>{label}</text>}
  </>
}

function RightAngleMark({ points, label }: { points: readonly Point[]; label: string }) {
  const [first, vertex, second] = points
  if (!first || !vertex || !second) return null
  const firstUnit = unit(vertex, first)
  const secondUnit = unit(vertex, second)
  if (!firstUnit || !secondUnit) return null
  const firstCorner = {
    x: vertex.x + firstUnit.x * sceneLayout.rightAngleSize,
    y: vertex.y + firstUnit.y * sceneLayout.rightAngleSize,
  }
  const middleCorner = {
    x: firstCorner.x + secondUnit.x * sceneLayout.rightAngleSize,
    y: firstCorner.y + secondUnit.y * sceneLayout.rightAngleSize,
  }
  const secondCorner = {
    x: vertex.x + secondUnit.x * sceneLayout.rightAngleSize,
    y: vertex.y + secondUnit.y * sceneLayout.rightAngleSize,
  }
  return <>
    <path className="diagram-mark" d={`M ${firstCorner.x} ${firstCorner.y} L ${middleCorner.x} ${middleCorner.y} L ${secondCorner.x} ${secondCorner.y}`} />
    {label && <text className="diagram-angle-label" x={middleCorner.x} y={middleCorner.y}>{label}</text>}
  </>
}

function EqualSegmentMark({ points, label }: { points: readonly Point[]; label: string }) {
  const pairs = points.length >= 4 ? [[points[0], points[1]], [points[2], points[3]]] : [[points[0], points[1]]]
  const paths = pairs.flatMap(([start, end]) => {
    if (!start || !end) return []
    const direction = unit(start, end)
    if (!direction) return []
    const middle = average([start, end])
    const normal = { x: -direction.y, y: direction.x }
    return [`M ${middle.x - normal.x * sceneLayout.equalSegmentTickHalf} ${middle.y - normal.y * sceneLayout.equalSegmentTickHalf} L ${middle.x + normal.x * sceneLayout.equalSegmentTickHalf} ${middle.y + normal.y * sceneLayout.equalSegmentTickHalf}`]
  })
  const labelPoint = points.length > 0 ? average(points) : null
  return <>
    {keyed(paths, (path) => path).map(({ key, item: path }) => <path className="diagram-mark" d={path} key={key} />)}
    {label && labelPoint && <text className="diagram-angle-label" x={labelPoint.x + sceneLayout.labelOffsetX} y={labelPoint.y + sceneLayout.labelOffsetY}>{label}</text>}
  </>
}

function parallelChevron(start: Point, end: Point) {
  const direction = unit(start, end)
  if (!direction) return ''
  const middle = average([start, end])
  const normal = { x: -direction.y, y: direction.x }
  const center = {
    x: middle.x + normal.x * sceneLayout.parallelMarkGap,
    y: middle.y + normal.y * sceneLayout.parallelMarkGap,
  }
  return `M ${center.x - direction.x * sceneLayout.parallelMarkHalf + normal.x * sceneLayout.parallelMarkHalf} ${center.y - direction.y * sceneLayout.parallelMarkHalf + normal.y * sceneLayout.parallelMarkHalf} L ${center.x} ${center.y} L ${center.x + direction.x * sceneLayout.parallelMarkHalf + normal.x * sceneLayout.parallelMarkHalf} ${center.y + direction.y * sceneLayout.parallelMarkHalf + normal.y * sceneLayout.parallelMarkHalf}`
}

function ParallelMark({ points, label }: { points: readonly Point[]; label: string }) {
  const pairs = points.length >= 4 ? [[points[0], points[1]], [points[2], points[3]]] : [[points[0], points[1]]]
  const paths = pairs.map(([start, end]) => start && end ? parallelChevron(start, end) : '').filter(Boolean)
  const labelPoint = points.length > 0 ? average(points) : null
  return <>
    {keyed(paths, (path) => path).map(({ key, item: path }) => <path className="diagram-mark" d={path} key={key} />)}
    {label && labelPoint && <text className="diagram-angle-label" x={labelPoint.x} y={labelPoint.y + sceneLayout.objectLabelOffsetY}>{label}</text>}
  </>
}

/* Куда поставить подпись вершины.

   Прежде выбиралось одно из четырёх направлений - «наружу от середины
   чертежа». На треугольнике это работало, на ромбе с диагоналями уже нет:
   буква ложилась на диагональ, подпись центра пересечения садилась на две
   линии сразу, а соседние вершины подписывались в одну точку.

   Теперь подпись примеряется по восьми направлениям вокруг точки, и берётся
   то, где она дальше всего от линий чертежа, от других вершин и от уже
   поставленных подписей. Направление наружу остаётся предпочтительным: при
   равном счёте выигрывает оно, поэтому обычный треугольник подписывается
   так же, как раньше. */
const labelDirections = [
  { x: 1, y: -1 }, { x: -1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 },
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 },
]

const labelClearance = 26

function segmentDistance(point: { x: number; y: number }, start: Point, end: Point) {
  const length = Math.hypot(end.x - start.x, end.y - start.y)
  if (length === 0) return Math.hypot(point.x - start.x, point.y - start.y)
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / (length * length)))
  return Math.hypot(point.x - (start.x + (end.x - start.x) * t), point.y - (start.y + (end.y - start.y) * t))
}

function labelPlacement(
  point: Point,
  center: { x: number; y: number },
  points: readonly Point[],
  edges: readonly (readonly [Point, Point])[],
  taken: readonly { x: number; y: number }[],
) {
  const outward = {
    x: point.x >= center.x ? 1 : -1,
    y: point.y >= center.y ? 1 : -1,
  }
  const offsetX = Math.abs(sceneLayout.labelOffsetX)
  const offsetY = Math.abs(sceneLayout.labelOffsetY)

  let best = {
    x: point.x + offsetX,
    y: point.y - offsetY,
    anchor: 'start' as 'start' | 'end',
    score: -Infinity,
  }

  for (const direction of labelDirections) {
    const spot = {
      x: point.x + direction.x * offsetX * 1.6,
      y: point.y + direction.y * offsetY * 1.6,
    }
    const fromPoints = points
      .filter((other) => other.id !== point.id)
      .reduce((closest, other) => Math.min(closest, Math.hypot(spot.x - other.x, spot.y - other.y)), Infinity)
    const fromEdges = edges.reduce((closest, [start, end]) => Math.min(closest, segmentDistance(spot, start, end)), Infinity)
    const fromLabels = taken.reduce((closest, other) => Math.min(closest, Math.hypot(spot.x - other.x, spot.y - other.y)), Infinity)
    const outwardBonus = (direction.x === outward.x ? labelClearance / 2 : 0) + (direction.y === outward.y ? labelClearance / 2 : 0)
    const score = Math.min(fromPoints, labelClearance * 2)
      + Math.min(fromEdges, labelClearance)
      + Math.min(fromLabels, labelClearance * 2)
      + outwardBonus

    if (score > best.score) {
      best = {
        x: spot.x,
        y: spot.y + (direction.y >= 0 ? offsetY * 0.7 : 0),
        anchor: direction.x < 0 ? 'end' : 'start',
        score,
      }
    }
  }

  return best
}

/* Где написать имя линии или фигуры.

   Кандидаты - несколько точек вдоль объекта, сдвинутых в обе стороны от
   него. Побеждает та, что дальше от вершин, от других линий и от уже
   поставленных подписей. */
function objectLabelPlacement(
  objectPoints: readonly Point[],
  points: readonly Point[],
  edges: readonly (readonly [Point, Point])[],
  taken: readonly { x: number; y: number }[],
) {
  const [start, end] = objectPoints
  const fallback = objectPoints.length > 0
    ? { x: average(objectPoints).x, y: average(objectPoints).y + sceneLayout.objectLabelOffsetY }
    : { x: 0, y: 0 }
  if (!start || !end) return fallback

  const direction = unit(start, end)
  if (!direction) return fallback
  const normal = { x: -direction.y, y: direction.x }
  const offset = Math.abs(sceneLayout.lineLabelOffsetY)

  let best = { ...fallback, score: -Infinity }
  for (const along of [0.18, 0.34, 0.66, 0.82]) {
    for (const side of [1, -1]) {
      const spot = {
        x: start.x + (end.x - start.x) * along + normal.x * offset * side,
        y: start.y + (end.y - start.y) * along + normal.y * offset * side,
      }
      const fromPoints = points.reduce((closest, point) => Math.min(closest, Math.hypot(spot.x - point.x, spot.y - point.y)), Infinity)
      const fromEdges = edges.reduce((closest, [from, to]) => Math.min(closest, segmentDistance(spot, from, to)), Infinity)
      const fromLabels = taken.reduce((closest, other) => Math.min(closest, Math.hypot(spot.x - other.x, spot.y - other.y)), Infinity)
      const score = Math.min(fromPoints, labelClearance * 2)
        + Math.min(fromEdges, labelClearance)
        + Math.min(fromLabels, labelClearance * 2)
      if (score > best.score) best = { x: spot.x, y: spot.y, score }
    }
  }
  return { x: best.x, y: best.y }
}

export function GeometryScene({ scene, description }: { scene: HomeworkDiagramScene; description: string }) {
  const clipId = `geometry-scene-${useId().replace(/:/gu, '')}`
  const projection = sceneProjection(scene.points)
  const points = scene.points.map((point) => mapPoint(point, projection))
  const pointMap = new Map(points.map((point) => [point.id, point]))
  const center = points.length > 0 ? average(points) : { x: 0, y: 0 }

  /* Отрезки чертежа нужны подписям: буква не должна ложиться на линию.
     Окружности сюда не идут - подпись на дуге читается, а хорда между
     центром и точкой окружности линией не является. */
  const edges = scene.objects.flatMap((object) => {
    if (object.kind === 'circle') return []
    const objectPoints = object.points.map((id) => pointMap.get(id)).filter((point): point is Point => Boolean(point))
    return objectPoints
      .slice(0, -1)
      .map((start, index) => [start, objectPoints[index + 1]] as const)
      .concat(object.kind === 'polygon' && objectPoints.length > 2
        ? [[objectPoints[objectPoints.length - 1], objectPoints[0]] as const]
        : [])
  })
  const placedLabels: { x: number; y: number }[] = []

  return (
    <g className="geometry-diagram geometry-scene" data-testid="geometry-scene" role="img" aria-label={description}>
      <defs>
        <clipPath id={clipId}>
          <rect x={sceneLayout.x} y={sceneLayout.y} width={sceneLayout.width} height={sceneLayout.height} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {scene.objects.map((object, index) => {
          const objectPoints = object.points.map((id) => pointMap.get(id)).filter((point): point is Point => Boolean(point))
          const className = object.auxiliary ? 'diagram-auxiliary' : 'diagram-line'
          const key = `${object.kind}-${object.points.join('-')}-${index}`
          const labelPoint = objectPoints.length > 0 ? average(objectPoints) : null
          return <g key={key}>
            {object.kind === 'circle' && objectPoints[0] && objectPoints[1]
              ? <circle className={className} cx={objectPoints[0].x} cy={objectPoints[0].y} r={distance(objectPoints[0], objectPoints[1])} />
              : object.kind === 'polyline' || object.kind === 'polygon'
                ? <path className={className} d={chainPath(objectPoints, object.kind === 'polygon')} />
                : <path className={className} d={segmentPath(objectPoints, object.kind as 'line' | 'segment' | 'ray')} />}
            {object.label && labelPoint && (() => {
              /* Подпись линии раньше вставала в её середину, а середина
                 отрезка - это чаще всего точка пересечения с другой линией
                 или вершина: на чертеже выходило слипшееся «aB». Теперь
                 подпись примеряется вдоль линии и отодвигается от неё вбок,
                 по тем же правилам, что и подпись вершины. */
              const place = objectLabelPlacement(objectPoints, points, edges, placedLabels)
              placedLabels.push(place)
              return <text className="diagram-angle-label" textAnchor="middle" x={place.x} y={place.y}>{object.label}</text>
            })()}
          </g>
        })}
        {scene.marks.map((mark, index) => {
          const markPoints = mark.points.map((id) => pointMap.get(id)).filter((point): point is Point => Boolean(point))
          const key = `${mark.kind}-${mark.points.join('-')}-${index}`
          if (mark.kind === 'angle') return <AngleMark points={markPoints} label={mark.label} key={key} />
          if (mark.kind === 'right-angle') return <RightAngleMark points={markPoints} label={mark.label} key={key} />
          if (mark.kind === 'equal-segment') return <EqualSegmentMark points={markPoints} label={mark.label} key={key} />
          return <ParallelMark points={markPoints} label={mark.label} key={key} />
        })}
        {points.filter((point) => point.visible).map((point) => {
          const place = labelPlacement(point, center, points, edges, placedLabels)
          placedLabels.push({ x: place.x, y: place.y })
          return (
            <g key={point.id}>
              <circle className="diagram-point" cx={point.x} cy={point.y} r={sceneLayout.pointRadius} />
              <text className="diagram-vertex" textAnchor={place.anchor} x={place.x} y={place.y}>{point.label || point.id}</text>
            </g>
          )
        })}
      </g>
    </g>
  )
}
