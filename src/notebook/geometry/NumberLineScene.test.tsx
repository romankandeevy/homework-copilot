import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { NumberLineScene } from './NumberLineScene'
import type { HomeworkNumberLine } from '../../lib/homeworkContract'

/* Неравенства а-г с прода 9 сентября: ответ был верным, чертежа не было
   вовсе, хотя условие просило изобразить множество решений на прямой. */
const inequalities: HomeworkNumberLine = {
  lines: [
    {
      label: 'а)',
      variable: 'x',
      marks: [{ value: -2.5, label: '-2,5', filled: false }],
      regions: [{ from: -2.5, to: null }],
    },
    {
      label: 'в)',
      variable: 'x',
      marks: [{ value: 0, label: '0', filled: true }],
      regions: [{ from: 0, to: null }],
    },
    {
      label: 'г)',
      variable: 'x',
      marks: [{ value: -2.5, label: '-2,5', filled: false }],
      regions: [{ from: null, to: -2.5 }],
    },
  ],
}

describe('NumberLineScene', () => {
  it('рисует по прямой на пункт: ось, закрашенный луч и границу', () => {
    const { container } = render(<svg>
      <NumberLineScene numberLine={inequalities} description="Множества решений" />
    </svg>)

    expect(container.querySelectorAll('.number-line-row')).toHaveLength(3)
    expect(container.querySelectorAll('.number-line-region')).toHaveLength(3)
    expect(container.querySelectorAll('.number-line-hatch').length).toBeGreaterThan(3)
    expect(container.textContent).toContain('а)')
    expect(container.textContent).toContain('-2,5')
  })

  it('строгая граница выколота, нестрогая закрашена', () => {
    const { container } = render(<svg>
      <NumberLineScene numberLine={inequalities} description="" />
    </svg>)

    expect(container.querySelectorAll('.number-line-point-hollow')).toHaveLength(2)
    expect(container.querySelectorAll('.number-line-point-filled')).toHaveLength(1)
  })

  it('уголок закрыт стенкой у точки и открыт со стороны бесконечности', () => {
    const { container } = render(<svg>
      <NumberLineScene numberLine={{ lines: [inequalities.lines[0]] }} description="" />
    </svg>)

    const axis = container.querySelector('path.diagram-axis')?.getAttribute('d') ?? ''
    const cap = container.querySelector('.number-line-cap')?.getAttribute('d') ?? ''
    const axisEnd = Number(axis.split('L')[1].trim().split(' ')[0])
    const axisStart = Number(axis.split('M')[1].trim().split(' ')[0])
    const capPoints = [...cap.matchAll(/([ML]) (-?[\d.]+) (-?[\d.]+)/gu)]

    // Стенка у -2,5: путь начинается на оси и идёт вверх той же вертикалью.
    expect(capPoints[0][1]).toBe('M')
    expect(Number(capPoints[0][2])).toBeCloseTo(Number(capPoints[1][2]), 5)
    expect(Number(capPoints[1][3])).toBeLessThan(Number(capPoints[0][3]))
    // Луч уходит вправо до стрелки и там обрывается без стенки.
    expect(capPoints).toHaveLength(3)
    expect(Number(capPoints[2][2])).toBeLessThan(axisEnd)
    expect(Number(capPoints[0][2])).toBeGreaterThan(axisStart + 20)
  })

  it('пустая прямая не рисуется', () => {
    const { container } = render(<svg><NumberLineScene numberLine={{ lines: [] }} description="" /></svg>)
    expect(container.querySelector('.number-line')).toBeNull()
  })
})
