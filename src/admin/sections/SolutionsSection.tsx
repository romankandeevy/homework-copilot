/* База решений: всё, что решатель выдал ученикам и гостям.

   До 12 сентября раздел читал только общий каталог, а туда попадают лишь
   задачи по номеру из проверенного учебника - таких в базе ноль. При 31
   выданном решении раздел писал «Выданных решений пока нет», а цифры
   стояли нулями. Теперь список собирает admin_solutions_v2 из всех трёх
   мест хранения, ошибка загрузки видна текстом с кнопкой «Повторить».

   Раздел только читает: решение уже у ученика, и правка задним числом
   поменяла бы то, за что он заплатил. Модерации, скрытия из каталога,
   ручного добавления, импорта и версий в базе нет - поэтому нет и кнопок. */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowClockwise, CheckCircle, Info, WarningCircle, X, XCircle } from '@phosphor-icons/react'
import { AdminRequestError, adminRpc, formatDate, formatDateTime, formatKopecks, formatNumber } from '../api'
import { useAdmin } from '../context'
import { Badge, Button, DataTable, Drawer, Field, JsonView, PageHeader, Pagination, Panel, Stat, StatGrid, useAsync, useQueryState } from '../ui'
import type { Column, Tone } from '../ui'
import {
  activeFilterCount,
  jobStatusLabels,
  keyedLines,
  kindLabels,
  label,
  parseSolutionDetail,
  parseSolutionList,
  solutionTitle,
  sourceLabels,
  statusLabels,
  walletTotals,
} from './solutionsModel'
import type { Facet, SolutionDetail, SolutionItem, SolutionStats } from './solutionsModel'
import './solutions.css'

const PAGE_SIZE = 50

const queryDefaults = { s_q: '', s_subject: '', s_source: '', s_status: '', s_kind: '', s_from: '', s_to: '', s_page: '1', s_open: '' }

const statusTone: Record<string, Tone> = { passed: 'success', failed: 'danger', unknown: 'neutral' }

function kindTone(kind: string): Tone {
  return kind === 'catalog' ? 'info' : 'neutral'
}

/* ---------- Состояния ---------- */

function LoadError({ title = 'Не получилось загрузить базу решений', message, onRetry }: { title?: string; message: string; onRetry: () => void }) {
  return (
    <div className="sol-error" role="alert">
      <WarningCircle size={22} weight="bold" aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
      </div>
      <Button size="sm" icon={<ArrowClockwise size={16} weight="bold" aria-hidden="true" />} onClick={onRetry}>Повторить</Button>
    </div>
  )
}

function Skeleton({ lines, label: text }: { lines: number; label: string }) {
  return (
    <div className="sol-skeleton">
      <span className="sol-sr" role="status">{text}</span>
      {Array.from({ length: lines }, (_, index) => <i key={`line-${index}`} aria-hidden="true" />)}
    </div>
  )
}

/* Схема на месте пустой базы: откуда вообще берутся решения. Геометрия на
   сетке blueprint, без картинок и внешних файлов. */
function SolutionFlowDiagram() {
  return (
    <svg className="sol-flow" viewBox="0 0 360 168" role="img" aria-label="Схема: условие уходит решателю, решение получает ученик или гость, задача по номеру из проверенного учебника попадает ещё и в общий каталог">
      <defs>
        <pattern id="sol-flow-grid" width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M12 0H0V12" className="sol-flow-grid" />
        </pattern>
        <marker id="sol-flow-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0.5L7.5 4L0 7.5" className="sol-flow-arrowhead" />
        </marker>
      </defs>
      <rect x="0.5" y="0.5" width="359" height="167" rx="10" fill="url(#sol-flow-grid)" className="sol-flow-sheet" />
      <path d="M112 84H128" className="sol-flow-edge" markerEnd="url(#sol-flow-arrow)" />
      <path d="M230 78H239V40H246" className="sol-flow-edge" markerEnd="url(#sol-flow-arrow)" />
      <path d="M230 90H239V128H246" className="sol-flow-edge is-accent" markerEnd="url(#sol-flow-arrow)" />
      <g className="sol-flow-node">
        <rect x="12" y="62" width="100" height="44" rx="8" />
        <text x="62" y="81">Условие</text>
        <text x="62" y="96" className="sol-flow-note">фото, текст, номер</text>
      </g>
      <g className="sol-flow-node is-strong">
        <rect x="130" y="62" width="100" height="44" rx="8" />
        <text x="180" y="81">Решатель</text>
        <text x="180" y="96" className="sol-flow-note">решение и проверка</text>
      </g>
      <g className="sol-flow-node">
        <rect x="248" y="18" width="100" height="44" rx="8" />
        <text x="298" y="37">Ученику</text>
        <text x="298" y="52" className="sol-flow-note">или гостю</text>
      </g>
      <g className="sol-flow-node is-accent">
        <rect x="248" y="106" width="100" height="44" rx="8" />
        <text x="298" y="125">Каталог</text>
        <text x="298" y="140" className="sol-flow-note">номер из учебника</text>
      </g>
    </svg>
  )
}

