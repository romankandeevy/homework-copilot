/* Проверка промпта на примере задачи, без сохранения.

   Текст из редактора уходит в функцию админки (`prompt_preview`), та зовёт
   модель тем же движком, что и решатель, и возвращает решение. Ученику
   ничего не пишется, кошелёк не трогается, каталог решений прогона не
   видит. Роль, второй фактор, предел частоты и журнал - в базе
   (`admin_prompt_preview_start`). Прогон стоит денег, поэтому перед ним -
   подтверждение с ценой по живым решениям предмета. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleNotch, Flask } from '@phosphor-icons/react'
import {
  adminAction, adminRpc, arr, bool, formatDateTime, formatKopecks, formatNumber, isRecord, num, numOrNull, obj, rows, str, strOrNull,
  type Row,
} from '../api'
import { Badge, Button, ErrorState, Field, Modal, Panel, useAsync, useToast } from '../ui'
import { useAdmin } from '../context'
import { maxConditionLength } from '../../lib/homeworkContract'
import { kieCreditKopecks } from '../../lib/solutionPricing'
import { findSubjectById, solvableGrades } from '../../lib/subjects'
import { keyedLines, lineDiff } from './settingsDiff'
import { DiffView } from './settingsParts'

const promptMax = 8000
const pollEveryMs = 5000
// Прогон длится до 230 секунд; после семи минут ждать больше нечего.
const lostAfterMs = 7 * 60_000

type SolutionView = {
  given: string[]
  goal: { title: string; text: string }
  explanation: string[]
  steps: string[]
  answer: string
  code: { language: string; text: string } | null
  form: 'notebook' | 'essay'
  reviewPassed: boolean
  issues: string[]
  hasDiagram: boolean
}

type RunView = {
  variant: 'draft' | 'current'
  promptVersion: number | null
  hadPrompt: boolean
  ok: boolean
  error: string | null
  seconds: number
  calls: number
  credits: number | null
  kopecks: number | null
  models: string
  solution: SolutionView | null
}

type PreviewView = {
  id: string
  createdAt: string | null
  actorEmail: string | null
  prompt: string
  condition: string
  grade: string
  status: string
  error: string | null
  credits: number | null
  kopecks: number | null
  seconds: number | null
  currentVersion: number | null
  runs: RunView[]
}

type Quota = {
  hourLimit: number
  dayLimit: number
  hourUsed: number
  dayUsed: number
  running: boolean
  perRun: number | null
  basis: 'subject' | 'overall' | null
  samples: number
  maxCredits: number | null
  spent30d: number
}

function strings(value: Row[string]) {
  return arr(value).filter((item): item is string => typeof item === 'string')
}

function parseSolution(value: Row[string]): SolutionView | null {
  if (!isRecord(value)) return null
  const goal = obj(value.goal)
  const code = isRecord(value.code) ? { language: str(value.code.language), text: str(value.code.text) } : null
  return {
    given: strings(value.given),
    goal: { title: str(goal.title), text: str(goal.text) },
    explanation: strings(value.explanation),
    steps: strings(value.steps),
    answer: str(value.answer),
    code,
    form: str(value.form) === 'essay' ? 'essay' : 'notebook',
    reviewPassed: bool(value.reviewPassed),
    issues: strings(value.issues),
    hasDiagram: bool(value.hasDiagram),
  }
}

function parseRun(row: Row): RunView {
  return {
    variant: str(row.variant) === 'current' ? 'current' : 'draft',
    promptVersion: numOrNull(row.promptVersion),
    hadPrompt: bool(row.hadPrompt),
    ok: bool(row.ok),
    error: strOrNull(row.error),
    seconds: num(row.seconds),
    calls: num(row.calls),
    credits: numOrNull(row.credits),
    kopecks: numOrNull(row.kopecks),
    models: str(row.models),
    solution: parseSolution(row.solution),
  }
}

function parseStored(row: Row): PreviewView {
  const result = obj(row.result)
  return {
    id: str(row.id),
    createdAt: strOrNull(row.createdAt),
    actorEmail: strOrNull(row.actorEmail),
    prompt: str(row.prompt),
    condition: str(row.condition),
    grade: str(row.grade),
    status: str(row.status),
    error: strOrNull(row.error),
    credits: numOrNull(row.credits) ?? numOrNull(result.credits),
    kopecks: numOrNull(result.kopecks),
    seconds: numOrNull(row.seconds) ?? numOrNull(result.seconds),
    currentVersion: numOrNull(row.currentVersion),
    runs: rows(result.runs).map(parseRun),
  }
}

function parseQuota(data: unknown): Quota | null {
  if (!isRecord(data)) return null
  const subjectAvg = numOrNull(data.subjectAvgCredits)
  const overallAvg = numOrNull(data.overallAvgCredits)
  return {
    hourLimit: num(data.hourLimit, 6),
    dayLimit: num(data.dayLimit, 30),
    hourUsed: num(data.hourUsed),
    dayUsed: num(data.dayUsed),
    running: bool(data.running),
    perRun: subjectAvg ?? overallAvg,
    basis: subjectAvg !== null ? 'subject' : overallAvg !== null ? 'overall' : null,
    samples: num(data.subjectSamples),
    maxCredits: numOrNull(data.subjectMaxCredits),
    spent30d: num(data.spent30d),
  }
}

/* «1,2 кредита», «3 кредита», «5 кредитов». Дробное число в русском
   согласуется с родительным падежом единственного числа. */
