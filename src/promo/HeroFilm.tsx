/* Ролик первого экрана: 45 секунд, тринадцать коротких ударов.

   Длинную сцену подросток не досиживает, поэтому кадр здесь меняется каждые
   две-четыре секунды: жёсткие склейки со вспышкой, влёты сбоку, тряска на
   ударах, кинетический набор слов. Всё это - вычисленные стили от авторского
   времени T, без CSS-анимаций: кадр воспроизводим и рендерится покадрово.

   Продукт показан настоящим интерфейсом (realUi.tsx), а не его подобием. */

import { ArrowRight, ChatsCircle, Compass, PencilSimpleLine, Table } from '@phosphor-icons/react'
import { countUp, easeOutBack, easeOutExpo, hold, lerp, pop, ramp, rise, typed, whip } from './motion'
import { AppScreen, NotebookPage, SolveCard, TaskFormCard, taskCondition } from './realUi'
import { Eyebrow, Stage, at, color, font, stageHeight, stageWidth } from './stage'
import { beatAt, heroBeats, startOf } from './timelines'

const starts = Object.fromEntries(heroBeats.map((beat) => [beat.id, startOf(heroBeats, beat.id)])) as Record<string, number>

const subjects = [
  'Математика', 'Алгебра', 'Геометрия', 'Физика', 'Химия', 'Биология', 'Информатика',
  'Русский язык', 'Литература', 'Английский язык', 'История', 'Обществознание', 'География', 'Астрономия',
]

/* Слова влетают по одному: строка читается как речь, а не появляется целиком. */
function Kinetic({ t, start, words, style, gap = 0.11 }: {
  t: number
  start: number
  words: readonly string[]
  style?: React.CSSProperties
  gap?: number
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 0.28em', ...style }}>
      {words.map((word, index) => {
        const p = ramp(t, start + index * gap, 0.42, easeOutExpo)
        return (
          <span
            key={word + String(index)}
            style={{
              display: 'inline-block',
              opacity: p,
              transform: `translateY(${((1 - p) * 44).toFixed(2)}px) skewY(${((1 - p) * -5).toFixed(2)}deg)`,
            }}
          >
            {word}
          </span>
        )
      })}
    </div>
  )
}

/* 1. Ночь. Часы бьют по глазам и дрожат. */
function HookScene({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.25, 0.3)
  const punch = 1 + (1 - ramp(t, 0.05, 0.5, easeOutBack)) * 0.16
  const minutes = 40 + countUp(t, 0.2, 2.4, 0, 7)

  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <Eyebrow style={at(0, 330, { width: stageWidth, textAlign: 'center', ...rise(t, 0.1, 0.4) })}>Геометрия · 7 класс</Eyebrow>
      <div
        style={at(0, 380, {
          width: stageWidth,
          textAlign: 'center',
          fontFamily: font.mono,
          fontSize: 300,
          fontWeight: 600,
          lineHeight: 1,
          color: color.ink,
          fontVariantNumeric: 'tabular-nums',
          transform: `scale(${punch.toFixed(4)})`,
          opacity: ramp(t, 0, 0.3),
        })}
      >
        23:{String(minutes).padStart(2, '0')}
      </div>
      <div style={at(0, 730, { width: stageWidth, display: 'flex', justifyContent: 'center' })}>
        <Kinetic
          t={t}
          start={1.5}
          words={['Завтра', 'сдавать.']}
          style={{ fontFamily: font.display, fontSize: 64, color: color.muted }}
        />
      </div>
    </div>
  )
}

/* 2. Проблема. */
function ProblemScene({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.2, 0.3)
  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <div style={at(0, 340, { width: stageWidth, display: 'flex', justifyContent: 'center' })}>
        <Kinetic t={t} start={0.05} words={['Задача', 'одна.']} style={{ fontFamily: font.display, fontSize: 150, lineHeight: 1.05, color: color.ink }} />
      </div>
      <div style={at(0, 520, { width: stageWidth, display: 'flex', justifyContent: 'center' })}>
        <Kinetic t={t} start={0.7} words={['Вечера', '—', 'нет.']} style={{ fontFamily: font.display, fontSize: 150, lineHeight: 1.05, color: color.accentInk }} />
      </div>
      <div style={at(0, 780, { width: stageWidth, textAlign: 'center', ...rise(t, 1.7, 0.5), fontFamily: font.body, fontSize: 32, color: color.muted })}>
        Решебник даёт ответ к номеру. Запись для тетради он не даёт.
      </div>
    </div>
  )
}

