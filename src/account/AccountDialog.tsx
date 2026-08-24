import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  ArrowRight,
  Camera,
  CheckCircle,
  EnvelopeSimple,
  GoogleLogo,
  LockKey,
  SignOut,
  UserCircle,
  X,
} from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { AccountData } from '../lib/supabase'
import { getInitials, supabase } from '../lib/supabase'
import { formatRubles } from '../lib/currency'
import './AccountDialog.css'

type AuthScreen = 'sign-in' | 'sign-up' | 'forgot' | 'reset' | 'check-email'
type VerificationKind = 'signup' | 'google'

const emailResendDelay = 60

function verificationRedirectUrl() {
  return `${window.location.origin}/?auth=verified`
}

function rememberEmailSent() {
  sessionStorage.setItem('homework-copilot:verification-sent-at', String(Date.now()))
}

function emailResendSecondsLeft() {
  const sentAt = Number(sessionStorage.getItem('homework-copilot:verification-sent-at') ?? 0)
  return Math.max(0, emailResendDelay - Math.floor((Date.now() - sentAt) / 1000))
}

type AccountDialogProps = {
  user: User | null
  account: AccountData | null
  passwordRecovery: boolean
  pendingVerificationEmail?: string
  notice?: string
  onClose: () => void
  onReloadAccount: () => Promise<void>
}

