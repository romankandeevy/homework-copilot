/* Пробелы тестовой среды, а не продукта.

   jsdom не реализует наблюдатель пересечений и matchMedia. На них опираются
   анимации витрины (motion.whileInView) и проверка prefers-reduced-motion,
   поэтому здесь стоят минимальные заглушки: они ничего не изображают, а лишь
   дают API существовать. Типы намеренно сведены к минимуму — заглушка
   не обязана повторять весь интерфейс браузера. */

const globals = globalThis as Record<string, unknown>

if (!globals.IntersectionObserver) {
  globals.IntersectionObserver = class {
    root = null
    rootMargin = '0px'
    thresholds: number[] = [0]
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  }
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  globals.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })
}

/* Прокрутки в jsdom нет вовсе: `window.scrollTo` объявлен, но при вызове
   печатает «Not implemented», а у элементов `scrollTo` нет и вовсе. Переход
   между разделами приложения поднимает наверх и окно, и ленту разделов -
   на узком экране листается именно она. Заглушки ничего не изображают, они
   лишь дают вызовам существовать. */
if (typeof window !== 'undefined') {
  window.scrollTo = () => {}
  Element.prototype.scrollTo = () => {}
}
