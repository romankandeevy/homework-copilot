/* Студия ролика: играет кадр правды (PromoFilm) по времени и даёт таймлайн.

   Открывается только в разработке: http://localhost:5173/?promo=1
   С `&render=1` остаётся голая сцена 1920×1080 без панели - так её снимает
   scripts/render-promo.mjs, выставляя время через window.promoControl.setTime.

   Управление: пробел - пуск/пауза, стрелки - кадр, с Shift - секунда,
   Home - в начало. Панель нарисована inline-стилями, как и сам ролик:
   у студии нет своего CSS-файла. */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import { PromoFilm, stageHeight, stageWidth } from './PromoFilm'
import { frameRate, sceneAt, scenes, sceneStarts, totalDuration } from './timeline'

declare global {
  interface Window {
    promoControl?: {
      total: number
      fps: number
      setTime: (T: number) => void
      getTime: () => number
    }
  }
}

const transportHeight = 132

const chipStyle: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,0.14)',
  background: 'transparent',
  color: '#c9ccd6',
  fontFamily: 'var(--font-mono)',
  fontSize: 12,
  cursor: 'pointer',
}

function useStageScale(renderMode: boolean) {
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    if (renderMode) return
    const measure = () => {
      const width = (window.innerWidth - 48) / stageWidth
      const height = (window.innerHeight - transportHeight - 48) / stageHeight
      setScale(Math.max(0.1, Math.min(width, height)))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [renderMode])
  return scale
}

export default function PromoStudio() {
  const params = new URLSearchParams(window.location.search)
  const renderMode = params.get('render') === '1'
  const initialTime = Math.min(Math.max(Number(params.get('t') ?? 0) || 0, 0), totalDuration)

  const [T, setT] = useState(initialTime)
  const [playing, setPlaying] = useState(!renderMode && params.get('autoplay') !== '0')
  const timeRef = useRef(initialTime)
  timeRef.current = T
  const scale = useStageScale(renderMode)

  // Часы студии: время течёт по requestAnimationFrame и зацикливается.
  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const delta = (now - last) / 1000
      last = now
      setT((current) => {
        const next = current + delta
        return next >= totalDuration ? next - totalDuration : next
      })
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  // Ручка для рендера: выставить время и дорисовать кадр синхронно.
  useEffect(() => {
    window.promoControl = {
      total: totalDuration,
      fps: frameRate,
      setTime: (value) => {
        flushSync(() => {
          setPlaying(false)
          setT(Math.min(Math.max(value, 0), totalDuration))
        })
      },
      getTime: () => timeRef.current,
    }
    return () => {
      delete window.promoControl
    }
  }, [])

  useEffect(() => {
    document.title = renderMode ? 'Ролик: рендер' : 'Ролик: студия'
    const { body, documentElement } = document
    const previous = { margin: body.style.margin, overflow: body.style.overflow, background: body.style.background, color: documentElement.style.colorScheme }
    body.style.margin = '0'
    body.style.overflow = 'hidden'
    body.style.background = renderMode ? '#000' : '#08090c'
    documentElement.style.colorScheme = 'dark'
    return () => {
      body.style.margin = previous.margin
      body.style.overflow = previous.overflow
      body.style.background = previous.background
      documentElement.style.colorScheme = previous.color
    }
  }, [renderMode])

  useEffect(() => {
    if (renderMode) return
    const step = 1 / frameRate
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return
      if (event.code === 'Space') {
        event.preventDefault()
        setPlaying((value) => !value)
      } else if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
        event.preventDefault()
        const direction = event.code === 'ArrowRight' ? 1 : -1
        const amount = event.shiftKey ? 1 : step
        setPlaying(false)
        setT((current) => Math.min(Math.max(current + direction * amount, 0), totalDuration - step))
      } else if (event.code === 'Home') {
        setPlaying(false)
        setT(0)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [renderMode])

  if (renderMode) {
    return (
      <div style={{ width: stageWidth, height: stageHeight, overflow: 'hidden' }}>
        <PromoFilm T={T} />
      </div>
    )
  }

  const { scene, local } = sceneAt(T)

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', gridTemplateRows: `1fr ${transportHeight}px`, background: '#08090c', color: '#e6e8ee' }}>
      <div style={{ display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
        <div style={{ width: stageWidth * scale, height: stageHeight * scale }}>
          <div style={{ transform: `scale(${scale})`, transformOrigin: '0 0', width: stageWidth, height: stageHeight, boxShadow: '0 30px 100px rgba(0,0,0,0.6)' }}>
            <PromoFilm T={T} />
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 12, padding: '14px 24px 18px', borderTop: '1px solid rgba(255,255,255,0.08)', background: '#0c0d12' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            type="button"
            onClick={() => setPlaying((value) => !value)}
            style={{ ...chipStyle, minWidth: 92, padding: '8px 14px', background: playing ? 'rgba(63,108,255,0.22)' : 'transparent', color: '#fff', fontSize: 13 }}
          >
            {playing ? 'Пауза' : 'Пуск'}
          </button>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: '#c9ccd6', fontVariantNumeric: 'tabular-nums' }}>
            {T.toFixed(2)} с / {totalDuration.toFixed(1)} с · кадр {Math.floor(T * frameRate)}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: '#8b90a0' }}>
            {scene.label} · {local.toFixed(2)} с
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {scenes.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setPlaying(false)
                  setT(sceneStarts[item.id])
                }}
                style={{ ...chipStyle, borderColor: item.id === scene.id ? '#3f6cff' : chipStyle.border as string, color: item.id === scene.id ? '#fff' : chipStyle.color }}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#6d7180', whiteSpace: 'nowrap' }}>
            пробел · ← → кадр · Shift секунда · Home
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={totalDuration}
          step={1 / frameRate}
          value={T}
          onChange={(event) => {
            setPlaying(false)
            setT(Number(event.target.value))
          }}
          style={{ width: '100%', accentColor: '#3f6cff' }}
          aria-label="Время ролика"
        />
      </div>
    </div>
  )
}
