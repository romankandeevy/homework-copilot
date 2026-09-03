/* Движение как функция времени.

   Ролики собраны без CSS-анимаций: каждая сцена считает позу, прозрачность и
   масштаб элементов от авторского времени T. Так один кадр полностью
   определяется числом, и таймлайн можно тянуть рукой в любую сторону, а
   рендер получает кадр за кадром, не дожидаясь браузерных переходов. */

export type Easing = (progress: number) => number

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

export const lerp = (from: number, to: number, progress: number) => from + (to - from) * progress

export const linear: Easing = (p) => p

export const easeOutCubic: Easing = (p) => 1 - (1 - p) ** 3

export const easeInCubic: Easing = (p) => p * p * p

export const easeInOutCubic: Easing = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)

export const easeOutQuint: Easing = (p) => 1 - (1 - p) ** 5

export const easeOutExpo: Easing = (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p))

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

/* Влёт сбоку с «прочерком»: быстрый заход, короткая размытая фаза.
   Размытие здесь - вычисленный стиль, а не переход: кадр по-прежнему
   определяется одним T. */
export function whip(t: number, start: number, duration = 0.45, distance = 220) {
  const p = ramp(t, start, duration, easeOutExpo)
  const blur = (1 - p) * 14
  return {
    opacity: ramp(t, start, duration * 0.4),
    transform: `translateX(${((1 - p) * distance).toFixed(2)}px)`,
    filter: blur > 0.15 ? `blur(${blur.toFixed(2)}px)` : 'none',
  }
}

/* Удар по кадру: короткая дрожь после события. */
export function shake(t: number, start: number, duration = 0.32, amplitude = 10) {
  const p = clamp01((t - start) / duration)
  if (p <= 0 || p >= 1) return { x: 0, y: 0 }
  const decay = (1 - p) ** 2
  return {
    x: Math.sin(p * Math.PI * 9) * amplitude * decay,
    y: Math.cos(p * Math.PI * 7) * amplitude * 0.6 * decay,
  }
}

/* Вспышка на монтажном стыке: вспыхивает в start и гаснет за duration.
   До самой метки её нет вовсе - иначе будущие склейки светили бы поверх
   всего ролика с первого кадра. */
export function flash(t: number, start: number, duration = 0.22) {
  if (t < start) return 0
  return 1 - ramp(t, start, duration, linear)
}

/* Жёсткая склейка: до start - ноль, после - единица, без перехода. */
export function cut(t: number, start: number) {
  return t >= start ? 1 : 0
}

/* Задержка для элемента под номером index: списки въезжают лесенкой. */
export const stagger = (index: number, gap = 0.08) => index * gap

/* Счётчик: число растёт от from до to. */
export function countUp(t: number, start: number, duration: number, from: number, to: number, ease: Easing = easeOutCubic) {
  return Math.round(lerp(from, to, ramp(t, start, duration, ease)))
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

/* Мигающая каретка ввода: две вспышки в секунду. */
export const caretOn = (t: number, from: number, to: number) => t >= from && t < to && Math.floor(t * 2.4) % 2 === 0
