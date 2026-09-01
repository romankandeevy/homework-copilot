/* Ключи списков, не зависящие от позиции в массиве.

   Списки вроде строк «Дано», шагов решения или блоков распознанной страницы
   перерисовываются целиком, и раньше ключ собирался из содержимого и индекса.
   Индекс в ключе означает, что при вставке строки в середину React считает
   изменившимися все строки ниже. Здесь повторы различаются порядковым номером
   самого повтора, поэтому ключ у строки один и тот же, где бы она ни стояла. */
export function keyed<T>(items: readonly T[], identity: (item: T) => string): { key: string; item: T }[] {
  const seen = new Map<string, number>()
  return items.map((item) => {
    const value = identity(item)
    const count = (seen.get(value) ?? 0) + 1
    seen.set(value, count)
    return { key: count === 1 ? value : `${value}#${count}`, item }
  })
}
