/* Сцены ролика первого экрана с фиксированными длительностями.

   Авторское время T идёт от начала ролика; каждая сцена получает своё
   локальное время t = T - start. Порядок и длительности задаются здесь
   и больше нигде: студия и рендер читают этот же список. */

export const scenes = [
  { id: 'night', label: 'Ночь', duration: 7 },
  { id: 'input', label: 'Условие', duration: 8 },
  { id: 'passes', label: 'Два прохода', duration: 9 },
  { id: 'notebook', label: 'Тетрадь', duration: 9.5 },
  { id: 'subjects', label: 'Предметы', duration: 5 },
  { id: 'price', label: 'Цена', duration: 5.5 },
  { id: 'outro', label: 'Финал', duration: 4 },
] as const

export type SceneId = (typeof scenes)[number]['id']

export const sceneStarts = scenes.reduce<Record<SceneId, number>>((starts, scene, index) => {
  starts[scene.id] = index === 0 ? 0 : starts[scenes[index - 1].id] + scenes[index - 1].duration
  return starts
}, {} as Record<SceneId, number>)

export const totalDuration = scenes.reduce((sum, scene) => sum + scene.duration, 0)

export const frameRate = 60

export function sceneAt(T: number) {
  const clamped = Math.min(Math.max(T, 0), totalDuration)
  let index = scenes.length - 1
  for (let i = 0; i < scenes.length; i += 1) {
    const start = sceneStarts[scenes[i].id]
    if (clamped >= start && clamped < start + scenes[i].duration) {
      index = i
      break
    }
  }
  const scene = scenes[index]
  return { scene, index, local: clamped - sceneStarts[scene.id] }
}
