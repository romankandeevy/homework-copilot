/* Короткий ролик «как решается задача» для секции витрины.

   Одна мысль: условие уходит в решатель и возвращается страницей тетради.
   Никаких придуманных виджетов - в кадре настоящая форма, настоящая
   карточка решения и настоящий тетрадный лист (realUi.tsx).

   Вход - авторское время T. Кадр целиком определяется этим числом. */

import { hold, pop, ramp, rise, typed } from './motion'
import { AppScreen, NotebookPage, SolveCard, TaskFormCard, taskCondition } from './realUi'
import { Eyebrow, Stage, at, color, font, stageHeight, stageWidth } from './stage'
import { beatAt, solveBeats } from './timelines'

function Caption({ t, start, children }: { t: number; start: number; children: string }) {
  return (
    <div style={at(0, 960, { ...rise(t, start, 0.5), width: stageWidth, display: 'flex', justifyContent: 'center' })}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div style={{ width: 34, height: 2, background: color.accent }} />
        <div style={{ fontFamily: font.body, fontSize: 30, color: color.muted }}>{children}</div>
      </div>
    </div>
  )
}

function TaskScene({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.45, 0.35)
  const text = typed(taskCondition, t, 0.6, 2.6)
  const pressed = t >= 3.9 && t < 4.2

  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <Eyebrow style={at(0, 150, { width: stageWidth, textAlign: 'center', ...rise(t, 0.1, 0.5) })}>Приносишь условие</Eyebrow>
      <AppScreen width={1560} style={{ left: 180, top: 250, ...pop(t, 0.15, 0.6, 0.96), transformOrigin: '50% 50%' }}>
        <TaskFormCard condition={text} pressed={pressed} submitting={t >= 4.2} />
      </AppScreen>
      <Caption t={t} start={3.3}>Фотографией или текстом - учебник неважен</Caption>
    </div>
  )
}

function SolvingScene({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.4, 0.35)
  // Шаги настоящие: Читаем, Решаем, Проверяем, Оформляем.
  const stageIndex = t < 1.1 ? 0 : t < 2.6 ? 1 : t < 4.0 ? 2 : 3
  const seconds = Math.min(59, Math.floor(6 + t * 5))

  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <Eyebrow style={at(0, 150, { width: stageWidth, textAlign: 'center', ...rise(t, 0.05, 0.45) })}>Задачу решают дважды</Eyebrow>
      <AppScreen width={1180} style={{ left: 370, top: 300, ...pop(t, 0.1, 0.5, 0.97), transformOrigin: '50% 50%' }}>
        <SolveCard stageIndex={stageIndex} clock={`0:${String(seconds).padStart(2, '0')}`} spin={t * 320} />
      </AppScreen>
      <Caption t={t} start={4.2}>Ответы не сошлись - решение не выдаётся и не оплачивается</Caption>
    </div>
  )
}

function SheetScene({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.4, 0.35)
  const filled = ramp(t, 0.4, 4.4)
  const zoom = 1 + ramp(t, 0, duration, (p) => p) * 0.06

  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <Eyebrow style={at(0, 120, { width: stageWidth, textAlign: 'center', ...rise(t, 0.05, 0.45) })}>Возвращается страницей тетради</Eyebrow>
      <div style={at(0, 190, { width: stageWidth, display: 'flex', justifyContent: 'center', transform: `scale(${zoom.toFixed(4)})`, transformOrigin: '50% 20%' })}>
        <NotebookPage filled={filled} width={620} />
      </div>
    </div>
  )
}

function DoneScene({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.4, 0.01)
  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <div style={at(0, 380, { width: stageWidth, textAlign: 'center', ...rise(t, 0.1, 0.6), fontFamily: font.display, fontSize: 118, lineHeight: 1.02, color: color.ink })}>
        Осталось переписать.
      </div>
      <div style={at(0, 560, { width: stageWidth, textAlign: 'center', ...rise(t, 0.45, 0.6), fontFamily: font.body, fontSize: 32, color: color.muted })}>
        Дано, ход решения, чертёж и ответ - в том виде, в каком их ждёт учитель.
      </div>
      <div style={at(0, 660, { width: stageWidth, textAlign: 'center', ...rise(t, 0.8, 0.6), fontFamily: font.mono, fontSize: 26, letterSpacing: '0.16em', color: color.accentInk })}>
        homeworkcopilot.ru
      </div>
    </div>
  )
}

const scenes = { task: TaskScene, solving: SolvingScene, sheet: SheetScene, done: DoneScene }

export function SolveFilm({ T }: { T: number }) {
  const { beat, local } = beatAt(solveBeats, T)
  const Scene = scenes[beat.id as keyof typeof scenes]
  return (
    <Stage T={T} glow={0.8}>
      <Scene t={local} duration={beat.duration} />
    </Stage>
  )
}
