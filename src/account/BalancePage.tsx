import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowRight, CheckCircle, CopySimple, Gift, Lifebuoy, LinkSimple, UsersThree, WarningCircle } from '@phosphor-icons/react'
import type { AccountData } from '../lib/supabase'
import { supabase } from '../lib/supabase'
import type { WalletEntry } from '../lib/database.types'
import { formatRubles } from '../lib/currency'
import { minimumSolutionPriceKopecks } from '../lib/solutionPricing'
import { createPayment, loadPaymentConfig } from '../lib/payments'
import type { PaymentConfig } from '../lib/payments'
import { parseTopUpRubles, topUpRangeLabel } from '../lib/topUpLimits'
import { loadReferralStatus } from '../lib/referrals'
import type { ReferralStatus } from '../lib/referrals'
import { AccountGuest, AccountPageHeader } from './AccountPageHeader'
import type { AccountPageName } from './AccountPageHeader'
import './AccountPages.css'

/* Баланс - страница по порядку важности.

   Разбор 14 сентября 2026: кошелёк был больше профиля, на компьютере не
   помещался в экран, на телефоне его листали долго. Первым шёл кобальтовый
   баннер суммы, за ним блок «Тариф „Базовый“» со строками про решение за
   4 ₽, ИИ-чат, расписание и «до 60 решений в сутки» - а тарифов и подписки
   у продукта нет. Теперь: сумма и цена, пополнение (когда оно включено),
   промокод, приглашение, последние операции. Дневные пределы решателя
   остались на сервере - это защита от злоупотреблений, а не тариф, и
   показывать их ученику незачем. */

/* Столько операций грузит `loadAccountData` (src/lib/supabase.ts): их видно
   сразу, остальное - по кнопке, страницами. */
const recentEntriesLimit = 5
const historyPageSize = 20

type BalancePageProps = {
  user: User | null
  account: AccountData | null
  notice?: string
  /** Флаг `promo_codes` из админки: выключен - блока промокода нет. */
  promoEnabled: boolean
  onReloadAccount: () => Promise<void>
  onNavigate: (page: AccountPageName) => void
  onSignIn: () => void
  /** Есть, когда сообщение над балансом ведёт обратно к задачам: пополнение
      прошло или решению не хватило денег. Черновик формы ждёт на `/app`. */
  onBackToTasks?: () => void
  onOpenSupport?: () => void
}

function promoErrorMessage(message: string) {
  if (message.includes('promo code not found')) return 'Такого промокода нет'
  if (message.includes('promo code expired')) return 'Срок промокода истёк'
  if (message.includes('promo code not started')) return 'Промокод ещё не начал действовать'
  if (message.includes('promo code already used')) return 'Этот промокод уже использован на твоём аккаунте'
  if (message.includes('promo code exhausted')) return 'Промокод закончился'
  if (message.includes('promo code for new accounts only')) return 'Промокод только для новых аккаунтов'
  if (message.includes('promo attempts exceeded')) return 'Слишком много попыток. Попробуй через час'
  if (message.includes('account is blocked')) return 'Аккаунт заблокирован'
  return 'Не получилось применить промокод'
}

/* Пополнение через Робокассу. Карточки нет, пока оплата не подключена на
   сервере: форма, которая ведёт в никуда, - обещание, которого нет в коде.
   В тестовом режиме её видят только служебные аккаунты, это решает сервер.
   Сумму проверяют и форма, и сервер, и база - из браузера её не навязать. */
function TopUpCard({ config }: { config: PaymentConfig }) {
  const [amount, setAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sending) return
    const parsed = parseTopUpRubles(amount)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setSending(true)
    setError('')
    try {
      const payment = await createPayment(parsed.kopecks)
      window.location.assign(payment.url)
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : 'Не получилось перейти к оплате')
      setSending(false)
    }
  }

  return (
    <section className="account-card account-top-up" aria-labelledby="account-top-up-title">
      <header>
        <h2 id="account-top-up-title">Пополнить баланс</h2>
        <span>{topUpRangeLabel()}</span>
      </header>
      <form className="account-inline-form" onSubmit={submit} noValidate>
        <label className="sr-only" htmlFor="account-top-up-amount">Сумма пополнения в рублях</label>
        <input
          id="account-top-up-amount"
          className="is-amount"
          value={amount}
          onChange={(event) => { setAmount(event.target.value.slice(0, 12)); setError('') }}
          inputMode="numeric"
          placeholder="Сумма, ₽"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
        />
        <button className="is-primary" type="submit" disabled={sending}>{sending ? 'Переходим…' : 'Перейти к оплате'}</button>
      </form>
      {error && <p className="account-inline-error" role="alert"><WarningCircle size={18} weight="fill" aria-hidden="true" />{error}</p>}
      <p className="account-card-note">Оплата проходит на странице Робокассы. Деньги придут на баланс, как только она подтвердит платёж.</p>
      {config.testMode && <p className="account-card-note">Тестовый режим: деньги не списываются, форму видят только служебные аккаунты.</p>}
    </section>
  )
}

