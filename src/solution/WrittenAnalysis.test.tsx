import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WrittenAnalysis, analysisLegend } from './WrittenAnalysis'
import type { HomeworkWrittenAnalysis } from '../lib/homeworkContract'

const sentenceParse: HomeworkWrittenAnalysis = {
  version: 1,
  kind: 'sentence-parse',
  blocks: [{
    lines: [{
      kind: 'sentence',
      tokens: [
        { text: 'Ветер', mark: 'single', note: 'подлежащее' },
        { text: 'гонит', mark: 'double', note: 'сказуемое' },
        { text: 'сухие', mark: 'wavy', note: 'определение' },
        { text: 'листья', mark: 'dashed', note: 'дополнение' },
        { text: 'по дороге', mark: 'dash-dot', note: 'обстоятельство' },
        { text: '.' },
      ],
    }],
  }],
}

const morphemes: HomeworkWrittenAnalysis = {
  version: 1,
  kind: 'morphemes',
  blocks: [{
    lines: [{
      kind: 'word',
      tokens: [
        { text: 'при', mark: 'prefix', note: 'приставка' },
        { text: 'город', mark: 'root', note: 'корень', tight: true },
        { text: 'н', mark: 'suffix', note: 'суффикс', tight: true },
        { text: 'ый', mark: 'ending', note: 'окончание', tight: true },
      ],
    }],
  }],
}

const markOf = (word: string) => screen.getByText(word).closest('.analysis-token')?.getAttribute('data-mark')

describe('WrittenAnalysis', () => {
  it('подчёркивает члены предложения по школьному стандарту', () => {
    render(<WrittenAnalysis analysis={sentenceParse} />)

    expect(markOf('Ветер')).toBe('single')
    expect(markOf('гонит')).toBe('double')
    expect(markOf('сухие')).toBe('wavy')
    expect(markOf('листья')).toBe('dashed')
    expect(markOf('по дороге')).toBe('dash-dot')
    // Служебные знаки остаются без значка.
    expect(markOf('.')).toBe('none')
  })

  it('ставит значки морфем и пишет части слова вплотную', () => {
    render(<WrittenAnalysis analysis={morphemes} />)

    expect(markOf('при')).toBe('prefix')
    expect(markOf('город')).toBe('root')
    expect(markOf('н')).toBe('suffix')
    expect(markOf('ый')).toBe('ending')
    expect(screen.getByText('город').closest('.analysis-token')).toHaveClass('is-tight')
    expect(screen.getByText('при').closest('.analysis-token')).not.toHaveClass('is-tight')
  })

  it('рисует значки геометрией, а не символами', () => {
    const { container } = render(<WrittenAnalysis analysis={morphemes} />)

    // Крышка суффикса — ломаная, а не глиф ∧.
    expect(container.querySelector('.analysis-token-cap path')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/[∧¬_]/u)
  })

  it('озвучивает значок словами для экранного диктора', () => {
    render(<WrittenAnalysis analysis={sentenceParse} />)

    const subject = screen.getByText('Ветер').closest('.analysis-token')
    expect(subject?.textContent).toContain('подлежащее')
  })

  it('собирает условные обозначения из пояснений без повторов', () => {
    const legend = analysisLegend(sentenceParse.blocks)

    expect(legend.map((entry) => entry.mark)).toEqual(['single', 'double', 'wavy', 'dashed', 'dash-dot'])
    expect(legend[0].label).toBe('подлежащее')
  })

  it('берёт стандартную подпись значка, когда пояснения нет', () => {
    const legend = analysisLegend([{ lines: [{ tokens: [{ text: 'дом', mark: 'single' }] }] }])

    expect(legend).toEqual([{ mark: 'single', label: 'подлежащее' }])
  })

  it('показывает формулу с подстановкой и выделенным ответом', () => {
    const { container } = render(<WrittenAnalysis analysis={{
      version: 1,
      kind: 'formula',
      blocks: [{
        lines: [
          { kind: 'formula', lead: 'Формула', tokens: [{ text: 'v = s/t' }] },
          { kind: 'formula', lead: 'Подстановка', tokens: [{ text: 'v = 120 км / 2 ч' }] },
          { kind: 'formula', lead: 'Ответ', tokens: [{ text: '60 км/ч', mark: 'box', note: 'ответ' }] },
        ],
      }],
    }} />)

    expect(screen.getByText('Формула')).toBeInTheDocument()
    expect(markOf('60 км/ч')).toBe('box')
    expect(container.querySelectorAll('.analysis-line-formula')).toHaveLength(3)
  })

  it('не рисует раздел, когда разбора нет', () => {
    const { container } = render(<WrittenAnalysis analysis={{ version: 1, kind: 'generic', blocks: [] }} />)

    expect(container.querySelector('.written-analysis')).toBeNull()
  })
})
