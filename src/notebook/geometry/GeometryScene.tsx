import { useId } from 'react'
import type { HomeworkDiagramScene, HomeworkSceneAxes } from '../../lib/homeworkContract'
import { geometryNotebookLayoutV1 as layout } from '../layouts/geometryNotebookLayoutV1'
import { keyed } from '../../lib/listKeys'
import { compileFormula, sampleFormula } from '../../lib/formula'
import { LabelLayout, labelRect, placementScore } from './labelLayout'
import type { Segment } from './labelLayout'

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

function sceneProjection(points: readonly HomeworkDiagramScene['points'][number][], axes?: HomeworkSceneAxes) {
  const drawableWidth = sceneLayout.width - (sceneLayout.padding + labelMargin) * 2
  const drawableHeight = sceneLayout.height - (sceneLayout.padding + labelMargin) * 2
  const centerX = sceneLayout.x + sceneLayout.width / 2
  const centerY = sceneLayout.y + sceneLayout.height / 2

  /* Координатная плоскость: в поле вписывается диапазон осей, а не
     точки, и ось y смотрит вверх - поэтому знак по вертикали меняется. */
  if (axes) {
    return {
      scale: Math.min(drawableWidth / (axes.xMax - axes.xMin), drawableHeight / (axes.yMax - axes.yMin)),
      localCenterX: (axes.xMin + axes.xMax) / 2,
      localCenterY: (axes.yMin + axes.yMax) / 2,
      centerX,
      centerY,
      flipY: true,
    }
  }

  if (points.length === 0) {
    const scale = Math.min(drawableWidth, drawableHeight) / (sceneLayout.localMax - sceneLayout.localMin)
    return { scale, localCenterX: 50, localCenterY: 50, centerX, centerY, flipY: false }
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
    flipY: false,
  }
}

type SceneProjection = ReturnType<typeof sceneProjection>

function mapXY(x: number, y: number, projection: SceneProjection) {
  return {
    x: projection.centerX + (x - projection.localCenterX) * projection.scale,
    y: projection.centerY + (y - projection.localCenterY) * projection.scale * (projection.flipY ? -1 : 1),
  }
}

function mapPoint(point: HomeworkDiagramScene['points'][number], projection: SceneProjection): Point {
  return { ...point, ...mapXY(point.x, point.y, projection) }
}

/* Оси координат со стрелками, делениями и подписями.

   Рисуются как в тетради: ось проходит через ноль, если ноль в диапазоне,
   иначе по краю поля; деления через unit подписаны числами, ноль подписан
   буквой O один раз; имена осей стоят у стрелок. */
const formatTick = (value: number) => String(value).replace('.', ',')

/* Разметка осей одна и для рисования, и для раскладки подписей: место под
   деления занимается до того, как расходятся буквы вершин, а посчитано оно
   должно быть тем же кодом, который потом их рисует. */
function axesGeometry(axes: HomeworkSceneAxes, projection: SceneProjection) {
  const originX = Math.min(Math.max(0, axes.xMin), axes.xMax)
  const originY = Math.min(Math.max(0, axes.yMin), axes.yMax)
  const ticks = (min: number, max: number) => {
    const values: number[] = []
    const first = Math.ceil(min / axes.unit) * axes.unit
    for (let value = first; value <= max + 1e-9; value += axes.unit) {
      const rounded = Number(value.toFixed(6))
      if (Math.abs(rounded) > 1e-9) values.push(rounded)
    }
    return values
  }
  return {
    originX,
    originY,
    origin: mapXY(originX, originY, projection),
    left: mapXY(axes.xMin, originY, projection),
    right: mapXY(axes.xMax, originY, projection),
    bottom: mapXY(originX, axes.yMin, projection),
    top: mapXY(originX, axes.yMax, projection),
    xTicks: ticks(axes.xMin, axes.xMax),
    yTicks: ticks(axes.yMin, axes.yMax),
  }
}

/* Оси и деления двигать некуда: их место задано самой сеткой, поэтому они
   занимают его первыми. Раньше подписи делений в раскладке не участвовали
   вовсе, и «S₀» на графике по обществознанию садилась прямо на число. */
