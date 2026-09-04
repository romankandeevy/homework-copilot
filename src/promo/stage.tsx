/* Общий язык кадра для обоих роликов: формат сцены, фон, служебные надписи.

   Форматов два. `wide` - 1920×1080, ролик на широком экране. `tall` -
   1080×1350, тот же ролик для телефона: раньше вертикальный экран обрезал
   широкий кадр по бокам и половина надписей уезжала за край. Сцены не
   дублируются - каждая знает свой формат через `useStage` и переставляет
   в вертикальном кадре ровно то, что нужно переставить.

   Цвета заданы явно, а не токенами темы: кадр не должен меняться от того,
   светлая тема у документа или тёмная. Настоящие куски интерфейса внутри
   (realUi.tsx) - наоборот, красятся токенами, как на сайте. */

import { createContext, useContext, type CSSProperties, type ReactNode } from 'react'
import { shake } from './motion'

/* `width`/`height` - система координат сцены. `cssWidth` - ширина окна, в
   котором кадр рисуется: она уходит в медиазапросы приложения. У вертикали
   окно 960 px, поэтому настоящий интерфейс внутри кадра раскладывается
   по-телефонному - одной колонкой, как его и увидит зритель с телефона.
   Кадр от этого не мельчает: сцена рисуется в своих 1080×1350 и сжимается
   в окно, а снимок делается на удвоенной плотности. */
export const stageFormats = {
  wide: { width: 1920, height: 1080, cssWidth: 1920 },
  tall: { width: 1080, height: 1350, cssWidth: 960 },
} as const

export function viewScaleOf(format: StageFormat) {
  return stageFormats[format].cssWidth / stageFormats[format].width
}

export type StageFormat = keyof typeof stageFormats

export const stageWidth = stageFormats.wide.width
export const stageHeight = stageFormats.wide.height

const StageFormatContext = createContext<StageFormat>('wide')

/* Размеры кадра и две мерки для сцены:
   - `pick(широкое, вертикальное)` - значение, которое в форматах разное;
   - `type(кегль)` - кегль широкого кадра, приведённый к вертикальному.
     Кадр уже почти вдвое, но текст ужимается слабее: на телефоне надпись
     должна занимать большую долю ширины, иначе её не прочесть. */
export function useStage() {
  const format = useContext(StageFormatContext)
  const tall = format === 'tall'
  return {
    format,
    tall,
    ...stageFormats[format],
    pick: <T,>(wide: T, tallValue: T) => (tall ? tallValue : wide),
    /* Поля вертикального кадра: в широком строка идёт от края до края,
       в узком без отступа текст упирается в border телефона. */
    safe: tall ? 60 : 0,
    safeWidth: stageFormats[format].width - (tall ? 120 : 0),
    type: (size: number) => (tall ? Math.round(size * 0.72) : size),
  }
}

export const color = {
  bg: '#0d0e12',
  grid: 'rgba(255, 255, 255, 0.05)',
  ink: '#f6f6f8',
  muted: '#a8acb8',
  subtle: '#71757f',
  accent: '#3f6cff',
  accentInk: '#8fa9ff',
}

export const font = {
  display: 'var(--font-display)',
  body: 'var(--font-body)',
  mono: 'var(--font-mono)',
}

export function at(left: number, top: number, extra: CSSProperties = {}): CSSProperties {
  return { position: 'absolute', left, top, ...extra }
}

/* Экран приложения в вертикальном кадре: по вёрстке он уже, а по масштабу
   крупнее. Сжать ширину мало - CSS-кегли внутри остаются прежними, и с
   телефона подписи интерфейса не прочесть. Масштаб отдан обёртке, чтобы
   собственные превращения сцены (влёт, нажатие) остались нетронутыми. */
export function Zoom({ left, top, width, scale = 1, children }: {
  left: number
  top: number
  /* Ширина обёртки равна ширине экрана внутри: без неё точка отсчёта
     масштаба приходится на левый край, и увеличенный экран уезжает
     за правую границу кадра. */
  width: number
  scale?: number
  children: ReactNode
}) {
  return (
    <div style={at(left, top, { width, transform: `scale(${scale})`, transformOrigin: '50% 0' })}>
      {children}
    </div>
  )
}

export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  const { type } = useStage()
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: type(22),
        fontWeight: 600,
        letterSpacing: '0.24em',
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

/* Фон: клетка и синее свечение, которое медленно ходит по кадру. Ролик от
   этого не «стоит» даже там, где ничего не происходит. */
export function Ambient({ T, intensity = 1 }: { T: number; intensity?: number }) {
  const { width, height, tall } = useStage()
  const glowX = width / 2 + Math.sin(T * 0.5) * width * 0.22
  const glowY = height * 0.39 + Math.cos(T * 0.37) * height * 0.18
  const cell = tall ? 48 : 64
  const glow = { x: tall ? 620 : 760, y: tall ? 620 : 540 }
  return (
    <>
      <div
        style={at(0, 0, {
          width,
          height,
          backgroundImage: `linear-gradient(${color.grid} 1px, transparent 1px), linear-gradient(90deg, ${color.grid} 1px, transparent 1px)`,
          backgroundSize: `${cell}px ${cell}px`,
          backgroundPosition: `${(T * 6) % cell}px ${(T * 4) % cell}px`,
        })}
      />
      <div
        style={at(0, 0, {
          width,
          height,
          background: `radial-gradient(${glow.x}px ${glow.y}px at ${glowX.toFixed(1)}px ${glowY.toFixed(1)}px, rgba(63, 108, 255, ${0.3 * intensity}), rgba(63, 108, 255, ${0.07 * intensity}) 45%, transparent 72%)`,
        })}
      />
      <div
        style={at(0, 0, {
          width,
          height,
          background: 'radial-gradient(125% 95% at 50% 45%, transparent 52%, rgba(0, 0, 0, 0.6) 100%)',
        })}
      />
    </>
  )
}

/* Тряска всего кадра после удара: сцена смещается целиком. */
export function useCameraShake(T: number, marks: readonly { at: number; amplitude?: number }[]) {
  let x = 0
  let y = 0
  for (const mark of marks) {
    const offset = shake(T, mark.at, 0.34, mark.amplitude ?? 12)
    x += offset.x
    y += offset.y
  }
  return { x, y }
}

const noMarks: readonly never[] = []

function StageBody({ T, children, shakeMarks, glow }: {
  T: number
  children: ReactNode
  shakeMarks: readonly { at: number; amplitude?: number }[]
  glow: number
}) {
  const { width, height } = useStage()
  const camera = useCameraShake(T, shakeMarks)
  return (
    <div
      style={{
        position: 'relative',
        width,
        height,
        overflow: 'hidden',
        background: color.bg,
        color: color.ink,
        fontFamily: font.body,
        userSelect: 'none',
      }}
    >
      <div style={at(0, 0, { width, height, transform: `translate(${camera.x.toFixed(2)}px, ${camera.y.toFixed(2)}px)` })}>
        <Ambient T={T} intensity={glow} />
        {children}
      </div>
    </div>
  )
}

export function Stage({ T, children, shakeMarks = noMarks, glow = 1, format = 'wide' }: {
  T: number
  children: ReactNode
  shakeMarks?: readonly { at: number; amplitude?: number }[]
  glow?: number
  format?: StageFormat
}) {
  return (
    <StageFormatContext.Provider value={format}>
      <StageBody T={T} shakeMarks={shakeMarks} glow={glow}>{children}</StageBody>
    </StageFormatContext.Provider>
  )
}