/* 3. Настоящая форма: условие печатается. */
function FormScene({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.2, 0.25)
  const text = typed(taskCondition, t, 0.5, 2.4)
  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <Eyebrow style={at(0, 120, { width: stageWidth, textAlign: 'center', ...rise(t, 0.05, 0.4) })}>Экран приложения</Eyebrow>
      <AppScreen width={1560} style={{ left: 180, top: 230, ...whip(t, 0.05, 0.5, 260), transformOrigin: '50% 50%' }}>
        <TaskFormCard condition={text} pressed={false} submitting={false} />
      </AppScreen>
      <div style={at(0, 900, { width: stageWidth, textAlign: 'center', ...rise(t, 2.9, 0.45), fontFamily: font.body, fontSize: 32, color: color.muted })}>
        Условие приносишь ты - любой учебник, тетрадь или карточка от учителя.
      </div>
    </div>
  )
}

/* 4. Фотография падает в поле. */
function PhotoScene({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.2, 0.25)
  const drop = ramp(t, 0.15, 0.75, easeOutBack)
  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <Eyebrow style={at(0, 150, { width: stageWidth, textAlign: 'center', ...rise(t, 0.05, 0.4) })}>Или просто фотографией</Eyebrow>
      <div
        style={at(660, lerp(-420, 300, drop), {
          width: 600,
          height: 500,
          borderRadius: 18,
          background: '#fffefd',
          backgroundImage: 'linear-gradient(#d8e2ef 1px, transparent 1px), linear-gradient(90deg, #d8e2ef 1px, transparent 1px)',
          backgroundSize: '34px 34px',
          boxShadow: '0 50px 110px rgba(0, 0, 0, 0.6)',
          transform: `rotate(${lerp(-13, -3, drop).toFixed(2)}deg)`,
          color: '#14161a',
          fontFamily: "'Segoe Print', 'Ink Free', 'Comic Sans MS', cursive",
          overflow: 'hidden',
        })}
      >
        <div style={at(72, 0, { width: 2, height: 500, background: '#e8a3ae', opacity: 0.75 })} />
        <div style={at(104, 40, { fontSize: 30, fontWeight: 700 })}>№ 274</div>
        <div style={at(104, 100, { width: 440, fontSize: 22, lineHeight: 1.55 })}>{taskCondition}</div>
      </div>
      <div
        style={at(1290, 300, {
          ...pop(t, 1.15, 0.5, 0.6),
          padding: '16px 26px',
          borderRadius: 999,
          background: color.accent,
          color: '#fff',
          fontFamily: font.mono,
          fontSize: 20,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
          transformOrigin: '50% 50%',
          boxShadow: '0 20px 50px rgba(63, 108, 255, 0.5)',
        })}
      >
        Фото приложено ✓
      </div>
    </div>
  )
}

/* 5. Удар по кнопке. */
function LaunchScene({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.15, 0.2)
  const pressed = t >= 0.55 && t < 0.85
  const push = 1 - ramp(t, 0.55, 0.3) * 0.03 + ramp(t, 0.85, 0.4) * 0.03
  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <AppScreen width={1560} style={{ left: 180, top: 240, transform: `scale(${push.toFixed(4)})`, transformOrigin: '50% 50%' }}>
        <TaskFormCard condition={taskCondition} pressed={pressed} submitting={t >= 0.9} />
      </AppScreen>
      <div style={at(0, 930, { width: stageWidth, textAlign: 'center', ...rise(t, 1.0, 0.4), fontFamily: font.display, fontSize: 52, color: color.ink })}>
        Пошло.
      </div>
    </div>
  )
}

/* 6. Настоящая карточка решения: четыре шага продукта. */
function SolvingScene({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.2, 0.25)
  const stageIndex = t < 1.0 ? 0 : t < 2.2 ? 1 : t < 3.4 ? 2 : 3
  const seconds = Math.min(59, Math.floor(7 + t * 6))
  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <Eyebrow style={at(0, 130, { width: stageWidth, textAlign: 'center', ...rise(t, 0.05, 0.4) })}>Каждая задача решается дважды</Eyebrow>
      <AppScreen width={1180} style={{ left: 370, top: 280, ...pop(t, 0.05, 0.45, 0.96), transformOrigin: '50% 50%' }}>
        <SolveCard stageIndex={stageIndex} clock={`0:${String(seconds).padStart(2, '0')}`} spin={t * 330} />
      </AppScreen>
      <div style={at(0, 920, { width: stageWidth, textAlign: 'center', ...rise(t, 3.9, 0.45), fontFamily: font.body, fontSize: 30, color: color.muted })}>
        Два независимых прохода и сверка между ними.
      </div>
    </div>
  )
}

