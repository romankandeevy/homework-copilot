/* Общий язык кадра для обоих роликов: размер сцены, фон, служебные надписи.

   Цвета заданы явно, а не токенами темы: кадр не должен меняться от того,
   светлая тема у документа или тёмная. Настоящие куски интерфейса внутри
   (realUi.tsx) - наоборот, красятся токенами, как на сайте. */

import type { CSSProperties, ReactNode } from 'react'
import { flash, shake } from './motion'

export const stageWidth = 1920
export const stageHeight = 1080

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

export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: font.mono,
        fontSize: 22,
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
  const glowX = 960 + Math.sin(T * 0.5) * 420
  const glowY = 420 + Math.cos(T * 0.37) * 190
  return (
    <>
      <div
        style={at(0, 0, {
          width: stageWidth,
          height: stageHeight,
          backgroundImage: `linear-gradient(${color.grid} 1px, transparent 1px), linear-gradient(90deg, ${color.grid} 1px, transparent 1px)`,
          backgroundSize: '64px 64px',
          backgroundPosition: `${(T * 6) % 64}px ${(T * 4) % 64}px`,
        })}
      />
      <div
        style={at(0, 0, {
          width: stageWidth,
          height: stageHeight,
          background: `radial-gradient(760px 540px at ${glowX.toFixed(1)}px ${glowY.toFixed(1)}px, rgba(63, 108, 255, ${0.3 * intensity}), rgba(63, 108, 255, ${0.07 * intensity}) 45%, transparent 72%)`,
        })}
      />
      <div
        style={at(0, 0, {
          width: stageWidth,
          height: stageHeight,
          background: 'radial-gradient(125% 95% at 50% 45%, transparent 52%, rgba(0, 0, 0, 0.6) 100%)',
        })}
      />
    </>
  )
}

/* Вспышка на монтажном стыке: белая на ударе, синяя на смене темы. */
export function Cuts({ T, marks }: { T: number; marks: readonly { at: number; tone?: 'white' | 'accent'; power?: number }[] }) {
  return (
    <>
      {marks.map((mark) => {
        const value = flash(T, mark.at, 0.2) * (mark.power ?? 0.5)
        if (value <= 0.001) return null
        return (
          <div
            key={`${mark.at}-${mark.tone ?? 'white'}`}
            style={at(0, 0, {
              width: stageWidth,
              height: stageHeight,
              background: mark.tone === 'accent' ? color.accent : '#fff',
              opacity: value,
              mixBlendMode: 'screen',
              pointerEvents: 'none',
            })}
          />
        )
      })}
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

export function Stage({ T, children, shakeMarks = noMarks, cutMarks = noMarks, glow = 1 }: {
  T: number
  children: ReactNode
  shakeMarks?: readonly { at: number; amplitude?: number }[]
  cutMarks?: readonly { at: number; tone?: 'white' | 'accent'; power?: number }[]
  glow?: number
}) {
  const camera = useCameraShake(T, shakeMarks)
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
      <div style={at(0, 0, { width: stageWidth, height: stageHeight, transform: `translate(${camera.x.toFixed(2)}px, ${camera.y.toFixed(2)}px)` })}>
        <Ambient T={T} intensity={glow} />
        {children}
      </div>
      <Cuts T={T} marks={cutMarks} />
    </div>
  )
}
