import { useState } from 'react'
import { Check, ShieldCheck } from '@phosphor-icons/react'
import './PrivacyNotice.css'

const acknowledgementKey = 'homework-copilot:storage-notice-v1'

function wasAcknowledged() {
  try {
    return window.localStorage.getItem(acknowledgementKey) === 'acknowledged'
  } catch {
    return false
  }
}

export default function PrivacyNotice() {
  const [visible, setVisible] = useState(() => !wasAcknowledged())

  if (!visible) return null

  const acknowledge = () => {
    try {
      window.localStorage.setItem(acknowledgementKey, 'acknowledged')
    } catch {
      // The notice can still be dismissed for the current page when storage is unavailable.
    }
    setVisible(false)
  }

  return (
    <aside className="privacy-notice" aria-label="Уведомление о хранении данных">
      <span className="privacy-notice-icon" aria-hidden="true"><ShieldCheck size={22} weight="duotone" /></span>
      <p><strong>Без рекламных cookie.</strong> Мы сохраняем в браузере только вход, тему, выбранный учебник и твои локальные данные. <a href="/cookies">Как это работает</a></p>
      <button type="button" onClick={acknowledge}>Понятно <Check size={16} weight="bold" aria-hidden="true" /></button>
    </aside>
  )
}
