import { describe, expect, it } from 'vitest'
import { evaluateExpression, verifyAnswerDerivation, verifyWorksheet, verifyWorksheetDerivation } from './worksheet.ts'

/* Живой отказ 6 сентября: обе модели уронили ровно один множитель в
   переборе случаев, а сложили правильно. Проверка формата такого не видит,
   калькулятор - видит. */

describe('калькулятор черновика', () => {
  it('считает школьные обозначения', () => {
    expect(evaluateExpression('C(3,3)*C(3,1)*C(3,1)')).toBe(9)
    expect(evaluateExpression('9 · 9 · 8 · 7 · 6 · 5')).toBe(136080)
    expect(evaluateExpression('5!')).toBe(120)
    expect(evaluateExpression('5! − 4!')).toBe(96)
    expect(evaluateExpression('A(5,2)')).toBe(20)
    expect(evaluateExpression('2^10')).toBe(1024)
    expect(evaluateExpression('√144')).toBe(12)
    expect(evaluateExpression('(1 + 2) * (3 + 4)')).toBe(21)
    // Кириллическая «С» в C(n,k) приходит от модели постоянно.
    expect(evaluateExpression('С(3,2)')).toBe(3)
  })

  it('понимает запятую в десятичной дроби', () => {
    expect(evaluateExpression('0,5 + 0,25')).toBe(0.75)
  })

  it('возвращает null там, где считать нечего или опасно', () => {
    expect(evaluateExpression('process.exit(1)')).toBeNull()
    expect(evaluateExpression('fetch("http://x")')).toBeNull()
    expect(evaluateExpression('1/0')).toBeNull()
    expect(evaluateExpression('')).toBeNull()
    expect(evaluateExpression('сторона ромба')).toBeNull()
    expect(evaluateExpression('1000!')).toBeNull()
  })
})

describe('проверка черновика', () => {
  it('ловит потерянный множитель - тот самый отказ 6 сентября', () => {
    const issues = verifyWorksheet([
      { label: '3 из первой группы, по 1 из второй и третьей', expression: 'C(3,3)*C(3,1)*C(3,1)', value: '3' },
    ])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('даёт 9, а записано 3')
    // Не «поставь 9»: неверным может быть и само выражение.
    expect(issues[0]).toContain('не подгоняй')
  })

  it('молчит, когда всё сошлось', () => {
    expect(verifyWorksheet([
      { label: 'всего чисел', expression: '9*9*8*7*6*5', value: '136080' },
      { label: 'наборов с суммой, кратной 3', expression: '9 + 3 + 3 + 27', value: '42' },
      { label: 'случай с нулём на конце', expression: '42 * 5!', value: '5040' },
      { label: 'вероятность', expression: '9744 / 136080', value: '29/405' },
    ])).toEqual([])
  })

  it('пропускает строки, которые не считаются', () => {
    expect(verifyWorksheet([
      { label: 'по теореме Пифагора', expression: 'AB² = AC² + BC²', value: '13' },
    ])).toEqual([])
  })

  it('требует, чтобы результат был числом', () => {
    const issues = verifyWorksheet([
      { label: 'сумма', expression: '2 + 2', value: 'примерно четыре' },
    ])
    expect(issues[0]).toContain('не число')
  })

  it('не придирается к округлению непрерывной величины', () => {
    expect(verifyWorksheet([
      { label: 'вероятность', expression: '29/405', value: '0,0716' },
    ])).toEqual([])
    // А целое расхождение - это ошибка, а не округление.
    expect(verifyWorksheet([
      { label: 'всего', expression: '9*9*8*7*6*5', value: '136081' },
    ])).toHaveLength(1)
  })
})

