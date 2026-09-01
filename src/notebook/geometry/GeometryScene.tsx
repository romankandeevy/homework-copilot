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

function mapPoint(point: HomeworkDiagramScene['points'][number]): Point {
  const localSpan = sceneLayout.localMax - sceneLayout.localMin
  const drawableWidth = sceneLayout.width - sceneLayout.padding * 2
  const drawableHeight = sceneLayout.height - sceneLayout.padding * 2
  return {
    ...point,
    x: sceneLayout.x + sceneLayout.padding + ((point.x - sceneLayout.localMin) / localSpan) * drawableWidth,
    y: sceneLayout.y + sceneLayout.padding + ((point.y - sceneLayout.localMin) / localSpan) * drawableHeight,
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

export function GeometryScene({ scene, description }: { scene: HomeworkDiagramScene; description: string }) {
  const clipId = `geometry-scene-${useId().replace(/:/gu, '')}`
  const points = scene.points.map(mapPoint)
  const pointMap = new Map(points.map((point) => [point.id, point]))

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
            {object.label && labelPoint && <text
              className="diagram-angle-label"
              x={labelPoint.x + (object.kind === 'line' || object.kind === 'ray' ? sceneLayout.lineLabelOffsetX : 0)}
              y={labelPoint.y + (object.kind === 'line' || object.kind === 'ray' ? sceneLayout.lineLabelOffsetY : sceneLayout.objectLabelOffsetY)}
            >{object.label}</text>}
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
        {points.filter((point) => point.visible).map((point) => (
          <g key={point.id}>
            <circle className="diagram-point" cx={point.x} cy={point.y} r={sceneLayout.pointRadius} />
            <text className="diagram-vertex" x={point.x + sceneLayout.labelOffsetX} y={point.y + sceneLayout.labelOffsetY}>{point.label || point.id}</text>
          </g>
        ))}
      </g>
    </g>
  )
}