function authErrorMessage(message: string) {
  const normalized = message.toLocaleLowerCase('en')
  if (normalized.includes('invalid login credentials')) return 'Неверная почта или пароль'
  if (normalized.includes('user already registered')) return 'Аккаунт с этой почтой уже существует'
  if (normalized.includes('password') && normalized.includes('characters')) return 'Пароль должен содержать минимум 8 символов'
  if (normalized.includes('email rate limit')) return 'Слишком много писем. Попробуй немного позже'
  if (normalized.includes('email not confirmed')) return 'Сначала подтверди почту по ссылке из письма'
  if (normalized.includes('token') || normalized.includes('otp')) return 'Код неверный или уже истёк'
  return 'Не получилось выполнить запрос. Проверь данные и попробуй ещё раз'
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function AuthView({ passwordRecovery, pendingVerificationEmail, notice }: { passwordRecovery: boolean; pendingVerificationEmail?: string; notice?: string }) {
  const [screen, setScreen] = useState<AuthScreen>(passwordRecovery ? 'reset' : pendingVerificationEmail ? 'check-email' : 'sign-in')
  const [verificationKind, setVerificationKind] = useState<VerificationKind>(pendingVerificationEmail ? 'google' : 'signup')
  const [fullName, setFullName] = useState('')
  const [grade, setGrade] = useState('8')
  const [email, setEmail] = useState(pendingVerificationEmail ?? '')
  const [password, setPassword] = useState('')
  const [resendIn, setResendIn] = useState(() => pendingVerificationEmail ? emailResendSecondsLeft() : 0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const formIsValid = screen === 'sign-up'
    ? fullName.trim().length >= 2 && isValidEmail(email) && password.length >= 8
    : screen === 'sign-in'
      ? isValidEmail(email) && password.length >= 8
      : screen === 'forgot'
        ? isValidEmail(email)
        : password.length >= 8

  useEffect(() => {
    if (passwordRecovery) setScreen('reset')
  }, [passwordRecovery])

  useEffect(() => {
    if (!pendingVerificationEmail) return
    setEmail(pendingVerificationEmail)
    setVerificationKind('google')
    setResendIn(emailResendSecondsLeft())
    setScreen('check-email')
  }, [pendingVerificationEmail])

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = window.setInterval(() => setResendIn((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [resendIn])

  const switchScreen = (next: AuthScreen) => {
    setScreen(next)
    setStatus('')
    setError('')
  }

  const continueWithGoogle = async () => {
    if (!supabase || loading) return
    setLoading(true)
    setStatus('')
    setError('')
    sessionStorage.setItem('homework-copilot:google-auth-pending', '1')
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/?auth=google-code`,
        queryParams: { prompt: 'select_account' },
      },
    })
    if (oauthError) {
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
      rememberEmailSent()
      setStatus('Новое письмо отправлено. Проверь также папку «Спам»')
      setResendIn(emailResendDelay)
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
        if (password.length < 8) throw new Error('password characters')
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { full_name: fullName.trim(), grade },
            emailRedirectTo: verificationRedirectUrl(),
          },
        })
        if (signUpError) throw signUpError
        if (!data.session) {
          setVerificationKind('signup')
          rememberEmailSent()
          setResendIn(emailResendDelay)
          setScreen('check-email')
        }
        return
      }

      if (screen === 'forgot') {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/?auth=reset`,
        })
        if (resetError) throw resetError
        setStatus('Если аккаунт существует, ссылка для смены пароля уже отправлена')
        return
      }

      if (password.length < 8) throw new Error('password characters')
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setStatus('Пароль обновлён')
      window.history.replaceState({}, '', window.location.pathname)
      setScreen('sign-in')
      setPassword('')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : ''
      if (message === 'name') setError('Введи имя')
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
        : screen === 'check-email'
          ? 'Открой почту'
        : 'Войди в аккаунт'

  const subtitle = screen === 'sign-up'
    ? 'Создай профиль и получи 20 ₽ на первые решения.'
    : screen === 'check-email'
      ? 'Остался один короткий шаг.'
      : screen === 'forgot'
        ? 'Пришлём безопасную ссылку для нового пароля.'
        : screen === 'reset'
          ? 'Придумай пароль длиной не меньше 8 символов.'
          : 'Продолжи с Google или войди по почте.'

  return (
    <div className="account-auth-view">
      <div className="account-auth-brand">
        <span className="account-auth-mark"><UserCircle size={30} weight="duotone" aria-hidden="true" /></span>
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

      {screen === 'check-email' && (
        <div className="account-email-check">
          <div className="account-email-check-lead">
            <span className="account-code-icon"><EnvelopeSimple size={25} weight="duotone" aria-hidden="true" /></span>
            <div>
              <strong>Письмо отправлено</strong>
              <p>{email}</p>
            </div>
          </div>
          <ol className="account-email-steps">
            <li><span>1</span><div><strong>Открой письмо</strong><small>Отправитель — Supabase Auth. Проверь «Спам», если его нет во входящих.</small></div></li>
            <li><span>2</span><div><strong>Нажми кнопку в письме</strong><small>Мы вернём тебя сюда уже с подтверждённым входом.</small></div></li>
          </ol>
        </div>
      )}

      {screen !== 'check-email' && <form className="account-auth-form" onSubmit={submit}>
        {screen === 'sign-up' && (
          <div className="account-field-row">
            <label>
              <span>Имя</span>
              <div className="account-input-shell">
                <UserCircle size={19} weight="duotone" aria-hidden="true" />
                <input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" maxLength={80} placeholder="Как к тебе обращаться" required autoFocus />
              </div>
            </label>
            <label className="account-grade-field">
              <span>Класс</span>
              <select value={grade} onChange={(event) => setGrade(event.target.value)} aria-label="Класс">
                {Array.from({ length: 11 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
          </div>
        )}

        {screen !== 'reset' && (
          <label>
            <span>Почта</span>
            <div className="account-input-shell">
              <EnvelopeSimple size={19} weight="duotone" aria-hidden="true" />
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@example.com" required autoFocus={screen !== 'sign-up'} />
            </div>
          </label>
        )}

        {screen !== 'forgot' && (
          <label>
            <span>{screen === 'reset' ? 'Новый пароль' : 'Пароль'}</span>
            <div className="account-input-shell">
              <LockKey size={19} weight="duotone" aria-hidden="true" />
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={screen === 'sign-in' ? 'current-password' : 'new-password'} minLength={8} placeholder="Минимум 8 символов" required autoFocus={screen === 'reset'} />
            </div>
          </label>
        )}

        {error && <p className="account-form-message is-error" role="alert">{error}</p>}
        {status && <p className="account-form-message is-success" role="status"><CheckCircle size={18} weight="fill" aria-hidden="true" />{status}</p>}

        <button className="account-primary-button" type="submit" disabled={loading || !formIsValid}>
          {loading ? 'Подожди…' : screen === 'sign-up' ? 'Создать аккаунт' : screen === 'forgot' ? 'Отправить ссылку' : screen === 'reset' ? 'Сохранить пароль' : 'Войти'}
          {!loading && <ArrowRight size={18} weight="bold" aria-hidden="true" />}
        </button>
      </form>}

      {screen === 'check-email' && (
        <>
          {error && <p className="account-form-message is-error" role="alert">{error}</p>}
          {status && <p className="account-form-message is-success" role="status"><CheckCircle size={18} weight="fill" aria-hidden="true" />{status}</p>}
        </>
      )}

      <div className="account-auth-secondary">
        {screen === 'sign-in' && <button type="button" onClick={() => switchScreen('forgot')}>Не помню пароль</button>}
        {(screen === 'forgot' || screen === 'reset') && <button type="button" onClick={() => switchScreen('sign-in')}>Вернуться ко входу</button>}
        {screen === 'check-email' && (
          <>
            <button type="button" onClick={() => { void resendEmail() }} disabled={loading || resendIn > 0}>{resendIn > 0 ? `Отправить снова через ${resendIn} сек.` : 'Отправить письмо снова'}</button>
            <button type="button" onClick={() => switchScreen(verificationKind === 'signup' ? 'sign-up' : 'sign-in')}>{verificationKind === 'signup' ? 'Изменить почту' : 'Другой способ входа'}</button>
          </>
        )}
      </div>

      {screen === 'sign-up' && (
        <p className="account-auth-legal">Создавая аккаунт, ты принимаешь <a href="/terms" target="_blank" rel="noreferrer">условия использования</a> и <a href="/privacy" target="_blank" rel="noreferrer">политику конфиденциальности</a>.</p>
      )}

    </div>
  )
}

function ProfileView({ user, account, notice, onReloadAccount }: { user: User; account: AccountData | null; notice?: string; onReloadAccount: () => Promise<void> }) {
  const [fullName, setFullName] = useState(account?.profile.full_name ?? '')
  const [grade, setGrade] = useState(String(account?.profile.grade ?? 8))
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    setFullName(account?.profile.full_name ?? '')
    setGrade(String(account?.profile.grade ?? 8))
  }, [account])

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

  const uploadAvatar = async (file: File | null) => {
    if (!supabase || !file || loading) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setError('Выбери JPG, PNG или WEBP до 5 МБ')
      return
    }

    setLoading(true)
    setStatus('')
    setError('')
    const avatarPath = `${user.id}/avatar`
    const { error: uploadError } = await supabase.storage.from('profile-avatars').upload(avatarPath, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: true,
    })

    if (uploadError) setError('Не получилось загрузить фото')
    else {
      const { error: updateError } = await supabase.from('profiles').update({ avatar_path: avatarPath }).eq('id', user.id)
      if (updateError) setError('Фото загружено, но профиль не обновился')
      else {
        await onReloadAccount()
        setStatus('Фото обновлено')
      }
    }
    setLoading(false)
  }

  const signOut = async () => {
    if (!supabase || loading) return
    setLoading(true)
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
    if (signOutError) {
      setError('Не получилось выйти из аккаунта')
      setLoading(false)
    }
  }

  const displayName = account?.profile.full_name || user.email || 'Ученик'

  return (
    <div className="account-profile-view">
      <header className="account-profile-header">
        <div>
          <span>Профиль</span>
          <h2 id="account-dialog-title">Твой аккаунт</h2>
        </div>
        <div className="account-balance-pill" aria-label={`Баланс: ${formatRubles(account?.balance ?? 0)}`}>
          <span className="account-balance-icon" aria-hidden="true">₽</span>
          <span><small>Баланс</small><strong>{account ? formatRubles(account.balance) : '…'}</strong></span>
        </div>
      </header>

      {notice && <p className="account-notice account-profile-notice">{notice}</p>}

      <div className="account-profile-grid">
        <aside className="account-profile-summary">
          <div className="account-avatar-large">
            {account?.avatarUrl ? <img src={account.avatarUrl} alt="Фото профиля" /> : <span>{getInitials(displayName, user.email)}</span>}
          </div>
          <strong>{displayName}</strong>
          <small>{user.email}</small>
          <input id="profile-avatar" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { void uploadAvatar(event.target.files?.[0] ?? null); event.currentTarget.value = '' }} />
          <label className="account-avatar-button" htmlFor="profile-avatar"><Camera size={18} weight="duotone" aria-hidden="true" /> Сменить фото</label>
        </aside>

        <div className="account-profile-main">
          <form className="account-profile-form" onSubmit={saveProfile}>
            <label>
              <span>Имя</span>
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={80} autoComplete="name" required />
            </label>
            <label>
              <span>Класс</span>
              <select value={grade} onChange={(event) => setGrade(event.target.value)}>
                {Array.from({ length: 11 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value} класс</option>)}
              </select>
            </label>
            <label className="account-email-field">
              <span>Почта</span>
              <input value={user.email ?? ''} disabled readOnly />
            </label>

            {error && <p className="account-form-message is-error" role="alert">{error}</p>}
            {status && <p className="account-form-message is-success" role="status"><CheckCircle size={18} weight="fill" aria-hidden="true" />{status}</p>}

            <button className="account-primary-button" type="submit" disabled={loading || fullName.trim().length < 1}>Сохранить</button>
          </form>

          <section className="account-wallet-history" aria-labelledby="wallet-history-title">
            <div><h3 id="wallet-history-title">Последние операции</h3><span>Журнал нельзя изменить</span></div>
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
      </div>

      <footer className="account-profile-footer">
        <span>Данные профиля защищены правилами доступа Supabase.</span>
        <button type="button" onClick={() => { void signOut() }} disabled={loading}><SignOut size={18} weight="duotone" aria-hidden="true" /> Выйти</button>
      </footer>
    </div>
  )
}

export default function AccountDialog({ user, account, passwordRecovery, pendingVerificationEmail, notice, onClose, onReloadAccount }: AccountDialogProps) {
  const reduceMotion = useReducedMotion()
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    window.setTimeout(() => closeButtonRef.current?.focus(), 0)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
      previouslyFocused?.focus()
    }
  }, [onClose])

  return (
    <AnimatePresence>
      <motion.div
        className="account-dialog-backdrop"
        role="presentation"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.18 }}
        onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}
      >
        <motion.section
          className={`account-dialog${user ? ' is-profile' : ' is-auth'}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-dialog-title"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.985, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, scale: 0.985, y: 8 }}
          transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <button ref={closeButtonRef} className="account-dialog-close" type="button" aria-label="Закрыть окно аккаунта" onClick={onClose}><X size={20} weight="bold" aria-hidden="true" /></button>
          {user
            ? <ProfileView user={user} account={account} notice={notice} onReloadAccount={onReloadAccount} />
            : <AuthView passwordRecovery={passwordRecovery} pendingVerificationEmail={pendingVerificationEmail} notice={notice} />}
        </motion.section>
      </motion.div>
    </AnimatePresence>
  )
}