function creditsText(value: number) {
  const rounded = Math.round(value * 10) / 10
  if (value > 0 && rounded === 0) return 'меньше 0,1 кредита'
  if (!Number.isInteger(rounded)) return `${formatNumber(rounded)} кредита`
  const tail = Math.abs(rounded) % 100
  const last = tail % 10
  const word = tail > 10 && tail < 20 ? 'кредитов' : last === 1 ? 'кредит' : last >= 2 && last <= 4 ? 'кредита' : 'кредитов'
  return `${formatNumber(rounded)} ${word}`
}

function rublesOf(credits: number) {
  return formatKopecks(Math.round(credits * kieCreditKopecks))
}

function runCost(run: { credits: number | null; seconds: number; models: string }) {
  const parts = [`${formatNumber(run.seconds)} с`]
  parts.push(run.credits === null ? 'расход шлюз не сообщил' : `${creditsText(run.credits)} ≈ ${rublesOf(run.credits)}`)
  if (run.models) parts.push(run.models)
  return parts.join(' · ')
}

const statusLabels: Record<string, { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }> = {
  done: { label: 'готово', tone: 'success' },
  failed: { label: 'не решилось', tone: 'danger' },
  running: { label: 'идёт', tone: 'info' },
  lost: { label: 'потерялась', tone: 'warning' },
}

function RunColumn({ run }: { run: RunView }) {
  const title = run.variant === 'draft'
    ? 'Стало: текст из редактора'
    : run.hadPrompt ? `Было: версия ${run.promptVersion ?? '?'}` : 'Было: без промпта'
  const solution = run.solution
  return (
    <article className={`set-run${run.variant === 'draft' ? ' is-draft' : ''}`}>
      <header className="set-run-head">
        <h3>{title}</h3>
        <span className="set-badges">
          {!run.ok && <Badge tone="danger">не решилось</Badge>}
          {run.ok && solution?.reviewPassed && <Badge tone="success">прошло проверку</Badge>}
          {run.ok && solution && !solution.reviewPassed && <Badge tone="warning">проверка не пройдена</Badge>}
        </span>
        <small>{runCost(run)}</small>
      </header>
      {run.error && <p className="set-form-error">{run.error}</p>}
      {solution && (
        <>
          {solution.explanation.length > 0 && (
            <div className="set-run-block">
              <h4>Разбор</h4>
              {keyedLines(solution.explanation).map((line) => <p key={line.key}>{line.text}</p>)}
            </div>
          )}
          {solution.given.length > 0 && (
            <div className="set-run-block">
              <h4>Дано</h4>
              <ul>{keyedLines(solution.given).map((line) => <li key={line.key}>{line.text}</li>)}</ul>
            </div>
          )}
          <div className="set-run-block">
            <h4>Запись</h4>
            {solution.form === 'notebook'
              ? <ol>{keyedLines(solution.steps).map((line) => <li key={line.key}>{line.text}</li>)}</ol>
              : keyedLines(solution.steps).map((line) => <p key={line.key}>{line.text}</p>)}
          </div>
          {solution.code && (
            <div className="set-run-block">
              <h4>Программа, {solution.code.language}</h4>
              <pre className="set-prompt-body">{solution.code.text}</pre>
            </div>
          )}
          <div className="set-run-answer">
            <h4>Ответ</h4>
            <p>{solution.answer || '-'}</p>
          </div>
          {solution.hasDiagram && <p className="set-note">В решении есть чертёж. В проверке он не рисуется - только текст.</p>}
          {solution.issues.length > 0 && (
            <div className="set-run-block">
              <h4>Проверка кодом нашла</h4>
              <ul>{solution.issues.map((line) => <li key={line}>{line}</li>)}</ul>
              {solution.reviewPassed && <p className="set-note">Замечания исправлены повтором - решение вышло после починки.</p>}
            </div>
          )}
        </>
      )}
    </article>
  )
}

