/* Ролик первого экрана: один компонент = один кадр.

   Вход - авторское время T в секундах от начала. Никаких CSS-анимаций и
   переходов: всё, что двигается, считается от T через функции из motion.ts,
   поэтому кадр воспроизводим, таймлайн можно тянуть рукой, а рендер
   (scripts/render-promo.mjs) снимает его кадр за кадром.

   Сцена получает своё локальное время t = T - start и сама решает, что и
   когда показать. Сцены и длительности - в timeline.ts.

   Цвета заданы явно, а не токенами темы: кадр не должен зависеть от того,
   светлая у документа тема или тёмная.

   Всё, что здесь обещано, есть в коде: цена - src/lib/solutionPricing.ts,
   20 ₽ при регистрации - server/homeworkSolver.ts, два прохода и рецензент -
   server/geometrySolutionEngine.ts, предметы - src/CopyTask.tsx. */

import type { CSSProperties, ReactNode } from 'react'
import { clamp01, easeInCubic, easeInOutCubic, hold, lerp, pop, ramp, rise, stroke, typed } from './motion'
import { sceneAt, scenes } from './timeline'

export const stageWidth = 1920
export const stageHeight = 1080

const color = {
  bg: '#0f1014',
  grid: 'rgba(255, 255, 255, 0.045)',
  ink: '#f5f5f7',
  muted: '#a6aab6',
  subtle: '#6f7381',
  accent: '#3f6cff',
  accentSoft: 'rgba(63, 108, 255, 0.16)',
  card: '#15161c',
  cardRaised: '#1d1e26',
  cardLine: 'rgba(255, 255, 255, 0.09)',
  paper: '#fffefd',
  paperInk: '#14161a',
  paperPencil: '#565656',
  paperLine: '#d8e2ef',
  paperMargin: '#e8a3ae',
}

const font = {
  display: 'var(--font-display)',
  body: 'var(--font-body)',
  mono: 'var(--font-mono)',
  hand: "'Segoe Print', 'Ink Free', 'Comic Sans MS', cursive",
}

const condition = 'Ромб ABCD, AC = 10 см, BD = 24 см. Найти AB.'

const subjects = [
  'Математика', 'Алгебра', 'Геометрия', 'Физика', 'Химия', 'Биология', 'Информатика',
  'Русский язык', 'Литература', 'Английский язык', 'История', 'Обществознание', 'География', 'Астрономия',
]

/* ─── Мелкие кирпичики ─────────────────────────────────────────────── */

function at(left: number, top: number, extra: CSSProperties = {}): CSSProperties {
  return { position: 'absolute', left, top, ...extra }
}

