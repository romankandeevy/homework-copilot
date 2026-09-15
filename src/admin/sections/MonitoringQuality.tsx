/* Вкладка «Качество»: сбои и обрезанные ответы по предметам, время
   ответа, чертежи и жалобы, длина ответа, предел частоты. */

import type { Json } from '../../lib/database.types'
import { useState } from 'react'
import { solvableSubjects } from '../../lib/subjects'
import { adminRpc, arr, formatNumber, formatPercent, num, numOrNull, obj, rows, shiftDate, str, todayMsk } from '../api'
import { Badge, Button, DataTable, DateRangePicker, EmptyState, ErrorState, HorizontalBars, Panel, Stat, StatGrid, useAction, useAsync, useQueryState } from '../ui'
import type { Column, Tone } from '../ui'
import { HeaderHint, LiveStatus } from './monitoringShared'
import { Check } from './settingsParts'
import './settings.css'
import { useLiveQuery } from './useLiveQuery'

/* Предметы в фокусе.

   До 15 сентября 2026 это был зашитый список - химия, литература,
   английский, история, - и поменять его было нельзя. Владелец открыл
   вкладку и спросил, почему в фокусе редкие и стабильные предметы. Теперь
   их выбирает владелец (ключ quality_focus_subjects), а пока не выбрал -
   автоматически: сначала предметы с проблемами за период, иначе самые
   частые. */
const FOCUS_SIZE = 4
const HELPFUL_BAD = 70

function autoFocus(subjects: readonly SubjectQuality[]) {
  const troubled = subjects
    .filter((row) => row.total > 0 && (row.failedShare >= FAILED_BAD || row.truncatedShare >= TRUNCATED_BAD || (row.helpfulShare !== null && row.helpfulShare < HELPFUL_BAD)))
    .sort((a, b) => (b.failedShare + b.truncatedShare) - (a.failedShare + a.truncatedShare) || b.total - a.total)
  const frequent = subjects.filter((row) => row.total > 0 && !troubled.includes(row)).sort((a, b) => b.total - a.total)
  return {
    subjects: [...troubled, ...frequent].slice(0, FOCUS_SIZE).map((row) => row.subject),
    reason: troubled.length > 0 ? 'автоматически: где больше проблем' : 'автоматически: самые частые',
  }
}
/* Доля сбоев от 10 % и обрезанных ответов от 5 % - красным в таблице. */
const FAILED_BAD = 10
const TRUNCATED_BAD = 5

type SubjectQuality = {
  subject: string
  total: number
  truncatedShare: number
  failedShare: number
  share: number | null
  helpful: number
  notHelpful: number
  helpfulShare: number | null
  p50: number | null
  p95: number | null
}

function formatSeconds(value: number | null) {
  return value === null ? '-' : `${formatNumber(value)} с`
}

