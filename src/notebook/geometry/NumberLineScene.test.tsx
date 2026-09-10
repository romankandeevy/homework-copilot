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
      answer: 'x ∈ (-2,5; +∞)',
      marks: [{ value: -2.5, label: '-2,5', filled: false }],
      regions: [{ from: -2.5, to: null }],
    },
    {
      label: 'в)',
      variable: 'x',
      answer: 'x ∈ [0; +∞)',
      marks: [{ value: 0, label: '0', filled: true }],
      regions: [{ from: 0, to: null }],
    },
    {
      label: 'г)',
      variable: 'x',
      answer: 'x ∈ (-∞; -2,5)',
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

  /* Образец 10 сентября: штрихи растут от оси и обрываются у точки,
     без крышки над штриховкой. */
  it('штрихует над осью от точки до стрелки, без крышки', () => {
    const { container } = render(<svg>
      <NumberLineScene numberLine={{ lines: [inequalities.lines[0]] }} description="" />
    </svg>)

    const axis = container.querySelector('path.diagram-axis')?.getAttribute('d') ?? ''
    const axisStart = Number(axis.split('M')[1].trim().split(' ')[0])
    const axisEnd = Number(axis.split('L')[1].trim().split(' ')[0])
    const band = container.querySelector('.number-line-region clipPath rect')
    const bandFrom = Number(band?.getAttribute('x'))
    const bandTo = bandFrom + Number(band?.getAttribute('width'))
    const point = Number(container.querySelector('.number-line-point-hollow')?.getAttribute('cx'))

    expect(container.querySelector('.number-line-cap')).toBeNull()
    expect(bandFrom).toBeCloseTo(point, 5)
    expect(bandFrom).toBeGreaterThan(axisStart + 20)
    expect(bandTo).toBeLessThan(axisEnd)
  })

  it('пустая прямая не рисуется', () => {
    const { container } = render(<svg><NumberLineScene numberLine={{ lines: [] }} description="" /></svg>)
    expect(container.querySelector('.number-line')).toBeNull()
  })
})