describe('происхождение чисел', () => {
  const condition = 'Из цифр 0-9 составляют шестизначные числа без повторяющихся цифр, первая цифра не 0. '
    + 'Найти количество чисел, делящихся на 15.'

  it('ловит число, взятое ниоткуда - тот самый неверный прогон', () => {
    const issues = verifyWorksheetDerivation([
      { label: 'всего чисел', expression: '9*9*8*7*6*5', value: '136080' },
      { label: 'числа с нулём на конце', expression: '36*120', value: '4320' },
    ], condition)
    expect(issues).toHaveLength(2)
    expect(issues[0]).toContain('36')
    // 120 тоже ниоткуда: 5! модель обязана выписать строкой.
    expect(issues[1]).toContain('120')
  })

  it('молчит, когда число выведено другой строкой', () => {
    expect(verifyWorksheetDerivation([
      { label: 'наборов с суммой, кратной 3', expression: 'C(3,3)*C(3,1)*C(3,1) + C(3,1)*C(3,3)', value: '12' },
      { label: 'перестановок пяти цифр', expression: '5!', value: '120' },
      { label: 'числа с нулём на конце', expression: '12*120', value: '1440' },
    ], condition)).toEqual([])
  })

  it('не придирается к числам до дюжины и к числам из условия', () => {
    expect(verifyWorksheetDerivation([
      { label: 'всего чисел', expression: '9*9*8*7*6*5', value: '136080' },
      { label: 'кратность', expression: '15*2', value: '30' },
    ], condition)).toEqual([])
  })

  it('пустой черновик проверять нечего', () => {
    expect(verifyWorksheetDerivation([], condition)).toEqual([])
  })
})

/* Ответ появляется на глазах у ученика, а не готовым.

   7 сентября на проде химия отдала «V(NO₂) = 2,1 л». Число верное, а лист
   обрывается на «n(Cu) = 3/64 моль»: строки, где 3/64 превращается в 2,1,
   нет ни в решении, ни в черновике. Ученик такое у доски не выведет. */
describe('происхождение ответа', () => {
  const condition = 'Смесь Mg, Al, Cu массой 15,0 г + избыток HCl → 13,44 л H₂, остаток 3,0 г. Найти массовые доли и объём NO₂. Vm = 22,4.'
  const given = ['m(смеси) = 15,0 г', 'V(H₂) = 13,44 л', 'm(остатка) = 3,0 г']
  const steps = [
    'm(Cu) = 3,0 г, w(Cu) = 3,0 / 15,0 = 0,20 (20%)',
    'w(Mg) = 4,8 / 15,0 = 0,32 (32%)',
    'w(Al) = 7,2 / 15,0 = 0,48 (48%)',
    'n(Cu) = 3,0 / 64 = 3/64 моль',
  ]

  it('ловит объём, который никто не выводил', () => {
    const issues = verifyAnswerDerivation(
      'w(Mg) = 32%, w(Al) = 48%, w(Cu) = 20%, V(NO₂) = 2,1 л',
      [],
      condition,
      given,
      steps,
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('2,1')
  })

  it('молчит, когда вывод дописан на лист', () => {
    expect(verifyAnswerDerivation(
      'w(Mg) = 32%, w(Al) = 48%, w(Cu) = 20%, V(NO₂) = 2,1 л',
      [],
      condition,
      given,
      [...steps, 'V(NO₂) = 2 · 3/64 · 22,4 = 2,1 л'],
    )).toEqual([])
  })

  it('принимает долю, записанную процентами', () => {
    // На листе 0,32, в ответе 32 % - это одно и то же число.
    expect(verifyAnswerDerivation('w(Mg) = 32%', [], 'Найти массовую долю магния.', [], ['w(Mg) = 4,8 / 15,0 = 0,32'])).toEqual([])
  })

  it('принимает округление', () => {
    // Астрономия: посчитано 10^0,536 = 3,4356, в ответе стоит 3,42.
    expect(verifyAnswerDerivation(
      'L/L☉ = 3,42',
      [{ label: 'светимость', expression: '10^0.536', value: '3.4356' }],
      'Найти светимость.',
      [],
      [],
    )).toEqual([])
  })

  it('не придирается к счётному ответу до дюжины', () => {
    expect(verifyAnswerDerivation('12 сторон', [], 'Сколько сторон имеет многоугольник?', [], ['n = 12'])).toEqual([])
  })

  it('принимает число, взятое прямо из условия', () => {
    expect(verifyAnswerDerivation('AB = 13 см', [], 'В треугольнике AB = 13 см. Найти AB.', [], [])).toEqual([])
  })
})
