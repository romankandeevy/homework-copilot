import { assertGeometryNotebookLayoutV1, geometryNotebookLayoutV1 as layout } from './layouts/geometryNotebookLayoutV1'
import type { GeometryDiagramSpec, GeometryNotebookPageSpec } from './geometry/types'

assertGeometryNotebookLayoutV1()

type PageSegment = {
  lines: readonly string[]
  answerLines?: readonly string[]
  continuation: boolean
}

function wrapText(line: string, maxCharacters: number) {
  if (line.length <= maxCharacters) return [line]
  const words = line.split(/\s+/).filter(Boolean)
  const wrapped: string[] = []
  let current = ''

  for (const word of words) {
    if (current && `${current} ${word}`.length > maxCharacters) {
      wrapped.push(current)
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current) wrapped.push(current)
  return wrapped.length > 0 ? wrapped : [line]
}

function fitLinesToZone(
  lineCount: number,
  firstLineY: number,
  preferredLineStep: number,
  lastLineY: number,
  preferredFontSize: number,
  fontToLineRatio: number,
) {
  const lineStep = lineCount > 1
    ? Math.min(preferredLineStep, (lastLineY - firstLineY) / (lineCount - 1))
    : preferredLineStep
  return {
    lineStep,
    fontSize: Math.min(preferredFontSize, lineStep * fontToLineRatio),
  }
}

function paginateSolution(spec: GeometryNotebookPageSpec): readonly PageSegment[] {
  const segments: PageSegment[] = []
  const solutionLines = spec.solution.flatMap((line) => wrapText(line, layout.zones.solution.maxCharacters))
  const answerLines = spec.answer
    ? wrapText(`Ответ: ${spec.answer}`, layout.zones.solution.maxCharacters)
    : []
  let start = 0

  do {
    const continuation = start > 0
    const zone = continuation ? layout.zones.solution.continuation : layout.zones.solution
    const remaining = solutionLines.length - start
    const maxLinesWithAnswer = Math.min(
      zone.maxLinesWithAnswer,
      Math.max(0, zone.maxLinesWithoutAnswer - answerLines.length),
    )
    const fitsWithAnswer = answerLines.length > 0 && remaining <= maxLinesWithAnswer
    const maxLines = fitsWithAnswer
      ? maxLinesWithAnswer
      : answerLines.length > 0
        ? Math.min(zone.maxLinesWithoutAnswer, Math.max(1, remaining - 1))
        : zone.maxLinesWithoutAnswer
    const lines = solutionLines.slice(start, start + maxLines)
    start += lines.length
    const isFinal = start >= solutionLines.length
    segments.push({
      lines,
      continuation,
      ...(isFinal && fitsWithAnswer ? { answerLines } : {}),
    })
  } while (start < solutionLines.length)

  return segments
}

function TriangleDiagram({ diagram }: { diagram: GeometryDiagramSpec }) {
  const { threePointLines, threeLinesCases, threeCollinearOneOffLines, triangle, labels, apexAngle, angleArc, leftTick, rightTick, rightAngle, exteriorAngle, auxiliaryLabel, parallelLine, parallelLabel, intersectingSegments, quadrilateral, circle } = layout.zones.diagram
  if (diagram.kind === 'none') return null

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

function NotebookSheet({ spec, segment }: { spec: GeometryNotebookPageSpec; segment: PageSegment }) {
  const { page, colors, zones, typography, strokes } = layout
  const isContinuation = segment.continuation
  const solutionTitleY = isContinuation ? zones.solution.continuation.titleY : zones.solution.titleY
  const solutionFirstLineY = isContinuation ? zones.solution.continuation.firstLineY : zones.solution.firstLineY
  const compactGiven = spec.given.flatMap((line) => wrapText(line, zones.given.compact.maxCharacters))
  const denseGiven = spec.given.flatMap((line) => wrapText(line, zones.given.dense.maxCharacters))
  const usesCompactGiven = compactGiven.length > spec.given.length && compactGiven.length <= zones.given.compact.maxLines
  const usesDenseGiven = compactGiven.length > zones.given.compact.maxLines
  const givenLines = usesDenseGiven ? denseGiven : usesCompactGiven ? compactGiven : spec.given
  const denseGivenLayout = fitLinesToZone(
    givenLines.length,
    zones.given.dense.firstLineY,
    zones.given.dense.lineStep,
    zones.given.dense.lastLineY,
    zones.given.dense.fontSize,
    zones.given.dense.fontToLineRatio,
  )
  const givenFirstLineY = usesDenseGiven ? zones.given.dense.firstLineY : usesCompactGiven ? zones.given.compact.firstLineY : zones.given.firstLineY
  const givenLineStep = usesDenseGiven ? denseGivenLayout.lineStep : usesCompactGiven ? zones.given.compact.lineStep : zones.given.lineStep
  const goalText = `${spec.goal.title}: ${spec.goal.text}`
  const goalLines = wrapText(goalText, zones.goal.compact.maxCharacters)
  const usesCompactGoal = goalLines.length > 1
  const compactGoalLayout = fitLinesToZone(
    goalLines.length,
    zones.goal.y,
    zones.goal.compact.lineStep,
    zones.goal.compact.lastLineY,
    zones.goal.compact.fontSize,
    zones.goal.compact.fontToLineRatio,
  )

  return (
    <article className="geometry-notebook-page" data-testid="geometry-notebook-page" aria-label={`Лист тетради: задача ${spec.number}${isContinuation ? ', продолжение' : ''}`}>
      <svg viewBox={page.viewBox} preserveAspectRatio="xMidYMin meet" aria-hidden="false">
        <rect width={page.width} height={page.height} fill={colors.paper} />
        {!isContinuation && (
          <>
            <text className="notebook-number" x={zones.number.x} y={zones.number.y}>№ {spec.number}</text>
            <text className="notebook-title" x={zones.given.x} y={zones.given.titleY}>Дано:</text>
            {givenLines.map((line, index) => (
              <text
                className={`notebook-body${usesDenseGiven ? ' notebook-body-dense' : usesCompactGiven ? ' notebook-body-compact' : ''}`}
                key={`${line}-${index}`}
                x={zones.given.x}
                y={givenFirstLineY + index * givenLineStep}
                style={usesDenseGiven ? { fontSize: denseGivenLayout.fontSize } : undefined}
              >{line}</text>
            ))}
            <line className="notebook-divider" x1={zones.divider.horizontal.startX} x2={zones.divider.horizontal.endX} y1={zones.divider.horizontal.y} y2={zones.divider.horizontal.y} />
            <line className="notebook-divider" x1={zones.divider.vertical.x} x2={zones.divider.vertical.x} y1={zones.divider.vertical.startY} y2={zones.divider.vertical.endY} />
            {goalLines.map((line, index) => (
              <text
                className={`notebook-goal${usesCompactGoal ? ' notebook-goal-compact' : ''}`}
                key={`${line}-${index}`}
                x={zones.goal.x}
                y={zones.goal.y + index * compactGoalLayout.lineStep}
                style={usesCompactGoal ? { fontSize: compactGoalLayout.fontSize } : undefined}
              >{line}</text>
            ))}
            {spec.sourceDiagram ? (
              <image
                className="source-diagram-image"
                x={zones.diagram.sourceImage.x}
                y={zones.diagram.sourceImage.y}
                width={zones.diagram.sourceImage.width}
                height={zones.diagram.sourceImage.height}
                href={spec.sourceDiagram.imageUrl}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label={spec.sourceDiagram.alt}
              />
            ) : <TriangleDiagram diagram={spec.diagram} />}
          </>
        )}

        <text className="notebook-title" x={zones.solution.x} y={solutionTitleY}>{isContinuation ? 'Решение. (продолжение)' : 'Решение.'}</text>
        {segment.lines.map((line, index) => (
          <text className="notebook-solution" key={`${line}-${index}`} x={zones.solution.x} y={solutionFirstLineY + index * zones.solution.lineStep}>{line}</text>
        ))}
        {segment.answerLines?.map((line, index) => (
          <text className="notebook-answer" key={`${line}-${index}`} x={zones.solution.x} y={solutionFirstLineY + Math.max(0, segment.lines.length - 1) * zones.solution.lineStep + zones.solution.answerGap + index * zones.solution.lineStep}>{line}</text>
        ))}
        <style>{`
          .notebook-number,.notebook-title,.notebook-body,.notebook-goal,.notebook-solution,.notebook-answer,.diagram-vertex,.diagram-angle-label,.diagram-caption { fill: ${colors.ink}; font-family: ${typography.family}; font-weight: ${typography.weight}; letter-spacing: .25px; }
          .notebook-number { font-size: ${typography.numberSize}px; }
          .notebook-title { font-size: ${typography.titleSize}px; }
          .notebook-body { font-size: ${typography.bodySize}px; }
          .notebook-goal { font-size: ${typography.goalSize}px; }
          .notebook-body-compact { font-size: ${zones.given.compact.fontSize}px; }
          .notebook-body-dense { font-size: ${zones.given.dense.fontSize}px; }
          .notebook-goal-compact { font-size: ${zones.goal.compact.fontSize}px; }
          .notebook-solution,.notebook-answer { font-size: ${typography.solutionSize}px; }
          .notebook-divider { stroke: ${colors.ink}; stroke-width: ${strokes.divider}px; stroke-linecap: square; }
          .geometry-diagram { opacity: ${strokes.pencilOpacity}; }
          .diagram-line,.diagram-mark,.diagram-angle-arc,.diagram-auxiliary { fill: none; stroke: ${colors.pencil}; stroke-linecap: round; stroke-linejoin: round; }
          .diagram-line { stroke-width: ${strokes.triangle}px; }
          .diagram-point { fill: ${colors.pencil}; }
          .diagram-mark,.diagram-angle-arc { stroke-width: ${strokes.marker}px; }
          .diagram-auxiliary { stroke-width: ${strokes.marker}px; stroke-dasharray: 10 7; }
          .diagram-vertex,.diagram-angle-label { fill: ${colors.pencil}; font-size: ${typography.bodySize}px; }
          .diagram-caption { fill: ${colors.pencil}; font-size: ${typography.goalSize}px; }
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
