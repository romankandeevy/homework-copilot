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
