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
    family: "'Onest', 'Segoe UI', sans-serif",
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
      compact: {
        maxCharacters: 22,
        firstLineY: 230,
        lineStep: 44,
        fontSize: 32,
        maxLines: 4,
      },
      dense: {
        maxCharacters: 30,
        firstLineY: 214,
        lineStep: 32,
        fontSize: 24,
        lastLineY: 390,
        fontToLineRatio: 0.8,
      },
    },
    divider: {
      horizontal: { startX: 48, endX: 421, y: 416 },
      vertical: { x: 421, startY: 90, endY: 558 },
    },
    goal: {
      x: 64,
      y: 473,
      compact: {
        maxCharacters: 20,
        lineStep: 38,
        fontSize: 28,
        lastLineY: 545,
        fontToLineRatio: 0.8,
      },
    },
    diagram: {
      scene: {
        x: 455,
        y: 96,
        width: 575,
        height: 455,
        padding: 28,
        localMin: 0,
        localMax: 100,
        pointRadius: 5,
        labelOffsetX: 12,
        labelOffsetY: -12,
        objectLabelOffsetY: -14,
        lineLabelOffsetX: 0,
        lineLabelOffsetY: 34,
        lineExtensionFactor: 5,
        angleRadius: 31,
        rightAngleSize: 24,
        equalSegmentTickHalf: 10,
        parallelMarkHalf: 12,
        parallelMarkGap: 12,
      },
      threePointLines: {
        paths: [
          'M 476 550 L 798 100',
          'M 712 100 L 1035 550',
          'M 455 460 L 1040 460',
        ],
        points: {
          a: { x: 540, y: 460 },
          b: { x: 755, y: 160 },
          c: { x: 970, y: 460 },
        },
        labels: {
          a: { x: 510, y: 500 },
          b: { x: 742, y: 140 },
          c: { x: 982, y: 500 },
        },
      },
      threeLinesCases: {
        distinct: {
          paths: [
            'M 470 430 L 720 430',
            'M 485 520 L 685 150',
            'M 500 170 L 710 515',
          ],
          points: {
            a: { x: 534, y: 430 },
            b: { x: 592, y: 322 },
            c: { x: 658, y: 430 },
          },
          labels: {
            a: { x: 505, y: 465 },
            b: { x: 568, y: 305 },
            c: { x: 668, y: 465 },
          },
          caption: { x: 580, y: 548, text: 'n = 3' },
        },
        common: {
          paths: [
            'M 770 330 L 1025 330',
            'M 790 510 L 1000 150',
            'M 790 150 L 1000 510',
          ],
          point: { x: 895, y: 330 },
          label: { x: 908, y: 315 },
          caption: { x: 895, y: 548, text: 'n = 1' },
        },
      },
      threeCollinearOneOffLines: {
        paths: [
          'M 455 450 L 1035 450',
          'M 797 114 L 489 534',
          'M 755 96 L 755 550',
          'M 714 114 L 1022 534',
        ],
        points: {
          a: { x: 550, y: 450 },
          b: { x: 755, y: 450 },
          c: { x: 960, y: 450 },
          d: { x: 755, y: 170 },
        },
        labels: {
          a: { x: 522, y: 490 },
          b: { x: 708, y: 500 },
          c: { x: 972, y: 490 },
          d: { x: 700, y: 150 },
          line: { x: 1010, y: 435 },
        },
      },
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
      sourceImage: {
        x: 455,
        y: 96,
        width: 575,
        height: 455,
      },
    },
    solution: {
      x: 64,
      maxCharacters: 39,
      titleY: 651,
      firstLineY: 738,
      lineStep: 84,
      answerGap: 84,
      maxLinesWithAnswer: 7,
      maxLinesWithoutAnswer: 8,
      continuation: {
        titleY: 94,
        firstLineY: 181,
        maxLinesWithAnswer: 14,
        maxLinesWithoutAnswer: 15,
      },
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
