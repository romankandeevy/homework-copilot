/* Ролик первого экрана: 45 секунд, тринадцать коротких ударов.

   Длинную сцену подросток не досиживает, поэтому кадр здесь меняется каждые
   две-четыре секунды: жёсткие склейки со вспышкой, влёты сбоку, тряска на
   ударах, кинетический набор слов. Всё это - вычисленные стили от авторского
   времени T, без CSS-анимаций: кадр воспроизводим и рендерится покадрово.

   Продукт показан настоящим интерфейсом (realUi.tsx), а не его подобием.

   Форматов два: широкий 1920×1080 и вертикальный 1080×1350 для телефона.
   Сцена одна и та же, но знает оба кадра: `pick` даёт разное число там, где
   вертикаль требует своей раскладки, `type` - кегль под узкий кадр. Раньше
   телефон показывал широкий ролик обрезанным по бокам, и половина надписей
   уезжала за край. */

import { ArrowRight, ChatsCircle, Compass, PencilSimpleLine, Table } from '@phosphor-icons/react'
import { countUp, easeOutBack, easeOutExpo, hold, lerp, pop, ramp, rise, typed, whip } from './motion'
import { AppScreen, NotebookPage, SolveCard, TaskFormCard, taskCondition } from './realUi'
import { Eyebrow, Stage, Zoom, at, color, font, useStage, type StageFormat } from './stage'
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
  const { pick } = useStage()
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0 0.28em', ...style }}>
      {words.map((word, index) => {
        const p = ramp(t, start + index * gap, 0.42, easeOutExpo)
        return (
          <span
            key={word + String(index)}
            style={{
              display: 'inline-block',
              opacity: p,
              transform: `translateY(${((1 - p) * pick(44, 32)).toFixed(2)}px) skewY(${((1 - p) * -5).toFixed(2)}deg)`,
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
  const { width, height, pick, type } = useStage()
  const opacity = hold(t, 0, duration, 0.25, 0.3)
  const punch = 1 + (1 - ramp(t, 0.05, 0.5, easeOutBack)) * 0.16
  const minutes = 40 + countUp(t, 0.2, 2.4, 0, 7)

  return (
    <div style={at(0, 0, { width, height, opacity })}>
      <Eyebrow style={at(0, pick(330, 430), { width, textAlign: 'center', ...rise(t, 0.1, 0.4) })}>Геометрия · 7 класс</Eyebrow>
      <div
        style={at(0, pick(380, 490), {
          width,
          textAlign: 'center',
          fontFamily: font.mono,
          fontSize: type(300),
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
      <div style={at(0, pick(730, 840), { width, display: 'flex', justifyContent: 'center' })}>
        <Kinetic
          t={t}
          start={1.5}
          words={['Завтра', 'сдавать.']}
          style={{ fontFamily: font.display, fontSize: type(64), color: color.muted }}
        />
      </div>
    </div>
  )
}

/* 2. Проблема. */
function ProblemScene({ t, duration }: { t: number; duration: number }) {
  const { width, height, safe, safeWidth, pick, type } = useStage()
  const opacity = hold(t, 0, duration, 0.2, 0.3)
  return (
    <div style={at(0, 0, { width, height, opacity })}>
      <div style={at(0, pick(340, 420), { width, display: 'flex', justifyContent: 'center' })}>
        <Kinetic t={t} start={0.05} words={['Задача', 'одна.']} style={{ fontFamily: font.display, fontSize: type(150), lineHeight: 1.05, color: color.ink }} />
      </div>
      <div style={at(0, pick(520, 570), { width, display: 'flex', justifyContent: 'center' })}>
        <Kinetic t={t} start={0.7} words={['Вечера', '—', 'нет.']} style={{ fontFamily: font.display, fontSize: type(150), lineHeight: 1.05, color: color.accentInk }} />
      </div>
      <div style={at(safe, pick(780, 880), { width: safeWidth, textAlign: 'center', ...rise(t, 1.7, 0.5), fontFamily: font.body, fontSize: type(32), lineHeight: 1.4, color: color.muted })}>
        Решебник даёт ответ к номеру. Запись для тетради он не даёт.
      </div>
    </div>
  )
}

/* 3. Настоящая форма: условие печатается. */
function FormScene({ t, duration }: { t: number; duration: number }) {
  const { width, height, safe, safeWidth, pick, type } = useStage()
  const opacity = hold(t, 0, duration, 0.2, 0.25)
  const text = typed(taskCondition, t, 0.5, 2.4)
  return (
    <div style={at(0, 0, { width, height, opacity })}>
      <Eyebrow style={at(0, pick(120, 190), { width, textAlign: 'center', ...rise(t, 0.05, 0.4) })}>Экран приложения</Eyebrow>
      <Zoom left={pick(180, 60)} top={pick(230, 330)} width={pick(1560, 960)} scale={pick(1, 1.08)}>
        <AppScreen width={pick(1560, 960)} style={{ left: 0, top: 0, ...whip(t, 0.05, 0.5, 260), transformOrigin: '50% 50%' }}>
          <TaskFormCard condition={text} pressed={false} submitting={false} />
        </AppScreen>
      </Zoom>
      <div style={at(safe, pick(900, 1180), { width: safeWidth, textAlign: 'center', ...rise(t, 2.9, 0.45), fontFamily: font.body, fontSize: type(32), lineHeight: 1.4, color: color.muted })}>
        Условие приносишь ты - любой учебник, тетрадь или карточка от учителя.
      </div>
    </div>
  )
}

/* 4. Фотография падает в поле. */
function PhotoScene({ t, duration }: { t: number; duration: number }) {
  const { width, height, pick } = useStage()
  const opacity = hold(t, 0, duration, 0.2, 0.25)
  const drop = ramp(t, 0.15, 0.75, easeOutBack)
  const card = { width: pick(600, 620), height: pick(500, 520) }
  return (
    <div style={at(0, 0, { width, height, opacity })}>
      <Eyebrow style={at(0, pick(150, 250), { width, textAlign: 'center', ...rise(t, 0.05, 0.4) })}>Или просто фотографией</Eyebrow>
      <div
        style={at(pick(660, (width - card.width) / 2), lerp(-420, pick(300, 380), drop), {
          width: card.width,
          height: card.height,
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
        <div style={at(72, 0, { width: 2, height: card.height, background: '#e8a3ae', opacity: 0.75 })} />
        <div style={at(104, 40, { fontSize: 30, fontWeight: 700 })}>№ 274</div>
        <div style={at(104, 100, { width: card.width - 160, fontSize: 22, lineHeight: 1.55 })}>{taskCondition}</div>
      </div>
      <div
        style={at(pick(1290, 330), pick(300, 1010), {
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
  const { width, height, pick, type } = useStage()
  const opacity = hold(t, 0, duration, 0.15, 0.2)
  const pressed = t >= 0.55 && t < 0.85
  const push = 1 - ramp(t, 0.55, 0.3) * 0.03 + ramp(t, 0.85, 0.4) * 0.03
  return (
    <div style={at(0, 0, { width, height, opacity })}>
      <Zoom left={pick(180, 60)} top={pick(240, 350)} width={pick(1560, 960)} scale={pick(1, 1.08)}>
        <AppScreen width={pick(1560, 960)} style={{ left: 0, top: 0, transform: `scale(${push.toFixed(4)})`, transformOrigin: '50% 50%' }}>
          <TaskFormCard condition={taskCondition} pressed={pressed} submitting={t >= 0.9} />
        </AppScreen>
      </Zoom>
      <div style={at(0, pick(930, 1200), { width, textAlign: 'center', ...rise(t, 1.0, 0.4), fontFamily: font.display, fontSize: type(52), color: color.ink })}>
        Пошло.
      </div>
    </div>
  )
}

/* 6. Настоящая карточка решения: четыре шага продукта. */
function SolvingScene({ t, duration }: { t: number; duration: number }) {
  const { width, height, safe, safeWidth, pick, type } = useStage()
  const opacity = hold(t, 0, duration, 0.2, 0.25)
  const stageIndex = t < 1.0 ? 0 : t < 2.2 ? 1 : t < 3.4 ? 2 : 3
  const seconds = Math.min(59, Math.floor(7 + t * 6))
  return (
    <div style={at(0, 0, { width, height, opacity })}>
      <Eyebrow style={at(0, pick(130, 250), { width, textAlign: 'center', ...rise(t, 0.05, 0.4) })}>Каждая задача решается дважды</Eyebrow>
      <Zoom left={pick(370, 190)} top={pick(280, 440)} width={pick(1180, 700)} scale={pick(1, 1.5)}>
        <AppScreen width={pick(1180, 700)} style={{ left: 0, top: 0, ...pop(t, 0.05, 0.45, 0.96), transformOrigin: '50% 50%' }}>
          <SolveCard stageIndex={stageIndex} clock={`0:${String(seconds).padStart(2, '0')}`} spin={t * 330} />
        </AppScreen>
      </Zoom>
      <div style={at(safe, pick(920, 1150), { width: safeWidth, textAlign: 'center', ...rise(t, 3.9, 0.45), fontFamily: font.body, fontSize: type(30), lineHeight: 1.4, color: color.muted })}>
        Два независимых прохода и сверка между ними.
      </div>
    </div>
  )
}

/* 7. Сверка сошлась. */
function CheckedScene({ t, duration }: { t: number; duration: number }) {
  const { width, height, safe, safeWidth, pick, type } = useStage()
  const opacity = hold(t, 0, duration, 0.15, 0.25)
  return (
    <div style={at(0, 0, { width, height, opacity })}>
      <div style={at(0, pick(420, 560), { width, display: 'flex', justifyContent: 'center', ...pop(t, 0.05, 0.5, 0.55), transformOrigin: '50% 50%' })}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 26,
            padding: pick('30px 56px', '24px 40px'),
            borderRadius: 999,
            background: color.accent,
            color: '#fff',
            boxShadow: '0 30px 90px rgba(63, 108, 255, 0.55)',
          }}
        >
          <div style={{ fontFamily: font.display, fontSize: type(62), lineHeight: 1 }}>✓ Ответы сошлись</div>
        </div>
      </div>
      <div style={at(safe, pick(640, 780), { width: safeWidth, textAlign: 'center', ...rise(t, 0.75, 0.5), fontFamily: font.body, fontSize: type(32), lineHeight: 1.4, color: color.muted })}>
        Не сошлись бы - решение не выдаётся и деньги не списываются.
      </div>
    </div>
  )
}

/* 8. Настоящий тетрадный лист заполняется. */
function SheetScene({ t, duration }: { t: number; duration: number }) {
  const { width, height, pick } = useStage()
  const opacity = hold(t, 0, duration, 0.2, 0.25)
  const filled = ramp(t, 0.3, 3.8)
  const zoom = 1 + ramp(t, 0, duration, (p) => p) * 0.08
  return (
    <div style={at(0, 0, { width, height, opacity })}>
      <Eyebrow style={at(0, pick(110, 200), { width, textAlign: 'center', ...rise(t, 0.05, 0.4) })}>Готовая запись, а не голый ответ</Eyebrow>
      <div style={at(0, pick(175, 300), { width, display: 'flex', justifyContent: 'center', transform: `scale(${(zoom * pick(1, 1.5)).toFixed(4)})`, transformOrigin: '50% 18%' })}>
        <NotebookPage filled={filled} width={pick(480, 640)} />
      </div>
    </div>
  )
}

/* 9. Осталось переписать. В широком кадре текст слева и лист справа,
   в вертикальном - текст сверху, лист под ним. */
function RewriteScene({ t, duration }: { t: number; duration: number }) {
  const { width, height, pick, type } = useStage()
  const opacity = hold(t, 0, duration, 0.2, 0.25)
  return (
    <div style={at(0, 0, { width, height, opacity })}>
      <div style={at(pick(200, 60), pick(360, 160), { width: pick(900, 960) })}>
        <Kinetic
          t={t}
          start={0.05}
          words={['Осталось', 'переписать.']}
          style={{ justifyContent: 'flex-start', fontFamily: font.display, fontSize: type(128), lineHeight: 1.0, color: color.ink }}
        />
      </div>
      <div style={at(pick(200, 60), pick(640, 400), { ...rise(t, 0.7, 0.5), width: pick(820, 960), fontFamily: font.body, fontSize: type(32), lineHeight: 1.45, color: color.muted })}>
        Дано, ход решения по шагам, чертёж и ответ. Формулы записаны по-школьному.
      </div>
      <Zoom left={pick(1240, 220)} top={pick(150, 620)} width={pick(350, 640)} scale={pick(1, 1.25)}>
        <div style={at(0, 0, { ...whip(t, 0.3, 0.55, 300) })}>
          <NotebookPage filled={1} width={pick(350, 640)} />
        </div>
      </Zoom>
    </div>
  )
}

/* 10. Четырнадцать предметов: счётчик и лента. */
function MarqueeRow({ t, y, speed, offset }: { t: number; y: number; speed: number; offset: number }) {
  const { width, pick, type } = useStage()
  const rowHeight = pick(86, 66)
  const sequence = [0, 1, 2].flatMap((copy) => subjects.map((subject, position) => ({ copy, subject, accent: (copy * subjects.length + position) % 3 === 1 })))
  return (
    <div style={at(0, y, { width, overflow: 'hidden', height: rowHeight })}>
      <div style={{ display: 'flex', gap: pick(60, 44), whiteSpace: 'nowrap', transform: `translateX(${(offset + t * speed).toFixed(1)}px)` }}>
        {sequence.map(({ copy, subject, accent }) => (
          <div
            key={`${copy}:${subject}`}
            style={{ fontFamily: font.display, fontSize: type(52), lineHeight: `${rowHeight}px`, color: accent ? color.accent : color.ink, opacity: accent ? 1 : 0.4 }}
          >
            {subject}
          </div>
        ))}
      </div>
    </div>
  )
}

function SubjectsScene({ t, duration }: { t: number; duration: number }) {
  const { width, height, pick, type } = useStage()
  const opacity = hold(t, 0, duration, 0.2, 0.25)
  return (
    <div style={at(0, 0, { width, height, opacity })}>
      <MarqueeRow t={t} y={pick(170, 320)} speed={-190} offset={-380} />
      <div
        style={at(0, pick(400, 570), {
          width,
          textAlign: 'center',
          ...pop(t, 0.05, 0.5, 0.8),
          fontFamily: font.display,
          fontSize: pick(168, 92),
          lineHeight: 1,
          color: color.ink,
          transformOrigin: '50% 50%',
        })}
      >
        {countUp(t, 0.15, 1.1, 1, 14)} предметов
      </div>
      <div style={at(0, pick(610, 740), { width, textAlign: 'center', ...rise(t, 0.8, 0.5), fontFamily: font.mono, fontSize: type(26), letterSpacing: '0.18em', textTransform: 'uppercase', color: color.muted })}>
        5-11 класс · любой учебник
      </div>
      <MarqueeRow t={t} y={pick(830, 960)} speed={170} offset={-2600} />
    </div>
  )
}

/* 11. Что ещё умеет: быстрые плашки. В вертикальном кадре они идут одной
   колонкой - в две плашка сжимается до нечитаемой. */
const extras = [
  { icon: Compass, title: 'Чертёж по условию', note: 'фигура строится из данных задачи' },
  { icon: PencilSimpleLine, title: 'Разбор со значками', note: 'подлежащее, суффикс, степень окисления' },
  { icon: ChatsCircle, title: 'ИИ-чат по домашке', note: 'спросить, почему шаг именно такой' },
  { icon: Table, title: 'Расписание с фото', note: 'снимок доски становится таблицей' },
]

function MoreScene({ t, duration }: { t: number; duration: number }) {
  const { width, height, pick } = useStage()
  const opacity = hold(t, 0, duration, 0.2, 0.25)
  return (
    <div style={at(0, 0, { width, height, opacity })}>
      <Eyebrow style={at(pick(160, 60), pick(300, 270), rise(t, 0.05, 0.4))}>Не только решение задачи</Eyebrow>
      <div style={at(pick(160, 60), pick(380, 350), { width: pick(1600, 960), display: 'grid', gridTemplateColumns: pick('1fr 1fr', '1fr'), gap: pick(28, 22) })}>
        {extras.map(({ icon: Icon, title, note }, index) => (
          <div
            key={title}
            style={{
              ...pop(t, 0.25 + index * 0.14, 0.5, 0.86),
              display: 'flex',
              alignItems: 'center',
              gap: pick(26, 22),
              padding: pick('34px 38px', '28px 30px'),
              borderRadius: 24,
              background: 'rgba(255, 255, 255, 0.045)',
              border: '1px solid rgba(255, 255, 255, 0.09)',
              transformOrigin: '50% 50%',
            }}
          >
            <Icon size={pick(46, 40)} weight="duotone" color={color.accentInk} />
            <div>
              <div style={{ fontFamily: font.display, fontSize: pick(36, 32), color: color.ink }}>{title}</div>
              <div style={{ marginTop: 8, fontFamily: font.body, fontSize: pick(24, 21), lineHeight: 1.3, color: color.subtle }}>{note}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* 12. Цена. Без «бесплатно без регистрации»: обещаем то, что даёт сервер.
   В вертикальном кадре строка цены складывается в столбик. */
const priceRows = [
  { label: 'Решение задачи', value: '5 ₽', note: 'любой предмет, фото или текст', accent: false },
  { label: 'После регистрации', value: '20 ₽', note: 'сразу на счёте - это четыре решения', accent: true },
  { label: 'Не решилась', value: '0 ₽', note: 'деньги остаются на балансе', accent: false },
]

function PriceScene({ t, duration }: { t: number; duration: number }) {
  const { width, height, pick, type } = useStage()
  const opacity = hold(t, 0, duration, 0.2, 0.25)
  return (
    <div style={at(0, 0, { width, height, opacity })}>
      <Eyebrow style={at(pick(240, 60), pick(240, 270), rise(t, 0.05, 0.4))}>Сколько это стоит</Eyebrow>
      {priceRows.map((row, index) => (
        <div
          key={row.label}
          style={at(pick(240, 60), pick(330 + index * 165, 360 + index * 230), {
            ...whip(t, 0.2 + index * 0.16, 0.45, 160),
            width: pick(1440, 960),
            display: 'grid',
            gridTemplateColumns: pick('440px 400px 1fr', '1fr'),
            alignItems: 'center',
          })}
        >
          <div style={{ fontFamily: font.body, fontSize: type(32), color: color.muted }}>{row.label}</div>
          <div style={{ fontFamily: font.display, fontSize: type(96), lineHeight: 1.05, color: row.accent ? color.accent : color.ink }}>{row.value}</div>
          <div style={{ fontFamily: font.body, fontSize: type(26), color: color.subtle }}>{row.note}</div>
        </div>
      ))}
      <div style={at(pick(240, 60), pick(850, 1120), { ...rise(t, 1.1, 0.5), width: pick(1440, 960), fontFamily: font.body, fontSize: type(30), lineHeight: 1.4, color: color.muted })}>
        Подписки нет. Баланс тратится только на то, что ты запросил.
      </div>
    </div>
  )
}

/* 13. Финал. */
function OutroScene({ t, duration }: { t: number; duration: number }) {
  const { width, height, pick, type } = useStage()
  const opacity = hold(t, 0, duration, 0.25, 0.01)
  const badge = pick(106, 84)
  return (
    <div style={at(0, 0, { width, height, opacity })}>
      <div style={at(0, pick(390, 520), { width, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: pick(32, 22), ...pop(t, 0.05, 0.55, 0.85), transformOrigin: '50% 50%' })}>
        <div
          style={{
            width: badge,
            height: badge,
            borderRadius: pick(26, 20),
            border: `3px solid ${color.accent}`,
            display: 'grid',
            placeItems: 'center',
            fontFamily: font.display,
            fontSize: type(44),
            color: color.ink,
            letterSpacing: '-0.04em',
          }}
        >
          HC
        </div>
        <div style={{ fontFamily: font.display, fontSize: type(100), lineHeight: 1, color: color.ink }}>
          Homework <span style={{ color: color.accent }}>Copilot</span>
        </div>
      </div>
      <div style={at(0, pick(560, 700), { width, textAlign: 'center', ...rise(t, 0.5, 0.5), fontFamily: font.display, fontSize: type(46), color: color.muted })}>
        Сфоткал. Списал.
      </div>
      <div style={at(0, pick(660, 810), { width, display: 'flex', justifyContent: 'center', ...pop(t, 0.85, 0.5, 0.85), transformOrigin: '50% 50%' })}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: pick('22px 44px', '18px 34px'),
            borderRadius: 16,
            background: color.accent,
            color: '#fff',
            fontFamily: font.body,
            fontSize: type(30),
            fontWeight: 620,
          }}
        >
          homeworkcopilot.ru
          <ArrowRight size={pick(26, 22)} weight="bold" />
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

export function HeroFilm({ T, format = 'wide' }: { T: number; format?: StageFormat }) {
  const { beat, local } = beatAt(heroBeats, T)
  const Scene = scenes[beat.id as keyof typeof scenes]

  return (
    <Stage
      T={T}
      format={format}
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
