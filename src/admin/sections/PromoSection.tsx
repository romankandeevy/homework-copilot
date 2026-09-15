/* Промокоды - свой раздел меню с 14 сентября 2026, в группе «Деньги»
   рядом с финансами. До этого они были вкладкой «Настроек» между тарифами
   и промптами решателя, и владелец искал их не там.

   Код даёт деньги на баланс или тариф (дневной предел решений) на срок.
   Ученик вводит его на странице баланса или открывает ссылку
   /balance?promo=КОД - код там уже вписан. Логика списка, пакета и
   выгрузок - в promoModel.ts, без React. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { CopySimple, LinkSimple, ListPlus, MagnifyingGlass, PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import {
  adminRpc, downloadCsv, formatDateTime, formatKopecks, formatNumber, intOrNull, isMissingRpc, kopecksToInput, num, obj, rows,
  todayMsk, type Row,
} from '../api'
import {
  Badge, Button, DataTable, Drawer, EmptyState, ErrorState, ExportButton, Field, LoadingState, PageHeader, Pagination, Panel,
  Segmented, useAsync, useQueryState, useToast, type Column,
} from '../ui'
import { useAdmin } from '../context'
import { Check, ConfirmModal, SettingsEmpty, SettingsHistory } from './settingsParts'
import {
  BATCH_MAX, PREFIX_MAX, PROMO_MIGRATION, PROMO_MIGRATION_TEXT, PROMO_PAGE_SIZE, PROMO_QUERY_DEFAULTS, PROMO_STATE_ORDER,
  REDEMPTIONS_PAGE_SIZE, batchCsv, draftProblem, duplicateOf, filterPromos, freeCode, isValidCode, normalizePrefix, pageSlice,
  parseBatchResult, parseDirection, parsePromo, parsePromoContext, parsePromoFilter, parsePromoSort, parseRedemption,
  prefixProblem, promoAudience, promoCounts, promoLink, promoPayload, promoPeriod, promoState, promoStateMeta, promoTemplates,
  promoWhat, readDraft, redemptionCsv, redemptionWho, sampleCode, sortOptions, sortPromos, toLocalInput,
  type Promo, type PromoDraft, type PromoFilter, type PromoFlag, type PromoKind, type PromoPlan, type PromoSettings,
  type PromoTemplate, type Redemption,
} from './promoModel'
import './settings.css'

type Tools = 'checking' | 'ready' | 'missing'
type Editing = { mode: 'new' } | { mode: 'edit'; promo: Promo } | { mode: 'copy'; promo: Promo }

/* Есть ли в базе функции миграции 20260914220000. Спрашиваем один раз при
   входе в раздел самым лёгким вызовом - пустым списком активаций. Без
   этого «Только новым аккаунтам» до миграции молча терялось бы: старая
   admin_promo_save незнакомое поле просто не читает. */
function usePromoTools() {
  const [tools, setTools] = useState<Tools>('checking')
  useEffect(() => {
    let active = true
    adminRpc('admin_promo_redemptions', { p_code: '', p_page: 1, p_page_size: 1 })
      .then(() => { if (active) setTools((current) => (current === 'missing' ? current : 'ready')) })
      .catch((failure: unknown) => { if (active) setTools(isMissingRpc(failure) ? 'missing' : 'ready') })
    return () => { active = false }
  }, [])
  const markMissing = useCallback(() => setTools('missing'), [])
  return { tools, markMissing }
}

/* Как useAction из ui.tsx, но отсутствие функции в базе - не поломка:
   вместо красной ошибки спокойная подсказка про миграцию. */
function usePromoAction(onMissing: () => void) {
  const toast = useToast()
  const [pending, setPending] = useState<string | null>(null)
  const run = useCallback(async <T,>(key: string, action: () => Promise<T>, success?: string | ((result: T) => string)) => {
    setPending(key)
    try {
      const result = await action()
      if (success) toast.success(typeof success === 'function' ? success(result) : success)
      return result
    } catch (failure) {
      if (isMissingRpc(failure)) {
        onMissing()
        toast.info(PROMO_MIGRATION_TEXT)
      } else {
        toast.error(failure instanceof Error ? failure.message : 'Операция не выполнилась.')
      }
      return undefined
    } finally {
      setPending(null)
    }
  }, [toast, onMissing])
  return { pending, run }
}

function MigrationNote({ children }: { children?: ReactNode }) {
  return (
    <p className="set-note set-promo-migration" role="note">
      <strong>{PROMO_MIGRATION_TEXT}</strong>{children ? <> {children}</> : null}
    </p>
  )
}

function FlagNote({ flag }: { flag: PromoFlag | null }) {
  if (!flag) return null
  if (!flag.enabled || flag.rolloutPercent === 0) {
    return (
      <p className="set-note is-warning">
        Поле ввода кода у учеников сейчас скрыто: флаг promo_codes выключен. Созданный код никто не сможет ввести, и ссылка с кодом тоже не сработает, пока флаг не включат в «Настройках».
      </p>
    )
  }
  if (flag.rolloutPercent < 100) {
    return <p className="set-note is-warning">Поле ввода кода видят не все: флаг promo_codes раскатан на {flag.rolloutPercent} %.</p>
  }
  return null
}

