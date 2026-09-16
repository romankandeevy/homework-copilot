import { useCallback, useEffect, useState } from 'react'
import { X } from '@phosphor-icons/react'
import './PrivacyNotice.css'

const acknowledgementKey = 'homework-copilot:storage-notice-v1'

/* Прокрутка в первые мгновения - это не человек, а сама страница: документ
   прокручивается к якорю из адреса, приложение поднимает раздел наверх. */
const scrollDismissDelayMs = 800

function wasAcknowledged() {
  try {
    return window.localStorage.getItem(acknowledgementKey) === 'acknowledged'
  } catch {
    return false
  }
}

/* Уведомление о хранении данных - одна строка внизу, без кнопки.

   Аудит 16 сентября 2026 (Г4): на 375x812 плашка с кнопкой «Понятно»
   занимала около 180 пикселей, ложилась на строку про регистрацию и на
   кнопку поддержки и стояла на каждой публичной странице до нажатия.
   Рекламных cookie нет, согласие здесь не спрашивается - это сообщение, а не
   выбор. Поэтому оно закрывается само, как только человек начал листать
   страницу, и крестиком - для тех, кто не листает (клавиатура, скринридер).

   Прокрутка слушается на захвате: в приложении на телефоне листает не окно,
   а `.product-content`, и до окна событие не всплывает. */
export default function PrivacyNotice() {
  const [visible, setVisible] = useState(() => !wasAcknowledged())

  const acknowledge = useCallback(() => {
    try {
      window.localStorage.setItem(acknowledgementKey, 'acknowledged')
    } catch {
      // Без хранилища уведомление закрывается хотя бы на этой странице.
    }
    setVisible(false)
  }, [])

  useEffect(() => {
    if (!visible) return
    let listening = false
    const onScroll = () => acknowledge()
    const timer = window.setTimeout(() => {
      document.addEventListener('scroll', onScroll, { capture: true, passive: true })
      listening = true
    }, scrollDismissDelayMs)
    return () => {
      window.clearTimeout(timer)
      if (listening) document.removeEventListener('scroll', onScroll, { capture: true })
    }
  }, [visible, acknowledge])

  if (!visible) return null

  return (
    <aside className="privacy-notice" aria-label="Уведомление о хранении данных">
      <p>
        <strong>Без рекламных cookie.</strong>
        <span className="privacy-notice-detail"> В браузере хранятся только вход, тема и твои данные.</span>
        {' '}<a href="/docs/cookies">Подробнее</a>
      </p>
      <button type="button" onClick={acknowledge} aria-label="Закрыть уведомление">
        <X size={16} weight="bold" aria-hidden="true" />
      </button>
    </aside>
  )
}