function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        color: color.subtle,
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function Card({ style, children }: { style?: CSSProperties; children: ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        boxSizing: 'border-box',
        background: color.card,
        border: `1px solid ${color.cardLine}`,
        borderRadius: 28,
        boxShadow: '0 30px 80px rgba(0, 0, 0, 0.45)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/* Тетрадный лист: клетка, поле, рукописный набор - как на витрине. */
function Paper({ width, height, style, children }: { width: number; height: number; style?: CSSProperties; children: ReactNode }) {
  return (
    <div
      style={{
        position: 'absolute',
        boxSizing: 'border-box',
        width,
        height,
        background: color.paper,
        backgroundImage: `linear-gradient(${color.paperLine} 1px, transparent 1px), linear-gradient(90deg, ${color.paperLine} 1px, transparent 1px)`,
        backgroundSize: '32px 32px',
        backgroundPosition: '0 0',
        borderRadius: 8,
        boxShadow: '0 40px 90px rgba(0, 0, 0, 0.55), 0 2px 0 rgba(0, 0, 0, 0.2)',
        color: color.paperInk,
        fontFamily: font.hand,
        overflow: 'hidden',
        ...style,
      }}
    >
      <div style={at(64, 0, { width: 2, height, background: color.paperMargin, opacity: 0.7 })} />
      {children}
    </div>
  )
}

function Hand({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ position: 'absolute', fontFamily: font.hand, fontSize: 24, lineHeight: 1.25, color: color.paperInk, whiteSpace: 'nowrap', ...style }}>{children}</div>
}

/* ─── Фон: клетка и блуждающее синее свечение, общие для всех сцен ───── */

function Ambient({ T }: { T: number }) {
  const glowX = 960 + Math.sin(T * 0.23) * 320
  const glowY = 380 + Math.cos(T * 0.17) * 140
  return (
    <>
      <div
        style={at(0, 0, {
          width: stageWidth,
          height: stageHeight,
          backgroundImage: `linear-gradient(${color.grid} 1px, transparent 1px), linear-gradient(90deg, ${color.grid} 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
          backgroundPosition: '32px 24px',
        })}
      />
      <div
        style={at(0, 0, {
          width: stageWidth,
          height: stageHeight,
          background: `radial-gradient(720px 520px at ${glowX.toFixed(1)}px ${glowY.toFixed(1)}px, rgba(63, 108, 255, 0.26), rgba(63, 108, 255, 0.06) 45%, transparent 72%)`,
        })}
      />
      <div
        style={at(0, 0, {
          width: stageWidth,
          height: stageHeight,
          background: 'radial-gradient(120% 90% at 50% 45%, transparent 55%, rgba(0, 0, 0, 0.55) 100%)',
        })}
      />
    </>
  )
}

/* ─── Сцена 1. Ночь: часы бегут, задача одна ───────────────────────── */

function clockLabel(t: number) {
  const advanced = Math.floor(easeInCubic(clamp01(t / 6.4)) * 24)
  const total = (23 * 60 + 40 + advanced) % (24 * 60)
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function SceneNight({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.5, 0.45)
  const tilt = lerp(-9, -6, ramp(t, 0.5, duration - 0.5, easeInOutCubic))
  const paperIn = pop(t, 0.5, 0.8, 0.9)
  const noteShown = t >= 1.6

  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <Eyebrow style={at(200, 300, rise(t, 0.2))}>Геометрия · 8 класс</Eyebrow>
      <div
        style={at(196, 350, {
          ...rise(t, 0.35, 0.7),
          fontFamily: font.mono,
          fontSize: 220,
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: '0.02em',
          color: color.ink,
          fontVariantNumeric: 'tabular-nums',
        })}
      >
        {clockLabel(t)}
      </div>
      <div
        style={at(200, 610, {
          ...rise(t, 0.75, 0.7),
          fontFamily: font.display,
          fontSize: 66,
          lineHeight: 1.05,
          color: color.ink,
          width: 760,
        })}
      >
        Задача одна.<br />Вечера больше нет.
      </div>
      <div style={at(200, 866, { ...rise(t, 4.6, 0.6), display: 'flex', alignItems: 'center', gap: 18 })}>
        <div style={{ width: 36, height: 2, background: color.accent }} />
        <div style={{ fontFamily: font.body, fontSize: 28, color: color.muted }}>
          Решебник даёт ответ к номеру. Запись для тетради он не даёт.
        </div>
      </div>

      <div style={at(1180, 250, { ...paperIn, transformOrigin: '50% 50%' })}>
        <Paper width={520} height={660} style={{ transform: `rotate(${tilt.toFixed(2)}deg)` }}>
          <Hand style={{ left: 96, top: 36, fontSize: 30, fontWeight: 700 }}>№ 274</Hand>
          <Hand style={{ left: 96, top: 96, fontSize: 22, lineHeight: 1.5, whiteSpace: 'normal', width: 380, opacity: ramp(t, 1.2, 0.4) }}>
            {typed(condition, t, 1.2, 1.6)}
          </Hand>
          <Hand style={{ left: 96, top: 190, fontSize: 22, color: '#b3402f', opacity: noteShown ? ramp(t, 3.2, 0.5) : 0 }}>
            AB = ?
          </Hand>
        </Paper>
      </div>
    </div>
  )
}

/* ─── Сцена 2. Условие: текст печатается, фото прилетает ───────────── */

function SceneInput({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.5, 0.45)
  const text = typed(condition, t, 0.9, 3.1)
  const typing = t >= 0.9 && t < 4.0
  const caretOn = typing && Math.floor(t * 2.4) % 2 === 0
  const press = Math.sin(Math.PI * clamp01((t - 4.6) / 0.32))
  const photoIn = ramp(t, 2.3, 0.75, easeInOutCubic)

  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <Eyebrow style={at(200, 190, rise(t, 0.1))}>Условие задачи</Eyebrow>

      <Card style={at(200, 250, { ...rise(t, 0.2, 0.7, 40), width: 900, height: 560, padding: 40 })}>
        <div
          style={{
            boxSizing: 'border-box',
            width: '100%',
            height: 250,
            padding: 28,
            borderRadius: 18,
            background: color.cardRaised,
            fontFamily: font.body,
            fontSize: 34,
            lineHeight: 1.4,
            color: color.ink,
          }}
        >
          {text}
          <span style={{ display: 'inline-block', width: 3, height: '1.05em', marginLeft: 3, verticalAlign: '-0.15em', background: color.accent, opacity: caretOn ? 1 : 0 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 34, ...rise(t, 0.6, 0.5, 12) }}>
          {['Предмет: геометрия', 'Класс: 8'].map((chip) => (
            <div
              key={chip}
              style={{
                padding: '16px 26px',
                borderRadius: 14,
                border: `1px solid ${color.cardLine}`,
                fontFamily: font.body,
                fontSize: 24,
                fontWeight: 540,
                color: color.muted,
              }}
            >
              {chip}
            </div>
          ))}
          <div
            style={{
              marginLeft: 'auto',
              padding: '18px 34px',
              borderRadius: 14,
              background: press > 0 ? '#5d84ff' : color.accent,
              color: '#fff',
              fontFamily: font.body,
              fontSize: 26,
              fontWeight: 620,
              transform: `scale(${(1 - press * 0.06).toFixed(4)})`,
              boxShadow: `0 ${lerp(12, 4, press).toFixed(1)}px 30px rgba(63, 108, 255, 0.45)`,
            }}
          >
            Решить →
          </div>
        </div>
        <div style={{ marginTop: 26, fontFamily: font.body, fontSize: 22, color: color.subtle, ...rise(t, 0.8, 0.5, 8) }}>
          Условие приносишь ты: подойдёт любой учебник, тетрадь или карточка от учителя.
        </div>
      </Card>

      <div
        style={at(1160, 250, {
          ...rise(t, 0.35, 0.7, 40),
          boxSizing: 'border-box',
          width: 560,
          height: 560,
          borderRadius: 28,
          border: `2px dashed ${color.cardLine}`,
          background: 'rgba(255, 255, 255, 0.02)',
        })}
      >
        <div style={at(40, 460, { ...rise(t, 0.7, 0.5, 8) })}>
          <Eyebrow style={{ fontSize: 18, color: color.subtle }}>Фото условия</Eyebrow>
          <div style={{ marginTop: 10, fontFamily: font.body, fontSize: 22, color: color.subtle }}>снимок из учебника или с доски</div>
        </div>
        <div
          style={at(120, lerp(-260, 70, photoIn), {
            opacity: ramp(t, 2.3, 0.3),
            transform: `rotate(${lerp(-14, -4, photoIn).toFixed(2)}deg)`,
          })}
        >
          <Paper width={320} height={360}>
            <Hand style={{ left: 84, top: 24, fontSize: 22, fontWeight: 700 }}>№ 274</Hand>
            <Hand style={{ left: 84, top: 70, fontSize: 15, whiteSpace: 'normal', width: 210, lineHeight: 1.5 }}>{condition}</Hand>
          </Paper>
        </div>
        <div
          style={at(330, 40, {
            ...pop(t, 3.5, 0.6),
            padding: '12px 20px',
            borderRadius: 999,
            background: color.accent,
            color: '#fff',
            fontFamily: font.mono,
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
          })}
        >
          Фото приложено ✓
        </div>
      </div>

      <div style={at(200, 860, { ...rise(t, 5.3, 0.6), display: 'flex', alignItems: 'center', gap: 18 })}>
        <div style={{ width: 36, height: 2, background: color.accent }} />
        <div style={{ fontFamily: font.body, fontSize: 28, color: color.muted }}>Задача ушла на два независимых прохода.</div>
      </div>
    </div>
  )
}

/* ─── Сцена 3. Два прохода сходятся в одном ответе ─────────────────── */

const passOne = ['AO = 10 : 2 = 5', 'BO = 24 : 2 = 12', 'AB² = 5² + 12² = 169', 'AB = 13 см']
const passTwo = ['A(−5; 0), B(0; 12)', 'AB² = 25 + 144', 'AB = √169', 'AB = 13 см']

function PassCard({ t, x, title, tag, lines, startAt }: { t: number; x: number; title: string; tag: string; lines: string[]; startAt: number }) {
  return (
    <Card style={at(x, 300, { ...rise(t, startAt, 0.7, 40), width: 760, height: 430, padding: 36 })}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 12, height: 12, borderRadius: 999, background: color.accent }} />
        <div style={{ fontFamily: font.body, fontSize: 30, fontWeight: 620, color: color.ink }}>{title}</div>
        <Eyebrow style={{ marginLeft: 'auto', fontSize: 16 }}>{tag}</Eyebrow>
      </div>
      {lines.map((line, index) => {
        const last = index === lines.length - 1
        return (
          <div
            key={line}
            style={{
              marginTop: index === 0 ? 34 : 18,
              padding: last ? '14px 18px' : '0 18px',
              borderRadius: 12,
              background: last ? color.cardRaised : 'transparent',
              fontFamily: font.mono,
              fontSize: 28,
              color: last ? color.ink : color.muted,
              ...rise(t, startAt + 0.7 + index * 0.7, 0.45, 10),
            }}
          >
            {line}
          </div>
        )
      })}
    </Card>
  )
}

function ScenePasses({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.5, 0.45)
  const settle = ramp(t, 4.6, 0.7)

  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <Eyebrow style={at(160, 220, rise(t, 0.1))}>Каждая задача решается дважды</Eyebrow>
      <div
        style={at(0, 0, {
          width: stageWidth,
          height: stageHeight,
          transform: `translateY(${(-70 * settle).toFixed(1)}px) scale(${lerp(1, 0.9, settle).toFixed(4)})`,
          transformOrigin: '50% 45%',
          opacity: lerp(1, 0.35, settle),
        })}
      >
        <PassCard t={t} x={160} title="Проход 1" tag="Теорема Пифагора" lines={passOne} startAt={0.3} />
        <PassCard t={t} x={1000} title="Проход 2" tag="Координаты" lines={passTwo} startAt={0.5} />
      </div>
      <div
        style={at(0, 640, {
          ...pop(t, 4.8, 0.6, 0.6),
          width: stageWidth,
          display: 'flex',
          justifyContent: 'center',
          transformOrigin: '50% 50%',
        })}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 22,
            padding: '24px 44px',
            borderRadius: 999,
            background: color.accent,
            color: '#fff',
            boxShadow: '0 24px 70px rgba(63, 108, 255, 0.45)',
          }}
        >
          <div style={{ fontFamily: font.display, fontSize: 46, lineHeight: 1 }}>✓ AB = 13 см</div>
          <div style={{ fontFamily: font.mono, fontSize: 18, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.9 }}>ответы сошлись</div>
        </div>
      </div>
      <div
        style={at(0, 790, {
          ...rise(t, 5.9, 0.6),
          width: stageWidth,
          textAlign: 'center',
          fontFamily: font.body,
          fontSize: 28,
          color: color.muted,
        })}
      >
        Не сошлись бы: решение не выдаётся, деньги не списываются.
      </div>
    </div>
  )
}

/* ─── Сцена 4. Тетрадь: страница заполняется сама ──────────────────── */

const solutionSteps = [
  '1) Диагонали ромба делятся пополам и ⊥',
  '2) AO = AC : 2 = 5 см, BO = BD : 2 = 12 см',
  '3) △AOB прямоугольный, ∠AOB = 90°',
  '4) AB² = AO² + BO² = 25 + 144 = 169',
  '5) AB = √169 = 13 см',
]

function Rhombus({ t }: { t: number }) {
  const outline = stroke(t, 2.4, 1.6, 570)
  const diagonalAC = stroke(t, 4.0, 0.45, 180)
  const diagonalBD = stroke(t, 4.35, 0.5, 220)
  const mark = stroke(t, 5.0, 0.3, 26)
  const label = (start: number): CSSProperties => ({ opacity: ramp(t, start, 0.3) })
  const pencil = { fill: 'none', stroke: color.paperPencil, strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg viewBox="0 0 220 260" width={230} height={272} style={{ position: 'absolute', left: 372, top: 150 }}>
      <path d="M20 130 L110 20 L200 130 L110 240 Z" style={{ ...pencil, ...outline }} />
      <path d="M20 130 L200 130" style={{ ...pencil, strokeWidth: 1.6, ...diagonalAC }} />
      <path d="M110 20 L110 240" style={{ ...pencil, strokeWidth: 1.6, ...diagonalBD }} />
      <path d="M110 117 L123 117 L123 130" style={{ ...pencil, strokeWidth: 1.5, ...mark }} />
      <g style={{ fontFamily: font.hand, fontSize: 20, fill: color.paperInk }}>
        <text x="2" y="136" style={label(4.6)}>A</text>
        <text x="104" y="14" style={label(4.7)}>B</text>
        <text x="206" y="136" style={label(4.8)}>C</text>
        <text x="104" y="258" style={label(4.9)}>D</text>
        <text x="116" y="152" style={label(5.1)}>O</text>
      </g>
    </svg>
  )
}

function SceneNotebook({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.5, 0.45)
  const pageIn = pop(t, 0.2, 0.8, 0.94)
  // Длина штриха с запасом больше самой кривой: иначе при нулевом прогрессе
  // из-под пунктира вылезал хвост линии.
  const answerLine = stroke(t, 7.7, 0.5, 320)

  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <div style={at(220, 120, { ...pageIn, transformOrigin: '50% 50%' })}>
        <Paper width={660} height={840}>
          <Hand style={{ right: 44, top: 30, fontSize: 30, fontWeight: 700 }}>№ 274</Hand>
          <Hand style={{ left: 96, top: 86, fontSize: 21, opacity: ramp(t, 0.4, 0.4) }}>{condition}</Hand>
          <div style={at(96, 132, { width: 520, height: 2, background: color.paperInk, opacity: ramp(t, 0.6, 0.3) })} />

          <Hand style={{ left: 96, top: 154, fontWeight: 700, ...rise(t, 1.0, 0.4, 8) }}>Дано:</Hand>
          <Hand style={{ left: 96, top: 194, ...rise(t, 1.25, 0.4, 8) }}>ромб ABCD</Hand>
          <Hand style={{ left: 96, top: 230, ...rise(t, 1.5, 0.4, 8) }}>AC = 10 см</Hand>
          <Hand style={{ left: 96, top: 266, ...rise(t, 1.75, 0.4, 8) }}>BD = 24 см</Hand>
          <div style={at(96, 306, { width: 230, height: 2, background: color.paperInk, opacity: ramp(t, 2.0, 0.3) })} />
          <Hand style={{ left: 96, top: 318, fontWeight: 700, ...rise(t, 2.15, 0.4, 8) }}>Найти: AB</Hand>
          <div style={at(346, 154, { width: 2, height: 200, background: color.paperInk, opacity: ramp(t, 1.0, 0.4) })} />

          <Rhombus t={t} />

          <Hand style={{ left: 96, top: 396, fontWeight: 700, ...rise(t, 5.2, 0.4, 8) }}>Решение:</Hand>
          {solutionSteps.map((step, index) => (
            <Hand key={step} style={{ left: 96, top: 440 + index * 40, fontSize: 22, ...rise(t, 5.5 + index * 0.4, 0.4, 8) }}>
              {step}
            </Hand>
          ))}

          <Hand style={{ left: 96, top: 668, fontSize: 26, fontWeight: 700, ...rise(t, 7.5, 0.4, 8) }}>Ответ: AB = 13 см.</Hand>
          <svg width={300} height={8} style={{ position: 'absolute', left: 92, top: 704 }}>
            <path d="M2 4 C 60 1, 140 7, 296 3" style={{ fill: 'none', stroke: color.paperInk, strokeWidth: 2.2, strokeLinecap: 'round', ...answerLine }} />
          </svg>
        </Paper>
      </div>

      <div
        style={at(1020, 400, {
          ...rise(t, 7.9, 0.7),
          fontFamily: font.display,
          fontSize: 86,
          lineHeight: 1.02,
          color: color.ink,
        })}
      >
        Осталось<br />переписать.
      </div>
      <div style={at(1020, 620, { ...rise(t, 8.3, 0.6), fontFamily: font.body, fontSize: 30, lineHeight: 1.45, color: color.muted, width: 700 })}>
        Дано, ход решения по шагам, чертёж, ответ. Формулы записаны по-школьному.
      </div>
    </div>
  )
}

/* ─── Сцена 5. Четырнадцать предметов ──────────────────────────────── */

function MarqueeRow({ t, y, speed, offset, start }: { t: number; y: number; speed: number; offset: number; start: number }) {
  const shift = offset + t * speed
  // Три копии списка подряд, чтобы лента не кончалась за время сцены.
  const sequence = [0, 1, 2].flatMap((copy) => subjects.map((subject, position) => ({ copy, subject, accent: (copy * subjects.length + position) % 3 === 1 })))
  return (
    <div style={at(0, y, { ...rise(t, start, 0.6, 0), width: stageWidth, overflow: 'hidden', height: 90 })}>
      <div style={{ display: 'flex', gap: 64, whiteSpace: 'nowrap', transform: `translateX(${shift.toFixed(1)}px)` }}>
        {sequence.map(({ copy, subject, accent }) => (
          <div
            key={`${copy}:${subject}`}
            style={{
              fontFamily: font.display,
              fontSize: 54,
              lineHeight: '90px',
              color: accent ? color.accent : color.ink,
              opacity: accent ? 1 : 0.42,
            }}
          >
            {subject}
          </div>
        ))}
      </div>
    </div>
  )
}

function SceneSubjects({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.5, 0.45)
  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <MarqueeRow t={t} y={150} speed={-140} offset={-400} start={0.4} />
      <div
        style={at(0, 400, {
          ...rise(t, 0.2, 0.7),
          width: stageWidth,
          textAlign: 'center',
          fontFamily: font.display,
          fontSize: 150,
          lineHeight: 1,
          color: color.ink,
        })}
      >
        14 предметов
      </div>
      <div
        style={at(0, 585, {
          ...rise(t, 0.5, 0.6),
          width: stageWidth,
          textAlign: 'center',
          fontFamily: font.mono,
          fontSize: 26,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: color.muted,
        })}
      >
        5-11 класс · любой учебник
      </div>
      <MarqueeRow t={t} y={840} speed={120} offset={-2400} start={0.6} />
    </div>
  )
}

/* ─── Сцена 6. Цена: без подписки и без бесплатных обещаний ────────── */

const priceRows = [
  { label: 'Решение задачи', value: '5 ₽', note: 'любой предмет, фото или текст', accent: false },
  { label: 'После регистрации', value: '20 ₽', note: 'сразу на счёте, это четыре решения', accent: true },
  { label: 'Не решилась', value: '0 ₽', note: 'деньги остаются на балансе', accent: false },
]

function ScenePrice({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.5, 0.45)
  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <Eyebrow style={at(240, 200, rise(t, 0.1))}>Сколько это стоит</Eyebrow>
      {priceRows.map((row, index) => {
        const start = 0.4 + index * 0.7
        return (
          <div key={row.label} style={at(240, 300 + index * 170, { ...rise(t, start, 0.7, 34), width: 1440, display: 'grid', gridTemplateColumns: '440px 420px 1fr', alignItems: 'center' })}>
            <div style={{ fontFamily: font.body, fontSize: 30, color: color.muted }}>{row.label}</div>
            <div style={{ fontFamily: font.display, fontSize: 92, lineHeight: 1, color: row.accent ? color.accent : color.ink }}>{row.value}</div>
            <div style={{ fontFamily: font.body, fontSize: 26, color: color.subtle }}>{row.note}</div>
          </div>
        )
      })}
      <div style={at(240, 300 + priceRows.length * 170 - 20, { width: 1440, height: 1, background: color.cardLine, opacity: ramp(t, 2.6, 0.4) })} />
      <div style={at(240, 830, { ...rise(t, 2.8, 0.6), fontFamily: font.body, fontSize: 28, color: color.muted })}>
        Подписки нет. Баланс тратится только на то, что ты запросил.
      </div>
    </div>
  )
}

/* ─── Сцена 7. Финал ───────────────────────────────────────────────── */

function SceneOutro({ t, duration }: { t: number; duration: number }) {
  const opacity = hold(t, 0, duration, 0.5, 0.01)
  const toBlack = ramp(t, duration - 0.7, 0.7, easeInCubic)
  return (
    <div style={at(0, 0, { width: stageWidth, height: stageHeight, opacity })}>
      <div style={at(0, 380, { ...pop(t, 0.2, 0.7, 0.86), width: stageWidth, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 34, transformOrigin: '50% 50%' })}>
        <div
          style={{
            width: 104,
            height: 104,
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
        <div style={{ fontFamily: font.display, fontSize: 96, lineHeight: 1, color: color.ink }}>
          Homework <span style={{ color: color.accent }}>Copilot</span>
        </div>
      </div>
      <div style={at(0, 540, { ...rise(t, 0.8, 0.6), width: stageWidth, textAlign: 'center', fontFamily: font.mono, fontSize: 30, letterSpacing: '0.16em', color: color.accent })}>
        homeworkcopilot.ru
      </div>
      <div style={at(0, 620, { ...rise(t, 1.2, 0.6), width: stageWidth, textAlign: 'center', fontFamily: font.display, fontSize: 40, color: color.muted })}>
        Сфоткал. Списал.
      </div>
      <div style={at(0, 0, { width: stageWidth, height: stageHeight, background: '#000', opacity: toBlack })} />
    </div>
  )
}

/* ─── Сборка кадра ─────────────────────────────────────────────────── */

const sceneComponents = {
  night: SceneNight,
  input: SceneInput,
  passes: ScenePasses,
  notebook: SceneNotebook,
  subjects: SceneSubjects,
  price: ScenePrice,
  outro: SceneOutro,
} satisfies Record<(typeof scenes)[number]['id'], (props: { t: number; duration: number }) => ReactNode>

export function PromoFilm({ T }: { T: number }) {
  const { scene, local } = sceneAt(T)
  const Scene = sceneComponents[scene.id]
  const fadeFromBlack = 1 - ramp(T, 0, 0.7)

  return (
    <div
      style={{
        position: 'relative',
        width: stageWidth,
        height: stageHeight,
        overflow: 'hidden',
        background: color.bg,
        color: color.ink,
        fontFamily: font.body,
        userSelect: 'none',
      }}
    >
      <Ambient T={T} />
      <Scene t={local} duration={scene.duration} />
      <div style={at(0, 0, { width: stageWidth, height: stageHeight, background: '#000', opacity: fadeFromBlack, pointerEvents: 'none' })} />
    </div>
  )
}