/* 7. Сверка сошлась. */
function CheckedScene({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.15, 0.25)
  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <div style={at(0, 420, { width: stageWidth, display: 'flex', justifyContent: 'center', ...pop(t, 0.05, 0.5, 0.55), transformOrigin: '50% 50%' })}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 26,
            padding: '30px 56px',
            borderRadius: 999,
            background: color.accent,
            color: '#fff',
            boxShadow: '0 30px 90px rgba(63, 108, 255, 0.55)',
          }}
        >
          <div style={{ fontFamily: font.display, fontSize: 62, lineHeight: 1 }}>✓ Ответы сошлись</div>
        </div>
      </div>
      <div style={at(0, 640, { width: stageWidth, textAlign: 'center', ...rise(t, 0.75, 0.5), fontFamily: font.body, fontSize: 32, color: color.muted })}>
        Не сошлись бы - решение не выдаётся и деньги не списываются.
      </div>
    </div>
  )
}

/* 8. Настоящий тетрадный лист заполняется. */
function SheetScene({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.2, 0.25)
  const filled = ramp(t, 0.3, 3.8)
  const zoom = 1 + ramp(t, 0, duration, (p) => p) * 0.08
  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <Eyebrow style={at(0, 110, { width: stageWidth, textAlign: 'center', ...rise(t, 0.05, 0.4) })}>Готовая запись, а не голый ответ</Eyebrow>
      <div style={at(0, 175, { width: stageWidth, display: 'flex', justifyContent: 'center', transform: `scale(${zoom.toFixed(4)})`, transformOrigin: '50% 18%' })}>
        <NotebookPage filled={filled} width={480} />
      </div>
    </div>
  )
}

/* 9. Осталось переписать. */
function RewriteScene({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.2, 0.25)
  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <div style={at(200, 360, { width: 900 })}>
        <Kinetic t={t} start={0.05} words={['Осталось', 'переписать.']} style={{ fontFamily: font.display, fontSize: 128, lineHeight: 1.0, color: color.ink }} />
      </div>
      <div style={at(200, 640, { ...rise(t, 0.7, 0.5), width: 820, fontFamily: font.body, fontSize: 32, lineHeight: 1.45, color: color.muted })}>
        Дано, ход решения по шагам, чертёж и ответ. Формулы записаны по-школьному.
      </div>
      <div style={at(1240, 150, { ...whip(t, 0.3, 0.55, 300) })}>
        <NotebookPage filled={1} width={350} />
      </div>
    </div>
  )
}

/* 10. Четырнадцать предметов: счётчик и лента. */
function MarqueeRow({ t, y, speed, offset }: { t: number; y: number; speed: number; offset: number }) {
  const sequence = [0, 1, 2].flatMap((copy) => subjects.map((subject, position) => ({ copy, subject, accent: (copy * subjects.length + position) % 3 === 1 })))
  return (
    <div style={at(0, y, { width: stageWidth, overflow: 'hidden', height: 86 })}>
      <div style={{ display: 'flex', gap: 60, whiteSpace: 'nowrap', transform: `translateX(${(offset + t * speed).toFixed(1)}px)` }}>
        {sequence.map(({ copy, subject, accent }) => (
          <div
            key={`${copy}:${subject}`}
            style={{ fontFamily: font.display, fontSize: 52, lineHeight: '86px', color: accent ? color.accent : color.ink, opacity: accent ? 1 : 0.4 }}
          >
            {subject}
          </div>
        ))}
      </div>
    </div>
  )
}

function SubjectsScene({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.2, 0.25)
  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <MarqueeRow t={t} y={170} speed={-190} offset={-380} />
      <div
        style={at(0, 400, {
          width: stageWidth,
          textAlign: 'center',
          ...pop(t, 0.05, 0.5, 0.8),
          fontFamily: font.display,
          fontSize: 168,
          lineHeight: 1,
          color: color.ink,
          transformOrigin: '50% 50%',
        })}
      >
        {countUp(t, 0.15, 1.1, 1, 14)} предметов
      </div>
      <div style={at(0, 610, { width: stageWidth, textAlign: 'center', ...rise(t, 0.8, 0.5), fontFamily: font.mono, fontSize: 26, letterSpacing: '0.18em', textTransform: 'uppercase', color: color.muted })}>
        5-11 класс · любой учебник
      </div>
      <MarqueeRow t={t} y={830} speed={170} offset={-2600} />
    </div>
  )
}

/* 11. Что ещё умеет: быстрые плашки. */
const extras = [
  { icon: Compass, title: 'Чертёж по условию', note: 'фигура строится из данных задачи' },
  { icon: PencilSimpleLine, title: 'Разбор со значками', note: 'подлежащее, суффикс, степень окисления' },
  { icon: ChatsCircle, title: 'ИИ-чат по домашке', note: 'спросить, почему шаг именно такой' },
  { icon: Table, title: 'Расписание с фото', note: 'снимок доски становится таблицей' },
]