function reserveAxesLabels(axes: HomeworkSceneAxes, projection: SceneProjection, labels: LabelLayout) {
  const { origin, right, top, originX, originY, xTicks, yTicks } = axesGeometry(axes, projection)
  /* Имя оси стояло в десяти пикселях над осью и задевало подпись последнего
     деления, которая идёт под осью: «Q» и «100» на графике по обществознанию
     сливались в один комок. Двигать здесь некого - обе подписи привязаны к
     концу оси, - поэтому имя оси поднято выше. */
  labels.reserveText(right.x - 4, right.y - 22, axes.xLabel, labelFontSize, 'end')
  labels.reserveText(top.x + 10, top.y + 14, axes.yLabel, labelFontSize, 'start')
  labels.reserveText(origin.x - 6, origin.y + 18, 'O', labelFontSize, 'end')
  for (const value of xTicks) {
    const at = mapXY(value, originY, projection)
    labels.reserveText(at.x, at.y + 22, formatTick(value), tickFontSize, 'middle')
  }
  for (const value of yTicks) {
    const at = mapXY(originX, value, projection)
    labels.reserveText(at.x - 10, at.y + 5, formatTick(value), tickFontSize, 'end')
  }
}

function Axes({ axes, projection }: { axes: HomeworkSceneAxes; projection: SceneProjection }) {
  const { origin, left, right, bottom, top, originX, originY, xTicks, yTicks } = axesGeometry(axes, projection)
  const arrow = 12
  const tick = 6
  const format = formatTick

  return (
    <g className="diagram-axes">
      <path className="diagram-axis" d={`M ${left.x} ${left.y} L ${right.x} ${right.y}`} />
      <path className="diagram-axis" d={`M ${right.x - arrow} ${right.y - arrow / 2} L ${right.x} ${right.y} L ${right.x - arrow} ${right.y + arrow / 2}`} />
      <path className="diagram-axis" d={`M ${bottom.x} ${bottom.y} L ${top.x} ${top.y}`} />
      <path className="diagram-axis" d={`M ${top.x - arrow / 2} ${top.y + arrow} L ${top.x} ${top.y} L ${top.x + arrow / 2} ${top.y + arrow}`} />
      <text className="diagram-axis-label" textAnchor="end" x={right.x - 4} y={right.y - 22}>{axes.xLabel}</text>
      <text className="diagram-axis-label" textAnchor="start" x={top.x + 10} y={top.y + 14}>{axes.yLabel}</text>
      <text className="diagram-axis-label" textAnchor="end" x={origin.x - 6} y={origin.y + 18}>O</text>
      {keyed(xTicks, (value) => `x${value}`).map(({ key, item: value }) => {
        const at = mapXY(value, originY, projection)
        return <g key={key}>
          <path className="diagram-axis" d={`M ${at.x} ${at.y - tick} L ${at.x} ${at.y + tick}`} />
          <text className="diagram-tick-label" textAnchor="middle" x={at.x} y={at.y + 22}>{format(value)}</text>
        </g>
      })}
      {keyed(yTicks, (value) => `y${value}`).map(({ key, item: value }) => {
        const at = mapXY(originX, value, projection)
        return <g key={key}>
          <path className="diagram-axis" d={`M ${at.x - tick} ${at.y} L ${at.x + tick} ${at.y}`} />
          <text className="diagram-tick-label" textAnchor="end" x={at.x - 10} y={at.y + 5}>{format(value)}</text>
        </g>
      })}
    </g>
  )
}

/* График по формуле: кривая считается по точкам в диапазоне осей и
   переводится на лист той же проекцией, что и точки сцены. Подпись
   «y = ...» ставится у правого конца последней ветви, внутри поля. */
function curveBranches(object: HomeworkDiagramScene['objects'][number], axes: HomeworkSceneAxes, projection: SceneProjection) {
  const formula = compileFormula(object.formula ?? '')
  if (!formula) return null
  return sampleFormula(formula, axes.xMin, axes.xMax, axes.yMin, axes.yMax)
    .map((branch) => branch.map((point) => mapXY(point.x, point.y, projection)))
}

export const curveLabel = (label: string) => label.trim().slice(0, 24)

/* Где написать «S₀» и «y = 2x - 1».

   Прежде подпись вставала у последней точки кривой внутри поля и ни на кого
   не смотрела. 7 сентября на проде обе кривые предложения уходили за поле в
   одном и том же углу, и «S₀» с «S₁» сошлись в одной точке - поверх самих
   графиков и поверх подписи деления. Теперь место выбирается из нескольких
   точек вдоль кривой, по обе стороны от неё и на разном отходе: у графика,
   идущего вдоль оси, ближнее положение упирается в числа делений. */
