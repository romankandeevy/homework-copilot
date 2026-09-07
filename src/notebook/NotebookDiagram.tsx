import { geometryNotebookLayoutV1 as layout } from './layouts/geometryNotebookLayoutV1'
import { GeometryScene } from './geometry/GeometryScene'
import { SchematicScene } from './geometry/SchematicScene'
import type { GeometryDiagramSpec } from './geometry/types'

/* Чертёж отдельно от листа.

   Раньше чертёж умел жить только внутри SVG-листа геометрии: он рисовался
   в жёсткой зоне страницы 1086×1448, и вынести его было некуда. Из-за
   этого страница решения держала два разных листа - SVG для геометрии и
   HTML для остальных предметов, - и выглядели они по-разному: у геометрии
   «Найти» вжато в узкую колонку, посреди листа дыра от пустой зоны
   чертежа, а решение рвалось на «продолжение».

   Теперь чертёж - самостоятельный рисунок. Координаты у него прежние,
   зоны листа, но окно svg обрезано ровно по зоне: рисунок масштабируется
   под ширину, где бы ни стоял. Один чертёж, один лист, все предметы. */

export function TriangleDiagram({ diagram }: { diagram: GeometryDiagramSpec }) {
  const { threePointLines, threeLinesCases, threeCollinearOneOffLines, triangle, labels, apexAngle, angleArc, leftTick, rightTick, rightAngle, exteriorAngle, auxiliaryLabel, parallelLine, parallelLabel, intersectingSegments, quadrilateral, circle } = layout.zones.diagram
  if (diagram.kind === 'none') return null
  if (diagram.kind === 'construction') {
    return diagram.scene ? <GeometryScene scene={diagram.scene} description={diagram.description} /> : null
  }
  if (diagram.kind === 'schematic') {
    return diagram.schematic ? <SchematicScene schematic={diagram.schematic} description={diagram.description} /> : null
  }

  if (diagram.kind === 'three-point-extended-lines') {
    return (
      <g className="geometry-diagram" role="img" aria-label={diagram.description}>
        {threePointLines.paths.map((path) => <path className="diagram-line" d={path} key={path} />)}
        <circle className="diagram-point" cx={threePointLines.points.a.x} cy={threePointLines.points.a.y} r="6" />
        <circle className="diagram-point" cx={threePointLines.points.b.x} cy={threePointLines.points.b.y} r="6" />
        <circle className="diagram-point" cx={threePointLines.points.c.x} cy={threePointLines.points.c.y} r="6" />
        <text className="diagram-vertex" x={threePointLines.labels.a.x} y={threePointLines.labels.a.y}>{diagram.vertices[0] ?? 'A'}</text>
        <text className="diagram-vertex" x={threePointLines.labels.b.x} y={threePointLines.labels.b.y}>{diagram.vertices[1] ?? 'B'}</text>
        <text className="diagram-vertex" x={threePointLines.labels.c.x} y={threePointLines.labels.c.y}>{diagram.vertices[2] ?? 'C'}</text>
      </g>
    )
  }

  if (diagram.kind === 'three-lines-cases') {
    return (
      <g className="geometry-diagram" role="img" aria-label={diagram.description}>
        {threeLinesCases.distinct.paths.map((path) => <path className="diagram-line" d={path} key={path} />)}
        <circle className="diagram-point" cx={threeLinesCases.distinct.points.a.x} cy={threeLinesCases.distinct.points.a.y} r="5" />
        <circle className="diagram-point" cx={threeLinesCases.distinct.points.b.x} cy={threeLinesCases.distinct.points.b.y} r="5" />
        <circle className="diagram-point" cx={threeLinesCases.distinct.points.c.x} cy={threeLinesCases.distinct.points.c.y} r="5" />
        <text className="diagram-vertex" x={threeLinesCases.distinct.labels.a.x} y={threeLinesCases.distinct.labels.a.y}>{diagram.vertices[0] ?? 'A'}</text>
        <text className="diagram-vertex" x={threeLinesCases.distinct.labels.b.x} y={threeLinesCases.distinct.labels.b.y}>{diagram.vertices[1] ?? 'B'}</text>
        <text className="diagram-vertex" x={threeLinesCases.distinct.labels.c.x} y={threeLinesCases.distinct.labels.c.y}>{diagram.vertices[2] ?? 'C'}</text>
        <text className="diagram-caption" textAnchor="middle" x={threeLinesCases.distinct.caption.x} y={threeLinesCases.distinct.caption.y}>{threeLinesCases.distinct.caption.text}</text>
        {threeLinesCases.common.paths.map((path) => <path className="diagram-line" d={path} key={path} />)}
        <circle className="diagram-point" cx={threeLinesCases.common.point.x} cy={threeLinesCases.common.point.y} r="6" />
        <text className="diagram-vertex" x={threeLinesCases.common.label.x} y={threeLinesCases.common.label.y}>{diagram.vertices[3] ?? 'O'}</text>
        <text className="diagram-caption" textAnchor="middle" x={threeLinesCases.common.caption.x} y={threeLinesCases.common.caption.y}>{threeLinesCases.common.caption.text}</text>
      </g>
    )
  }

  if (diagram.kind === 'three-collinear-one-off-lines') {
    return (
      <g className="geometry-diagram" role="img" aria-label={diagram.description}>
        {threeCollinearOneOffLines.paths.map((path) => <path className="diagram-line" d={path} key={path} />)}
        <circle className="diagram-point" cx={threeCollinearOneOffLines.points.a.x} cy={threeCollinearOneOffLines.points.a.y} r="6" />
        <circle className="diagram-point" cx={threeCollinearOneOffLines.points.b.x} cy={threeCollinearOneOffLines.points.b.y} r="6" />
        <circle className="diagram-point" cx={threeCollinearOneOffLines.points.c.x} cy={threeCollinearOneOffLines.points.c.y} r="6" />
        <circle className="diagram-point" cx={threeCollinearOneOffLines.points.d.x} cy={threeCollinearOneOffLines.points.d.y} r="6" />
        <text className="diagram-vertex" x={threeCollinearOneOffLines.labels.a.x} y={threeCollinearOneOffLines.labels.a.y}>{diagram.vertices[0] ?? 'A'}</text>
        <text className="diagram-vertex" x={threeCollinearOneOffLines.labels.b.x} y={threeCollinearOneOffLines.labels.b.y}>{diagram.vertices[1] ?? 'B'}</text>
        <text className="diagram-vertex" x={threeCollinearOneOffLines.labels.c.x} y={threeCollinearOneOffLines.labels.c.y}>{diagram.vertices[2] ?? 'C'}</text>
        <text className="diagram-vertex" x={threeCollinearOneOffLines.labels.d.x} y={threeCollinearOneOffLines.labels.d.y}>{diagram.vertices[3] ?? 'D'}</text>
        <text className="diagram-vertex" x={threeCollinearOneOffLines.labels.line.x} y={threeCollinearOneOffLines.labels.line.y}>a</text>
      </g>
    )
  }

  if (diagram.kind === 'intersecting-segments') {
    return (
      <g className="geometry-diagram" role="img" aria-label={diagram.description}>
        <path className="diagram-line" d={intersectingSegments.first} />
        <path className="diagram-line" d={intersectingSegments.second} />
        <text className="diagram-vertex" x={intersectingSegments.labels.a.x} y={intersectingSegments.labels.a.y}>{diagram.vertices[0] ?? 'A'}</text>
        <text className="diagram-vertex" x={intersectingSegments.labels.b.x} y={intersectingSegments.labels.b.y}>{diagram.vertices[1] ?? 'B'}</text>
        <text className="diagram-vertex" x={intersectingSegments.labels.c.x} y={intersectingSegments.labels.c.y}>{diagram.vertices[2] ?? 'C'}</text>
        <text className="diagram-vertex" x={intersectingSegments.labels.d.x} y={intersectingSegments.labels.d.y}>{diagram.vertices[3] ?? 'D'}</text>
        <text className="diagram-vertex" x={intersectingSegments.labels.o.x} y={intersectingSegments.labels.o.y}>{diagram.vertices[4] ?? 'O'}</text>
      </g>
    )
  }

  if (diagram.kind === 'circle') {
    return (
      <g className="geometry-diagram" role="img" aria-label={diagram.description}>
        <circle className="diagram-line" cx={circle.center.x} cy={circle.center.y} r={circle.radius} />
        <path className="diagram-auxiliary" d={`M ${circle.center.x} ${circle.center.y} L ${circle.center.x + circle.radius} ${circle.center.y}`} />
        <text className="diagram-vertex" x={circle.labels.center.x} y={circle.labels.center.y}>{diagram.vertices[0] ?? 'O'}</text>
        <text className="diagram-vertex" x={circle.labels.edge.x} y={circle.labels.edge.y}>{diagram.vertices[1] ?? 'A'}</text>
      </g>
    )
  }

  if (diagram.kind in quadrilateral.paths) {
    const kind = diagram.kind as keyof typeof quadrilateral.paths
    return (
      <g className="geometry-diagram" role="img" aria-label={diagram.description}>
        <path className="diagram-line" d={quadrilateral.paths[kind]} />
        <text className="diagram-vertex" x={quadrilateral.labels.a.x} y={quadrilateral.labels.a.y}>{diagram.vertices[0] ?? 'A'}</text>
        <text className="diagram-vertex" x={quadrilateral.labels.b.x} y={quadrilateral.labels.b.y}>{diagram.vertices[1] ?? 'B'}</text>
        <text className="diagram-vertex" x={quadrilateral.labels.c.x} y={quadrilateral.labels.c.y}>{diagram.vertices[2] ?? 'C'}</text>
        <text className="diagram-vertex" x={quadrilateral.labels.d.x} y={quadrilateral.labels.d.y}>{diagram.vertices[3] ?? 'D'}</text>
      </g>
    )
  }

  const trianglePath = `M ${triangle.a.x} ${triangle.a.y} L ${triangle.b.x} ${triangle.b.y} L ${triangle.c.x} ${triangle.c.y} Z`

  return (
    <g className="geometry-diagram" role="img" aria-label={diagram.description}>
      <path className="diagram-line" d={trianglePath} />
      {diagram.kind === 'parallel-line-triangle' && (
        <>
          <path className="diagram-auxiliary" d={parallelLine} />
          <text className="diagram-angle-label" x={parallelLabel.x} y={parallelLabel.y}>p ∥ {diagram.parallelTo ?? 'AB'}</text>
        </>
      )}
      {diagram.kind === 'isosceles-triangle' && (
        <>
          <path className="diagram-mark" d={leftTick} />
          <path className="diagram-mark" d={rightTick} />
          <path className="diagram-angle-arc" d={angleArc} data-angle-arc="B" />
          {diagram.apexAngle && <text className="diagram-angle-label" x={apexAngle.x} y={apexAngle.y}>{diagram.apexAngle}</text>}
        </>
      )}
      {diagram.kind === 'median-triangle' && (
        <>
          <path className="diagram-auxiliary" d={`M ${triangle.b.x} ${triangle.b.y} L ${(triangle.a.x + triangle.c.x) / 2} ${triangle.a.y}`} />
          <text className="diagram-vertex" x={auxiliaryLabel.x} y={auxiliaryLabel.y}>{diagram.auxiliaryLabel ?? 'M'}</text>
        </>
      )}
      {diagram.kind === 'right-triangle' && (
        <>
          <path className="diagram-mark" d={diagram.rightAngleAt === 'C' ? rightAngle.atC : rightAngle.atA} />
          {diagram.exteriorAngle && <>
            <path className="diagram-auxiliary" d={exteriorAngle.extensionAtA} />
            <text className="diagram-angle-label" x={exteriorAngle.label.x} y={exteriorAngle.label.y}>{diagram.exteriorAngle}</text>
          </>}
        </>
      )}
      <text className="diagram-vertex" x={labels.a.x} y={labels.a.y}>{diagram.vertices[0] ?? 'A'}</text>
      <text className="diagram-vertex" x={labels.b.x} y={labels.b.y}>{diagram.vertices[1] ?? 'B'}</text>
      <text className="diagram-vertex" x={labels.c.x} y={labels.c.y}>{diagram.vertices[2] ?? 'C'}</text>
    </g>
  )
}

