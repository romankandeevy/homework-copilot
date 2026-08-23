const rubleFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })

export function formatRubles(amount: number) {
  return `${rubleFormatter.format(amount)} ₽`
}
