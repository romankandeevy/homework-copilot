import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowRight,
  CheckCircle,
  CircleNotch,
  CreditCard,
  Gift,
  Lifebuoy,
  Paperclip,
  UserCircle,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { formatRubles } from './lib/currency'
import type { Json } from './lib/database.types'
import { supabase } from './lib/supabase'
import './SupportAdminPanel.css'

type SupportStatus = 'pending_owner' | 'pending_user' | 'resolved'
type SupportCategory = 'general' | 'payment' | 'feature' | 'wrong_solution'

type SupportListItem = {
  id: string
  userId: string
  email: string
  fullName: string
  category: SupportCategory
  subject: string
  status: SupportStatus
  ownerNotificationStatus: string
  context: Json
  createdAt: string
  updatedAt: string
  lastMessageAt: string
  lastMessage: string
}

type SupportDetail = {
  conversation: SupportListItem & { grade: number | null; balance: number | null; resolvedAt: string | null }
  messages: { id: string; authorType: 'user' | 'owner'; body: string; createdAt: string }[]
  walletEntries: { id: string; amount: number; kind: string; description: string; createdAt: string }[]
  ideaApproval: {
    status: 'pending' | 'approved' | 'rejected' | 'not_applicable'
    requiredPhrase: string
    source: string | null
    decidedAt: string | null
    credited: boolean
  }
}

const categoryLabels: Record<SupportCategory, string> = {
  general: 'Общий вопрос',
  payment: 'Оплата и баланс',
  feature: 'Идея',
  wrong_solution: 'Неверное решение',
}

function isRecord(value: Json | undefined | null): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: Json | undefined, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function asNullableString(value: Json | undefined) {
  return typeof value === 'string' ? value : null
}

function asNumber(value: Json | undefined, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asNullableNumber(value: Json | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asArray(value: Json | undefined) {
  return Array.isArray(value) ? value : []
}

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date)
}

function statusLabel(status: SupportStatus) {
  if (status === 'resolved') return 'Закрыто'
  if (status === 'pending_user') return 'Ждём пользователя'
  return 'Ждём владельца'
}

function parseListItem(value: Json): SupportListItem {
  const source = isRecord(value) ? value : {}
  const rawCategory = asString(source.category, 'general')
  const rawStatus = asString(source.status, 'pending_owner')
  return {
    id: asString(source.id),
    userId: asString(source.userId),
    email: asString(source.email, 'Без почты'),
    fullName: asString(source.fullName, 'Ученик'),
    category: rawCategory === 'payment' || rawCategory === 'feature' || rawCategory === 'wrong_solution' ? rawCategory : 'general',
    subject: asString(source.subject, 'Обращение'),
    status: rawStatus === 'pending_user' || rawStatus === 'resolved' ? rawStatus : 'pending_owner',
    ownerNotificationStatus: asString(source.ownerNotificationStatus, 'pending'),
    context: source.context ?? {},
    createdAt: asString(source.createdAt),
    updatedAt: asString(source.updatedAt),
    lastMessageAt: asString(source.lastMessageAt),
    lastMessage: asString(source.lastMessage),
  }
}

function parseDetail(value: Json | null): SupportDetail | null {
  const source = isRecord(value) ? value : null
  const conversationSource = source && isRecord(source.conversation) ? source.conversation : null
  if (!source || !conversationSource) return null
  const item = parseListItem(conversationSource)
  const approvalSource = isRecord(source.ideaApproval) ? source.ideaApproval : {}
  const rawApprovalStatus = asString(approvalSource.status, 'pending')
  return {
    conversation: { ...item, grade: asNullableNumber(conversationSource.grade), balance: asNullableNumber(conversationSource.balance), resolvedAt: asNullableString(conversationSource.resolvedAt) },
    messages: asArray(source.messages).flatMap((value) => {
      const row = isRecord(value) ? value : {}
      const authorType = asString(row.authorType) === 'owner' ? 'owner' : 'user'
      return [{ id: asString(row.id), authorType, body: asString(row.body), createdAt: asString(row.createdAt) }]
    }),
    walletEntries: asArray(source.walletEntries).flatMap((value) => {
      const row = isRecord(value) ? value : {}
      return [{ id: asString(row.id), amount: asNumber(row.amount), kind: asString(row.kind), description: asString(row.description), createdAt: asString(row.createdAt) }]
    }),
    ideaApproval: {
      status: rawApprovalStatus === 'approved' || rawApprovalStatus === 'rejected' || rawApprovalStatus === 'not_applicable' ? rawApprovalStatus : 'pending',
      requiredPhrase: asString(approvalSource.requiredPhrase, 'да это хорошая идея'),
      source: asNullableString(approvalSource.source),
      decidedAt: asNullableString(approvalSource.decidedAt),
      credited: approvalSource.credited === true,
    },
  }
}