/* Чертёж как рисунок на общем листе: окно svg обрезано по зоне чертежа,
   поэтому те же координаты дают самостоятельную картинку любой ширины. */
export function NotebookDiagram({ diagram }: { diagram: GeometryDiagramSpec }) {
  const { colors, strokes, typography } = layout
  const { x, y, width, height } = layout.zones.diagram.scene
  if (diagram.kind === 'none') return null
  if (diagram.kind === 'construction' && !diagram.scene) return null
  if (diagram.kind === 'schematic' && !diagram.schematic) return null

  return (
    <figure className="notebook-sheet-diagram">
      {/* Подпись рисунка держит внутренняя группа: у неё уже есть role="img"
          и описание. Второй такой же ярлык на обёртке читалка объявляла бы
          как два разных рисунка на одном чертеже. */}
      <svg viewBox={`${x} ${y} ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        <TriangleDiagram diagram={diagram} />
        <style>{`
          .geometry-diagram { opacity: ${strokes.pencilOpacity}; }
          .diagram-line,.diagram-mark,.diagram-angle-arc,.diagram-auxiliary,.diagram-hidden { fill: none; stroke: ${colors.pencil}; stroke-linecap: round; stroke-linejoin: round; }
          .diagram-line { stroke-width: ${strokes.triangle}px; }
          .diagram-point { fill: ${colors.pencil}; }
          .diagram-paper { fill: ${colors.paper}; stroke: none; }
          .diagram-axis { fill: none; stroke: ${colors.pencil}; stroke-width: ${strokes.marker}px; stroke-linecap: round; stroke-linejoin: round; }
          .diagram-axis-label,.diagram-tick-label { fill: ${colors.pencil}; font-family: ${typography.family}; font-weight: ${typography.weight}; }
          .diagram-axis-label { font-size: ${typography.bodySize}px; }
          .diagram-tick-label { font-size: ${Math.round(typography.bodySize * 0.72)}px; }
          .diagram-mark,.diagram-angle-arc { stroke-width: ${strokes.marker}px; }
          .diagram-auxiliary { stroke-width: ${strokes.marker}px; stroke-dasharray: 10 7; }
          /* Скрытое ребро - настоящее ребро тела, просто за гранью: толщина
             как у видимых рёбер, пунктир чаще, чем у вспомогательной линии. */
          .diagram-hidden { stroke-width: ${strokes.triangle}px; stroke-dasharray: 6 5; }
          .diagram-vertex,.diagram-angle-label { fill: ${colors.pencil}; font-size: ${typography.bodySize}px; }
          .diagram-caption { fill: ${colors.pencil}; font-size: ${typography.goalSize}px; }
        `}</style>
      </svg>
      {diagram.description && <figcaption>{diagram.description}</figcaption>}
    </figure>
  )
}