/* ---------- Раздел ---------- */

export default function PromoSection() {
  const { access } = useAdmin()
  if (!access.permissions.settings) {
    return (
      <div className="set-stack">
        <PageHeader title="Промокоды" />
        <Panel><EmptyState>Промокоды открыты ролям «администратор» и «владелец».</EmptyState></Panel>
      </div>
    )
  }
  return <PromoContent />
}

function PromoContent() {
  const toast = useToast()
  const [query, setQuery] = useQueryState(PROMO_QUERY_DEFAULTS)
  const { tools, markMissing } = usePromoTools()
  const { pending, run } = usePromoAction(markMissing)
  const overview = useAsync(() => adminRpc('admin_settings_overview'), [])
  const list = useAsync(() => adminRpc('admin_promo_list'), [])
  const { plans, flag } = useMemo(() => parsePromoContext(overview.data), [overview.data])
  const promos = useMemo(() => rows(list.data).map(parsePromo), [list.data])
  const codes = useMemo(() => promos.map((promo) => promo.code), [promos])
  const [editing, setEditing] = useState<Editing | null>(null)
  const [generating, setGenerating] = useState(false)
  // Счётчик сохранений: по нему история раздела перечитывает журнал.
  const [changes, setChanges] = useState(0)

  const now = Date.now()
  const filter = parsePromoFilter(query.pr_state)
  const sort = parsePromoSort(query.pr_sort)
  const direction = parseDirection(query.pr_dir)
  const counts = promoCounts(promos, now)
  const visible = sortPromos(filterPromos(promos, { q: query.pr_q, state: filter }, now), sort, direction)
  const paged = pageSlice(visible, Number.parseInt(query.pr_page, 10), PROMO_PAGE_SIZE)
  const detail = query.pr_code ? promos.find((promo) => promo.code === query.pr_code) ?? null : null
  const empty = !list.error && list.data !== null && promos.length === 0
  const filtered = query.pr_q.trim() !== '' || filter !== 'all'

  const changed = () => {
    list.reload()
    setChanges((current) => current + 1)
  }

  const toggle = async (promo: Promo) => {
    const result = await run(
      `toggle:${promo.code}`,
      () => adminRpc('admin_promo_save', { p_promo: promoPayload({ ...promo, active: !promo.active }) }),
      promo.active ? `Код ${promo.code} выключен.` : `Код ${promo.code} включён.`,
    )
    if (result !== undefined) changed()
  }

  const copyLink = async (code: string) => {
    const link = promoLink(code, window.location.origin)
    try {
      await navigator.clipboard.writeText(link)
      toast.success(`Ссылка скопирована: ${link}`)
    } catch {
      toast.error(`Не получилось скопировать. Ссылка: ${link}`)
    }
  }

  const closeDetail = () => setQuery({ pr_code: '' })

  const stateOptions: { value: PromoFilter; label: string }[] = [
    { value: 'all', label: `Все · ${counts.all}` },
    ...PROMO_STATE_ORDER.map((state) => ({ value: state, label: `${promoStateMeta[state].plural} · ${counts[state]}` })),
  ]

  const columns: Column<Promo>[] = [
    { key: 'code', header: 'Код', render: (promo) => <span className="adm-cell-main"><strong className="adm-mono">{promo.code}</strong>{promo.note && <small>{promo.note}</small>}</span> },
    {
      key: 'what',
      header: 'Что даёт',
      render: (promo) => (
        <span className="set-promo-what">
          {promoWhat(promo, plans)}
          {promo.newUsersDays !== null && <small>только новым: до {formatNumber(promo.newUsersDays)} дн.</small>}
        </span>
      ),
    },
    { key: 'period', header: 'Срок', mobile: false, render: (promo) => <span className="adm-nowrap">{promoPeriod(promo)}</span> },
    { key: 'uses', header: 'Использований', sortKey: 'uses', align: 'right', render: (promo) => `${formatNumber(promo.uses)}${promo.maxUses !== null ? ` / ${formatNumber(promo.maxUses)}` : ''}` },
    { key: 'credited', header: 'Начислено', sortKey: 'credited', align: 'right', mobile: false, render: (promo) => <span className="adm-mono adm-nowrap">{formatKopecks(promo.creditedKopecks)}</span> },
    { key: 'paid', header: 'Оплатили после', align: 'right', mobile: false, render: (promo) => formatNumber(promo.paidAfter) },
    { key: 'created', header: 'Создан', sortKey: 'created', mobile: false, render: (promo) => <span className="adm-nowrap">{formatDateTime(promo.createdAt)}</span> },
    { key: 'state', header: 'Статус', render: (promo) => { const meta = promoStateMeta[promoState(promo, now)]; return <Badge tone={meta.tone}>{meta.label}</Badge> } },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (promo) => (
        <span className="set-row-actions">
          <Button size="sm" loading={pending === `toggle:${promo.code}`} onClick={() => void toggle(promo)}>{promo.active ? 'Выключить' : 'Включить'}</Button>
          <Button size="sm" icon={<PencilSimple size={14} weight="bold" aria-hidden="true" />} aria-label={`Изменить ${promo.code}`} title="Изменить" onClick={() => setEditing({ mode: 'edit', promo })} />
          <Button size="sm" icon={<CopySimple size={14} weight="bold" aria-hidden="true" />} aria-label={`Дублировать ${promo.code}`} title="Дублировать: новый код с теми же настройками" onClick={() => setEditing({ mode: 'copy', promo })} />
          <Button size="sm" icon={<LinkSimple size={14} weight="bold" aria-hidden="true" />} aria-label={`Скопировать ссылку на ${promo.code}`} title="Скопировать ссылку с кодом" onClick={() => void copyLink(promo.code)} />
        </span>
      ),
    },
  ]

  const batchButton = <Button icon={<ListPlus size={16} weight="bold" aria-hidden="true" />} onClick={() => setGenerating(true)}>Пакет кодов</Button>

  let body: ReactNode
  if (list.error) body = <ErrorState message={list.error} onRetry={list.reload} />
  else if (!list.data && list.loading) body = <LoadingState />
  else if (empty) {
    body = (
      <SettingsEmpty
        art="promo"
        title="Промокодов пока нет"
        actions={(
          <>
            <Button variant="primary" icon={<Plus size={16} weight="bold" aria-hidden="true" />} onClick={() => setEditing({ mode: 'new' })}>Создать промокод</Button>
            {batchButton}
          </>
        )}
      >
        Код даёт ученику деньги на баланс или тариф на срок, один аккаунт погашает его один раз. Ученик вводит код на странице баланса или открывает ссылку с кодом. Для школы или рассылки есть пакет одноразовых кодов с общим префиксом.
      </SettingsEmpty>
    )
  } else {
    body = (
      <>
        <div className="set-promo-tools">
          <Field label="Поиск">
            <span className="set-search">
              <MagnifyingGlass size={16} weight="bold" aria-hidden="true" />
              <input
                className="set-search-input"
                type="search"
                value={query.pr_q}
                placeholder="Код или заметка"
                autoComplete="off"
                onChange={(event) => setQuery({ pr_q: event.target.value, pr_page: '1' }, { replace: true })}
              />
            </span>
          </Field>
          <Field label="Порядок" className="set-promo-sort">
            <select
              value={`${sort}:${direction}`}
              onChange={(event) => {
                const [nextSort, nextDirection] = event.target.value.split(':')
                setQuery({ pr_sort: nextSort, pr_dir: nextDirection, pr_page: '1' })
              }}
            >
              {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </Field>
          <div className="adm-field set-promo-states">
            <span className="adm-field-label">Состояние</span>
            <Segmented label="Фильтр по состоянию" value={filter} options={stateOptions} onChange={(value) => setQuery({ pr_state: value, pr_page: '1' })} />
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={paged.items}
          rowKey={(promo) => promo.code}
          loading={list.loading}
          sort={sort}
          direction={direction}
          onSort={(key, nextDirection) => setQuery({ pr_sort: key, pr_dir: nextDirection, pr_page: '1' })}
          onRowClick={(promo) => setQuery({ pr_code: promo.code })}
          empty={filtered
            ? (
              <span className="set-row-actions">
                <span>Под фильтр ничего не попало.</span>
                <Button size="sm" variant="ghost" onClick={() => setQuery({ pr_q: '', pr_state: 'all', pr_page: '1' })}>Сбросить фильтр</Button>
              </span>
            )
            : 'Промокодов нет.'}
        />
        {visible.length > PROMO_PAGE_SIZE && <Pagination page={paged.page} pageSize={PROMO_PAGE_SIZE} total={visible.length} onPage={(next) => setQuery({ pr_page: String(next) })} />}
      </>
    )
  }

  return (
    <div className="set-stack">
      <PageHeader
        title="Промокоды"
        description="Код даёт деньги на баланс или тариф на срок, один аккаунт погашает его один раз. Каждое изменение попадает в журнал действий."
        actions={empty ? undefined : (
          <>
            {batchButton}
            <Button variant="primary" icon={<Plus size={16} weight="bold" aria-hidden="true" />} onClick={() => setEditing({ mode: 'new' })}>Новый код</Button>
          </>
        )}
      />
      <FlagNote flag={flag} />
      {tools === 'missing' && (
        <MigrationNote>
          До неё работают список, поиск, создание, правка и включение кодов. Пакет кодов, полный список активаций, удаление и «только новым аккаунтам» заработают после неё.
        </MigrationNote>
      )}
      <Panel>{body}</Panel>
      <SettingsHistory scope="promo" refreshKey={changes} />
      {detail && (
        <PromoDetail
          key={detail.code}
          promo={detail}
          plans={plans}
          tools={tools}
          toggling={pending === `toggle:${detail.code}`}
          onClose={closeDetail}
          onEdit={() => { closeDetail(); setEditing({ mode: 'edit', promo: detail }) }}
          onDuplicate={() => { closeDetail(); setEditing({ mode: 'copy', promo: detail }) }}
          onToggle={() => void toggle(detail)}
          onCopyLink={() => void copyLink(detail.code)}
          onDeleted={() => { closeDetail(); changed() }}
          onMissing={markMissing}
        />
      )}
      {editing && (
        <PromoForm
          editing={editing}
          plans={plans}
          existingCodes={codes}
          tools={tools}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); changed() }}
          onMissing={markMissing}
        />
      )}
      {generating && (
        <PromoBatchForm
          plans={plans}
          tools={tools}
          onClose={() => setGenerating(false)}
          onGenerated={changed}
          onShow={(search) => { setGenerating(false); setQuery({ pr_q: search, pr_state: 'all', pr_page: '1' }) }}
          onMissing={markMissing}
        />
      )}
    </div>
  )
}

