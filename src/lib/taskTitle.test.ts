import { describe, expect, it } from 'vitest'
import { describeTask, taskTitleLimit } from './taskTitle'
import type { TaskTitleSource } from './taskTitle'

/* Название задачи в «Моих решениях» - не обрубок условия и не «Задача с
   фото» (разбор 14 сентября 2026). */

function task(condition: string, overrides: Partial<TaskTitleSource> = {}): TaskTitleSource {
  return {
    task: condition.slice(0, 60).trim() || 'Задача с фото',
    source: 'text',
    condition,
    goal: { title: 'Найти', text: '' },
    subject: 'Геометрия',
    ...overrides,
  }
}

describe('describeTask', () => {
  it('берёт вопрос задачи, а данные уводит во вторую строку', () => {
    expect(describeTask(task('Диагонали ромба 10 и 24 см. Найдите сторону ромба.'))).toEqual({
      number: null,
      title: 'Найдите сторону ромба',
      detail: 'Диагонали ромба 10 и 24 см.',
    })
  })

  it('находит номер в начале условия и сжимает фразу до формулы', () => {
    const condition = '862. Решите неравенство и изобразите на координатной прямой множество его решений: 0,7x - 7 > 0'
    const result = describeTask(task(condition, { subject: 'Алгебра' }))

    expect(result.number).toBe('№ 862')
    expect(result.title).toBe('Решите неравенство: 0,7x - 7 > 0')
    // Название урезано - ниже условие целиком, без номера.
    expect(result.detail).toBe(condition.slice('862. '.length))
  })

  it('у фотографии название из распознанного условия, а не «Задача с фото»', () => {
    const result = describeTask(task('№ 274. Найдите значение выражения 3,5 · 2 + 4.', {
      task: 'Задача с фото',
      source: 'photo',
      goal: { title: 'Найти', text: 'значение выражения' },
      subject: 'Математика',
    }))

    expect(result).toEqual({ number: '№ 274', title: 'Найдите значение выражения 3,5 · 2 + 4', detail: '' })
  })

  it('не делает названием «Рассмотрите рисунок»', () => {
    expect(describeTask(task('Рассмотрите рисунок. Какие органоиды клетки обозначены цифрами 1-4?', {
      task: 'Задача с фото',
      source: 'photo',
      subject: 'Биология',
    })).title).toBe('Какие органоиды клетки обозначены цифрами 1-4?')
  })

  it('берёт номер учебника у задачи по номеру', () => {
    const result = describeTask(task('Постройте треугольник по трём сторонам.', { task: '274', source: 'number' }))

    expect(result.number).toBe('№ 274')
    expect(result.title).toBe('Постройте треугольник по трём сторонам')
  })

  it('не делает названием вопрос с местоимением', () => {
    expect(describeTask(task('Поезд шёл 3 ч со скоростью 60 км/ч. Сколько километров он прошёл?', { subject: 'Математика' }))).toEqual({
      number: null,
      title: 'Поезд шёл 3 ч со скоростью 60 км/ч',
      detail: 'Сколько километров он прошёл?',
    })
  })

  it('пропускает «Решите задачу» и режет длинное по слову', () => {
    const condition = 'Решите задачу. Из двух городов, расстояние между которыми 300 км, одновременно навстречу друг другу выехали два автомобиля. Через сколько часов они встретятся?'
    const result = describeTask(task(condition, { subject: 'Математика' }))

    expect(result.title.endsWith('…')).toBe(true)
    expect(result.title.length).toBeLessThanOrEqual(taskTitleLimit + 1)
    const kept = result.title.slice(0, -1)
    expect(condition).toContain(kept)
    // Обрыв по границе слова: следующий знак в условии - пробел или запятая.
    expect(condition[condition.indexOf(kept) + kept.length]).toMatch(/[\s,]/u)
    expect(result.detail).toBe(condition)
  })

  it('оставляет вопрос по литературе как есть и не рвёт инициалы', () => {
    expect(describeTask(task('Почему Печорина называют «лишним человеком»?', { subject: 'Литература' })).title)
      .toBe('Почему Печорина называют «лишним человеком»?')
    expect(describeTask(task('В романе А. С. Пушкина «Евгений Онегин» описан бал. Кто из героев танцевал с Татьяной?', { subject: 'Литература' })))
      .toEqual({
        number: null,
        title: 'Кто из героев танцевал с Татьяной?',
        detail: 'В романе А. С. Пушкина «Евгений Онегин» описан бал.',
      })
  })

  it('читает запись «Дано / Найти» построчно', () => {
    expect(describeTask(task('Дано:\nAB = 5 см, BC = 12 см\nНайти: AC'))).toEqual({
      number: null,
      title: 'Найти: AC',
      detail: 'Дано: AB = 5 см, BC = 12 см',
    })
  })

  it('без условия берёт «Найти», без всего - предмет', () => {
    expect(describeTask(task('', { goal: { title: 'Найти', text: 'площадь треугольника.' } })).title).toBe('Найти: площадь треугольника')
    expect(describeTask(task('', { subject: 'Физика' })).title).toBe('Задача по физике')
  })

  it('короткому уравнению добавляет «Найти» второй строкой', () => {
    expect(describeTask(task('Решите уравнение x² - 5x + 6 = 0.', { subject: 'Алгебра', goal: { title: 'Найти', text: 'корни уравнения' } })))
      .toEqual({ number: null, title: 'Решите уравнение x² - 5x + 6 = 0', detail: 'Найти: корни уравнения' })
  })
})
