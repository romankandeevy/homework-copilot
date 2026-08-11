import { assertGeometryNotebookLayoutV1, geometryNotebookLayoutV1 as layout } from './layouts/geometryNotebookLayoutV1'
import type { GeometryDiagramSpec, GeometryNotebookPageSpec } from './geometry/types'

assertGeometryNotebookLayoutV1()

type PageSegment = {
  lines: readonly string[]
  answer?: string
  continuation: boolean
}

function paginateSolution(spec: GeometryNotebookPageSpec): readonly PageSegment[] {
  const maxLines = spec.answer
    ? layout.zones.solution.maxLinesWithAnswer
    : layout.zones.solution.maxLinesWithoutAnswer
  const segments: PageSegment[] = []

  for (let start = 0; start < spec.solution.length; start += maxLines) {
    segments.push({
      lines: spec.solution.slice(start, start + maxLines),
      continuation: start > 0,
    })
  }

  if (segments.length === 0) {
    segments.push({ lines: [], continuation: false })
  }

  const finalSegment = segments.at(-1)
  if (finalSegment && spec.answer) {
    finalSegment.answer = spec.answer
  }

  return segments
}

function TriangleDiagram({ diagram }: { diagram: GeometryDiagramSpec }) {
  const { triangle, labels, apexAngle, angleArc, leftTick, rightTick } = layout.zones.diagram
  const trianglePath = `M ${triangle.a.x} ${triangle.a.y} L ${triangle.b.x} ${triangle.b.y} L ${triangle.c.x} ${triangle.c.y} Z`

  return (
    <g className="geometry-diagram" role="img" aria-label={diagram.description}>
      <path className="diagram-line" d={trianglePath} />
      {diagram.kind === 'isosceles-triangle' && (
        <>
          <path className="diagram-mark" d={leftTick} />
          <path className="diagram-mark" d={rightTick} />
          <path className="diagram-angle-arc" d={angleArc} data-angle-arc="B" />
          {diagram.apexAngle && <text className="diagram-angle-label" x={apexAngle.x} y={apexAngle.y}>{diagram.apexAngle}</text>}
        </>
      )}
      {diagram.kind === 'median-triangle' && (
        <path className="diagram-auxiliary" d={`M ${triangle.b.x} ${triangle.b.y} L ${(triangle.a.x + triangle.c.x) / 2} ${triangle.a.y}`} />
      )}
      {diagram.kind === 'right-triangle' && (
        <path className="diagram-mark" d={`M ${triangle.a.x + 24} ${triangle.a.y} L ${triangle.a.x + 24} ${triangle.a.y - 24} L ${triangle.a.x + 48} ${triangle.a.y - 24}`} />
      )}
      <text className="diagram-vertex" x={labels.a.x} y={labels.a.y}>{diagram.vertices[0]}</text>
      <text className="diagram-vertex" x={labels.b.x} y={labels.b.y}>{diagram.vertices[1]}</text>
      <text className="diagram-vertex" x={labels.c.x} y={labels.c.y}>{diagram.vertices[2]}</text>
    </g>
  )
}