export function QualityTab() {
  const today = todayMsk()
  const [q, setQ] = useQueryState({ m_from: shiftDate(today, -29), m_to: today })
  const quality = useLiveQuery(() => adminRpc<Json>('admin_quality', { p_from: q.m_from, p_to: q.m_to }), [q.m_from, q.m_to], { intervalMs: 120_000, onPulse: false })
  const data = obj(quality.data)

  const subjects: SubjectQuality[] = rows(data.bySubject).map((row) => ({
    subject: str(row.subject, 'Без предмета'),
    total: num(row.total),
    truncatedShare: num(row.truncatedShare),
    failedShare: num(row.failedShare),
    share: numOrNull(row.share),
    helpful: num(row.helpful),
    notHelpful: num(row.notHelpful),
    helpfulShare: numOrNull(row.helpfulShare),
    p50: numOrNull(row.p50),
    p95: numOrNull(row.p95),
  }))
  const latency = obj(data.latency)
  const chatLatency = obj(data.chatLatency)
  const diagrams = obj(data.diagrams)
  const rateLimit = obj(data.rateLimit)
  const chat = obj(data.chatTruncated)
  const lengthBars = rows(data.answerLength).map((row) => {
    const bucket = num(row.bucket)
    return { label: bucket >= 6000 ? 'от 6000 знаков' : `${formatNumber(bucket)}-${formatNumber(bucket + 499)} знаков`, value: num(row.count) }
  })
  const routeBars = Object.entries(obj(rateLimit.byRoute))
    .map(([route, value]) => ({ label: route, value: num(value) }))
    .sort((a, b) => b.value - a.value)
  const diagramTotal = num(diagrams.total)
  const solvedTotal = subjects.reduce((sum, row) => sum + row.total, 0)

  const focusSetting = useAsync(() => adminRpc<Json>('admin_settings_overview'), [])
  const savedFocus = arr(obj(obj(focusSetting.data).settings).quality_focus_subjects).filter((entry): entry is string => typeof entry === 'string')
  const manualFocus = savedFocus.length > 0
  const automatic = autoFocus(subjects)
  const focus = manualFocus ? savedFocus : automatic.subjects
  const [editingFocus, setEditingFocus] = useState(false)
  const [draftFocus, setDraftFocus] = useState<string[]>([])
  const { pending, run } = useAction()

  const saveFocus = async (next: string[]) => {
    const result = await run(
      'focus',
      () => adminRpc('admin_setting_save', { p_key: 'quality_focus_subjects', p_value: next }),
      next.length > 0 ? 'Предметы в фокусе сохранены.' : 'Предметы в фокусе снова выбираются автоматически.',
    )
    if (result === undefined) return
    setEditingFocus(false)
    focusSetting.reload()
  }

  const columns: Column<SubjectQuality>[] = [
    {
      key: 'subject',
      header: 'Предмет',
      render: (row) => (
        <span className="mon-subject">
          {row.subject}
          {focus.includes(row.subject) && <Badge tone="accent">в фокусе</Badge>}
        </span>
      ),
    },
    { key: 'total', header: 'Задач', align: 'right', render: (row) => formatNumber(row.total) },
    { key: 'share', header: <HeaderHint label="Доля от всех" hint="Какая часть всех задач периода пришлась на предмет." />, align: 'right', mobile: false, render: (row) => formatPercent(row.share) },
    {
      key: 'failed',
      header: <HeaderHint label="Доля сбоев" hint={`Задачи, которые закончились ошибкой. От ${FAILED_BAD} % - красным.`} />,
      align: 'right',
      render: (row) => <span className={row.failedShare >= FAILED_BAD ? 'mon-bad' : ''}>{formatPercent(row.failedShare)}</span>,
    },
    {
      key: 'truncated',
      header: <HeaderHint label="Обрезанные ответы" hint={`Модель упёрлась в предел длины, и ответ пришёл не целиком. От ${TRUNCATED_BAD} % - красным.`} />,
      align: 'right',
      render: (row) => <span className={row.truncatedShare >= TRUNCATED_BAD ? 'mon-bad' : ''}>{formatPercent(row.truncatedShare)}</span>,
    },
    {
      key: 'helpful',
      header: <HeaderHint label="Оценки «помогло»" hint="Доля оценок «помогло» среди всех оценок решений по предмету." />,
      align: 'right',
      mobile: false,
      render: (row) => (row.helpfulShare === null ? <span className="adm-muted">нет оценок</span> : <span title={`Помогло ${row.helpful}, не помогло ${row.notHelpful}`}>{formatPercent(row.helpfulShare)}</span>),
    },
    {
      key: 'latency',
      header: <HeaderHint label="Время решения" hint="Медиана и 95-й перцентиль: половина задач решается быстрее первого числа, 95 из 100 - быстрее второго." />,
      align: 'right',
      mobile: false,
      render: (row) => `${formatSeconds(row.p50)} / ${formatSeconds(row.p95)}`,
    },
  ]

  return (
    <>
      <Panel
        title="Качество решений"
        description="Сбои и обрезанные ответы по предметам, время решения, чертежи, жалобы и предел частоты за выбранный период."
        actions={(
          <>
            <LiveStatus updatedAt={quality.updatedAt} refreshing={quality.refreshing} error={quality.refreshError} />
            <DateRangePicker value={{ from: q.m_from, to: q.m_to }} onChange={(range) => setQ({ m_from: range.from, m_to: range.to })} />
          </>
        )}
      >
        {quality.error && !quality.data ? (
          <ErrorState message={quality.error} onRetry={quality.reload} />
        ) : !quality.data ? (
          <div className="mon-cards-skeleton" aria-hidden="true">{[0, 1, 2, 3].map((index) => <span key={index} />)}</div>
        ) : (
          <div className="mon-stack-gap">
            <section aria-label="Предметы в фокусе">
              <div className="mon-focus-head">
                <h3 className="mon-subhead">
                  Предметы в фокусе
                  <Badge tone={manualFocus ? 'accent' : 'neutral'}>{manualFocus ? 'выбраны вручную' : automatic.reason}</Badge>
                </h3>
                {!editingFocus && (
                  <Button size="sm" variant="ghost" onClick={() => { setDraftFocus(focus); setEditingFocus(true) }}>Выбрать предметы</Button>
                )}
              </div>
              {editingFocus && (
                <div className="mon-focus-editor">
                  <div className="mon-focus-options" role="group" aria-label="Выбор предметов в фокусе">
                    {solvableSubjects.map((subject) => (
                      <Check
                        key={subject.id}
                        label={subject.name}
                        checked={draftFocus.includes(subject.name)}
                        onChange={(checked) => setDraftFocus((current) => (checked ? [...current, subject.name] : current.filter((name) => name !== subject.name)))}
                      />
                    ))}
                  </div>
                  <div className="mon-focus-actions">
                    <Button
                      variant="primary"
                      size="sm"
                      loading={pending === 'focus'}
                      disabled={draftFocus.length === 0}
                      onClick={() => void saveFocus(solvableSubjects.map((subject) => subject.name).filter((name) => draftFocus.includes(name)))}
                    >
                      Сохранить
                    </Button>
                    {manualFocus && <Button size="sm" onClick={() => void saveFocus([])}>Выбирать автоматически</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setEditingFocus(false)}>Отмена</Button>
                  </div>
                </div>
              )}
              {focus.length === 0 && <p className="mon-note">Задач за период нет - фокус появится с первыми задачами.</p>}
              <StatGrid>
                {focus.map((subject) => {
                  const row = subjects.find((item) => item.subject === subject)
                  if (!row || row.total === 0) return <Stat key={subject} label={subject} value="-" hint="задач за период не было" />
                  const tone: Tone | undefined = row.failedShare >= FAILED_BAD || row.truncatedShare >= TRUNCATED_BAD ? 'danger' : undefined
                  return (
                    <Stat
                      key={subject}
                      label={subject}
                      value={`${formatPercent(row.failedShare)} сбоев`}
                      hint={`обрезано ${formatPercent(row.truncatedShare)}, задач ${formatNumber(row.total)}`}
                      tone={tone}
                    />
                  )
                })}
              </StatGrid>
            </section>

            {solvedTotal === 0 && !quality.loading ? (
              <EmptyState>За выбранный период задач не было. Выбери период шире, например 30 или 90 дней.</EmptyState>
            ) : (
              <DataTable
                columns={columns}
                rows={subjects}
                rowKey={(row) => row.subject}
                loading={quality.loading}
                empty="За период задач не было."
                rowClassName={(row) => (focus.includes(row.subject) ? 'mon-priority-row' : '')}
              />
            )}
          </div>
        )}
      </Panel>

      {quality.data && (
        <>
          <div className="adm-grid-2">
            <Panel title="Время ответа" description="Сколько ждать готового ответа: медиана, 95 и 99 из 100 ответов быстрее этого.">
              <div className="adm-table-wrap">
                <table className="adm-table">
                  <thead>
                    <tr>
                      <th>Где</th>
                      <th className="is-right">Медиана</th>
                      <th className="is-right">95 %</th>
                      <th className="is-right">99 %</th>
                      <th className="is-right">Ответов в расчёте</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Решения</td>
                      <td className="is-right">{formatSeconds(numOrNull(latency.p50))}</td>
                      <td className="is-right">{formatSeconds(numOrNull(latency.p95))}</td>
                      <td className="is-right">{formatSeconds(numOrNull(latency.p99))}</td>
                      <td className="is-right">{formatNumber(num(latency.count))}</td>
                    </tr>
                    <tr>
                      <td>ИИ-чат</td>
                      <td className="is-right">{formatSeconds(numOrNull(chatLatency.p50))}</td>
                      <td className="is-right">{formatSeconds(numOrNull(chatLatency.p95))}</td>
                      <td className="is-right">{formatSeconds(numOrNull(chatLatency.p99))}</td>
                      <td className="is-right">{formatNumber(num(chatLatency.count))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mon-note">
                Чат за период: ответов {formatNumber(num(chat.total))}, из них со сбоем {formatNumber(num(chat.failed))}
                {num(chat.total) > 0 ? ` (${formatPercent((100 * num(chat.failed)) / num(chat.total))})` : ''}.
              </p>
            </Panel>

            <Panel title="Чертежи и жалобы" description="Жалобы - обращения в поддержку с темой «Неверное решение» за период.">
              <StatGrid>
                <Stat label="Решений с чертежом" value={diagramTotal > 0 ? formatPercent((100 * num(diagrams.withDiagram)) / diagramTotal) : '-'} hint={`${formatNumber(num(diagrams.withDiagram))} из ${formatNumber(diagramTotal)}`} />
                <Stat label="Жалоб на решение" value={formatNumber(num(diagrams.complaints))} tone={num(diagrams.complaints) > 0 ? 'warning' : undefined} />
                <Stat label="Оценок «не помогло»" value={formatNumber(num(diagrams.notHelpful))} tone={num(diagrams.notHelpful) > 0 ? 'warning' : undefined} />
              </StatGrid>
            </Panel>
          </div>

          <div className="adm-grid-2">
            <Panel title="Длина ответа" description="Решённые задачи по числу знаков в ответе, шаг 500 знаков.">
              {lengthBars.length ? <HorizontalBars items={lengthBars} /> : <EmptyState>Решённых задач за период нет - считать длину не из чего.</EmptyState>}
            </Panel>

            <Panel title="Предел частоты" description="Ответы 429: сколько раз и у скольких учеников сработал предел запросов.">
              <StatGrid>
                <Stat label="Срабатываний" value={formatNumber(num(rateLimit.hits))} tone={num(rateLimit.hits) > 0 ? 'warning' : undefined} />
                <Stat label="Учеников и гостей" value={formatNumber(num(rateLimit.users))} />
              </StatGrid>
              <div className="mon-gap-top">
                {routeBars.length ? <HorizontalBars items={routeBars} /> : <EmptyState>Предел за период не срабатывал ни разу.</EmptyState>}
              </div>
            </Panel>
          </div>
        </>
      )}
    </>
  )
}