function PreviewResult({ result, active }: { result: PreviewView; active: { body: string; version: number } | null }) {
  const ordered = [...result.runs].sort((a, b) => (a.variant === b.variant ? 0 : a.variant === 'current' ? -1 : 1))
  // Разницу промптов показываем, только пока активна та же версия, что при прогоне.
  const sameBase = (active?.version ?? null) === result.currentVersion
  const diff = useMemo(
    () => (sameBase && result.prompt ? lineDiff(active?.body ?? '', result.prompt) : []),
    [sameBase, active, result.prompt],
  )
  const changed = diff.some((line) => line.type !== 'same')
  const status = statusLabels[result.status] ?? statusLabels.done
  return (
    <section className="set-preview-result" aria-label="Результат проверки">
      <div className="set-preview-meta">
        <Badge tone={status.tone}>{status.label}</Badge>
        <span>
          {[formatDateTime(result.createdAt), result.grade, result.actorEmail, result.credits !== null ? `${creditsText(result.credits)} ≈ ${rublesOf(result.credits)}` : null]
            .filter(Boolean).join(' · ')}
        </span>
      </div>
      <details className="set-preview-details">
        <summary>Пример задачи</summary>
        <p className="set-preview-condition">{result.condition}</p>
      </details>
      {result.runs.length === 0 && (
        <p className="set-form-error">{result.error ?? 'Прогон не вернул решения.'}</p>
      )}
      {ordered.length > 0 && (
        <div className={`set-compare${ordered.length > 1 ? ' is-two' : ''}`}>
          {ordered.map((run) => <RunColumn key={run.variant} run={run} />)}
        </div>
      )}
      {ordered.length === 1 && <p className="set-note">Сравнения нет: прогон был один, с текстом из редактора.</p>}
      {changed && (
        <details className="set-preview-details">
          <summary>Что поменялось в промпте против {active ? `версии ${active.version}` : 'пустого промпта'}</summary>
          <DiffView lines={diff} />
        </details>
      )}
    </section>
  )
}

