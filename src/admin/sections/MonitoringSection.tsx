/* Мониторинг: ошибки со сводкой, графиком и алертами, качество решений,
   логи запросов и светофор сервисов. Раздел открыт ролям с правом
   settings (admin и owner); у поддержки его нет - RPC всё равно ответят
   отказом. Вкладки живут в своих файлах рядом. */

import { useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { EmptyState, ErrorState, PageHeader, Panel, Tabs, useQueryState } from '../ui'
import { useAdmin } from '../context'
import { pushParams } from './monitoringLabels'
import { ErrorsTab } from './MonitoringErrors'
import { QualityTab } from './MonitoringQuality'
import { LogsTab } from './MonitoringLogs'
import { HealthTab } from './MonitoringHealth'
import './monitoring.css'

type MonitoringTab = 'errors' | 'quality' | 'logs' | 'health'
const tabValues: MonitoringTab[] = ['errors', 'quality', 'logs', 'health']

export default function MonitoringSection() {
  const { access, signals } = useAdmin()
  const [state, setState] = useQueryState({ m_tab: 'errors', m_kind: '' })
  const tab: MonitoringTab = tabValues.find((value) => value === state.m_tab) ?? 'errors'

  const openLogs = useCallback((requestId: string) => {
    pushParams({ m_tab: 'logs', m_kind: '', m_request: requestId, m_rq: '', m_user: '', m_lpage: '', fingerprint: '', m_event: '' })
  }, [])

  if (!access.permissions.settings) {
    return (
      <>
        <PageHeader title="Мониторинг" />
        <Panel>
          <EmptyState>
            Мониторинг открыт ролям admin и owner: ошибки, логи запросов и состояние сервисов содержат данные всех учеников. Для роли поддержки есть раздел «Поддержка» и карточка пользователя.
          </EmptyState>
        </Panel>
      </>
    )
  }

  if (!supabase) {
    return (
      <>
        <PageHeader title="Мониторинг" />
        <ErrorState message="Подключение к базе не настроено." />
      </>
    )
  }

  return (
    <>
      <PageHeader title="Мониторинг" description="Ошибки, качество решений, логи запросов и состояние сервисов. Данные обновляются сами." />
      <Tabs
        value={tab}
        tabs={[
          { value: 'errors', label: 'Ошибки', badge: signals.openErrors },
          { value: 'quality', label: 'Качество' },
          { value: 'logs', label: 'Логи' },
          { value: 'health', label: 'Состояние' },
        ]}
        // m_kind у ошибок и логов значит разное, при смене вкладки его сбрасываем.
        onChange={(next) => setState({ m_tab: next, m_kind: '' })}
      />
      {tab === 'errors' && <ErrorsTab onOpenLogs={openLogs} />}
      {tab === 'quality' && <QualityTab />}
      {tab === 'logs' && <LogsTab />}
      {tab === 'health' && <HealthTab />}
    </>
  )
}
