/* Короткий ролик «как решается задача» для секции витрины.

   Одна мысль: условие уходит в решатель и возвращается страницей тетради.
   Никаких придуманных виджетов - в кадре настоящая форма, настоящая
   карточка решения и настоящий тетрадный лист (realUi.tsx).

   Вход - авторское время T и формат кадра. Кадр целиком определяется этой
   парой: широкий 1920×1080 для экрана, вертикальный 1080×1350 для телефона. */

import { hold, pop, ramp, rise, typed } from './motion'
import { AppScreen, NotebookPage, SolveCard, TaskFormCard, taskCondition } from './realUi'
import { Eyebrow, Stage, Zoom, at, color, font, useStage, type StageFormat } from './stage'
import { beatAt, solveBeats } from './timelines'

function Caption({ t, start, children }: { t: number; start: number; children: string }) {
  const { safe, safeWidth, pick, type } = useStage()
  return (
    <div style={at(safe, pick(960, 1190), { ...rise(t, start, 0.5), width: safeWidth, display: 'flex', justifyContent: 'center' })}>
      <div style={{ display: 'flex', alignItems: 'center', gap: pick(18, 14) }}>
        <div style={{ width: pick(34, 26), height: 2, background: color.accent, flexShrink: 0 }} />
        <div style={{ fontFamily: font.body, fontSize: type(30), lineHeight: 1.35, color: color.muted }}>{children}</div>
      </div>
    </div>
  )
}

function TaskScene({ t, duration }: { t: number; duration: number }) {
  const { width, height, pick } = useStage()
  const opacity = hold(t, 0, duration, 0.45, 0.35)
  const text = typed(taskCondition, t, 0.6, 2.6)
  const pressed = t >= 3.9 && t < 4.2

  return (
    <div style={at(0, 0, { width, height, opacity })}>
      <Eyebrow style={at(0, pick(150, 220), { width, textAlign: 'center', ...rise(t, 0.1, 0.5) })}>Приносишь условие</Eyebrow>
      <Zoom left={pick(180, 60)} top={pick(250, 350)} width={pick(1560, 960)} scale={pick(1, 1.08)}>
        <AppScreen width={pick(1560, 960)} style={{ left: 0, top: 0, ...pop(t, 0.15, 0.6, 0.96), transformOrigin: '50% 50%' }}>
          <TaskFormCard condition={text} pressed={pressed} submitting={t >= 4.2} />
        </AppScreen>
      </Zoom>
      <Caption t={t} start={3.3}>Фотографией или текстом - учебник неважен</Caption>
    </div>
  )
}

function SolvingScene({ t, duration }: { t: number; duration: number }) {
  const { width, height, pick } = useStage()
  const opacity = hold(t, 0, duration, 0.4, 0.35)
  // Шаги настоящие: Читаем, Решаем, Проверяем, Оформляем.
  const stageIndex = t < 1.1 ? 0 : t < 2.6 ? 1 : t < 4.0 ? 2 : 3
  const seconds = Math.min(59, Math.floor(6 + t * 5))

  return (
    <div style={at(0, 0, { width, height, opacity })}>
      <Eyebrow style={at(0, pick(150, 250), { width, textAlign: 'center', ...rise(t, 0.05, 0.45) })}>Задачу решают дважды</Eyebrow>
      <Zoom left={pick(370, 190)} top={pick(300, 450)} width={pick(1180, 700)} scale={pick(1, 1.5)}>
        <AppScreen width={pick(1180, 700)} style={{ left: 0, top: 0, ...pop(t, 0.1, 0.5, 0.97), transformOrigin: '50% 50%' }}>
          <SolveCard stageIndex={stageIndex} clock={`0:${String(seconds).padStart(2, '0')}`} spin={t * 320} />
        </AppScreen>
      </Zoom>
      <Caption t={t} start={4.2}>Ответы не сошлись - решение не выдаётся и не оплачивается</Caption>
    </div>
  )
}

function SheetScene({ t, duration }: { t: number; duration: number }) {
  const { width, height, pick } = useStage()
  const opacity = hold(t, 0, duration, 0.4, 0.35)
  const filled = ramp(t, 0.4, 4.4)
  const zoom = 1 + ramp(t, 0, duration, (p) => p) * 0.06

  return (
    <div style={at(0, 0, { width, height, opacity })}>
      <Eyebrow style={at(0, pick(120, 200), { width, textAlign: 'center', ...rise(t, 0.05, 0.45) })}>Возвращается страницей тетради</Eyebrow>
      <div style={at(0, pick(190, 300), { width, display: 'flex', justifyContent: 'center', transform: `scale(${(zoom * pick(1, 1.5)).toFixed(4)})`, transformOrigin: '50% 20%' })}>
        <NotebookPage filled={filled} width={pick(470, 640)} />
      </div>
    </div>
  )
}

function DoneScene({ t, duration }: { t: number; duration: number }) {
  const { width, height, safe, safeWidth, pick, type } = useStage()
  const opacity = hold(t, 0, duration, 0.4, 0.01)
  return (
    <div style={at(0, 0, { width, height, opacity })}>
      <div style={at(safe, pick(380, 480), { width: safeWidth, textAlign: 'center', ...rise(t, 0.1, 0.6), fontFamily: font.display, fontSize: type(118), lineHeight: 1.02, color: color.ink })}>
        Осталось переписать.
      </div>
      <div style={at(safe, pick(560, 740), { width: safeWidth, textAlign: 'center', ...rise(t, 0.45, 0.6), fontFamily: font.body, fontSize: type(32), lineHeight: 1.4, color: color.muted })}>
        Дано, ход решения, чертёж и ответ - в том виде, в каком их ждёт учитель.
      </div>
      <div style={at(safe, pick(660, 920), { width: safeWidth, textAlign: 'center', ...rise(t, 0.8, 0.6), fontFamily: font.mono, fontSize: type(26), letterSpacing: '0.16em', color: color.accentInk })}>
        homeworkcopilot.ru
      </div>
    </div>
  )
}

const scenes = { task: TaskScene, solving: SolvingScene, sheet: SheetScene, done: DoneScene }

export function SolveFilm({ T, format = 'wide' }: { T: number; format?: StageFormat }) {
  const { beat, local } = beatAt(solveBeats, T)
  const Scene = scenes[beat.id as keyof typeof scenes]
  return (
    <Stage T={T} format={format} glow={0.8}>
      <Scene t={local} duration={beat.duration} />
    </Stage>
  )
}