export function PromptPreview({ subject, draft, active, onFinished }: {
  subject: string
  draft: string
  active: { body: string; version: number } | null
  /* Прогон кончился (или потерялся): запуск уже в журнале, историю пора обновить. */
  onFinished?: () => void
}) {
  const { access } = useAdmin()
  const toast = useToast()
  const subjectName = findSubjectById(subject)?.name ?? subject
  const [grade, setGrade] = useState<string>('8 класс')
  const [condition, setCondition] = useState('')
  const [compareWanted, setCompareWanted] = useState(Boolean(active))
  const [phase, setPhase] = useState<'idle' | 'confirm' | 'running' | 'waiting'>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<PreviewView | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [version, setVersion] = useState(0)
  const pending = useRef<{ startedAt: number; prompt: string; condition: string; known: Set<string> } | null>(null)
  const onFinishedRef = useRef(onFinished)
  onFinishedRef.current = onFinished

  // version растёт ровно тогда, когда прогон закончился, потерялся или
  // перешёл к ожиданию: запуск уже в журнале, историю пора перечитать.
  useEffect(() => {
    if (version > 0) onFinishedRef.current?.()
  }, [version])

  const quotaState = useAsync(() => adminRpc('admin_prompt_preview_quota', { p_subject_name: subjectName }), [subjectName, version])
  const recentState = useAsync(() => adminRpc('admin_prompt_previews', { p_subject_id: subject, p_limit: 5 }), [subject, version])
  const quota = useMemo(() => parseQuota(quotaState.data), [quotaState.data])
  const recent = useMemo(() => rows(recentState.data).map(parseStored), [recentState.data])

  const prompt = draft.trim()
  const task = condition.trim()
  const sameAsActive = active !== null && prompt === active.body.trim()
  const compare = compareWanted && !sameAsActive
  const runs = compare ? 2 : 1
  const estimate = quota?.perRun !== null && quota?.perRun !== undefined ? quota.perRun * runs : null
  const hourLeft = quota ? Math.max(0, quota.hourLimit - quota.hourUsed) : null
  const dayLeft = quota ? Math.max(0, quota.dayLimit - quota.dayUsed) : null
  const busy = phase === 'running' || phase === 'waiting'

  const inputProblem = !prompt
    ? 'Впиши текст промпта в редактор выше: проверяется он, а не сохранённая версия.'
    : prompt.length > promptMax
      ? `Промпт - не длиннее ${formatNumber(promptMax)} символов.`
      : task.length < 15
        ? 'Пример задачи - хотя бы одно предложение, от 15 символов.'
        : task.length > maxConditionLength ? `Пример задачи - не длиннее ${formatNumber(maxConditionLength)} символов.` : ''
  const limitProblem = !quota
    ? ''
    : quota.running && !busy
      ? 'Предыдущая проверка ещё идёт. Дождись её результата.'
      : hourLeft !== null && hourLeft < runs
        ? `Предел: ${quota.hourLimit} прогонов в час на администратора. Сравнение считается за два.`
        : dayLeft !== null && dayLeft < runs ? `Предел: ${quota.dayLimit} прогонов в сутки на всех администраторов.` : ''
  const blocked = Boolean(inputProblem || limitProblem) || busy

  const runLabel = estimate !== null ? `Проверить (стоит ~${creditsText(estimate)})` : 'Проверить (цена неизвестна)'

  // Ответ функции мог не дойти: прокси обрывает связь на 150 секундах, а
  // прогон идёт дальше и пишется в базу. Ищем свою новую проверку там.
  const findMine = async (): Promise<PreviewView | null> => {
    const sent = pending.current
    if (!sent) return null
    const list = rows(await adminRpc('admin_prompt_previews', { p_subject_id: subject, p_limit: 5 })).map(parseStored)
    return list.find((item) => !sent.known.has(item.id)
      && item.actorEmail === access.email
      && item.prompt === sent.prompt
      && item.condition === sent.condition) ?? null
  }
  const findMineRef = useRef(findMine)
  findMineRef.current = findMine

  useEffect(() => {
    if (!busy) return undefined
    const started = pending.current?.startedAt ?? Date.now()
    const tick = () => setElapsed(Math.round((Date.now() - started) / 1000))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [busy])

  useEffect(() => {
    if (phase !== 'waiting') return undefined
    let cancelled = false
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const found = await findMineRef.current()
          if (cancelled) return
          const started = pending.current?.startedAt ?? Date.now()
          if (found && (found.status === 'done' || found.status === 'failed')) {
            setResult(found)
            setPhase('idle')
            setVersion((current) => current + 1)
          } else if ((found && found.status === 'lost') || Date.now() - started > lostAfterMs) {
            setError('Проверка не вернулась: функцию на сервере остановили по сроку. За вызов модели, скорее всего, уже заплачено, и он учтён в пределе.')
            setPhase('idle')
            setVersion((current) => current + 1)
          }
        } catch {
          // Сеть моргнула - попробуем на следующем круге.
        }
      })()
    }, pollEveryMs)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [phase])

  const run = async () => {
    const known = new Set(recent.map((item) => item.id))
    if (result) known.add(result.id)
    pending.current = { startedAt: Date.now(), prompt, condition: task, known }
    setPhase('running')
    setError('')
    setResult(null)
    try {
      const response = await adminAction<Row>('prompt_preview', { subjectId: subject, grade, prompt, condition: task, compare })
      const fresh: PreviewView = {
        id: str(response.id),
        createdAt: new Date().toISOString(),
        actorEmail: access.email,
        prompt,
        condition: task,
        grade,
        status: rows(response.runs).some((item) => bool(item.ok)) ? 'done' : 'failed',
        error: null,
        credits: numOrNull(response.credits),
        kopecks: numOrNull(response.kopecks),
        seconds: numOrNull(response.seconds),
        currentVersion: active?.version ?? null,
        runs: rows(response.runs).map(parseRun),
      }
      setResult(fresh)
      setPhase('idle')
      toast.success('Проверка готова.')
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Проверка не выполнилась.'
      let found: PreviewView | null = null
      try {
        found = await findMine()
      } catch {
        found = null
      }
      if (found?.status === 'running') {
        setPhase('waiting')
      } else if (found && (found.status === 'done' || found.status === 'failed')) {
        setResult(found)
        setPhase('idle')
      } else {
        setError(message)
        setPhase('idle')
      }
    } finally {
      setVersion((current) => current + 1)
    }
  }

  const basisText = !quota || quota.basis === null
    ? ''
    : quota.basis === 'subject'
      ? `среднее по предмету за 30 дней, решений в учёте: ${formatNumber(quota.samples)}${quota.maxCredits !== null ? `, самое дорогое - ${creditsText(quota.maxCredits)}` : ''}`
      : 'среднее по всем предметам за 30 дней: по этому предмету решений в учёте нет'

  return (
    <Panel
      title="Проверка на примере задачи"
      description="Модель решает пример с текстом из редактора, как решила бы задачу ученика. Ученику ничего не записывается, с кошелька ничего не списывается, в базу решений прогон не попадает."
    >
      <form className="set-form" onSubmit={(event) => { event.preventDefault(); if (!blocked) setPhase('confirm') }}>
        <Field label="Пример задачи" hint={`${formatNumber(task.length)} из ${formatNumber(maxConditionLength)} символов. Условие целиком, как его прислал бы ученик.`}>
          <textarea value={condition} maxLength={maxConditionLength} onChange={(event) => setCondition(event.target.value)} disabled={busy} />
        </Field>
        <div className="set-preview-bar">
          <p className="set-preview-subject">Предмет: <strong>{subjectName}</strong> <span>(меняется выбором выше)</span></p>
          <Field label="Класс" className="set-preview-grade">
            <select value={grade} onChange={(event) => setGrade(event.target.value)} disabled={busy}>
              {solvableGrades.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </Field>
        </div>
        <label className={`set-check${sameAsActive ? ' is-disabled' : ''}`}>
          <input type="checkbox" checked={compare} disabled={sameAsActive || busy} onChange={(event) => setCompareWanted(event.target.checked)} />
          <span>
            {active ? `Сравнить с активной версией ${active.version}` : 'Сравнить с решением без промпта'} - второй прогон, стоит вдвое
          </span>
        </label>
        {sameAsActive && <p className="set-note">Текст в редакторе совпадает с активной версией - сравнивать не с чем.</p>}
        {quota && (
          <p className="set-note">
            Осталось прогонов: {formatNumber(hourLeft ?? 0)} из {quota.hourLimit} в этот час у тебя, {formatNumber(dayLeft ?? 0)} из {quota.dayLimit} за сутки на всех.
            {quota.spent30d > 0 ? ` За 30 дней проверки обошлись в ${creditsText(quota.spent30d)} ≈ ${rublesOf(quota.spent30d)}.` : ''}
          </p>
        )}
        {quotaState.error && <p className="set-note is-warning">Предел и цену прочитать не удалось: {quotaState.error} База всё равно проверит предел при запуске.</p>}
        {limitProblem && <p className="set-form-error" role="alert">{limitProblem}</p>}
        {!limitProblem && inputProblem && (task.length > 0 || !prompt) && <p className="set-form-error">{inputProblem}</p>}
        <div className="adm-form-actions">
          <Button type="submit" variant="primary" disabled={blocked} loading={busy} icon={<Flask size={16} weight="bold" aria-hidden="true" />}>{runLabel}</Button>
        </div>
      </form>

      {busy && (
        <div className="set-preview-progress" role="status">
          <CircleNotch className="adm-spin" size={18} weight="bold" aria-hidden="true" />
          <span>
            {phase === 'waiting'
              ? `Связь с сервером оборвалась, а прогон идёт дальше. Ждём результат из базы: ${formatNumber(elapsed)} с.`
              : `Модель решает пример: ${formatNumber(elapsed)} с. Обычно 30-60 секунд, предел - 230 секунд на прогон.`}
          </span>
        </div>
      )}
      {error && <div className="set-preview-error"><ErrorState message={error} /></div>}
      {result && <PreviewResult result={result} active={active} />}

      {recent.length > 0 && (
        <details className="set-preview-details set-preview-recent">
          <summary>Прошлые проверки по предмету: {recent.length}</summary>
          <ul className="set-recent-list">
            {recent.map((item) => {
              const status = statusLabels[item.status] ?? statusLabels.done
              return (
                <li key={item.id}>
                  <span className="set-recent-main">
                    <Badge tone={status.tone}>{status.label}</Badge>
                    <span>{[formatDateTime(item.createdAt), item.actorEmail, item.grade, item.credits !== null ? creditsText(item.credits) : null].filter(Boolean).join(' · ')}</span>
                  </span>
                  {item.runs.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setResult(item)} aria-pressed={result?.id === item.id}>Показать</Button>
                  )}
                </li>
              )
            })}
          </ul>
        </details>
      )}

      {phase === 'confirm' && (
        <Modal
          open
          title="Запустить проверку промпта?"
          onClose={() => setPhase('idle')}
          footer={(
            <>
              <Button onClick={() => setPhase('idle')}>Отмена</Button>
              <Button variant="primary" icon={<Flask size={16} weight="bold" aria-hidden="true" />} onClick={() => void run()}>
                {estimate !== null ? `Проверить за ~${creditsText(estimate)}` : 'Проверить'}
              </Button>
            </>
          )}
        >
          <div className="set-confirm">
            <p>
              Модель решит пример по предмету «{subjectName}», {grade.toLocaleLowerCase('ru-RU')},{' '}
              {compare ? `дважды: с текстом из редактора и с ${active ? `активной версией ${active.version}` : 'правилами без промпта'}` : 'один раз, с текстом из редактора'}.
            </p>
            <ul className="set-confirm-list">
              <li>Ученику ничего не записывается, с кошелька ничего не списывается, в базу решений и очередь прогон не попадает.</li>
              <li>
                {estimate !== null
                  ? `Стоит нам около ${creditsText(estimate)} ≈ ${rublesOf(estimate)}: ${basisText}.`
                  : 'Сколько стоит прогон, неизвестно: в учёте нет решений за 30 дней.'}
              </li>
              <li>Ждать обычно 30-60 секунд, предел - 230 секунд на прогон.</li>
              {quota && hourLeft !== null && dayLeft !== null && (
                <li>После запуска останется прогонов: {formatNumber(Math.max(0, hourLeft - runs))} из {quota.hourLimit} в этот час и {formatNumber(Math.max(0, dayLeft - runs))} из {quota.dayLimit} за сутки на всех.</li>
              )}
              <li>Запуск попадёт в журнал действий.</li>
            </ul>
          </div>
        </Modal>
      )}
    </Panel>
  )
}
