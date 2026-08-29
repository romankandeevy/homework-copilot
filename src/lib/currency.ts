// Баланс и все суммы хранятся в базе целыми КОПЕЙКАМИ: ИИ-чат списывает
// по фактическому расходу API, и целых рублей для этого мало.
// Наружу мы по-прежнему показываем рубли, поэтому вся конвертация — здесь,
// в одном месте. Копейки печатаем только когда они есть: «20 ₽», но «5,40 ₽».

const wholeRubleFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const preciseRubleFormatter = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatKopecks(amountInKopecks: number) {
  const rubles = amountInKopecks / 100
  return amountInKopecks % 100 === 0
    ? `${wholeRubleFormatter.format(rubles)} ₽`
    : `${preciseRubleFormatter.format(rubles)} ₽`
}

// Прежнее имя оставлено, чтобы не переписывать полтора десятка мест вызова:
// аргумент везде приходит из базы, то есть уже в копейках.
export const formatRubles = formatKopecks

export function rublesToKopecks(rubles: number) {
  return Math.round(rubles * 100)
}

export function kopecksToRubles(kopecks: number) {
  return kopecks / 100
}