function curveLabelPlacement(
  branches: readonly (readonly { x: number; y: number }[])[],
  label: string,
  layout: LabelLayout,
  edges: readonly Segment[],
) {
  const fieldTop = sceneLayout.y + sceneLayout.padding
  const fieldBottom = sceneLayout.y + sceneLayout.height - sceneLayout.padding
  const inside = branches.flat().filter((point) => point.y > fieldTop + 12 && point.y < fieldBottom - 12)
  if (!label || inside.length === 0) return null

  const candidates = [0.25, 0.4, 0.55, 0.7, 0.85, 1]
    .map((along) => inside[Math.min(inside.length - 1, Math.floor((inside.length - 1) * along))])
  let best: { x: number; y: number; anchor: 'start' | 'end'; score: number } | null = null
  for (const at of candidates) {
    for (const side of [-1, 1] as const) {
      for (const away of [1, 1.8, 2.6] as const) {
        const spot = { x: at.x + side * 8, y: at.y + side * labelFontSize * away }
        const anchor = side < 0 ? 'end' as const : 'start' as const
        const rect = labelRect(spot.x, spot.y, label, labelFontSize, anchor)
        const score = placementScore({ rect, layout, edges, points: [], clearance: labelClearance })
        if (!best || score > best.score) best = { ...spot, anchor, score }
      }
    }
  }
  return best
}

function Curve({ object, axes, projection, className, place }: {
  object: HomeworkDiagramScene['objects'][number]
  axes: HomeworkSceneAxes
  projection: SceneProjection
  className: string
  place: { x: number; y: number; anchor: 'start' | 'end' } | null
}) {
  const branches = curveBranches(object, axes, projection)
  if (!branches) return null
  const paths = branches.map((branch) => branch.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' '))
  const label = curveLabel(object.label)

  return <>
    {keyed(paths, (path) => path).map(({ key, item: path }) => <path className={className} d={path} key={key} />)}
    {label && place && (
      <text className="diagram-angle-label" textAnchor={place.anchor} x={place.x} y={place.y}>{label}</text>
    )}
  </>
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

/* Место подписи угла: по биссектрисе и дальше дуги.

   Считается отдельно от рисования, потому что занять место надо до того,
   как разойдутся буквы вершин, а тела дочерних компонентов React выполняет
   уже после родителя. */
function angleLabelPoint(points: readonly Point[]) {
  const [first, vertex, second] = points
  if (!first || !vertex || !second) return null
  const firstUnit = unit(vertex, first)
  const secondUnit = unit(vertex, second)
  if (!firstUnit || !secondUnit) return null
  const bisector = unit(
    { x: 0, y: 0 } as Point,
    { x: firstUnit.x + secondUnit.x, y: firstUnit.y + secondUnit.y } as Point,
  ) ?? firstUnit
  const labelDistance = sceneLayout.angleRadius * 2.05
  return { x: vertex.x + bisector.x * labelDistance, y: vertex.y + bisector.y * labelDistance }
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
  /* Подпись угла раньше вставала на сумму единичных векторов - у тупого
     угла это почти вершина, и «135°» ложилось прямо на дугу: на проде
     6 сентября читалось как «I 35». */
  const labelPoint = angleLabelPoint(points)
  if (!labelPoint) return null
  return <>
    <path className="diagram-mark" d={`M ${start.x} ${start.y} A ${sceneLayout.angleRadius} ${sceneLayout.angleRadius} 0 0 ${sweep} ${end.x} ${end.y}`} />
    {label && (
      <text
        className="diagram-angle-label"
        textAnchor="middle"
        dominantBaseline="central"
        x={labelPoint.x}
        y={labelPoint.y}
      >
        {label}
      </text>
    )}
  </>
}

