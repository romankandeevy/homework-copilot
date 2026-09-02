import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent, RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { User } from '@supabase/supabase-js'
import {
  ArrowRight,
  CaretDown,
  Check,
  CheckCircle,
  ClockCountdown,
  CopySimple,
  EnvelopeSimple,
  Eye,
  EyeSlash,
  Gift,
  GoogleLogo,
  LinkSimple,
  LockKey,
  Moon,
  ShieldCheck,
  SignOut,
  Trash,
  Sun,
  UserCircle,
  UsersThree,
  X,
} from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { AccountData } from '../lib/supabase'
import { supabase } from '../lib/supabase'
import { applicationPath } from '../lib/appPath'
import { formatRubles } from '../lib/currency'
import { solutionPriceKopecks } from '../lib/solutionPricing'
import { deleteMyAccount } from '../lib/accountDeletion'
import { forgetPendingLegalAcceptance, rememberPendingLegalAcceptance } from '../lib/legalConsent'
import { loadReferralStatus, preparePendingReferralClaim } from '../lib/referrals'
import type { ReferralStatus } from '../lib/referrals'
import { useModalIsolation } from '../lib/useModalIsolation'
import PasswordStrength from './PasswordStrength'
import { isStrongPassword } from './passwordStrengthRules'
import './AccountDialog.css'

type AuthScreen = 'sign-in' | 'sign-up' | 'forgot' | 'reset' | 'verify-email'
type VerificationKind = 'signup' | 'google'
type AccountView = 'profile' | 'wallet'
type Theme = 'light' | 'dark'

const emailResendDelay = 60
const emailCodeLifetime = 5 * 60
const verificationEmailKey = 'homework-copilot:verification-email'
const verificationKindKey = 'homework-copilot:verification-kind'
const verificationSentAtKey = 'homework-copilot:verification-sent-at'

/* Возврат авторизации ведёт в приложение, а не на витрину.

   На `/` живёт витрина: клиента Supabase она не создаёт и обработчиков
   подтверждения не имеет. Пока ссылки вели туда, кнопка из письма, вход
   через Google и смена пароля обрывались на полпути. */
function authReturnUrl(marker: string) {
  return `${window.location.origin}${applicationPath('/app')}?auth=${marker}`
}

function verificationRedirectUrl() {
  return authReturnUrl('verified')
}

function readPendingVerification(): { email: string; kind: VerificationKind } | null {
  const email = sessionStorage.getItem(verificationEmailKey)?.trim() ?? ''
  const kind = sessionStorage.getItem(verificationKindKey)
  if (!email || (kind !== 'signup' && kind !== 'google')) return null
  return { email, kind }
}

function rememberVerification(email: string, kind: VerificationKind) {
  const sentAt = Date.now()
  sessionStorage.setItem(verificationEmailKey, email)
  sessionStorage.setItem(verificationKindKey, kind)
  sessionStorage.setItem(verificationSentAtKey, String(sentAt))
  return sentAt
}

function clearPendingVerification() {
  sessionStorage.removeItem(verificationEmailKey)
  sessionStorage.removeItem(verificationKindKey)
  sessionStorage.removeItem(verificationSentAtKey)
}

function verificationSecondsLeft(sentAt: number, lifetime: number, now: number) {
  if (!sentAt) return 0
  return Math.max(0, lifetime - Math.floor((now - sentAt) / 1000))
}