/* ---------- Карточка кода ---------- */

function PromoDetail({ promo, plans, tools, toggling, onClose, onEdit, onDuplicate, onToggle, onCopyLink, onDeleted, onMissing }: {
  promo: Promo
  plans: PromoPlan[]
  tools: Tools
  toggling: boolean
  onClose: () => void
  onEdit: () => void
  onDuplicate: () => void
  onToggle: () => void
  onCopyLink: () => void
  onDeleted: () => void
  onMissing: () => void
}) {
  const { pending, run } = usePromoAction(onMissing)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const state = promoStateMeta[promoState(promo)]
  const link = promoLink(promo.code, window.location.origin)
  const used = promo.uses > 0

  const remove = async () => {
    const result = await run('delete', () => adminRpc('admin_promo_delete', { p_code: promo.code }), `Код ${promo.code} удалён.`)
    setConfirmDelete(false)
    if (result !== undefined) onDeleted()
  }

  return (
    <Drawer open wide title={`Код ${promo.code}`} subtitle={promoWhat(promo, plans)} onClose={onClose}>
      <div className="set-stack">
        <dl className="adm-kv">
          <dt>Статус</dt><dd><Badge tone={state.tone}>{state.label}</Badge></dd>
          <dt>Срок</dt><dd>{promoPeriod(promo)}</dd>
          <dt>Кому</dt><dd>{promoAudience(promo.newUsersDays)}</dd>
          <dt>Использований</dt><dd>{formatNumber(promo.uses)}{promo.maxUses !== null ? ` из ${formatNumber(promo.maxUses)}` : ', без ограничения'}</dd>
          <dt>Последнее</dt><dd>{promo.lastUsedAt ? formatDateTime(promo.lastUsedAt) : 'не использовался'}</dd>
          <dt>Начислено</dt><dd>{formatKopecks(promo.creditedKopecks)}</dd>
          <dt>Оплатили после</dt><dd>{formatNumber(promo.paidAfter)} чел.</dd>
          <dt>Создан</dt><dd>{formatDateTime(promo.createdAt)}</dd>
          {promo.note && <><dt>Заметка</dt><dd>{promo.note}</dd></>}
        </dl>
        <div className="set-promo-link">
          <Field label="Ссылка с кодом" hint="Откроет баланс с уже вписанным кодом - ученику останется нажать «Применить».">
            <input value={link} readOnly className="adm-mono" onFocus={(event) => event.currentTarget.select()} />
          </Field>
          <Button icon={<LinkSimple size={16} weight="bold" aria-hidden="true" />} onClick={onCopyLink}>Скопировать ссылку</Button>
        </div>
        <div className="set-promo-actions">
          <Button icon={<PencilSimple size={16} weight="bold" aria-hidden="true" />} onClick={onEdit}>Изменить</Button>
          <Button icon={<CopySimple size={16} weight="bold" aria-hidden="true" />} onClick={onDuplicate}>Дублировать</Button>
          <Button loading={toggling} onClick={onToggle}>{promo.active ? 'Выключить' : 'Включить'}</Button>
          {!used && (
            <Button variant="danger" icon={<Trash size={16} weight="bold" aria-hidden="true" />} disabled={tools === 'missing'} onClick={() => setConfirmDelete(true)}>Удалить</Button>
          )}
        </div>
        {used && (
          <p className="set-note">
            Кодом уже пользовались, поэтому удалить его нельзя: вместе с ним пропала бы история начислений. {promo.active ? 'Чтобы код больше не принимался, выключи его.' : 'Код выключен и больше не принимается.'}
          </p>
        )}
        {!used && tools === 'missing' && <MigrationNote>Удаление неиспользованного кода заработает после неё.</MigrationNote>}
        <PromoRedemptions promo={promo} tools={tools} onMissing={onMissing} />
      </div>
      {confirmDelete && (
        <ConfirmModal
          title={`Удалить код ${promo.code}?`}
          confirmLabel="Удалить"
          danger
          loading={pending === 'delete'}
          onConfirm={() => void remove()}
          onClose={() => setConfirmDelete(false)}
        >
          <p className="set-note">Кодом ни разу не пользовались. Он пропадёт из списка, а запись об удалении останется в журнале действий.</p>
        </ConfirmModal>
      )}
    </Drawer>
  )
}

