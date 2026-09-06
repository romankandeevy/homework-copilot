import { describe, expect, it } from 'vitest'
import {
  estimateSolutionPrice,
  getSolutionPrice,
  kieCreditKopecks,
  maximumSolutionPriceKopecks,
  minimumSolutionPriceKopecks,
  solutionPriceKopecks,
} from './solutionPricing'

/* Цена перестала быть плоской.

   Пока задачи были одного размера, 5 ₽ за любую были честны. Замер
   6 сентября показал разброс себестоимости почти в десять раз: короткая
   задача по истории - 0,24 кредита, трудная комбинаторика с починкой -
   2,2. При плоской цене лёгкие задачи оплачивают трудные.

   Главное требование к формуле: то, что показано в форме, и то, что
   спишется, считается одним и тем же кодом. */

describe('цена решения', () => {
  it('пол цены - короткая задача текстом по предмету слова', () => {
    expect(estimateSolutionPrice({ conditionLength: 120, subject: 'История' }))
      .toBe(minimumSolutionPriceKopecks)
    expect(minimumSolutionPriceKopecks).toBe(400)
  })

  it('пустой запрос стоит как пол: цена без задачи - это витрина', () => {
    expect(estimateSolutionPrice()).toBe(minimumSolutionPriceKopecks)
    expect(getSolutionPrice()).toBe(solutionPriceKopecks)
  })

  it('длинное условие дороже короткого', () => {
    const short = estimateSolutionPrice({ conditionLength: 200, subject: 'История' })
    const long = estimateSolutionPrice({ conditionLength: 1400, subject: 'История' })
    expect(long).toBeGreaterThan(short)
  })

  it('фотография дороже текста, крупная - дороже мелкой', () => {
    const text = estimateSolutionPrice({ conditionLength: 200, subject: 'История' })
    const photo = estimateSolutionPrice({ imageBytes: 300_000, subject: 'История' })
    const bigPhoto = estimateSolutionPrice({ imageBytes: 900_000, subject: 'История' })
    expect(photo).toBeGreaterThan(text)
    expect(bigPhoto).toBeGreaterThan(photo)
  })

  it('счётный предмет дороже словесного: там второй вызов - норма', () => {
    const history = estimateSolutionPrice({ conditionLength: 200, subject: 'История' })
    const algebra = estimateSolutionPrice({ conditionLength: 200, subject: 'Алгебра' })
    expect(algebra).toBeGreaterThan(history)
  })

  it('не выходит за пол и потолок ни на каком вводе', () => {
    const wild = [
      { conditionLength: 0 },
      { conditionLength: 100_000, imageBytes: 4_000_000, subject: 'Физика' },
      { conditionLength: -50, imageBytes: -1 },
      { subject: 'Труд' },
    ]
    for (const input of wild) {
      const price = estimateSolutionPrice(input)
      expect(price).toBeGreaterThanOrEqual(minimumSolutionPriceKopecks)
      expect(price).toBeLessThanOrEqual(maximumSolutionPriceKopecks)
      expect(Number.isInteger(price)).toBe(true)
    }
  })

  it('цена кратна пятидесяти копейкам: она должна читаться как цена', () => {
    const prices = [
      estimateSolutionPrice({ conditionLength: 900, subject: 'Физика', imageBytes: 500_000 }),
      estimateSolutionPrice({ conditionLength: 2500, subject: 'Алгебра' }),
      estimateSolutionPrice({ imageBytes: 1_500_000, subject: 'Химия' }),
    ]
    for (const price of prices) expect(price % 50).toBe(0)
  })

  /* Замеры 6 сентября: худший живой случай - комбинаторика с починкой,
     2,07 кредита. Кредит стоит 43 копейки, значит нам она обошлась в 89
     копеек. Даже пол цены обязан покрывать это с кратным запасом: сверх
     себестоимости идут эквайринг, налог и скачки тарифа шлюза. */
  it('покрывает худшую замеренную себестоимость с запасом', () => {
    const worstMeasuredCredits = 2.07
    const worstCost = worstMeasuredCredits * kieCreditKopecks

    expect(worstCost).toBeLessThan(100)
    expect(minimumSolutionPriceKopecks).toBeGreaterThan(worstCost * 4)
  })
})