function EmptyBase() {
  return (
    <section className="sol-empty" aria-labelledby="sol-empty-title">
      <SolutionFlowDiagram />
      <div className="sol-empty-copy">
        <h2 id="sol-empty-title">Выданных решений пока нет</h2>
        <p>Решение появится здесь, как только решатель доведёт задачу до конца и отдаст её ученику с аккаунтом или гостю. Неудачные попытки сюда не попадают.</p>
        <p>Задачи по номеру из проверенного учебника попадают ещё и в общий каталог: следующий ученик с тем же номером получает готовое решение сразу. Решения по фото и по тексту остаются личными.</p>
      </div>
    </section>
  )
}

/* ---------- Цифры и пояснения ---------- */

function SolutionNumbers({ stats }: { stats: SolutionStats }) {
  return (
    <StatGrid>
      <Stat label="Выдано решений" value={formatNumber(stats.total)} hint={`${formatNumber(stats.catalog + stats.personal)} ученикам · ${formatNumber(stats.guest)} гостям`} />
      <Stat label="Добавлено сегодня" value={formatNumber(stats.today)} hint="с полуночи по Москве" />
      <Stat label="За 7 дней" value={formatNumber(stats.week)} hint="включая сегодня" />
      <Stat label="В общем каталоге" value={formatNumber(stats.catalog)} hint={stats.verifiedTasks === 0 ? 'проверенных задач по номеру нет' : 'доступны всем сразу'} />
    </StatGrid>
  )
}

function HowItWorks({ stats }: { stats: SolutionStats }) {
  return (
    <details className="sol-how">
      <summary><Info size={16} weight="bold" aria-hidden="true" /> Откуда берутся решения и как считаются цифры</summary>
      <dl>
        <div><dt>Выдано решений</dt><dd>Решение попадает сюда, когда решатель довёл задачу до конца и отдал её ученику с аккаунтом или гостю. Неудачные попытки сюда не попадают.</dd></div>
        <div>
          <dt>Общий каталог</dt>
          <dd>
            Туда попадают только задачи по номеру из проверенного учебника: следующий ученик с тем же номером получает готовое решение сразу. Решения по фото и по тексту остаются личными.
            {' '}{stats.verifiedTasks === 0 ? 'Проверенных задач по номеру в базе сейчас нет, поэтому каталог пуст.' : `Проверенных задач по номеру в базе: ${formatNumber(stats.verifiedTasks)}.`}
          </dd>
        </div>
        <div><dt>Открытия</dt><dd>Просмотры решений база не записывает, только выдачу - одну запись на ученика. Поэтому «часто открываемых» здесь нет. Если одно решение из каталога получили несколько учеников, в столбце «Кому» стоит +N.</dd></div>
        <div><dt>Статус проверки</dt><dd>Отметка, которую решатель записал в решение после проверки кодом: условие, тип задачи, чертёж, запись в тетради. В фильтре только те статусы, что есть в базе.</dd></div>
        <div><dt>Цена и себестоимость</dt><dd>Цена - списание с баланса ученика за это решение. Себестоимость - расход шлюза моделей{stats.costsSince ? `, её записывают с ${formatDate(stats.costsSince)}` : ''}; у более ранних решений её нет.</dd></div>
        <div><dt>Решения гостей</dt><dd>Гость решает без аккаунта. Его решения база хранит 7 дней, потом удаляет.</dd></div>
      </dl>
    </details>
  )
}