const MISSING = 'missing'

function PromoRedemptions({ promo, tools, onMissing }: { promo: Promo; tools: Tools; onMissing: () => void }) {
  const { openUser } = useAdmin()
  const toast = useToast()
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const toolsMissing = tools === 'missing'
  const { data, error, loading, reload } = useAsync<Row | typeof MISSING>(async () => {
    if (toolsMissing) return MISSING
    try {
      return obj(await adminRpc('admin_promo_redemptions', { p_code: promo.code, p_page: page, p_page_size: REDEMPTIONS_PAGE_SIZE }))
    } catch (failure) {
      if (isMissingRpc(failure)) return MISSING
      throw failure
    }
  }, [promo.code, promo.uses, page, toolsMissing])
  const missing = data === MISSING
  useEffect(() => { if (missing) onMissing() }, [missing, onMissing])
  const result = data && data !== MISSING ? data : null
  const items = useMemo(() => (result ? rows(result.items).map(parseRedemption) : []), [result])
  const total = result ? num(result.total) : 0

  const exportCsv = async () => {
    setExporting(true)
    try {
      const all = obj(await adminRpc('admin_promo_redemptions', { p_code: promo.code, p_page: 1, p_page_size: 5000 }))
      const list = rows(all.items).map(parseRedemption)
      downloadCsv(`promo-${promo.code}-${todayMsk()}`, list, redemptionCsv(promo.code))
      if (num(all.total) > list.length) toast.info(`В файл попали первые ${formatNumber(list.length)} из ${formatNumber(num(all.total))} активаций.`)
    } catch (failure) {
      if (isMissingRpc(failure)) {
        onMissing()
        toast.info(PROMO_MIGRATION_TEXT)
      } else {
        toast.error(failure instanceof Error ? failure.message : 'Не получилось выгрузить активации.')
      }
    } finally {
      setExporting(false)
    }
  }

  const columns: Column<Redemption>[] = [
    {
      key: 'who',
      header: 'Кто',
      render: (item) => (
        <span className="adm-cell-main">
          <button type="button" className="set-link" title="Открыть карточку ученика" onClick={() => openUser(item.userId)}>{redemptionWho(item)}</button>
          {item.fullName && <small>{item.fullName}</small>}
        </span>
      ),
    },
    { key: 'when', header: 'Когда', render: (item) => <span className="adm-nowrap">{formatDateTime(item.redeemedAt)}</span> },
    {
      key: 'credited',
      header: 'Начислено',
      align: 'right',
      render: (item) => (item.creditedKopecks === null
        ? <span className="adm-muted">{promo.kind === 'plan' ? 'тариф' : '-'}</span>
        : <span className="adm-mono adm-nowrap">{formatKopecks(item.creditedKopecks)}</span>),
    },
    { key: 'paid', header: 'Пополнил после', mobile: false, render: (item) => (item.paidAfter ? <Badge tone="success">да</Badge> : <span className="adm-muted">нет</span>) },
  ]

  let content: ReactNode
  if (missing) {
    content = (
      <>
        <p className="set-note">Полный список с выгрузкой появится после миграции {PROMO_MIGRATION}. Пока видны последние десять активаций.</p>
        {promo.recent.length === 0
          ? <EmptyState>Код ещё никто не использовал.</EmptyState>
          : (
            <ul className="adm-list">
              {promo.recent.map((item) => <li key={`${item.email}:${item.redeemedAt}`}>{item.email || 'без почты'} · {formatDateTime(item.redeemedAt)}</li>)}
            </ul>
          )}
      </>
    )
  } else if (error) content = <ErrorState message={error} onRetry={reload} />
  else if (!result) content = <LoadingState />
  else {
    content = (
      <>
        <DataTable columns={columns} rows={items} rowKey={(item) => item.id} loading={loading} empty="Код ещё никто не использовал." />
        {total > REDEMPTIONS_PAGE_SIZE && <Pagination page={page} pageSize={REDEMPTIONS_PAGE_SIZE} total={total} onPage={setPage} />}
      </>
    )
  }

  return (
    <Panel
      title="Кто использовал"
      description={!missing && total > 0 ? `Всего ${formatNumber(total)}. Почта или телефон открывают карточку ученика.` : undefined}
      actions={!missing && total > 0 ? <ExportButton onExport={() => void exportCsv()} loading={exporting} /> : undefined}
    >
      {content}
    </Panel>
  )
}