function MoreScene({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.2, 0.25)
  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <Eyebrow style={at(160, 300, rise(t, 0.05, 0.4))}>Не только решение задачи</Eyebrow>
      <div style={at(160, 380, { width: 1600, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 })}>
        {extras.map(({ icon: Icon, title, note }, index) => (
          <div
            key={title}
            style={{
              ...pop(t, 0.25 + index * 0.14, 0.5, 0.86),
              display: 'flex',
              alignItems: 'center',
              gap: 26,
              padding: '34px 38px',
              borderRadius: 24,
              background: 'rgba(255, 255, 255, 0.045)',
              border: '1px solid rgba(255, 255, 255, 0.09)',
              transformOrigin: '50% 50%',
            }}
          >
            <Icon size={46} weight="duotone" color={color.accentInk} />
            <div>
              <div style={{ fontFamily: font.display, fontSize: 36, color: color.ink }}>{title}</div>
              <div style={{ marginTop: 8, fontFamily: font.body, fontSize: 24, color: color.subtle }}>{note}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* 12. Цена. Без «бесплатно без регистрации»: обещаем то, что даёт сервер. */
const priceRows = [
  { label: 'Решение задачи', value: '5 ₽', note: 'любой предмет, фото или текст', accent: false },
  { label: 'После регистрации', value: '20 ₽', note: 'сразу на счёте - это четыре решения', accent: true },
  { label: 'Не решилась', value: '0 ₽', note: 'деньги остаются на балансе', accent: false },
]

function PriceScene({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.2, 0.25)
  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <Eyebrow style={at(240, 240, rise(t, 0.05, 0.4))}>Сколько это стоит</Eyebrow>
      {priceRows.map((row, index) => (
        <div
          key={row.label}
          style={at(240, 330 + index * 165, {
            ...whip(t, 0.2 + index * 0.16, 0.45, 160),
            width: 1440,
            display: 'grid',
            gridTemplateColumns: '440px 400px 1fr',
            alignItems: 'center',
          })}
        >
          <div style={{ fontFamily: font.body, fontSize: 32, color: color.muted }}>{row.label}</div>
          <div style={{ fontFamily: font.display, fontSize: 96, lineHeight: 1, color: row.accent ? color.accent : color.ink }}>{row.value}</div>
          <div style={{ fontFamily: font.body, fontSize: 26, color: color.subtle }}>{row.note}</div>
        </div>
      ))}
      <div style={at(240, 850, { ...rise(t, 1.1, 0.5), fontFamily: font.body, fontSize: 30, color: color.muted })}>
        Подписки нет. Баланс тратится только на то, что ты запросил.
      </div>
    </div>
  )
}

/* 13. Финал. */
function OutroScene({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.25, 0.01)
  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <div style={at(0, 390, { width: stageWidth, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 32, ...pop(t, 0.05, 0.55, 0.85), transformOrigin: '50% 50%' })}>
        <div
          style={{
            width: 106,
            height: 106,
            borderRadius: 26,
            border: `3px solid ${color.accent}`,
            display: 'grid',
            placeItems: 'center',
            fontFamily: font.display,
            fontSize: 44,
            color: color.ink,
            letterSpacing: '-0.04em',
          }}
        >
          HC
        </div>
        <div style={{ fontFamily: font.display, fontSize: 100, lineHeight: 1, color: color.ink }}>
          Homework <span style={{ color: color.accent }}>Copilot</span>
        </div>
      </div>
      <div style={at(0, 560, { width: stageWidth, textAlign: 'center', ...rise(t, 0.5, 0.5), fontFamily: font.display, fontSize: 46, color: color.muted })}>
        Сфоткал. Списал.
      </div>
      <div style={at(0, 660, { width: stageWidth, display: 'flex', justifyContent: 'center', ...pop(t, 0.85, 0.5, 0.85), transformOrigin: '50% 50%' })}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '22px 44px',
            borderRadius: 16,
            background: color.accent,
            color: '#fff',
            fontFamily: font.body,
            fontSize: 30,
            fontWeight: 620,
          }}
        >
          homeworkcopilot.ru
          <ArrowRight size={26} weight="bold" />
        </div>
      </div>
    </div>
  )
}

const scenes = {
  hook: HookScene,
  problem: ProblemScene,
  form: FormScene,
  photo: PhotoScene,
  launch: LaunchScene,
  solving: SolvingScene,
  checked: CheckedScene,
  sheet: SheetScene,
  rewrite: RewriteScene,
  subjects: SubjectsScene,
  more: MoreScene,
  price: PriceScene,
  outro: OutroScene,
}

export function HeroFilm({ T }: { T: number }) {
  const { beat, local } = beatAt(heroBeats, T)
  const Scene = scenes[beat.id as keyof typeof scenes]

  return (
    <Stage
      T={T}
      shakeMarks={[
        { at: starts.hook + 0.05, amplitude: 16 },
        { at: starts.launch + 0.55, amplitude: 14 },
        { at: starts.checked + 0.05, amplitude: 12 },
      ]}
    >
      <Scene t={local} duration={beat.duration} />
    </Stage>
  )
}
