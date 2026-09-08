import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SolutionCard } from './SolutionCard'
import type { HomeworkSolution } from '../lib/homeworkContract'

/* Карточка отвечает на три вопроса до открытия: что за задача, как
   выглядит запись, какой ответ. Раньше в списке была строка с номером и
   временем - чтобы понять, что там, приходилось открывать. */

function solution(overrides: Partial<HomeworkSolution> = {}): HomeworkSolution {
  return {
    engineVersion: 3,
    textbookId: 'chemistry',
    task: 'Смесь Mg, Al, Cu массой 15,0 г',
    source: 'text',
    textbookEdition: '',
    sourceUrl: '',
    conditionNormalized: '',
    subject: 'Химия',
    textbookTitle: '',
    condition: 'Смесь Mg, Al, Cu массой 15,0 г + избыток HCl → 13,44 л H₂, остаток 3,0 г. Найти массовые доли металлов.',
    given: ['m(смеси) = 15,0 г'],
    goal: { title: 'Найти', text: 'w(Mg), w(Al), w(Cu)' },
    steps: [
      'Медь не реагирует с HCl: m(Cu) = 3,0 г',
      'n(H₂) = 13,44 / 22,4 = 0,6 моль',
      'Mg + 2HCl = MgCl₂ + H₂↑',
      '2Al + 6HCl = 2AlCl₃ + 3H₂↑',
      '24x + 27y = 12,0; x + 1,5y = 0,6',
      'w(Mg) = 4,8 / 15,0 = 0,32',
    ],
    answer: 'w(Mg) = 32%, w(Al) = 48%, w(Cu) = 20%',
    diagram: { kind: 'none', description: '', vertices: [] },
    sourceVerified: true,
    taskType: 'calculation',
    createdAt: '2026-09-07T19:01:00.000Z',
    ...overrides,
  }
}

describe('SolutionCard', () => {
  it('показывает предмет, условие, три первые строки и ответ', () => {
    render(<SolutionCard solution={solution()} subject="Химия" time="19:01" onOpen={() => {}} />)

    expect(screen.getByText('Химия')).toBeTruthy()
    expect(screen.getByText(/Смесь Mg, Al, Cu массой 15,0 г/u)).toBeTruthy()
    expect(screen.getByText('Медь не реагирует с HCl: m(Cu) = 3,0 г')).toBeTruthy()
    expect(screen.getByText('Mg + 2HCl = MgCl₂ + H₂↑')).toBeTruthy()
    // Четвёртой строки на карточке нет: её место - в решении.
    expect(screen.queryByText('2Al + 6HCl = 2AlCl₃ + 3H₂↑')).toBeNull()
    // Вместо затухания - честная цифра.
    expect(screen.getByText('ещё 3 строки')).toBeTruthy()
    expect(screen.getByText('w(Mg) = 32%, w(Al) = 48%, w(Cu) = 20%')).toBeTruthy()
  })

  it('открывает решение по нажатию на всю карточку', () => {
    const onOpen = vi.fn()
    render(<SolutionCard solution={solution()} subject="Химия" time="19:01" onOpen={onOpen} />)

    screen.getByRole('button').click()

    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('снимает нумерацию, которую модель проставила сама', () => {
    render(<SolutionCard
      solution={solution({ steps: ['1) A(8,4) = 1680'] })}
      subject="Математика"
      time="18:42"
      onOpen={() => {}}
    />)

    expect(screen.getByText('A(8,4) = 1680')).toBeTruthy()
    expect(screen.queryByText('ещё', { exact: false })).toBeNull()
  })

  it('помечает чертёж и показывает программу вместо шагов', () => {
    render(<SolutionCard
      solution={solution({
        subject: 'Информатика',
        diagram: { kind: 'construction', description: 'Схема', vertices: [] },
        code: { language: 'python', text: 'count = {0: 1}\ns = 0\nans = 0\nfor x in arr:\n    s = (s + x) % k' },
      })}
      subject="Информатика"
      time="19:19"
      onOpen={() => {}}
    />)

    expect(screen.getByText('чертёж')).toBeTruthy()
    expect(screen.getByText('python')).toBeTruthy()
    expect(screen.getByText('count = {0: 1}')).toBeTruthy()
    expect(screen.queryByText('for x in arr:')).toBeNull()
    expect(screen.getByText('ещё 2 строки')).toBeTruthy()
  })

  it('у сочинения считает абзацы, а не строки', () => {
    render(<SolutionCard
      solution={solution({
        subject: 'Литература',
        taskType: 'mixed',
        steps: ['Первый абзац.', 'Второй абзац.', 'Третий абзац.', 'Четвёртый абзац.'],
      })}
      subject="Литература"
      time="19:27"
      onOpen={() => {}}
    />)

    expect(screen.getByText('ещё 1 абзац')).toBeTruthy()
  })
})