/* ---------- Поля, общие для кода и пакета ---------- */

function WhatFields({ kind, amount, planId, planDays, plans, onKind, onAmount, onPlanId, onPlanDays }: {
  kind: PromoKind
  amount: string
  planId: string
  planDays: string
  plans: PromoPlan[]
  onKind: (value: PromoKind) => void
  onAmount: (value: string) => void
  onPlanId: (value: string) => void
  onPlanDays: (value: string) => void
}) {
  return (
    <>
      <div className="adm-field">
        <span className="adm-field-label">Что даёт</span>
        <Segmented label="Тип промокода" value={kind} options={[{ value: 'balance', label: 'Деньги на баланс' }, { value: 'plan', label: 'Тариф' }]} onChange={onKind} />
      </div>
      {kind === 'balance'
        ? (
          <Field label="Сумма, ₽" hint="До 10 000 ₽.">
            <input inputMode="decimal" value={amount} onChange={(event) => onAmount(event.target.value)} />
          </Field>
        )
        : (
          <div className="adm-form-grid">
            <Field label="Тариф" hint="Тариф задаёт дневной предел решений на срок.">
              <select value={planId} onChange={(event) => onPlanId(event.target.value)}>
                {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}
              </select>
            </Field>
            <Field label="На сколько дней">
              <input type="number" min={1} max={3650} value={planDays} onChange={(event) => onPlanDays(event.target.value)} />
            </Field>
          </div>
        )}
    </>
  )
}