function previewItems(): SupportListItem[] {
  return [{
    id: 'preview-support-1',
    userId: 'preview-user-1',
    email: 'alina.demo@example.test',
    fullName: 'Алина Смирнова',
    category: 'feature',
    subject: 'Идея для сервиса',
    status: 'pending_owner',
    ownerNotificationStatus: 'sent',
    context: {},
    createdAt: '2026-08-26T09:12:00.000Z',
    updatedAt: '2026-08-26T09:12:00.000Z',
    lastMessageAt: '2026-08-26T09:12:00.000Z',
    lastMessage: 'Добавить быстрый повтор последней задачи',
  }]
}

function previewDetail(): SupportDetail {
  return {
    conversation: { ...previewItems()[0], grade: 8, balance: 42, resolvedAt: null },
    messages: [{ id: 'preview-message-1', authorType: 'user', body: 'Добавить быстрый повтор последней задачи', createdAt: '2026-08-26T09:12:00.000Z' }],
    walletEntries: [{ id: 'preview-wallet-1', amount: 50, kind: 'credit', description: 'Бонус за участие', createdAt: '2026-08-24T09:12:00.000Z' }],
    ideaApproval: { status: 'pending', requiredPhrase: 'да это хорошая идея', source: null, decidedAt: null, credited: false },
  }
}