/* ---------- Фильтры ---------- */

function FacetSelect({ title, value, facets, labels, allLabel, onChange }: {
  title: string
  value: string
  facets: Facet[]
  labels?: Record<string, string>
  allLabel: string
  onChange: (value: string) => void
}) {
  // Значение из ссылки, которого уже нет в данных, всё равно показываем, иначе поле выглядит пустым.
  const options = !value || facets.some((facet) => facet.value === value) ? facets : [{ value, count: 0 }, ...facets]
  return (
    <Field label={title}>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((facet) => (
          <option key={facet.value} value={facet.value}>{labels ? label(labels, facet.value) : facet.value} · {formatNumber(facet.count)}</option>
        ))}
      </select>
    </Field>
  )
}

/* ---------- Полное решение ---------- */

async function loadDetail(id: string) {
  try {
    return parseSolutionDetail(await adminRpc('admin_solution_detail_v2', { p_id: id }))
  } catch (failure) {
    if (failure instanceof AdminRequestError && failure.code === 'P0002') {
      throw new Error('Такого решения в базе нет. Если это решение гостя, его могли удалить: их база хранит 7 дней.', { cause: failure })
    }
    throw failure
  }
}

function SheetPart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="sol-part">
      <h3>{title}</h3>
      <div className="sol-part-body">{children}</div>
    </div>
  )
}

function costText(cost: NonNullable<SolutionDetail['cost']>) {
  const parts = [cost.costKopecks !== null ? formatKopecks(cost.costKopecks) : 'шлюз не сообщил расход']
  if (cost.seconds !== null) parts.push(`${formatNumber(Math.round(cost.seconds))} с`)
  if (cost.calls > 0) parts.push(`вызовов модели: ${formatNumber(cost.calls)}`)
  return parts.join(' · ')
}