/* Ссылка из админки `/balance?promo=КОД` (14 сентября 2026) приносит код
   уже вписанным: остаётся нажать «Применить». Параметр потом уходит из
   адреса, как `?subject=` на главной, - перезагрузка код не навязывает. */
function promoFromAddress() {
  return (new URLSearchParams(window.location.search).get('promo') ?? '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32)
}

/* Промокод - отдельный блок, а не приписка к тарифу: тариф и промокод -
   разные вещи. Промокод начисляет деньги или, если так его завела админка,
   подключает тариф на срок. Текст успеха говорит, что именно произошло. */
function PromoCard({ onReloadAccount }: { onReloadAccount: () => Promise<void> }) {
  const [code, setCode] = useState(promoFromAddress)
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('promo')) return
    url.searchParams.delete('promo')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  const redeem = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || sending || !code.trim()) return
    setSending(true)
    setMessage('')
    setError('')
    const { data, error: redeemError } = await supabase.rpc('redeem_promo_code', { p_code: code.trim() })
    setSending(false)
    const result = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
    /* С 15 сентября 2026 (миграция 20260915130000) база отвечает на неверный
       код строкой `{ ok: false, error }`, а не ошибкой: ошибка откатывала
       запись о попытке, и лимит «10 попыток в час» не работал вовсе. Ответ
       ошибкой тоже понимаем: сайт выкатывается раньше миграции. */
    if (redeemError || result.ok === false) {
      setError(promoErrorMessage(redeemError?.message ?? String(result.error ?? '')))
      return
    }
    setCode('')
    setMessage(result.kind === 'plan'
      ? `Подключён тариф «${String(result.planTitle ?? '')}» на ${String(result.planDays ?? '')} дн.`
      : `Начислено ${formatRubles(Number(result.amount ?? 0))}`)
    await onReloadAccount()
  }

  return (
    <section className="account-card account-promo" aria-labelledby="account-promo-title">
      <h2 id="account-promo-title">Промокод</h2>
      <form className="account-inline-form" onSubmit={redeem}>
        <label className="sr-only" htmlFor="account-promo-code">Промокод</label>
        <input
          id="account-promo-code"
          className="is-code"
          value={code}
          onChange={(event) => { setCode(event.target.value.slice(0, 32)); setError('') }}
          placeholder="Код"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'account-promo-error' : undefined}
        />
        <button type="submit" disabled={sending || !code.trim()}>{sending ? 'Применяем…' : 'Применить'}</button>
      </form>
      {/* Ошибка промокода - цветом ошибки и полужирным: 14 сентября
          приглушённое «Такого промокода нет» владелец просто не заметил. */}
      {error && <p id="account-promo-error" className="account-inline-error" role="alert"><WarningCircle size={18} weight="fill" aria-hidden="true" />{error}</p>}
      {message && <p className="account-inline-success" role="status"><CheckCircle size={18} weight="fill" aria-hidden="true" />{message}</p>}
    </section>
  )
}