function rightAngleCorners(points: readonly Point[]) {
  const [first, vertex, second] = points
  if (!first || !vertex || !second) return null
  const firstUnit = unit(vertex, first)
  const secondUnit = unit(vertex, second)
  if (!firstUnit || !secondUnit) return null
  const firstCorner = {
    x: vertex.x + firstUnit.x * sceneLayout.rightAngleSize,
    y: vertex.y + firstUnit.y * sceneLayout.rightAngleSize,
  }
  return {
    firstCorner,
    middleCorner: {
      x: firstCorner.x + secondUnit.x * sceneLayout.rightAngleSize,
      y: firstCorner.y + secondUnit.y * sceneLayout.rightAngleSize,
    },
    secondCorner: {
      x: vertex.x + secondUnit.x * sceneLayout.rightAngleSize,
      y: vertex.y + secondUnit.y * sceneLayout.rightAngleSize,
    },
  }
}

function RightAngleMark({ points, label }: { points: readonly Point[]; label: string }) {
  const corners = rightAngleCorners(points)
  if (!corners) return null
  const { firstCorner, middleCorner, secondCorner } = corners
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

/* Кегль подписи чертежа: тот же bodySize, каким NotebookDiagram задаёт
   .diagram-vertex и .diagram-angle-label. Раскладке он нужен, чтобы знать
   ширину строки: «S₀ = 40» занимает впятеро больше места, чем «A». */
const labelFontSize = layout.typography.bodySize
const tickFontSize = Math.round(layout.typography.bodySize * 0.72)

function labelPlacement(
  point: Point,
  center: { x: number; y: number },
  points: readonly Point[],
  edges: readonly Segment[],
  layout: LabelLayout,
  label: string,
) {
  const outward = {
    x: point.x >= center.x ? 1 : -1,
    y: point.y >= center.y ? 1 : -1,
  }
  const offsetX = Math.abs(sceneLayout.labelOffsetX)
  const offsetY = Math.abs(sceneLayout.labelOffsetY)
  const others = points.filter((other) => other.id !== point.id)

  let best: { x: number; y: number; anchor: 'start' | 'end'; score: number } | null = null

  for (const direction of labelDirections) {
    const anchor = direction.x < 0 ? 'end' as const : 'start' as const
    const spot = {
      x: point.x + direction.x * offsetX * 1.6,
      y: point.y + direction.y * offsetY * 1.6 + (direction.y >= 0 ? offsetY * 0.7 : 0),
    }
    const rect = labelRect(spot.x, spot.y, label, labelFontSize, anchor)
    const outwardBonus = (direction.x === outward.x ? labelClearance / 2 : 0) + (direction.y === outward.y ? labelClearance / 2 : 0)
    const score = placementScore({ rect, layout, edges, points: others, clearance: labelClearance }) + outwardBonus

    if (!best || score > best.score) best = { x: spot.x, y: spot.y, anchor, score }
  }

  return best ?? { x: point.x + offsetX, y: point.y - offsetY, anchor: 'start' as const, score: 0 }
}

/* Где написать имя линии или фигуры.

   Кандидаты - несколько точек вдоль объекта, сдвинутых в обе стороны от
   него. Побеждает та, что дальше от вершин, от других линий и от уже
   поставленных подписей. */
function objectLabelPlacement(
  objectPoints: readonly Point[],
  points: readonly Point[],
  edges: readonly Segment[],
  layout: LabelLayout,
  label: string,
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

  let best: { x: number; y: number; score: number } | null = null
  for (const along of [0.18, 0.34, 0.66, 0.82]) {
    for (const side of [1, -1]) {
      const spot = {
        x: start.x + (end.x - start.x) * along + normal.x * offset * side,
        y: start.y + (end.y - start.y) * along + normal.y * offset * side,
      }
      const rect = labelRect(spot.x, spot.y, label, labelFontSize, 'middle')
      const score = placementScore({ rect, layout, edges, points, clearance: labelClearance })
      if (!best || score > best.score) best = { x: spot.x, y: spot.y, score }
    }
  }
  return best ?? fallback
}

/* Что писать на чертеже, а что нет.

   6 сентября на проде чертёж к задаче про четырёхугольник вышел кашей:
   стороны подписаны «AB», «BC», «CD», «DA», сам многоугольник - «ABCD»,
   в трёх углах трижды написано «∠A = ∠B = ∠C», поперёк фигуры «AB ∥ CD»,
   и всё это налезает друг на друга и на буквы вершин.

   В тетради так не делают. Сторону между A и D не подписывают «AD» - это
   и так видно по вершинам. Равенство углов показывают дугами, а не
   формулой поверх чертежа. Подпись на чертеже нужна там, где она вводит
   то, чего из рисунка не прочесть: имя прямой «a», градусную меру «135°»,
   длину «10 см».

   Поэтому подпись отбрасывается, если она просто перечисляет вершины
   объекта, и если она длиннее короткой пометки. */
const maxDrawnLabelLength = 8

function isVertexListLabel(label: string, pointIds: readonly string[]) {
  // Класс задан свойствами Юникода, а не перечислением алфавитов: проверка
  // сборки справедливо ругается на латиницу вплотную к кириллице.
  const letters = label.replace(/[^\p{L}\p{N}]/gu, '').toLocaleUpperCase('ru-RU')
  if (letters.length === 0) return false
  const ids = pointIds.map((id) => id.toLocaleUpperCase('ru-RU')).join('')
  // «AD» при вершинах A и D, «ABCD» при четырёх вершинах - имя из букв
  // самих вершин, и оно на чертеже уже написано.
  return letters === ids || letters === [...ids].reverse().join('')
}

function drawnLabel(label: string, pointIds: readonly string[]) {
  const trimmed = label.trim()
  if (!trimmed) return ''
  if (isVertexListLabel(trimmed, pointIds)) return ''
  if (trimmed.length > maxDrawnLabelLength) return ''
  return trimmed
}

export function GeometryScene({ scene, description }: { scene: HomeworkDiagramScene; description: string }) {
  const clipId = `geometry-scene-${useId().replace(/:/gu, '')}`
  const axes = scene.axes
  const projection = sceneProjection(scene.points, axes)
  const points = scene.points.map((point) => mapPoint(point, projection))
  const pointMap = new Map(points.map((point) => [point.id, point]))
  const center = points.length > 0 ? average(points) : { x: 0, y: 0 }

  /* Отрезки чертежа нужны подписям: буква не должна ложиться на линию.
     Окружности сюда не идут - подпись на дуге читается, а хорда между
     центром и точкой окружности линией не является.

     График - идёт. 7 сентября на проде подписи кривых спроса и предложения
     легли прямо на сами кривые: раскладка про них не знала, потому что
     curve здесь отбрасывался вместе с окружностью. Кривую разбиваем на
     звенья тем же сэмплированием, каким её и рисуют. */
  const edges: Segment[] = scene.objects.flatMap((object) => {
    if (object.kind === 'circle') return []
    if (object.kind === 'curve') {
      const branches = axes ? curveBranches(object, axes, projection) : null
      if (!branches) return []
      return branches.flatMap((branch) => branch
        .slice(0, -1)
        .map((start, index) => [start, branch[index + 1]] as Segment))
    }
    const objectPoints = object.points.map((id) => pointMap.get(id)).filter((point): point is Point => Boolean(point))
    return objectPoints
      .slice(0, -1)
      .map((start, index) => [start, objectPoints[index + 1]] as Segment)
      .concat(object.kind === 'polygon' && objectPoints.length > 2
        ? [[objectPoints[objectPoints.length - 1], objectPoints[0]] as Segment]
        : [])
  })

  /* Раскладка считается вся до отрисовки.

     Порядок захвата места - он же порядок важности: сначала оси и деления,
     которым деваться некуда, потом значки, потом имена линий и графиков, и
     последними буквы вершин: у них выбор из восьми направлений вокруг
     точки, они и уступают.

     Считать это по ходу JSX нельзя: тела дочерних компонентов React
     выполняет уже после родителя, и подписи осей заняли бы место последними,
     когда все остальные уже расставлены. */
  const labels = new LabelLayout()
  if (axes) reserveAxesLabels(axes, projection, labels)

  const markLabels = scene.marks.map((mark) => {
    const markPoints = mark.points.map((id) => pointMap.get(id)).filter((point): point is Point => Boolean(point))
    const label = drawnLabel(mark.label, mark.points)
    if (!label) return null
    if (mark.kind === 'angle') {
      const at = angleLabelPoint(markPoints)
      return at ? labels.reserveText(at.x, at.y + labelFontSize * 0.4, label, labelFontSize, 'middle') : null
    }
    if (mark.kind === 'right-angle') {
      const corners = rightAngleCorners(markPoints)
      return corners ? labels.reserveText(corners.middleCorner.x, corners.middleCorner.y, label, labelFontSize) : null
    }
    if (markPoints.length === 0) return null
    const at = average(markPoints)
    return mark.kind === 'equal-segment'
      ? labels.reserveText(at.x + sceneLayout.labelOffsetX, at.y + sceneLayout.labelOffsetY, label, labelFontSize)
      : labels.reserveText(at.x, at.y + sceneLayout.objectLabelOffsetY, label, labelFontSize)
  })
  void markLabels

  const objectLabelPlaces = scene.objects.map((object) => {
    const objectPoints = object.points.map((id) => pointMap.get(id)).filter((point): point is Point => Boolean(point))
    if (object.kind === 'curve') {
      const label = curveLabel(object.label)
      const branches = axes ? curveBranches(object, axes, projection) : null
      if (!label || !branches) return null
      const place = curveLabelPlacement(branches, label, labels, edges)
      if (place) labels.reserveText(place.x, place.y, label, labelFontSize, place.anchor)
      return place
    }
    const label = drawnLabel(object.label, object.points)
    if (!label || objectPoints.length === 0) return null
    const place = objectLabelPlacement(objectPoints, points, edges, labels, label)
    labels.reserveText(place.x, place.y, label, labelFontSize, 'middle')
    return { ...place, anchor: 'start' as const }
  })

  const vertexPlaces = new Map(points.filter((point) => point.visible).map((point) => {
    const text = point.label || point.id
    const place = labelPlacement(point, center, points, edges, labels, text)
    labels.reserveText(place.x, place.y, text, labelFontSize, place.anchor)
    return [point.id, place] as const
  }))

  return (
    <g className="geometry-diagram geometry-scene" data-testid="geometry-scene" role="img" aria-label={description}>
      <defs>
        <clipPath id={clipId}>
          <rect x={sceneLayout.x} y={sceneLayout.y} width={sceneLayout.width} height={sceneLayout.height} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {axes && <Axes axes={axes} projection={projection} />}
        {scene.objects.map((object, index) => {
          const objectPoints = object.points.map((id) => pointMap.get(id)).filter((point): point is Point => Boolean(point))
          const className = object.auxiliary ? 'diagram-auxiliary' : 'diagram-line'
          const key = `${object.kind}-${object.points.join('-')}-${index}`
          if (object.kind === 'curve') {
            return axes
              ? <Curve object={object} axes={axes} projection={projection} className={className} place={objectLabelPlaces[index]} key={key} />
              : null
          }
          return <g key={key}>
            {object.kind === 'circle' && objectPoints[0] && objectPoints[1]
              ? <circle className={className} cx={objectPoints[0].x} cy={objectPoints[0].y} r={distance(objectPoints[0], objectPoints[1])} />
              : object.kind === 'polyline' || object.kind === 'polygon'
                ? <path className={className} d={chainPath(objectPoints, object.kind === 'polygon')} />
                : <path className={className} d={segmentPath(objectPoints, object.kind as 'line' | 'segment' | 'ray')} />}
            {/* Подпись линии раньше вставала в её середину, а середина
                отрезка - это чаще всего точка пересечения с другой линией
                или вершина: на чертеже выходило слипшееся «aB». Место
                выбрано в предпроходе, вдоль линии и вбок от неё. */}
            {objectLabelPlaces[index] && (
              <text className="diagram-angle-label" textAnchor="middle" x={objectLabelPlaces[index].x} y={objectLabelPlaces[index].y}>
                {drawnLabel(object.label, object.points)}
              </text>
            )}
          </g>
        })}
        {scene.marks.map((mark, index) => {
          const markPoints = mark.points.map((id) => pointMap.get(id)).filter((point): point is Point => Boolean(point))
          const key = `${mark.kind}-${mark.points.join('-')}-${index}`
          // Значок рисуется всегда, подпись - только короткая и по делу.
          const label = drawnLabel(mark.label, mark.points)
          if (mark.kind === 'angle') return <AngleMark points={markPoints} label={label} key={key} />
          if (mark.kind === 'right-angle') return <RightAngleMark points={markPoints} label={label} key={key} />
          if (mark.kind === 'equal-segment') return <EqualSegmentMark points={markPoints} label={label} key={key} />
          return <ParallelMark points={markPoints} label={label} key={key} />
        })}
        {points.filter((point) => point.visible).map((point) => {
          const place = vertexPlaces.get(point.id)
          if (!place) return null
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