function SolutionDetailView({ detail, onOpenUser }: { detail: SolutionDetail; onOpenUser: (id: string) => void }) {
  const { body } = detail
  const money = walletTotals(detail.wallet)
  const rated = detail.ratings.helpful + detail.ratings.unhelpful
  return (
    <>
      <dl className="adm-kv sol-meta">
        <dt>Кому</dt>
        <dd>
          {detail.userId
            ? <button type="button" className="sol-link" onClick={() => onOpenUser(detail.userId!)}>{detail.email ?? detail.userId}</button>
            : detail.guest ? 'Гость без аккаунта' : '-'}
        </dd>
        <dt>Где лежит</dt>
        <dd><Badge tone={kindTone(detail.kind)}>{label(kindLabels, detail.kind)}</Badge></dd>
        <dt>Учебник</dt>
        <dd>{[detail.textbookTitle, detail.textbookEdition].filter(Boolean).join(' · ') || '-'}</dd>
        {detail.task && <><dt>Номер</dt><dd>№ {detail.task}</dd></>}
        <dt>Проверка</dt>
        <dd><Badge tone={statusTone[detail.status] ?? 'neutral'}>{label(statusLabels, detail.status)}</Badge></dd>
        <dt>Цена</dt>
        <dd>{detail.wallet.length ? `${formatKopecks(money.charged)}${money.refunded ? `, возвращено ${formatKopecks(money.refunded)}` : ''}` : 'списаний с баланса нет'}</dd>
        <dt>Себестоимость</dt>
        <dd>{detail.cost ? costText(detail.cost) : 'записи о расходе нет'}</dd>
        {detail.cost?.models && <><dt>Модели</dt><dd className="adm-mono">{detail.cost.models}</dd></>}
        {detail.job && <><dt>Задача в очереди</dt><dd>{[label(jobStatusLabels, detail.job.status), detail.job.grade].filter(Boolean).join(' · ')}</dd></>}
        {detail.engineVersion !== null && <><dt>Версия решателя</dt><dd>{formatNumber(detail.engineVersion)}</dd></>}
      </dl>

      {detail.checks.length > 0 && (
        <section className="sol-block" aria-labelledby="sol-checks-title">
          <h3 id="sol-checks-title">Проверки решателя</h3>
          <ul className="sol-checks">
            {detail.checks.map((check) => (
              <li key={`${check.label}-${check.note}`} className={check.passed ? '' : 'is-failed'}>
                {check.passed ? <CheckCircle size={18} weight="bold" aria-label="пройдена" /> : <XCircle size={18} weight="bold" aria-label="не пройдена" />}
                <span><b>{check.label}</b>{check.note && <small>{check.note}</small>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sol-sheet" aria-label="Решение целиком">
        <SheetPart title="Условие">
          {body.condition ? <p className="sol-pre">{body.condition}</p> : <p className="adm-muted">Условие не сохранено.</p>}
        </SheetPart>
        {body.explanation.length > 0 && (
          <SheetPart title="Объяснение">
            {keyedLines(body.explanation).map((line) => <p key={line.key}>{line.text}</p>)}
          </SheetPart>
        )}
        {body.given.length > 0 && (
          <SheetPart title="Дано">
            <ul>{keyedLines(body.given).map((line) => <li key={line.key}>{line.text}</li>)}</ul>
          </SheetPart>
        )}
        {body.goal && <SheetPart title={body.goal.title}><p>{body.goal.text}</p></SheetPart>}
        {body.steps.length > 0 && (
          <SheetPart title={body.goal?.title === 'Доказать' ? 'Доказательство' : 'Решение'}>
            <ol className="sol-steps">{keyedLines(body.steps).map((line) => <li key={line.key}>{line.text}</li>)}</ol>
          </SheetPart>
        )}
        {body.code && (
          <SheetPart title={body.code.language ? `Программа · ${body.code.language}` : 'Программа'}>
            <pre className="sol-code">{body.code.text}</pre>
          </SheetPart>
        )}
        {body.diagram && <SheetPart title="Чертёж"><p>{body.diagram}</p></SheetPart>}
        <SheetPart title="Ответ">
          {body.answer ? <p className="sol-answer-line">{body.answer}</p> : <p className="adm-muted">Ответа в записи нет.</p>}
        </SheetPart>
      </section>

      {detail.accesses.length > 0 && (
        <section className="sol-block" aria-labelledby="sol-accesses-title">
          <h3 id="sol-accesses-title">Кому выдано</h3>
          <ul className="sol-accesses">
            {detail.accesses.map((access) => (
              <li key={`${access.userId ?? 'none'}-${access.at}`}>
                {access.userId
                  ? <button type="button" className="sol-link" onClick={() => onOpenUser(access.userId!)}>{access.email ?? access.userId}</button>
                  : <span>Аккаунт удалён</span>}
                <time>{formatDateTime(access.at)}</time>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sol-block" aria-labelledby="sol-ratings-title">
        <h3 id="sol-ratings-title">Оценка учеников</h3>
        {rated === 0 ? <p className="adm-muted">Оценок нет.</p> : (
          <>
            <p>Помогло: <b>{formatNumber(detail.ratings.helpful)}</b> · Не помогло: <b>{formatNumber(detail.ratings.unhelpful)}</b></p>
            {detail.ratings.comments.length > 0 && (
              <ul className="sol-accesses">
                {detail.ratings.comments.map((comment) => (
                  <li key={`${comment.at}-${comment.comment}`}><span>{comment.comment}</span><time>{formatDateTime(comment.at)}</time></li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <details className="sol-raw">
        <summary><Info size={16} weight="bold" aria-hidden="true" /> Запись решения целиком</summary>
        <JsonView value={detail.raw} maxHeight={480} />
      </details>
    </>
  )
}

function SolutionDrawer({ id, onClose, onOpenUser }: { id: string; onClose: () => void; onOpenUser: (id: string) => void }) {
  const { data, error, loading, reload } = useAsync(() => loadDetail(id), [id])
  const title = data ? [data.subject || 'Без предмета', label(sourceLabels, data.source)].join(' · ') : 'Решение'
  const subtitle = data ? `Выдано ${formatDateTime(data.createdAt)} · ${label(kindLabels, data.kind)}` : undefined
  return (
    <Drawer open title={title} subtitle={subtitle} onClose={onClose} wide>
      {error && <LoadError title="Не получилось открыть решение" message={error} onRetry={reload} />}
      {!error && loading && !data && <Skeleton lines={7} label="Загружаем решение" />}
      {!error && data && <SolutionDetailView detail={data} onOpenUser={onOpenUser} />}
    </Drawer>
  )
}

/* ---------- Раздел ---------- */

export default function SolutionsSection() {
  const { openUser } = useAdmin()
  const [query, setQuery] = useQueryState(queryDefaults)
  const page = Math.max(1, Number.parseInt(query.s_page, 10) || 1)
  const [search, setSearch] = useState(query.s_q)

  // Назад по истории меняет поиск в адресе - поле следует за ним.
  useEffect(() => {
    setSearch((current) => (current.trim() === query.s_q ? current : query.s_q))
  }, [query.s_q])

  useEffect(() => {
    if (search.trim() === query.s_q) return undefined
    const timer = window.setTimeout(() => setQuery({ s_q: search.trim(), s_page: '1' }, { replace: true }), 300)
    return () => window.clearTimeout(timer)
  }, [search, query.s_q, setQuery])

  const { data, error, loading, reload } = useAsync(
    () => adminRpc('admin_solutions_v2', {
      p_search: query.s_q,
      p_subject: query.s_subject || null,
      p_source: query.s_source || null,
      p_status: query.s_status || null,
      p_kind: query.s_kind || null,
      p_from: query.s_from || null,
      p_to: query.s_to || null,
      p_page: page,
      p_page_size: PAGE_SIZE,
    }),
    [query.s_q, query.s_subject, query.s_source, query.s_status, query.s_kind, query.s_from, query.s_to, page],
  )
  const list = data === null ? null : parseSolutionList(data)
  const filterCount = activeFilterCount({
    q: query.s_q, subject: query.s_subject, source: query.s_source, status: query.s_status, kind: query.s_kind, from: query.s_from, to: query.s_to,
  })

  const setFilter = (patch: Partial<typeof queryDefaults>) => setQuery({ ...patch, s_page: '1' })
  const resetFilters = () => {
    setSearch('')
    setQuery({ s_q: '', s_subject: '', s_source: '', s_status: '', s_kind: '', s_from: '', s_to: '', s_page: '1' })
  }

  const columns: Column<SolutionItem>[] = [
    {
      key: 'solution',
      header: 'Решение',
      render: (item) => (
        <span className="adm-cell-main sol-cell">
          <strong className="adm-clamp">{solutionTitle(item)}</strong>
          <small>{[item.subject || 'Без предмета', label(sourceLabels, item.source), item.task ? `№ ${item.task}` : ''].filter(Boolean).join(' · ')}</small>
          {item.answer && <span className="sol-answer">Ответ: {item.answer}</span>}
        </span>
      ),
    },
    {
      key: 'owner',
      header: 'Кому',
      render: (item) => (
        <span className="sol-owner">
          {item.userId
            ? <button type="button" className="sol-link" onClick={() => openUser(item.userId!)}>{item.email ?? 'Ученик без почты'}</button>
            : <span className="adm-muted">{item.kind === 'guest' ? 'Гость' : '-'}</span>}
          {item.accessCount > 1 && <Badge tone="info" title="Столько ещё учеников получили это решение из каталога">+{formatNumber(item.accessCount - 1)}</Badge>}
        </span>
      ),
    },
    { key: 'kind', header: 'Где лежит', mobile: false, render: (item) => <Badge tone={kindTone(item.kind)}>{label(kindLabels, item.kind)}</Badge> },
    {
      key: 'status',
      header: 'Проверка',
      mobile: false,
      render: (item) => (
        <span className="sol-status">
          <Badge tone={statusTone[item.status] ?? 'neutral'}>{label(statusLabels, item.status)}</Badge>
          {item.failedChecks > 0 && <small>не пройдено: {formatNumber(item.failedChecks)}</small>}
        </span>
      ),
    },
    {
      key: 'price',
      header: 'Цена',
      align: 'right',
      render: (item) => (
        <span className="sol-money">
          <span>{item.priceKopecks !== null ? formatKopecks(item.priceKopecks) : '-'}</span>
          {item.costKopecks !== null && <small>себест. {formatKopecks(item.costKopecks)}</small>}
        </span>
      ),
    },
    { key: 'at', header: 'Выдано', render: (item) => <span className="adm-nowrap">{formatDateTime(item.createdAt)}</span> },
  ]

  return (
    <div className="sol-stack">
      <PageHeader
        title="База решений"
        description="Все решения, которые решатель выдал ученикам и гостям. Только чтение: решение уже у ученика, и правка задним числом поменяла бы то, за что он заплатил."
        actions={list ? <Button size="sm" icon={<ArrowClockwise size={16} weight="bold" aria-hidden="true" />} loading={loading} onClick={reload}>Обновить</Button> : undefined}
      />

      {list === null && error && <LoadError message={error} onRetry={reload} />}
      {list === null && !error && <Skeleton lines={8} label="Загружаем решения" />}

      {list && list.stats.total === 0 && !error && <EmptyBase />}

      {list && (list.stats.total > 0 || error) && (
        <>
          <SolutionNumbers stats={list.stats} />
          <HowItWorks stats={list.stats} />
          <Panel
            title="Выданные решения"
            description={filterCount ? `По фильтрам: ${formatNumber(list.total)}` : 'Сначала новые. Строка открывает решение целиком.'}
          >
            <div className="adm-toolbar sol-toolbar">
              <Field label="Поиск" className="is-grow">
                <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Условие, ответ, предмет или почта" />
              </Field>
              <FacetSelect title="Предмет" value={query.s_subject} facets={list.facets.subjects} allLabel="Все предметы" onChange={(value) => setFilter({ s_subject: value })} />
              <FacetSelect title="Где лежит" value={query.s_kind} facets={list.facets.kinds} labels={kindLabels} allLabel="Везде" onChange={(value) => setFilter({ s_kind: value })} />
              <FacetSelect title="Источник" value={query.s_source} facets={list.facets.sources} labels={sourceLabels} allLabel="Любой" onChange={(value) => setFilter({ s_source: value })} />
              <FacetSelect title="Статус проверки" value={query.s_status} facets={list.facets.statuses} labels={statusLabels} allLabel="Любой" onChange={(value) => setFilter({ s_status: value })} />
              <Field label="Выдано с">
                <input type="date" value={query.s_from} max={query.s_to || undefined} onChange={(event) => setFilter({ s_from: event.target.value })} />
              </Field>
              <Field label="по">
                <input type="date" value={query.s_to} min={query.s_from || undefined} onChange={(event) => setFilter({ s_to: event.target.value })} />
              </Field>
              {filterCount > 0 && (
                <Button size="sm" variant="ghost" icon={<X size={16} weight="bold" aria-hidden="true" />} onClick={resetFilters}>Сбросить</Button>
              )}
            </div>
            {error ? <LoadError message={error} onRetry={reload} /> : (
              <DataTable
                columns={columns}
                rows={list.items}
                rowKey={(item) => item.id}
                loading={loading}
                onRowClick={(item) => setQuery({ s_open: item.id })}
                empty={(
                  <span className="sol-empty-filtered">
                    По этим фильтрам решений нет.
                    <Button size="sm" variant="ghost" onClick={resetFilters}>Сбросить фильтры</Button>
                  </span>
                )}
              />
            )}
            {!error && list.total > PAGE_SIZE && (
              <Pagination page={page} pageSize={PAGE_SIZE} total={list.total} onPage={(next) => setQuery({ s_page: String(next) })} />
            )}
          </Panel>
        </>
      )}

      {query.s_open && <SolutionDrawer id={query.s_open} onClose={() => setQuery({ s_open: '' })} onOpenUser={openUser} />}
    </div>
  )
}