function ReferralCard() {
  const [referral, setReferral] = useState<ReferralStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const load = async () => {
    if (!supabase) {
      setLoading(false)
      setError('Реферальная ссылка временно недоступна')
      return
    }
    setLoading(true)
    setError('')
    try {
      setReferral(await loadReferralStatus(supabase))
    } catch {
      setError('Не получилось загрузить реферальную ссылку')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const referralLink = referral
    ? `${window.location.origin}/?ref=${encodeURIComponent(referral.code)}`
    : ''

  const copyLink = async () => {
    if (!referralLink) return
    try {
      await navigator.clipboard.writeText(referralLink)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setError('Не получилось скопировать ссылку')
    }
  }

  return (
    <section className="account-card account-referral-card" aria-labelledby="account-referral-title">
      <header>
        <Gift size={24} weight="duotone" aria-hidden="true" />
        <div>
          <h2 id="account-referral-title">Пригласи друга</h2>
          <p>Как только он зарегистрируется по твоей ссылке и подтвердит почту или номер телефона, тебе начислят <strong>+10 ₽</strong>, а ему — <strong>+5 ₽</strong>. Пополнять ничего не нужно.</p>
        </div>
      </header>

      {loading && <p className="account-referral-state" role="status">Создаём личную ссылку…</p>}
      {!loading && error && <div className="account-referral-state is-error" role="alert"><span>{error}</span><button type="button" onClick={() => { void load() }}>Повторить</button></div>}
      {!loading && referral && (
        <>
          <div className="account-referral-link">
            <LinkSimple size={18} weight="bold" aria-hidden="true" />
            <input aria-label="Личная реферальная ссылка" value={referralLink} readOnly onFocus={(event) => event.currentTarget.select()} />
            <button type="button" onClick={() => { void copyLink() }}><CopySimple size={18} weight="bold" aria-hidden="true" />{copied ? 'Скопировано' : 'Копировать'}</button>
          </div>
          <div className="account-referral-stats" aria-label="Статистика приглашений">
            <span><UsersThree size={18} weight="duotone" aria-hidden="true" /><b>{referral.invitedCount}</b> приглашено</span>
            <span><Gift size={18} weight="duotone" aria-hidden="true" /><b>{formatRubles(referral.earnedAmount)}</b> начислено</span>
          </div>
          {referral.joinedViaReferral && (
            <p className="account-referral-joined">
              {referral.joinedRewardStatus === 'rewarded'
                ? 'Твои +5 ₽ по приглашению уже начислены.'
                : 'Ты зарегистрирован по приглашению: +5 ₽ придут, как только подтвердишь почту или номер телефона.'}
            </p>
          )}
          <small>Засчитывается только новый аккаунт, зарегистрированный по этой ссылке. Один аккаунт можно привязать один раз; повторных начислений нет.</small>
        </>
      )}
    </section>
  )
}

const entryDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })

/* Последние операции видны сразу, остальные - по кнопке. Новая операция
   меняет первую строку, и приложение перемонтирует список по её ключу:
   догруженная раньше история устарела бы. */
function WalletHistory({ userId, entries }: { userId: string; entries: readonly WalletEntry[] }) {
  const [loaded, setLoaded] = useState<WalletEntry[] | null>(null)
  const [hasMore, setHasMore] = useState(entries.length >= recentEntriesLimit)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const shown = loaded ?? entries

  const loadMore = async () => {
    if (!supabase || loading) return
    setLoading(true)
    setError('')
    const from = loaded ? loaded.length : 0
    const { data, error: loadError } = await supabase
      .from('wallet_entries')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(from, from + historyPageSize - 1)
    setLoading(false)
    if (loadError) {
      setError('Не получилось загрузить операции. Попробуй ещё раз')
      return
    }
    const page = data ?? []
    setLoaded((current) => [...(current ?? []), ...page])
    setHasMore(page.length === historyPageSize)
  }

  return (
    <section className="account-card account-wallet-history" aria-labelledby="wallet-history-title">
      <h2 id="wallet-history-title">История операций</h2>
      {shown.length > 0 ? (
        <ul>
          {shown.map((entry) => (
            <li className="account-wallet-entry" key={entry.id}>
              <span className={entry.amount > 0 ? 'is-credit' : 'is-debit'}>{entry.amount > 0 ? '+' : ''}{formatRubles(entry.amount)}</span>
              <strong>{entry.description}</strong>
              <time dateTime={entry.created_at}>{entryDate.format(new Date(entry.created_at))}</time>
            </li>
          ))}
        </ul>
      ) : <p className="account-card-note">Операций пока нет.</p>}
      {error && <p className="account-inline-error" role="alert"><WarningCircle size={18} weight="fill" aria-hidden="true" />{error}</p>}
      {hasMore && (
        <button className="account-quiet-button" type="button" onClick={() => { void loadMore() }} disabled={loading}>
          {loading ? 'Загружаем…' : 'Показать ещё'}
        </button>
      )}
    </section>
  )
}