export default function SupportAdminPanel({ preview = false }: { preview?: boolean }) {
  const [status, setStatus] = useState<'all' | SupportStatus>('all')
  const [items, setItems] = useState<SupportListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SupportDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [creditAmount, setCreditAmount] = useState('10')
  const [creditReason, setCreditReason] = useState('Спасибо за полезную идею')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const loadItems = useCallback(async () => {
    if (preview) {
      setItems(previewItems())
      return
    }
    if (!supabase) return
    setLoading(true)
    const { data, error: listError } = await supabase.rpc('admin_support_list', { p_status: status === 'all' ? null : status, p_limit: 100 })
    if (listError) setError('Не получилось загрузить обращения.')
    else setItems(asArray(data).map(parseListItem))
    setLoading(false)
  }, [preview, status])

  const loadDetail = useCallback(async (conversationId: string) => {
    if (preview) {
      setDetail(previewDetail())
      return
    }
    if (!supabase) return
    setDetailLoading(true)
    const { data, error: detailError } = await supabase.rpc('admin_support_detail', { p_conversation_id: conversationId })
    if (detailError) setError('Не получилось загрузить обращение.')
    else setDetail(parseDetail(data))
    setDetailLoading(false)
  }, [preview])

  useEffect(() => { void loadItems() }, [loadItems])

  const openDetail = (conversationId: string) => {
    setSelectedId(conversationId)
    setNotice('')
    setError('')
    void loadDetail(conversationId)
  }

  const updateStatus = async (nextStatus: SupportStatus) => {
    if (!detail || actionLoading) return
    if (preview) {
      setNotice('Предпросмотр: изменения не записываются.')
      return
    }
    if (!supabase) return
    setActionLoading(true)
    setError('')
    const { error: statusError } = await supabase.rpc('admin_support_update_status', { p_conversation_id: detail.conversation.id, p_status: nextStatus })
    if (statusError) setError('Не получилось изменить статус.')
    else {
      setNotice(`Статус обращения: ${statusLabel(nextStatus).toLocaleLowerCase('ru-RU')}.`)
      await Promise.all([loadItems(), loadDetail(detail.conversation.id)])
    }
    setActionLoading(false)
  }

  const creditFeature = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!detail || detail.conversation.category !== 'feature' || actionLoading) return
    if (detail.ideaApproval.status !== 'approved') {
      setError(detail.ideaApproval.status === 'rejected'
        ? 'Идея отклонена: начисление недоступно.'
        : `Сначала ответь в этом диалоге: «${detail.ideaApproval.requiredPhrase}».`)
      return
    }
    if (preview) {
      setNotice('Предпросмотр: начисление не записывается.')
      return
    }
    if (!supabase) return
    const amount = Number(creditAmount)
    if (!Number.isInteger(amount) || amount < 1 || amount > 10000 || creditReason.trim().length < 3) {
      setError('Укажи целую сумму от 1 до 10 000 ₽ и причину от 3 символов.')
      return
    }
    setActionLoading(true)
    setError('')
    const { data, error: creditError } = await supabase.rpc('admin_credit_feature_balance', { p_conversation_id: detail.conversation.id, p_amount: amount, p_reason: creditReason.trim() })
    if (creditError) {
      const approvalMissing = /owner approval required|idea was rejected/i.test(creditError.message)
      setError(approvalMissing ? 'Начисление не разрешено: нужно одобрение владельца в этом диалоге.' : 'Не получилось начислить баланс.')
    }
    else {
      const result = isRecord(data) ? data : {}
      setNotice(result.credited === true ? `Начислено ${amount} ₽. Баланс обновлён.` : 'За эту идею баланс уже начислялся.')
      await Promise.all([loadItems(), loadDetail(detail.conversation.id)])
    }
    setActionLoading(false)
  }

  const context = detail?.conversation.context
  const wrongSolution = isRecord(context) && isRecord(context.wrongSolution) ? context.wrongSolution : null
  const payment = isRecord(context) && isRecord(context.payment) ? context.payment : null

  return (
    <section className="support-admin-panel" id="support" aria-labelledby="support-admin-title">
      <header className="support-admin-header"><div><span className="admin-kicker"><Lifebuoy size={16} weight="duotone" aria-hidden="true" /> Входящие обращения</span><h2 id="support-admin-title">Поддержка</h2><p>Ответь пользователю в Telegram — переписка сохранится в его аккаунте.</p></div><div className="support-admin-filters" role="group" aria-label="Фильтр обращений">{([['all', 'Все'], ['pending_owner', 'Ждут ответа'], ['pending_user', 'Ждут пользователя'], ['resolved', 'Закрытые']] as const).map(([value, label]) => <button key={value} type="button" className={status === value ? 'is-selected' : ''} onClick={() => setStatus(value)} aria-pressed={status === value}>{label}</button>)}</div></header>
      <div className="support-admin-layout">
        <div className="support-admin-inbox">{loading ? <div className="support-admin-empty"><CircleNotch className="support-admin-spinner" size={22} aria-hidden="true" /> Загружаем…</div> : items.length ? items.map((item) => <button className={`support-admin-inbox-item${selectedId === item.id ? ' is-selected' : ''}`} key={item.id} type="button" onClick={() => openDetail(item.id)}><span className={`support-admin-status-dot is-${item.status}`} /><span><strong>{item.fullName}</strong><small>{categoryLabels[item.category]} · {item.lastMessage || 'Без текста'}</small></span><time>{formatDate(item.updatedAt)}</time><ArrowRight size={16} weight="bold" aria-hidden="true" /></button>) : <div className="support-admin-empty"><CheckCircle size={22} weight="duotone" aria-hidden="true" /> Нет обращений в этом фильтре.</div>}</div>
        {detailLoading ? <div className="support-admin-detail support-admin-empty"><CircleNotch className="support-admin-spinner" size={22} aria-hidden="true" /> Загружаем обращение…</div> : detail ? <article className="support-admin-detail"><header><div><span className="support-admin-detail-category">{categoryLabels[detail.conversation.category]}</span><h3>{detail.conversation.subject}</h3><p><UserCircle size={16} weight="duotone" aria-hidden="true" /> {detail.conversation.fullName} · {detail.conversation.email} · {detail.conversation.grade ?? '—'} класс</p></div><button type="button" className="admin-icon-button" onClick={() => { setDetail(null); setSelectedId(null) }} aria-label="Закрыть обращение"><X size={18} weight="bold" aria-hidden="true" /></button></header><div className="support-admin-status-row"><span className={`support-admin-status-pill is-${detail.conversation.status}`}>{statusLabel(detail.conversation.status)}</span><span>{formatDate(detail.conversation.updatedAt)}</span><span>{detail.conversation.ownerNotificationStatus === 'sent' ? 'Telegram доставлен' : 'Telegram не подключён или не доставлен'}</span></div><div className="support-admin-messages">{detail.messages.map((message) => <div className={`support-admin-message is-${message.authorType}`} key={message.id}><span>{message.authorType === 'owner' ? 'Владелец' : 'Пользователь'} · {formatDate(message.createdAt)}</span><p>{message.body}</p></div>)}</div>{wrongSolution && <section className="support-admin-context"><header><Paperclip size={18} weight="duotone" aria-hidden="true" /><h4>Контекст неверного решения</h4></header><dl><div><dt>Учебник и задача</dt><dd>{asString(wrongSolution.textbookTitle)} · № {asString(wrongSolution.task)}</dd></div><div><dt>Полное условие</dt><dd>{asString(wrongSolution.condition)}</dd></div><div><dt>Решение</dt><dd>{asArray(wrongSolution.steps).map((step, index) => <span key={`${asString(step)}-${index}`}>{asString(step)}</span>)}{asString(wrongSolution.answer) && <span><strong>Ответ:</strong> {asString(wrongSolution.answer)}</span>}</dd></div></dl></section>}{payment && <section className="support-admin-context is-payment"><header><CreditCard size={18} weight="duotone" aria-hidden="true" /><h4>Контекст оплаты</h4></header><p>{asString(payment.note, 'Платежи не подключены; требуется ручная проверка.')}</p><strong>Баланс на момент обращения: {formatRubles(asNumber(payment.currentBalance))}</strong></section>}<section className="support-admin-wallet"><header><span>История баланса</span><strong>{formatRubles(detail.conversation.balance ?? 0)}</strong></header><ol>{detail.walletEntries.slice(0, 8).map((entry) => <li key={entry.id}><b className={entry.amount >= 0 ? 'is-credit' : 'is-debit'}>{entry.amount > 0 ? '+' : ''}{formatRubles(entry.amount)}</b><span>{entry.description}</span><time>{formatDate(entry.createdAt)}</time></li>)}</ol></section><div className="support-admin-actions"><button type="button" onClick={() => { void updateStatus(detail.conversation.status === 'resolved' ? 'pending_owner' : 'resolved') }} disabled={actionLoading}>{detail.conversation.status === 'resolved' ? 'Открыть снова' : 'Закрыть обращение'}</button><button type="button" onClick={() => { void updateStatus('pending_user') }} disabled={actionLoading}>Ждать пользователя</button></div>{detail.conversation.category === 'feature' && <form className={`support-admin-credit is-${detail.ideaApproval.status}`} onSubmit={creditFeature}><header><Gift size={19} weight="duotone" aria-hidden="true" /><div><h4>Начислить за идею</h4><p className="support-admin-credit-gate">{detail.ideaApproval.status === 'approved' ? 'Идея одобрена. Выбери сумму для одноразового начисления.' : detail.ideaApproval.status === 'rejected' ? 'Идея отклонена. Начисление закрыто.' : <>Для начисления ответь в этом диалоге: <strong>«{detail.ideaApproval.requiredPhrase}»</strong>.</>}</p></div></header><div><label><span>Сумма, ₽</span><input type="number" min="1" max="10000" step="1" value={creditAmount} onChange={(event) => setCreditAmount(event.target.value)} disabled={actionLoading || detail.ideaApproval.status !== 'approved'} /></label><label><span>Причина</span><input value={creditReason} maxLength={160} onChange={(event) => setCreditReason(event.target.value)} disabled={actionLoading || detail.ideaApproval.status !== 'approved'} /></label></div><button type="submit" disabled={actionLoading || detail.ideaApproval.status !== 'approved'}>{actionLoading ? 'Сохраняем…' : detail.ideaApproval.status === 'approved' ? 'Начислить на баланс' : 'Нужно решение владельца'}</button></form>}</article> : <div className="support-admin-detail support-admin-empty"><WarningCircle size={24} weight="duotone" aria-hidden="true" /> Выбери обращение слева.</div>}
      </div>
      {(notice || error) && <p className={`support-admin-feedback${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</p>}
    </section>
  )
}
