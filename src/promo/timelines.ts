/* Сцены роликов с фиксированными длительностями.

   Авторское время T идёт от начала ролика; каждая сцена получает своё
   локальное время t = T - start. Порядок и длительности задаются здесь и
   больше нигде: студия и рендер читают этот же список.

   Роликов два, и они про разное:

   - `hero` - первый экран витрины. 45 секунд, короткие удары по 2-4 секунды:
     подросток не досидит до конца длинной сцены, ему нужна смена кадра.
   - `solve` - секция «Двадцать секунд - и понятно, что это». Короткий и
     спокойный: одна мысль - как задача превращается в страницу тетради. */

export type Beat = { id: string; label: string; duration: number }

export const heroBeats = [
  { id: 'hook', label: 'Ночь', duration: 3 },
  { id: 'problem', label: 'Проблема', duration: 3 },
  { id: 'form', label: 'Форма', duration: 4 },
  { id: 'photo', label: 'Фото', duration: 3 },
  { id: 'launch', label: 'Решить', duration: 2 },
  { id: 'solving', label: 'Решаем', duration: 5 },
  { id: 'checked', label: 'Сверка', duration: 2.5 },
  { id: 'sheet', label: 'Тетрадь', duration: 6 },
  { id: 'rewrite', label: 'Переписать', duration: 3 },
  { id: 'subjects', label: 'Предметы', duration: 4 },
  { id: 'more', label: 'Ещё', duration: 3.5 },
  { id: 'price', label: 'Цена', duration: 3.5 },
  { id: 'outro', label: 'Финал', duration: 2.5 },
] as const satisfies readonly Beat[]

export const solveBeats = [
  { id: 'task', label: 'Условие', duration: 4.5 },
  { id: 'solving', label: 'Решаем', duration: 5.5 },
  { id: 'sheet', label: 'Тетрадь', duration: 7 },
  { id: 'done', label: 'Готово', duration: 3 },
] as const satisfies readonly Beat[]

export const films = {
  hero: { beats: heroBeats as readonly Beat[], label: 'Первый экран', output: 'public/hero.mp4', poster: 'public/hero-poster.jpg', posterAt: 21 },
  solve: { beats: solveBeats as readonly Beat[], label: 'Как решается задача', output: 'public/promo.mp4', poster: 'public/promo-poster.jpg', posterAt: 12 },
} as const

export type FilmId = keyof typeof films

export function timelineOf(beats: readonly Beat[]) {
  const starts = new Map<string, number>()
  let elapsed = 0
  for (const beat of beats) {
    starts.set(beat.id, elapsed)
    elapsed += beat.duration
  }
  return { starts, total: elapsed }
}

export function beatAt(beats: readonly Beat[], T: number) {
  const { starts, total } = timelineOf(beats)
  const clamped = Math.min(Math.max(T, 0), total)
  let current = beats[beats.length - 1]
  for (const beat of beats) {
    const start = starts.get(beat.id) ?? 0
    if (clamped >= start && clamped < start + beat.duration) {
      current = beat
      break
    }
  }
  return { beat: current, start: starts.get(current.id) ?? 0, local: clamped - (starts.get(current.id) ?? 0) }
}

export const frameRate = 60

/* Начало сцены по имени: сцены ссылаются друг на друга при монтаже. */
export function startOf(beats: readonly Beat[], id: string) {
  return timelineOf(beats).starts.get(id) ?? 0
}