function BalanceContent({ user, account, notice, promoEnabled, onReloadAccount, onNavigate, onBackToTasks, onOpenSupport }: Omit<BalancePageProps, 'user' | 'onSignIn'> & { user: User }) {
  const [paymentConfig, setPaymentConfig] = useState<PaymentConfig | null>(null)
  const [paymentConfigLoaded, setPaymentConfigLoaded] = useState(false)

  useEffect(() => {
    if (!supabase) return
    let active = true
    loadPaymentConfig()
      .then((next) => { if (active) setPaymentConfig(next) })
      .catch(() => undefined)
      .finally(() => { if (active) setPaymentConfigLoaded(true) })
    return () => { active = false }
  }, [])

  const topUpEnabled = Boolean(paymentConfig?.enabled)
  const entries = account?.entries ?? []

  return (
    <section className="route-page account-page" aria-labelledby="account-page-title">
      <AccountPageHeader user={user} account={account} current="balance" onNavigate={onNavigate} />

      {/* Аудит 16 сентября, Г2: после «Баланс пополнен» и после нехватки денег
          человек дальше идёт к задачам, а путь туда был только через «Главная». */}
      {notice && !onBackToTasks && <p className="account-page-notice" role="status">{notice}</p>}
      {notice && onBackToTasks && (
        <div className="account-page-notice has-action">
          <p role="status">{notice}</p>
          <button className="account-quiet-button" type="button" onClick={onBackToTasks}>
            Вернуться к задачам
            <ArrowRight size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>
      )}

      <div className={`account-balance-grid${topUpEnabled ? ' has-top-up' : ''}${promoEnabled ? ' has-promo' : ''}`}>
        <section className="account-balance-card" aria-labelledby="account-balance-title">
          <h2 id="account-balance-title">Доступно сейчас</h2>
          <strong className="account-balance-amount">{account ? formatRubles(account.balance) : '…'}</strong>
          {/* Цена перестала быть плоской: короткая задача текстом стоит
              четыре рубля, длинная с фотографией по счётному предмету -
              дороже. Обещать здесь одно число нельзя, поэтому пишем пол
              цены и то, от чего она зависит. Точная сумма стоит в форме
              до нажатия «Решить». */}
          <p className="account-balance-rate"><strong>от {formatRubles(minimumSolutionPriceKopecks)}</strong> <span>за решение, точная цена зависит от задачи</span></p>
          {/* Сюда ведут и кнопка баланса в шапке, и нехватка денег перед
              решением. Без строки человек искал бы, где пополнить. */}
          {/* Аудит 16 сентября, Г3: заглушка была тупиком - без объяснения и без
              выхода. Срок не называем: его нет в коде, есть только то, что
              оплату подключаем. */}
          {paymentConfigLoaded && !topUpEnabled && (
            <>
              <p className="account-card-note">
                Пополнение пока недоступно: подключаем оплату картой, скоро заработает. {promoEnabled ? 'Рубли приходят по промокоду и за приглашённого друга.' : 'Рубли приходят за приглашённого друга.'}
              </p>
              {onOpenSupport && (
                <button className="account-quiet-button" type="button" onClick={onOpenSupport}>
                  <Lifebuoy size={17} weight="duotone" aria-hidden="true" />
                  Написать в поддержку
                </button>
              )}
            </>
          )}
        </section>

        {topUpEnabled && paymentConfig && <TopUpCard config={paymentConfig} />}
        {promoEnabled && <PromoCard onReloadAccount={onReloadAccount} />}
        <ReferralCard />
        <WalletHistory key={entries[0]?.id ?? 'empty'} userId={user.id} entries={entries} />
      </div>

      <nav className="account-page-links account-balance-links" aria-label="Оплата и документы">
        <a href="/docs/offer">Публичная оферта</a>
        <a href="/docs/terms#section-8">Оплата и возвраты</a>
        <a href="/support#faq">Как это работает</a>
        <a href="/docs/contacts">Реквизиты</a>
      </nav>
    </section>
  )
}

export default function BalancePage(props: BalancePageProps) {
  if (!props.user) return <AccountGuest page="balance" onSignIn={props.onSignIn} />
  return <BalanceContent {...props} user={props.user} />
}
