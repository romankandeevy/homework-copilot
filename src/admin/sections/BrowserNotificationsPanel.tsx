/* Системные уведомления браузера для поддержки. Раньше кнопка стояла в
   шапке раздела «Поддержка»; разрешение - настройка этого браузера, а не
   работа с обращениями, поэтому оно здесь. Показывает уведомление сам
   раздел «Поддержка» (SupportSection), когда его вкладка в фоне. */

import { useState } from 'react'
import { Bell, BellRinging, BellSlash } from '@phosphor-icons/react'
import { Badge, Button, Panel } from '../ui'

type Permission = NotificationPermission | 'unsupported'

function currentPermission(): Permission {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
}

export default function BrowserNotificationsPanel() {
  const [permission, setPermission] = useState<Permission>(currentPermission)

  const request = () => {
    if (typeof Notification === 'undefined') return
    void Notification.requestPermission().then(setPermission, () => setPermission(currentPermission()))
  }

  return (
    <Panel
      title="Уведомления в этом браузере"
      description="Когда раздел «Поддержка» открыт в фоновой вкладке, новое сообщение ученика придёт системным уведомлением. Разрешение хранит браузер, на каждом устройстве оно своё."
    >
      <div className="ntf-browser">
        {permission === 'granted' && (
          <Badge tone="success"><BellRinging size={13} weight="bold" aria-hidden="true" /> Включены</Badge>
        )}
        {permission === 'default' && (
          <Button variant="primary" size="sm" icon={<Bell size={16} weight="bold" aria-hidden="true" />} onClick={request}>Включить уведомления</Button>
        )}
        {permission === 'denied' && (
          <>
            <Badge tone="danger"><BellSlash size={13} weight="bold" aria-hidden="true" /> Запрещены</Badge>
            <p className="ntf-note">Браузер запретил уведомления для сайта. Разреши их в настройках сайта (значок слева от адреса) и обнови страницу.</p>
          </>
        )}
        {permission === 'unsupported' && (
          <p className="ntf-note">Этот браузер не показывает системные уведомления. Звуковой сигнал о новом сообщении в разделе «Поддержка» работает и без них.</p>
        )}
        {permission !== 'unsupported' && permission !== 'denied' && (
          <p className="ntf-note">Звуковой сигнал о новом сообщении работает и без разрешения - после первого клика по странице.</p>
        )}
      </div>
    </Panel>
  )
}