function formatCountdown(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

type AccountDialogProps = {
  user: User | null
  account: AccountData | null
  passwordRecovery: boolean
  pendingVerificationEmail?: string
  notice?: string
  initialView: AccountView
  theme: Theme
  onToggleTheme: () => void
  onClose: () => void
  onReloadAccount: () => Promise<void>
  returnFocusRef?: RefObject<HTMLElement | null>
}

function authErrorMessage(message: string) {
  const normalized = message.toLocaleLowerCase('en')
  if (normalized.includes('invalid login credentials')) return 'Неверная почта или пароль'
  if (normalized.includes('user already registered')) return 'Аккаунт с этой почтой уже существует'
  if (normalized.includes('password') && normalized.includes('characters')) return 'Пароль должен содержать минимум 8 символов'
  if (normalized.includes('email rate limit')) return 'Слишком много писем. Попробуй немного позже'
  if (normalized.includes('email not confirmed')) return 'Сначала подтверди почту кодом из письма'
  if (normalized.includes('token') || normalized.includes('otp')) return 'Код неверный или уже истёк'
  if (normalized.includes('referral claim unavailable')) return 'Не получилось закрепить приглашение. Повтори попытку'
  return 'Не получилось выполнить запрос. Проверь данные и попробуй ещё раз'
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

const consentErrorMessage = 'Прими соглашение, согласие на обработку данных и подтверди возраст'

const gradeOptions = Array.from({ length: 11 }, (_, index) => index + 1)

function GradeSelect({ value, onChange, compact = false }: { value: string; onChange: (value: string) => void; compact?: boolean }) {
  const listboxId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(Number(value))

  useEffect(() => {
    if (!open) return

    const dismiss = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  useEffect(() => {
    if (!open) return
    containerRef.current?.querySelector<HTMLElement>(`[data-grade="${highlighted}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [highlighted, open])

  const choose = (grade: number) => {
    onChange(String(grade))
    setHighlighted(grade)
    setOpen(false)
    triggerRef.current?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }

    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      if (!open) {
        setHighlighted(Number(value))
        setOpen(true)
        return
      }

      setHighlighted((current) => {
        if (event.key === 'Home') return 1
        if (event.key === 'End') return gradeOptions.length
        return Math.min(gradeOptions.length, Math.max(1, current + (event.key === 'ArrowDown' ? 1 : -1)))
      })
      return
    }

    if (event.key === 'Enter' && open && event.target === triggerRef.current) {
      event.preventDefault()
      choose(highlighted)
    }
  }

  return (
    <div
      className="account-grade-select"
      ref={containerRef}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        ref={triggerRef}
        className="account-grade-trigger"
        type="button"
        role="combobox"
        aria-label="Класс"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? `${listboxId}-${highlighted}` : undefined}
        onClick={() => {
          setHighlighted(Number(value))
          setOpen((current) => !current)
        }}
      >
        <span>{value ? (compact ? value : `${value} класс`) : 'Выбери'}</span>
        <CaretDown size={15} weight="bold" aria-hidden="true" />
      </button>

      {open && (
        <div id={listboxId} className="account-grade-menu" role="listbox" aria-label="Выбрать класс">
          {gradeOptions.map((grade) => (
            <button
              id={`${listboxId}-${grade}`}
              key={grade}
              data-grade={grade}
              className={`account-grade-option${grade === highlighted ? ' is-highlighted' : ''}`}
              type="button"
              role="option"
              aria-selected={String(grade) === value}
              tabIndex={-1}
              onPointerEnter={() => setHighlighted(grade)}
              onClick={() => choose(grade)}
            >
              <span>{grade} класс</span>
              {String(grade) === value && <Check size={15} weight="bold" aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AuthView({ passwordRecovery, pendingVerificationEmail, notice }: { passwordRecovery: boolean; pendingVerificationEmail?: string; notice?: string }) {
  const viewRef = useRef<HTMLDivElement>(null)
  const [initialVerification] = useState(() => pendingVerificationEmail
    ? { email: pendingVerificationEmail, kind: 'google' as const }
    : readPendingVerification())
  const [screen, setScreen] = useState<AuthScreen>(passwordRecovery ? 'reset' : initialVerification ? 'verify-email' : 'sign-in')
  const [verificationKind, setVerificationKind] = useState<VerificationKind>(initialVerification?.kind ?? 'signup')
  const [fullName, setFullName] = useState('')
  // Класс никто не подставляет за ученика: восьмиклассников среди
  // пользователей не большинство, а подставленный класс уходит в решения.
  const [grade, setGrade] = useState('')
  const [email, setEmail] = useState(initialVerification?.email ?? '')
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [sentAt, setSentAt] = useState(() => initialVerification ? Number(sessionStorage.getItem(verificationSentAtKey) ?? 0) : 0)
  const [now, setNow] = useState(() => Date.now())
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [agreementAccepted, setAgreementAccepted] = useState(false)
  const [personalDataAccepted, setPersonalDataAccepted] = useState(false)
  /* Аудитория сервиса — школьники, и часть из них младше четырнадцати лет:
     самостоятельно принять документы они не могут. Отметка не проверяет
     возраст, но фиксирует, на каком основании документы приняты, — так же,
     как это записано в соглашении и в согласии. */
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const passwordStrengthId = useId()
  const requiresStrongPassword = screen === 'sign-up' || screen === 'reset'
  const passwordIsValid = requiresStrongPassword ? isStrongPassword(password) : password.length >= 8
  const resendIn = verificationSecondsLeft(sentAt, emailResendDelay, now)
  const expiresIn = verificationSecondsLeft(sentAt, emailCodeLifetime, now)

  const formIsValid = screen === 'sign-up'
    ? fullName.trim().length >= 2 && Boolean(grade) && isValidEmail(email) && passwordIsValid && agreementAccepted && personalDataAccepted && ageConfirmed
    : screen === 'sign-in'
      ? isValidEmail(email) && password.length >= 8
      : screen === 'forgot'
        ? isValidEmail(email)
        : passwordIsValid

  useEffect(() => {
    if (passwordRecovery) setScreen('reset')
  }, [passwordRecovery])

  useEffect(() => {
    if (!pendingVerificationEmail) return
    setEmail(pendingVerificationEmail)
    setVerificationKind('google')
    setSentAt(Number(sessionStorage.getItem(verificationSentAtKey) ?? 0))
    setNow(Date.now())
    setScreen('verify-email')
  }, [pendingVerificationEmail])

  useEffect(() => {
    if (screen !== 'verify-email') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [screen])

  const switchScreen = (next: AuthScreen) => {
    if (screen === 'verify-email' && next !== 'verify-email') clearPendingVerification()
    setScreen(next)
    setStatus('')
    setError('')
    setVerificationCode('')
    // Содержимое окна выше самого окна, и после переключения вкладки
    // прокрутка оставалась там же: человек оказывался посреди формы.
    const scroller = viewRef.current?.closest('.account-dialog')
    if (scroller) scroller.scrollTop = 0
  }

  // Причина ушла — уходит и сообщение: иначе ошибка висит над формой,
  // в которой уже всё исправлено.
  useEffect(() => {
    if (!agreementAccepted || !personalDataAccepted || !ageConfirmed) return
    setError((current) => (current === consentErrorMessage ? '' : current))
  }, [ageConfirmed, agreementAccepted, personalDataAccepted])

  const continueWithGoogle = async () => {
    if (loading) return
    // Причина отказа проверяется до всего остального: кнопка больше
    // не гаснет, поэтому объяснение должно приходить всегда.
    if (screen === 'sign-up' && (!agreementAccepted || !personalDataAccepted || !ageConfirmed)) {
      setError(consentErrorMessage)
      return
    }
    if (!supabase) return
    setLoading(true)
    setStatus('')
    setError('')
    if (screen === 'sign-up') {
      rememberPendingLegalAcceptance('google')
      try {
        await preparePendingReferralClaim(supabase)
      } catch (claimError) {
        forgetPendingLegalAcceptance()
        setError(authErrorMessage(claimError instanceof Error ? claimError.message : ''))
        setLoading(false)
        return
      }
    }
    sessionStorage.setItem('homework-copilot:google-auth-pending', '1')
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: authReturnUrl('google-code'),
        queryParams: { prompt: 'select_account' },
      },
    })
    if (oauthError) {
      forgetPendingLegalAcceptance()
      sessionStorage.removeItem('homework-copilot:google-auth-pending')
      setError(authErrorMessage(oauthError.message))
      setLoading(false)
    }
  }

  const resendEmail = async () => {
    if (!supabase || loading || resendIn > 0) return
    setLoading(true)
    setStatus('')
    setError('')
    const normalizedEmail = email.trim()
    const { error: resendError } = verificationKind === 'signup'
      ? await supabase.auth.resend({ type: 'signup', email: normalizedEmail })
      : await supabase.auth.signInWithOtp({
          email: normalizedEmail,
          options: { shouldCreateUser: false, emailRedirectTo: verificationRedirectUrl() },
        })
    if (resendError) setError(authErrorMessage(resendError.message))
    else {
      const nextSentAt = rememberVerification(normalizedEmail, verificationKind)
      setSentAt(nextSentAt)
      setNow(nextSentAt)
      setVerificationCode('')
      setStatus('Новый код отправлен. Предыдущий больше не действует')
    }
    setLoading(false)
  }

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || loading || verificationCode.length !== 6) return
    if (expiresIn <= 0) {
      setError('Код уже истёк. Запроси новый')
      return
    }

    setLoading(true)
    setStatus('')
    setError('')
    const { error: verificationError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: verificationCode,
      type: verificationKind === 'signup' ? 'signup' : 'email',
    })

    if (verificationError) setError(authErrorMessage(verificationError.message))
    else {
      clearPendingVerification()
      setStatus('Почта подтверждена')
      const cleanUrl = new URL(window.location.href)
      cleanUrl.searchParams.delete('auth')
      window.history.replaceState({}, '', `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`)
    }
    setLoading(false)
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || loading) return
    setLoading(true)
    setStatus('')
    setError('')

    try {
      if (screen === 'sign-in') {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (signInError) throw signInError
        return
      }

      if (screen === 'sign-up') {
        if (fullName.trim().length < 2) throw new Error('name')
        if (!isStrongPassword(password)) throw new Error('weak password')
        if (!agreementAccepted || !personalDataAccepted || !ageConfirmed) throw new Error('legal consent')
        rememberPendingLegalAcceptance('email', email)
        const referralClaimToken = await preparePendingReferralClaim(supabase)
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: {
              // Отметку о согласии ставит триггер базы при создании
              // учётной записи: клиентская запись терялась, если почту
              // подтверждали в другом браузере или на телефоне.
              legal_source: 'email',
              full_name: fullName.trim(),
              grade,
              ...(referralClaimToken ? { referral_claim_token: referralClaimToken } : {}),
            },
            emailRedirectTo: verificationRedirectUrl(),
          },
        })
        if (signUpError) throw signUpError
        if (!data.session) {
          setVerificationKind('signup')
          const normalizedEmail = email.trim()
          const nextSentAt = rememberVerification(normalizedEmail, 'signup')
          setEmail(normalizedEmail)
          setSentAt(nextSentAt)
          setNow(nextSentAt)
          setScreen('verify-email')
        }
        return
      }

      if (screen === 'forgot') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: authReturnUrl('reset'),
        })
        if (resetError) throw resetError
        setStatus('Если аккаунт существует, ссылка для смены пароля уже отправлена')
        return
      }

      if (!isStrongPassword(password)) throw new Error('weak password')
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setStatus('Пароль обновлён')
      window.history.replaceState({}, '', window.location.pathname)
      setScreen('sign-in')
      setPassword('')
    } catch (caught) {
      if (screen === 'sign-up') forgetPendingLegalAcceptance()
      const message = caught instanceof Error ? caught.message : ''
      if (message === 'name') setError('Введи имя')
      else if (message === 'weak password') setError('Выполни все требования к паролю')
      else if (message === 'legal consent') setError(consentErrorMessage)
      else setError(authErrorMessage(message))
    } finally {
      setLoading(false)
    }
  }

  const title = screen === 'sign-up'
    ? 'Создай аккаунт'
    : screen === 'forgot'
      ? 'Восстанови доступ'
      : screen === 'reset'
        ? 'Новый пароль'
        : screen === 'verify-email'
          ? 'Введи код'
        : 'Войди в аккаунт'

  const subtitle = screen === 'sign-up'
    ? 'Создай профиль и получи 20 ₽ на первые решения.'
    : screen === 'verify-email'
      ? 'Шесть цифр из письма — и аккаунт готов.'
      : screen === 'forgot'
        ? 'Пришлём безопасную ссылку для нового пароля.'
        : screen === 'reset'
          ? 'Придумай новый надёжный пароль.'
          : 'Продолжи с Google или войди по почте.'

  return (
    <div className="account-auth-view" ref={viewRef}>
      <aside className="account-auth-context" aria-hidden="true">
        <div className="account-auth-wordmark"><span>HC</span><strong>Homework Copilot</strong></div>
        <div className="account-auth-context-copy">
          {screen === 'verify-email' ? <ShieldCheck size={42} weight="duotone" /> : <LockKey size={42} weight="duotone" />}
          <strong>{screen === 'verify-email' ? 'Код остаётся на этом устройстве.' : 'Аккаунт без лишних переходов.'}</strong>
          <p>{screen === 'verify-email' ? 'Открой письмо где угодно, а шесть цифр введи здесь.' : 'Учебники, баланс и готовые решения будут ждать тебя после входа.'}</p>
        </div>
        <div className="account-auth-context-meta">
          <ClockCountdown size={20} weight="duotone" />
          <span>{screen === 'verify-email' ? 'Код действует 5 минут' : 'Подтверждение занимает меньше минуты'}</span>
        </div>
      </aside>

      <section className="account-auth-panel">
        <div className="account-auth-brand">
          <span className="account-auth-mark">{screen === 'verify-email' ? <EnvelopeSimple size={28} weight="duotone" aria-hidden="true" /> : <UserCircle size={28} weight="duotone" aria-hidden="true" />}</span>
          <div>
            <h2 id="account-dialog-title">{title}</h2>
            <p>{subtitle}</p>
          </div>
        </div>

      {(screen === 'sign-in' || screen === 'sign-up') && (
        <div className="account-auth-tabs" role="tablist" aria-label="Вход или регистрация">
          <button type="button" role="tab" aria-selected={screen === 'sign-in'} className={screen === 'sign-in' ? 'is-active' : ''} onClick={() => switchScreen('sign-in')}>Вход</button>
          <button type="button" role="tab" aria-selected={screen === 'sign-up'} className={screen === 'sign-up' ? 'is-active' : ''} onClick={() => switchScreen('sign-up')}>Регистрация</button>
        </div>
      )}

      {notice && <p className="account-notice">{notice}</p>}

      {(screen === 'sign-in' || screen === 'sign-up') && (
        <>
          <button className="account-google-button" type="button" onClick={() => { void continueWithGoogle() }} disabled={loading}>
            <GoogleLogo size={20} weight="bold" aria-hidden="true" />
            Продолжить с Google
          </button>
          <div className="account-auth-divider"><span>или</span></div>
        </>
      )}

      {screen === 'verify-email' && (
        <div className="account-email-check">
          <div className="account-email-check-lead">
            <div>
              <strong>Код отправлен</strong>
              <p>{email}</p>
            </div>
            <span className={expiresIn > 0 ? 'account-code-timer' : 'account-code-timer is-expired'}>{expiresIn > 0 ? formatCountdown(expiresIn) : 'Истёк'}</span>
          </div>
          <form className="account-verify-form" onSubmit={verifyCode}>
            <label htmlFor="account-verification-code">Код подтверждения</label>
            <input
              id="account-verification-code"
              className="account-otp-input"
              value={verificationCode}
              onChange={(event) => { setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              placeholder="000000"
              aria-describedby="account-code-help"
              autoFocus
              required
              data-initial-focus=""
            />
            <p id="account-code-help">Можно вставить все шесть цифр сразу.</p>
            <button className="account-primary-button" type="submit" disabled={loading || expiresIn <= 0 || verificationCode.length !== 6}>
              {loading ? 'Проверяем…' : 'Подтвердить и войти'}
              {!loading && <ArrowRight size={18} weight="bold" aria-hidden="true" />}
            </button>
          </form>
        </div>
      )}

      {screen !== 'verify-email' && <form className="account-auth-form" onSubmit={submit}>
        {screen === 'sign-up' && (
          <div className="account-field-row">
            <label>
              <span>Имя</span>
              <div className="account-input-shell">
                <UserCircle size={19} weight="duotone" aria-hidden="true" />
                <input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" maxLength={80} placeholder="Как к тебе обращаться" required autoFocus data-initial-focus={screen === 'sign-up' ? '' : undefined} />
              </div>
            </label>
            <div className="account-grade-field">
              <span>Класс</span>
              <GradeSelect value={grade} onChange={setGrade} compact />
            </div>
          </div>
        )}

        {screen !== 'reset' && (
          <label>
            <span>Почта</span>
            <div className="account-input-shell">
              <EnvelopeSimple size={19} weight="duotone" aria-hidden="true" />
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" required autoFocus={screen !== 'sign-up'} data-initial-focus={screen === 'sign-in' || screen === 'forgot' ? '' : undefined} />
            </div>
          </label>
        )}

        {screen !== 'forgot' && (
          <div className="account-password-field">
            <label>
              <span>{screen === 'reset' ? 'Новый пароль' : 'Пароль'}</span>
              <div className="account-input-shell">
                <LockKey size={19} weight="duotone" aria-hidden="true" />
                <input
                  type={passwordVisible ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={screen === 'sign-in' ? 'current-password' : 'new-password'}
                  minLength={8}
                  placeholder={requiresStrongPassword ? 'Не меньше 8 символов' : 'Твой пароль'}
                  aria-describedby={requiresStrongPassword && password ? passwordStrengthId : undefined}
                  required
                  autoFocus={screen === 'reset'}
                />
                {/* Двенадцать символов вслепую на телефоне не набирают. */}
                <button
                  className="account-password-reveal"
                  type="button"
                  onClick={() => setPasswordVisible((visible) => !visible)}
                  aria-label={passwordVisible ? 'Скрыть пароль' : 'Показать пароль'}
                  aria-pressed={passwordVisible}
                >
                  {passwordVisible ? <EyeSlash size={19} weight="duotone" aria-hidden="true" /> : <Eye size={19} weight="duotone" aria-hidden="true" />}
                </button>
              </div>
            </label>
            {/* Требования показываются, когда человек начал набирать: до этого
                их пересказывает плейсхолдер, а четыре строки правил только
                удлиняют окно. */}
            {requiresStrongPassword && password.length > 0 && <PasswordStrength id={passwordStrengthId} value={password} />}
          </div>
        )}

        {screen === 'sign-up' && (
          <div className="account-legal-consents">
            <label className="account-consent">
              <input type="checkbox" checked={agreementAccepted} onChange={(event) => setAgreementAccepted(event.target.checked)} required />
              <span aria-hidden="true"><Check size={14} weight="bold" /></span>
              <em>Я принимаю <a href="/terms" target="_blank" rel="noreferrer">пользовательское соглашение</a></em>
            </label>
            <label className="account-consent">
              <input type="checkbox" checked={personalDataAccepted} onChange={(event) => setPersonalDataAccepted(event.target.checked)} required />
              <span aria-hidden="true"><Check size={14} weight="bold" /></span>
              <em>Я отдельно даю <a href="/consent" target="_blank" rel="noreferrer">согласие на обработку персональных данных</a> и прочитал <a href="/privacy" target="_blank" rel="noreferrer">политику данных</a></em>
            </label>
            <label className="account-consent">
              <input type="checkbox" checked={ageConfirmed} onChange={(event) => setAgeConfirmed(event.target.checked)} required />
              <span aria-hidden="true"><Check size={14} weight="bold" /></span>
              <em>Мне есть 14 лет или я регистрируюсь с согласия родителя</em>
            </label>
          </div>
        )}

        {error && <p className="account-form-message is-error" role="alert">{error}</p>}
        {status && <p className="account-form-message is-success" role="status"><CheckCircle size={18} weight="fill" aria-hidden="true" />{status}</p>}

        <button className="account-primary-button" type="submit" disabled={loading || !formIsValid}>
          {loading ? 'Подожди…' : screen === 'sign-up' ? 'Создать аккаунт' : screen === 'forgot' ? 'Отправить ссылку' : screen === 'reset' ? 'Сохранить пароль' : 'Войти'}
          {!loading && <ArrowRight size={18} weight="bold" aria-hidden="true" />}
        </button>
      </form>}

      {screen === 'verify-email' && (
        <>
          {error && <p className="account-form-message is-error" role="alert">{error}</p>}
          {status && <p className="account-form-message is-success" role="status"><CheckCircle size={18} weight="fill" aria-hidden="true" />{status}</p>}
        </>
      )}

      <div className="account-auth-secondary">
        {screen === 'sign-in' && <button type="button" onClick={() => switchScreen('forgot')}>Не помню пароль</button>}
        {(screen === 'forgot' || screen === 'reset') && <button type="button" onClick={() => switchScreen('sign-in')}>Вернуться ко входу</button>}
        {screen === 'verify-email' && (
          <>
            <button type="button" onClick={() => { void resendEmail() }} disabled={loading || resendIn > 0}>{resendIn > 0 ? `Новый код через ${formatCountdown(resendIn)}` : 'Отправить новый код'}</button>
            <button type="button" onClick={() => switchScreen(verificationKind === 'signup' ? 'sign-up' : 'sign-in')}>{verificationKind === 'signup' ? 'Изменить почту' : 'Другой способ входа'}</button>
          </>
        )}
      </div>

      </section>
    </div>
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
    <section className="account-referral-card" aria-labelledby="account-referral-title">
      <header>
        <span className="account-referral-icon"><Gift size={23} weight="duotone" aria-hidden="true" /></span>
        <div>
          <h3 id="account-referral-title">Пригласи друга</h3>
          <p>Как только он подтвердит регистрацию по твоей ссылке, тебе начислят <strong>+10 ₽</strong>, а ему — <strong>+5 ₽</strong>. Пополнять ничего не нужно.</p>
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
                : 'Ты зарегистрирован по приглашению: +5 ₽ придут, как только подтвердишь почту.'}
            </p>
          )}
          <small>Засчитывается только новый аккаунт, зарегистрированный по этой ссылке. Один аккаунт можно привязать один раз; повторных начислений нет.</small>
        </>
      )}
    </section>
  )
}

function ProfileView({ user, account, notice, initialView, theme, onToggleTheme, onReloadAccount }: { user: User; account: AccountData | null; notice?: string; initialView: AccountView; theme: Theme; onToggleTheme: () => void; onReloadAccount: () => Promise<void> }) {
  const [fullName, setFullName] = useState(account?.profile.full_name ?? '')
  const [grade, setGrade] = useState(String(account?.profile.grade ?? 8))
  const [activeView, setActiveView] = useState<AccountView>(initialView)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setFullName(account?.profile.full_name ?? '')
    setGrade(String(account?.profile.grade ?? 8))
  }, [account])

  useEffect(() => setActiveView(initialView), [initialView])

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || loading) return
    setLoading(true)
    setStatus('')
    setError('')
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), grade: Number(grade) })
      .eq('id', user.id)

    if (updateError) setError('Не получилось сохранить профиль')
    else {
      await onReloadAccount()
      setStatus('Профиль сохранён')
    }
    setLoading(false)
  }

  const [deletionOpen, setDeletionOpen] = useState(false)
  const [deletionWord, setDeletionWord] = useState('')

  const signOut = async () => {
    if (!supabase || loading) return
    setLoading(true)
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
    if (signOutError) {
      setError('Не получилось выйти из аккаунта')
      setLoading(false)
    }
  }

  /* Удаление аккаунта.

     Право на удаление записано в политике, а способом был адрес почты,
     которого у домена нет. Подтверждение — не «вы уверены?», а ввод слова:
     кнопка стоит рядом с выходом, и промахнуться по ней слишком легко. */
  const deleteAccount = async () => {
    if (!supabase || loading) return
    setLoading(true)
    setError('')
    try {
      await deleteMyAccount(supabase, user.id)
      await supabase.auth.signOut({ scope: 'local' })
      window.location.assign(applicationPath('/'))
    } catch (deletionError) {
      const message = deletionError instanceof Error ? deletionError.message : ''
      setError(message.includes('admin account')
        ? 'Аккаунт владельца из приложения не удаляется'
        : 'Не получилось удалить аккаунт. Попробуй ещё раз или напиши в поддержку')
      setLoading(false)
      setDeletionOpen(false)
    }
  }

  const displayName = account?.profile.full_name || user.email || 'Ученик'

  return (
    <div className="account-profile-view">
      <header className="account-profile-header">
        <div className="account-profile-identity">
          <div>
            <span>Аккаунт</span>
            <h2 id="account-dialog-title">{displayName}</h2>
            <p>{user.email}</p>
          </div>
        </div>
      </header>

      {notice && <p className="account-notice account-profile-notice">{notice}</p>}

      <nav className="account-profile-tabs" aria-label="Раздел аккаунта">
        <button type="button" className={activeView === 'profile' ? 'is-active' : ''} aria-current={activeView === 'profile' ? 'page' : undefined} onClick={() => setActiveView('profile')}>Профиль</button>
        <button type="button" className={activeView === 'wallet' ? 'is-active' : ''} aria-current={activeView === 'wallet' ? 'page' : undefined} onClick={() => setActiveView('wallet')}>Баланс <strong>{account ? formatRubles(account.balance) : '…'}</strong></button>
      </nav>

      {activeView === 'profile' ? (
        <div className="account-profile-main">
          <section className="account-profile-section" aria-labelledby="profile-data-title">
            <header><div><h3 id="profile-data-title">Личные данные</h3><p>Имя и класс используются в интерфейсе.</p></div></header>
          <form className="account-profile-form" onSubmit={saveProfile}>
            <label>
              <span>Имя</span>
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={80} autoComplete="name" required />
            </label>
            <div className="account-grade-field">
              <span>Класс</span>
              <GradeSelect value={grade} onChange={setGrade} />
            </div>
            <label className="account-email-field">
              <span>Почта</span>
              <input value={user.email ?? ''} readOnly />
            </label>

            {error && <p className="account-form-message is-error" role="alert">{error}</p>}
            {status && <p className="account-form-message is-success" role="status"><CheckCircle size={18} weight="fill" aria-hidden="true" />{status}</p>}

            <button className="account-primary-button" type="submit" disabled={loading || fullName.trim().length < 1}>Сохранить</button>
          </form>
          </section>

          <section className="account-profile-section account-theme-section" aria-labelledby="profile-theme-title">
            <header><div><h3 id="profile-theme-title">Тема</h3><p>Настрой вид приложения на этом устройстве.</p></div></header>
            <div className="account-theme-options">
              <button type="button" className={theme === 'light' ? 'is-selected' : ''} aria-pressed={theme === 'light'} onClick={() => { if (theme !== 'light') onToggleTheme() }}><Sun size={20} weight="duotone" /> Светлая</button>
              <button type="button" className={theme === 'dark' ? 'is-selected' : ''} aria-pressed={theme === 'dark'} onClick={() => { if (theme !== 'dark') onToggleTheme() }}><Moon size={20} weight="duotone" /> Тёмная</button>
            </div>
          </section>
        </div>
      ) : (
        <div className="account-wallet-view">
          <section className="account-wallet-hero" aria-labelledby="account-wallet-title">
            <div><span>Доступно сейчас</span><strong id="account-wallet-title">{account ? formatRubles(account.balance) : '…'}</strong></div>
            <div className="account-wallet-rate"><strong>{formatRubles(solutionPriceKopecks)}</strong><span>одно решение, любой предмет</span></div>
          </section>

          <ReferralCard />

          <section className="account-wallet-history" aria-labelledby="wallet-history-title">
            <div><h3 id="wallet-history-title">Последние операции</h3></div>
            {account?.entries.map((entry) => (
              <div className="account-wallet-entry" key={entry.id}>
                <span className={entry.amount > 0 ? 'is-credit' : 'is-debit'}>{entry.amount > 0 ? '+' : ''}{formatRubles(entry.amount)}</span>
                <strong>{entry.description}</strong>
                <time dateTime={entry.created_at}>{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' }).format(new Date(entry.created_at))}</time>
              </div>
            ))}
            {!account?.entries.length && <p>Операций пока нет.</p>}
          </section>
        </div>
      )}

      <footer className="account-profile-footer">
        {/* Названия те же, что в подвале сайта: два документа с тремя именами
            читались как три разных документа. */}
        <nav aria-label="Документы"><a href="/privacy" target="_blank" rel="noreferrer">Политика данных</a><a href="/terms" target="_blank" rel="noreferrer">Пользовательское соглашение</a></nav>
        <div className="account-profile-footer-actions">
          <button type="button" className="account-delete-open" onClick={() => setDeletionOpen(true)} disabled={loading}>
            <Trash size={17} weight="duotone" aria-hidden="true" /> Удалить аккаунт
          </button>
          <button type="button" onClick={() => { void signOut() }} disabled={loading}><SignOut size={18} weight="duotone" aria-hidden="true" /> Выйти</button>
        </div>
      </footer>

      {deletionOpen && (
        <form
          className="account-delete-confirm"
          aria-label="Удаление аккаунта"
          onSubmit={(event) => { event.preventDefault(); void deleteAccount() }}
        >
          <h3>Удалить аккаунт навсегда?</h3>
          <p>
            Уйдут профиль, баланс и его история, решения задач, диалоги чата с фотографиями,
            расписание и обращения в поддержку. Восстановить это нельзя, и вернуть баланс — тоже.
          </p>
          <label>
            <span>Впиши «удалить», чтобы подтвердить</span>
            <input
              autoFocus
              value={deletionWord}
              onChange={(event) => setDeletionWord(event.target.value)}
              autoComplete="off"
              placeholder="удалить"
            />
          </label>
          <div className="account-delete-actions">
            <button type="button" onClick={() => { setDeletionOpen(false); setDeletionWord('') }} disabled={loading}>Отмена</button>
            <button type="submit" className="is-danger" disabled={loading || deletionWord.trim().toLocaleLowerCase('ru') !== 'удалить'}>
              {loading ? 'Удаляем…' : 'Удалить аккаунт'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

export default function AccountDialog({ user, account, passwordRecovery, pendingVerificationEmail, notice, initialView, theme, onToggleTheme, onClose, onReloadAccount, returnFocusRef }: AccountDialogProps) {
  const reduceMotion = useReducedMotion()
  const dialogRef = useModalIsolation<HTMLElement>(true, onClose, returnFocusRef)

  return createPortal((
    <AnimatePresence>
      <motion.div
        className={`account-dialog-backdrop${user ? '' : ' is-auth-backdrop'}`}
        role="presentation"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.18 }}
        onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}
      >
        <motion.section
          ref={dialogRef}
          className={`account-dialog${user ? ' is-profile' : ' is-auth'}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-dialog-title"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.985, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, scale: 0.985, y: 8 }}
          transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <button className="account-dialog-close" type="button" aria-label="Закрыть окно аккаунта" onClick={onClose}><X size={20} weight="bold" aria-hidden="true" /></button>
          {user
            ? <ProfileView user={user} account={account} notice={notice} initialView={initialView} theme={theme} onToggleTheme={onToggleTheme} onReloadAccount={onReloadAccount} />
            : <AuthView passwordRecovery={passwordRecovery} pendingVerificationEmail={pendingVerificationEmail} notice={notice} />}
        </motion.section>
      </motion.div>
    </AnimatePresence>
  ), document.body)
}
