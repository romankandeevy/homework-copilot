export const geometryNotebookLayoutV1 = {
  id: 'GeometryNotebookLayoutV1',
  version: 1,
  page: {
    width: 1086,
    height: 1448,
    viewBox: '0 0 1086 1448',
  },
  colors: {
    paper: '#fffefd',
    ink: '#000000',
    pencil: '#565656',
  },
  typography: {
    family: "'Segoe Print', 'Ink Free', 'Comic Sans MS', cursive",
    numberSize: 42,
    bodySize: 42,
    goalSize: 34,
    titleSize: 44,
    solutionSize: 40,
    weight: 700,
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
      rightAngle: {
        atA: 'M 503 535 L 503 511 L 527 511',
        atC: 'M 1008 535 L 1008 511 L 984 511',
      },
      exteriorAngle: {
        extensionAtA: 'M 479 535 L 370 535',
        label: { x: 390, y: 505 },
      },
      auxiliaryLabel: { x: 744, y: 565 },
      parallelLine: 'M 728 535 L 880 319',
      parallelLabel: { x: 811, y: 429 },
      intersectingSegments: {
        first: 'M 505 477 L 1000 198',
        second: 'M 521 195 L 981 491',
        labels: {
          a: { x: 478, y: 520 },
          b: { x: 1008, y: 196 },
          c: { x: 485, y: 190 },
          d: { x: 992, y: 524 },
          o: { x: 773, y: 354 },
        },
      },
      quadrilateral: {
        paths: {
          parallelogram: 'M 508 476 L 620 205 L 990 205 L 878 476 Z',
          rectangle: 'M 505 228 L 1006 228 L 1006 472 L 505 472 Z',
          rhombus: 'M 500 348 L 754 162 L 1008 348 L 754 534 Z',
          square: 'M 615 178 L 951 178 L 951 514 L 615 514 Z',
          trapezoid: 'M 497 485 L 638 211 L 883 211 L 1030 485 Z',
        },
        labels: {
          a: { x: 477, y: 516 },
          b: { x: 595, y: 191 },
          c: { x: 1005, y: 191 },
          d: { x: 1021, y: 518 },
        },
      },
      circle: {
        center: { x: 759, y: 339 },
        radius: 187,
        labels: {
          center: { x: 772, y: 327 },
          edge: { x: 936, y: 323 },
        },
      },
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
    pencilOpacity: 0.84,
  },
  invariants: {
    hasAngleArcAtB: true,
    solutionAlignment: 'left',
    baselineAligned: true,
  },
} as const

export type GeometryNotebookLayoutV1 = typeof geometryNotebookLayoutV1

export function assertGeometryNotebookLayoutV1(layout: GeometryNotebookLayoutV1 = geometryNotebookLayoutV1) {
  const { horizontal, vertical } = layout.zones.divider

  if (!layout.invariants.hasAngleArcAtB) {
    throw new Error('GeometryNotebookLayoutV1 must keep the B angle-arc path.')
  }

  if (horizontal.endX !== vertical.x) {
    throw new Error('GeometryNotebookLayoutV1 dividers must meet without a gap.')
  }

  if (layout.invariants.solutionAlignment !== 'left' || !layout.invariants.baselineAligned) {
    throw new Error('GeometryNotebookLayoutV1 text must remain left aligned and baseline aligned.')
  }

  return true
}
