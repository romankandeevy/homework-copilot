export const geometryNotebookLayoutV1 = {
  id: 'GeometryNotebookLayoutV1',
  version: 1,
  page: {
    width: 1086,
    height: 1448,
    gridCell: 47.5,
    viewBox: '0 0 1086 1448',
  },
  colors: {
    paper: '#fffefd',
    grid: '#99d5f2',
    margin: '#ec7d89',
    ink: '#0751a9',
  },
  typography: {
    family: "'Comic Sans MS', 'Segoe Print', 'Ink Free', cursive",
    numberSize: 42,
    bodySize: 42,
    titleSize: 44,
    solutionSize: 40,
    weight: 700,
  },
  marginLine: {
    x: 36.5,
  },
  zones: {
    number: { x: 64, y: 62 },
    given: {
      x: 65,
      titleY: 166,
      firstLineY: 230,
      lineStep: 64,
    },
    divider: {
      horizontal: { startX: 48, endX: 421, y: 416 },
      vertical: { x: 421, startY: 90, endY: 558 },
    },
    goal: { x: 64, y: 473 },
    diagram: {
      triangle: {
        a: { x: 479, y: 535 },
        b: { x: 756, y: 142 },
        c: { x: 1032, y: 535 },
      },
      labels: {
        a: { x: 445, y: 565 },
        b: { x: 744, y: 126 },
        c: { x: 1040, y: 568 },
      },
      apexAngle: { x: 722, y: 244 },
      angleArc: 'M 722 181 Q 756 210 790 181',
      leftTick: 'M 609 317 L 632 332',
      rightTick: 'M 879 332 L 902 317',
    },
    solution: {
      x: 64,
      titleY: 651,
      firstLineY: 738,
      lineStep: 84,
      answerGap: 84,
      maxLinesWithAnswer: 6,
      maxLinesWithoutAnswer: 7,
    },
  },
  strokes: {
    divider: 3.4,
    triangle: 4.2,
    marker: 3.5,
  },
  invariants: {
    angleArcCountAtB: 1,
    solutionAlignment: 'left',
    gridAligned: true,
  },
} as const

export type GeometryNotebookLayoutV1 = typeof geometryNotebookLayoutV1

export function assertGeometryNotebookLayoutV1(layout: GeometryNotebookLayoutV1 = geometryNotebookLayoutV1) {
  const { horizontal, vertical } = layout.zones.divider

  if (layout.invariants.angleArcCountAtB !== 1) {
    throw new Error('GeometryNotebookLayoutV1 must render exactly one angle arc at B.')
  }

  if (horizontal.endX !== vertical.x) {
    throw new Error('GeometryNotebookLayoutV1 dividers must meet without a gap.')
  }

  if (layout.invariants.solutionAlignment !== 'left' || !layout.invariants.gridAligned) {
    throw new Error('GeometryNotebookLayoutV1 text must remain left aligned and grid aligned.')
  }

  return true
}