function AudienceField({ value, tools, onChange }: { value: string; tools: Tools; onChange: (value: string) => void }) {
  const missing = tools === 'missing'
  return (
    <Field label="Только новым аккаунтам, дней" hint={missing ? PROMO_MIGRATION_TEXT : 'Пусто - всем. Иначе код примет аккаунт не старше стольких дней.'}>
      <input type="number" min={1} max={365} value={missing ? '' : value} disabled={missing} onChange={(event) => onChange(event.target.value)} />
    </Field>
  )
}

/* ---------- Один код: создание, правка, копия ---------- */

function PromoForm({ editing, plans, existingCodes, tools, onClose, onSaved, onMissing }: {
  editing: Editing
  plans: PromoPlan[]
  existingCodes: string[]
  tools: Tools
  onClose: () => void
  onSaved: () => void
  onMissing: () => void
}) {
  const { pending, run } = usePromoAction(onMissing)
  const [initial] = useState<PromoSettings | null>(() => (editing.mode === 'copy'
    ? duplicateOf(editing.promo, existingCodes)
    : editing.mode === 'edit' ? editing.promo : null))
  const isEdit = editing.mode === 'edit'
  const activePlans = plans.filter((plan) => plan.active || plan.id === initial?.planId)
  const templates = useMemo(() => promoTemplates(plans), [plans])
  const [code, setCode] = useState(initial?.code ?? '')
  const [suggestedCode, setSuggestedCode] = useState(editing.mode === 'copy' ? initial?.code ?? '' : '')
  const [kind, setKind] = useState<PromoKind>(initial?.kind ?? 'balance')
  const [amount, setAmount] = useState(initial?.amountKopecks ? kopecksToInput(initial.amountKopecks) : '')
  const [planId, setPlanId] = useState(initial?.planId ?? activePlans[0]?.id ?? '')
  const [planDays, setPlanDays] = useState(initial?.planDays ? String(initial.planDays) : '30')
  const [startsAt, setStartsAt] = useState(toLocalInput(initial?.startsAt ?? null))
  const [expiresAt, setExpiresAt] = useState(toLocalInput(initial?.expiresAt ?? null))
  const [maxUses, setMaxUses] = useState(initial?.maxUses ? String(initial.maxUses) : '')
  const [active, setActive] = useState(initial?.active ?? true)
  const [note, setNote] = useState(initial?.note ?? '')
  const [newUsersDays, setNewUsersDays] = useState(initial?.newUsersDays ? String(initial.newUsersDays) : '')

  const normalized = code.trim().toUpperCase()
  // До миграции поле выключено и не уходит: старая функция его не прочтёт.
  const draft: PromoDraft = { kind, amount, planId, planDays, startsAt, expiresAt, newUsersDays: tools === 'missing' ? '' : newUsersDays }
  const values = readDraft(draft)
  const uses = maxUses.trim() === '' ? null : intOrNull(maxUses)
  const hasPlanTemplates = templates.some((item) => item.kind === 'plan')

  const templateMatches = (item: PromoTemplate) => item.kind === kind
    && (item.kind === 'balance' ? amount.trim() === item.amount : planId === item.planId && planDays.trim() === item.days)

  // Шаблон заполняет тип и сумму или тариф и предлагает свободный код, если
  // своего кода ещё не набрали.
  const applyTemplate = (item: PromoTemplate) => {
    setKind(item.kind)
    if (item.kind === 'balance') setAmount(item.amount)
    else {
      setPlanId(item.planId)
      setPlanDays(item.days)
    }
    if (!code.trim() || code === suggestedCode) {
      const next = freeCode(item.code, existingCodes)
      setCode(next)
      setSuggestedCode(next)
    }
  }

  const problem = !isValidCode(normalized)
    ? 'Код - от 3 до 32 символов: латиница, цифры, _ и -.'
    : !isEdit && existingCodes.includes(normalized)
      ? 'Такой код уже есть - открой его на изменение.'
      : maxUses.trim() !== '' && (uses === null || uses < 1 || uses > 1_000_000)
        ? 'Лимит использований - от 1 до 1 000 000 или пусто.'
        : draftProblem(draft)

  const save = async () => {
    if (problem) return
    const payload = promoPayload({
      code: normalized,
      kind,
      amountKopecks: values.amountKopecks,
      planId,
      planDays: values.planDays,
      startsAt: values.startsAt,
      expiresAt: values.expiresAt,
      maxUses: uses,
      active,
      note: note.trim(),
      newUsersDays: values.newUsersDays,
    })
    const result = await run('save', () => adminRpc('admin_promo_save', { p_promo: payload }), `Код ${normalized} сохранён.`)
    if (result !== undefined) onSaved()
  }

  const title = editing.mode === 'edit' ? `Код ${editing.promo.code}` : editing.mode === 'copy' ? `Копия кода ${editing.promo.code}` : 'Новый промокод'

  return (
    <Drawer open title={title} subtitle={editing.mode === 'copy' ? 'Настройки взяты у исходного кода. Счётчики и история у копии свои.' : undefined} onClose={onClose}>
      <form className="set-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
        {editing.mode === 'new' && (
          <div className="set-templates">
            <span className="adm-field-label">Шаблоны</span>
            <div className="set-templates-row" role="group" aria-label="Шаблоны промокода">
              {templates.map((item) => (
                <Button key={item.id} size="sm" aria-pressed={templateMatches(item)} onClick={() => applyTemplate(item)}>{item.label}</Button>
              ))}
            </div>
            <small className="adm-field-hint">
              {hasPlanTemplates
                ? 'Шаблон заполняет тип, сумму или тариф и предлагает свободный код. Остальное - как обычно.'
                : 'Шаблон «тариф на 7 дней» появится, когда будет включённый тариф, кроме тарифа по умолчанию.'}
            </small>
          </div>
        )}
        <Field label="Код" hint={isEdit ? 'После создания не меняется.' : 'Заглавная латиница, цифры, _ и -.'}>
          <input value={code} disabled={isEdit} maxLength={32} onChange={(event) => setCode(event.target.value.toUpperCase())} autoComplete="off" className="adm-mono" data-initial-focus />
        </Field>
        <WhatFields
          kind={kind}
          amount={amount}
          planId={planId}
          planDays={planDays}
          plans={activePlans}
          onKind={setKind}
          onAmount={setAmount}
          onPlanId={setPlanId}
          onPlanDays={setPlanDays}
        />
        <div className="adm-form-grid">
          <Field label="Начало" hint="Пусто - сразу. Время по поясу браузера.">
            <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          </Field>
          <Field label="Окончание" hint="Пусто - бессрочно.">
            <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </Field>
          <Field label="Всего использований" hint="Пусто - без ограничения.">
            <input type="number" min={1} value={maxUses} onChange={(event) => setMaxUses(event.target.value)} />
          </Field>
          <AudienceField value={newUsersDays} tools={tools} onChange={setNewUsersDays} />
        </div>
        <Field label="Заметка" hint="Для себя: откуда код, для кого. До 200 символов.">
          <input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <Check label="Включён" checked={active} onChange={setActive} />
        {problem && <p className="set-form-error" role="alert">{problem}</p>}
        <div className="adm-form-actions">
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={Boolean(problem)} loading={pending === 'save'}>Сохранить</Button>
        </div>
      </form>
    </Drawer>
  )
}