function NotebookSheet({ spec, segment }: { spec: GeometryNotebookPageSpec; segment: PageSegment }) {
  const { page, colors, marginLine, zones, typography, strokes } = layout
  const isContinuation = segment.continuation

  return (
    <article className="geometry-notebook-page" data-testid="geometry-notebook-page" aria-label={`Лист тетради: задача ${spec.number}${isContinuation ? ', продолжение' : ''}`}>
      <svg viewBox={page.viewBox} preserveAspectRatio="xMidYMin meet" aria-hidden="false">
        <defs>
          <pattern id="geometry-notebook-grid-v1" width={page.gridCell} height={page.gridCell} patternUnits="userSpaceOnUse">
            <path d={`M ${page.gridCell} 0 L 0 0 0 ${page.gridCell}`} fill="none" stroke={colors.grid} strokeWidth="1.2" />
          </pattern>
        </defs>
        <rect width={page.width} height={page.height} fill={colors.paper} />
        <rect width={page.width} height={page.height} fill="url(#geometry-notebook-grid-v1)" />
        <line className="notebook-margin" x1={marginLine.x} x2={marginLine.x} y1="0" y2={page.height} />

        {!isContinuation && (
          <>
            <text className="notebook-number" x={zones.number.x} y={zones.number.y}>№ {spec.number}</text>
            <text className="notebook-title" x={zones.given.x} y={zones.given.titleY}>Дано:</text>
            {spec.given.map((line, index) => (
              <text className="notebook-body" key={line} x={zones.given.x} y={zones.given.firstLineY + index * zones.given.lineStep}>{line}</text>
            ))}
            <line className="notebook-divider" x1={zones.divider.horizontal.startX} x2={zones.divider.horizontal.endX} y1={zones.divider.horizontal.y} y2={zones.divider.horizontal.y} />
            <line className="notebook-divider" x1={zones.divider.vertical.x} x2={zones.divider.vertical.x} y1={zones.divider.vertical.startY} y2={zones.divider.vertical.endY} />
            <text className="notebook-body" x={zones.goal.x} y={zones.goal.y}>{spec.goal.title}: {spec.goal.text}</text>
            <TriangleDiagram diagram={spec.diagram} />
          </>
        )}

        <text className="notebook-title" x={zones.solution.x} y={zones.solution.titleY}>{isContinuation ? 'Решение. (продолжение)' : 'Решение.'}</text>
        {segment.lines.map((line, index) => (
          <text className="notebook-solution" key={`${line}-${index}`} x={zones.solution.x} y={zones.solution.firstLineY + index * zones.solution.lineStep}>{line}</text>
        ))}
        {segment.answer && (
          <text className="notebook-answer" x={zones.solution.x} y={zones.solution.firstLineY + (segment.lines.length - 1) * zones.solution.lineStep + zones.solution.answerGap}>Ответ: {segment.answer}</text>
        )}
        <style>{`
          .notebook-number,.notebook-title,.notebook-body,.notebook-solution,.notebook-answer,.diagram-vertex,.diagram-angle-label { fill: ${colors.ink}; font-family: ${typography.family}; font-weight: ${typography.weight}; letter-spacing: .25px; }
          .notebook-number { font-size: ${typography.numberSize}px; }
          .notebook-title { font-size: ${typography.titleSize}px; }
          .notebook-body { font-size: ${typography.bodySize}px; }
          .notebook-solution,.notebook-answer { font-size: ${typography.solutionSize}px; }
          .notebook-margin { stroke: ${colors.margin}; stroke-width: 2px; }
          .notebook-divider { stroke: ${colors.ink}; stroke-width: ${strokes.divider}px; stroke-linecap: square; }
          .diagram-line,.diagram-mark,.diagram-angle-arc,.diagram-auxiliary { fill: none; stroke: ${colors.ink}; stroke-linecap: round; stroke-linejoin: round; }
          .diagram-line { stroke-width: ${strokes.triangle}px; }
          .diagram-mark,.diagram-angle-arc { stroke-width: ${strokes.marker}px; }
          .diagram-auxiliary { stroke-width: ${strokes.marker}px; stroke-dasharray: 10 7; }
          .diagram-vertex { font-size: ${typography.bodySize}px; }
          .diagram-angle-label { font-size: ${typography.bodySize}px; }
        `}</style>
      </svg>
    </article>
  )
}

export function GeometryNotebookLayoutV1({ spec }: { spec: GeometryNotebookPageSpec }) {
  return (
    <section className="geometry-notebook-document" aria-label={`Решение задачи ${spec.number}`}>
      {paginateSolution(spec).map((segment, index) => (
        <NotebookSheet key={`${spec.id}-${index}`} spec={spec} segment={segment} />
      ))}
    </section>
  )
}
