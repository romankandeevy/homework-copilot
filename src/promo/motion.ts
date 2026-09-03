/* Движение как функция времени.

   Ролик первого экрана собран без CSS-анимаций: каждая сцена считает позу,
   прозрачность и масштаб элементов от авторского времени T. Так один кадр
   полностью определяется числом, и таймлайн можно тянуть рукой в любую
   сторону, а рендер получает кадр за кадром, не дожидаясь браузерных
   переходов. */

export type Easing = (progress: number) => number

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress

export const linear: Easing = (p) => p

export const easeOutCubic: Easing = (p) => 1 - (1 - p) ** 3

export const easeInCubic: Easing = (p) => p * p * p

export const easeInOutCubic: Easing = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)

export const easeOutQuint: Easing = (p) => 1 - (1 - p) ** 5

/* Небольшой перелёт за цель и возврат: так «выскакивают» плашки и карточки. */
export const easeOutBack: Easing = (p) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2
}

/* Прогресс отрезка [start, start + duration] в момент t: 0 до начала,
   1 после конца, между ними - по кривой. */
export function ramp(t: number, start: number, duration: number, ease: Easing = easeOutCubic) {
  if (duration <= 0) return t >= start ? 1 : 0
  return ease(clamp01((t - start) / duration))
}

/* Присутствие элемента: плавно входит с start, плавно уходит к end. */
export function hold(t: number, start: number, end: number, fadeIn = 0.4, fadeOut = 0.35) {
  const enter = ramp(t, start, fadeIn)
  const leave = 1 - ramp(t, end - fadeOut, fadeOut, easeInCubic)
  return Math.min(enter, leave)
}

/* Появление снизу вверх: прозрачность и сдвиг одним числом. */
export function rise(t: number, start: number, duration = 0.6, distance = 28, ease: Easing = easeOutCubic) {
  const p = ramp(t, start, duration, ease)
  return { opacity: p, transform: `translateY(${((1 - p) * distance).toFixed(2)}px)` }
}

/* Выскакивание с перелётом: масштаб от small к 1 по easeOutBack. */
export function pop(t: number, start: number, duration = 0.55, small = 0.72) {
  const p = ramp(t, start, duration, easeOutBack)
  const opacity = ramp(t, start, Math.min(duration, 0.25), easeOutCubic)
  return { opacity, transform: `scale(${lerp(small, 1, p).toFixed(4)})` }
}

/* Длина уже нарисованной части контура для SVG-обводки. */
export function stroke(t: number, start: number, duration: number, length: number, ease: Easing = easeInOutCubic) {
  const p = ramp(t, start, duration, ease)
  return { strokeDasharray: length, strokeDashoffset: (1 - p) * length }
}

/* Набор текста: сколько символов уже напечатано к моменту t. */
export function typed(text: string, t: number, start: number, duration: number) {
  const p = ramp(t, start, duration, linear)
  return text.slice(0, Math.round(text.length * p))
}