/* ---------- Пакет одноразовых кодов ---------- */

function PromoBatchForm({ plans, tools, onClose, onGenerated, onShow, onMissing }: {
  plans: PromoPlan[]
  tools: Tools
  onClose: () => void
  onGenerated: () => void
  onShow: (search: string) => void
  onMissing: () => void
}) {
  const { pending, run } = usePromoAction(onMissing)
  const activePlans = plans.filter((plan) => plan.active)
  const [prefix, setPrefix] = useState('')
  const [count, setCount] = useState('20')
  const [kind, setKind] = useState<PromoKind>('balance')
  const [amount, setAmount] = useState('')
  const [planId, setPlanId] = useState(activePlans[0]?.id ?? '')
  const [planDays, setPlanDays] = useState('30')
  const [startsAt, setStartsAt] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [newUsersDays, setNewUsersDays] = useState('')
  const [note, setNote] = useState('')
  const [active, setActive] = useState(true)
  const [created, setCreated] = useState<PromoSettings[] | null>(null)

  const normalizedPrefix = normalizePrefix(prefix)
  const countValue = intOrNull(count)
  const draft: PromoDraft = { kind, amount, planId, planDays, startsAt, expiresAt, newUsersDays }
  const values = readDraft(draft)
  const problem = prefixProblem(normalizedPrefix)
    || (countValue === null || countValue < 1 || countValue > BATCH_MAX ? `Кодов в пакете - от 1 до ${BATCH_MAX}.` : '')
    || draftProblem(draft)

  const generate = async () => {
    if (problem || countValue === null) return
    const settings = {
      kind,
      amountKopecks: kind === 'balance' ? values.amountKopecks : null,
      planId: kind === 'plan' ? planId : null,
      planDays: kind === 'plan' ? values.planDays : null,
      startsAt: values.startsAt,
      expiresAt: values.expiresAt,
      newUsersDays: values.newUsersDays,
      note: note.trim(),
      active,
    }
    const result = await run(
      'generate',
      () => adminRpc('admin_promo_generate', { p_batch: { ...settings, prefix: normalizedPrefix, count: countValue } }),
      (response) => `Создано кодов: ${formatNumber(parseBatchResult(response).length)}.`,
    )
    if (result === undefined) return
    setCreated(parseBatchResult(result).map((code): PromoSettings => ({
      code,
      kind: settings.kind,
      amountKopecks: settings.amountKopecks,
      planId: settings.planId,
      planDays: settings.planDays,
      startsAt: settings.startsAt,
      expiresAt: settings.expiresAt,
      maxUses: 1,
      active: settings.active,
      note: settings.note || null,
      newUsersDays: settings.newUsersDays,
    })))
    onGenerated()
  }

  // По чему потом найти пакет в списке: префикс с дефисом, иначе заметка.
  const search = normalizedPrefix ? `${normalizedPrefix}-` : note.trim()

  let content: ReactNode
  if (tools === 'missing') {
    content = (
      <div className="set-form">
        <MigrationNote>Пакет кодов появится после неё. Одиночные коды создаются как прежде.</MigrationNote>
        <div className="adm-form-actions"><Button onClick={onClose}>Закрыть</Button></div>
      </div>
    )
  } else if (created) {
    content = (
      <div className="set-form">
        <p className="set-note">
          Создано кодов: {formatNumber(created.length)}. {created[0] ? `${promoWhat(created[0], plans)}, каждый код - на одно погашение.` : ''} В файле - коды и ссылки, которые сразу открывают баланс с вписанным кодом.
        </p>
        <ul className="set-promo-codes" aria-label="Созданные коды">
          {created.slice(0, 12).map((item) => <li key={item.code}>{item.code}</li>)}
        </ul>
        {created.length > 12 && <p className="set-note">И ещё {formatNumber(created.length - 12)} - все в файле.</p>}
        <div className="adm-form-actions">
          <Button variant="ghost" onClick={onClose}>Готово</Button>
          {search && <Button onClick={() => onShow(search)}>Показать в списке</Button>}
          <ExportButton
            variant="primary"
            size="md"
            label="Скачать CSV"
            onExport={() => downloadCsv(`promo-${normalizedPrefix || 'batch'}-${todayMsk()}`, created, batchCsv(plans, window.location.origin))}
          />
        </div>
      </div>
    )
  } else {
    content = (
      <form className="set-form" onSubmit={(event) => { event.preventDefault(); void generate() }}>
        <div className="adm-form-grid">
          <Field label="Префикс" hint={`До ${PREFIX_MAX} символов: латиница, цифры, _ и -. Пусто - только случайная часть.`}>
            <input value={prefix} maxLength={24} className="adm-mono" autoComplete="off" onChange={(event) => setPrefix(event.target.value.toUpperCase())} data-initial-focus />
          </Field>
          <Field label="Сколько кодов" hint={`От 1 до ${BATCH_MAX}.`}>
            <input type="number" min={1} max={BATCH_MAX} value={count} onChange={(event) => setCount(event.target.value)} />
          </Field>
        </div>
        <p className="set-note">
          Коды будут такими: <span className="adm-mono">{sampleCode(normalizedPrefix)}</span>. После префикса база ставит шесть случайных знаков без 0, O, 1, I и L, чтобы их не путали.
        </p>
        <WhatFields
          kind={kind}
          amount={amount}
          planId={planId}
          planDays={planDays}
          plans={activePlans}
          onKind={setKind}
          onAmount={setAmount}
          onPlanId={setPlanId}
          onPlanDays={setPlanDays}
        />
        <div className="adm-form-grid">
          <Field label="Начало" hint="Пусто - сразу. Время по поясу браузера.">
            <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          </Field>
          <Field label="Окончание" hint="Пусто - бессрочно.">
            <input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} />
          </Field>
          <AudienceField value={newUsersDays} tools={tools} onChange={setNewUsersDays} />
        </div>
        <Field label="Заметка" hint="Одна на весь пакет: по ней пакет потом находится в списке. До 200 символов.">
          <input value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} />
        </Field>
        <Check label="Коды включены" checked={active} onChange={setActive} />
        {problem && <p className="set-form-error" role="alert">{problem}</p>}
        <div className="adm-form-actions">
          <Button onClick={onClose}>Отмена</Button>
          <Button type="submit" variant="primary" disabled={Boolean(problem)} loading={pending === 'generate'}>Создать коды</Button>
        </div>
      </form>
    )
  }

  return (
    <Drawer open title="Пакет одноразовых кодов" subtitle="Каждый код погасит один аккаунт. Настройки общие для всего пакета." onClose={onClose}>
      {content}
    </Drawer>
  )
}
