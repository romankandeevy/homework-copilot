import { useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { User } from '@supabase/supabase-js'
import {
  ArrowRight,
  Camera,
  Check,
  CheckCircle,
  ClockCountdown,
  EnvelopeSimple,
  GoogleLogo,
  LockKey,
  Moon,
  ShieldCheck,
  SignOut,
  Sun,
  UserCircle,
  X,
} from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { AccountData } from '../lib/supabase'
import { supabase } from '../lib/supabase'
import { getInitials } from '../lib/account'
import { formatRubles } from '../lib/currency'
import { useModalIsolation } from '../lib/useModalIsolation'
import { AccountAvatar } from './AccountAvatar'
import { avatarPresets, getAvatarPresetId } from './avatarPresets'
import type { AvatarPresetId } from './avatarPresets'
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

function verificationRedirectUrl() {
  return `${window.location.origin}/?auth=verified`
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
}

function authErrorMessage(message: string) {
  const normalized = message.toLocaleLowerCase('en')
  if (normalized.includes('invalid login credentials')) return 'Неверная почта или пароль'
  if (normalized.includes('user already registered')) return 'Аккаунт с этой почтой уже существует'
  if (normalized.includes('password') && normalized.includes('characters')) return 'Пароль должен содержать минимум 8 символов'
  if (normalized.includes('email rate limit')) return 'Слишком много писем. Попробуй немного позже'
  if (normalized.includes('email not confirmed')) return 'Сначала подтверди почту кодом из письма'
  if (normalized.includes('token') || normalized.includes('otp')) return 'Код неверный или уже истёк'
  return 'Не получилось выполнить запрос. Проверь данные и попробуй ещё раз'
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function AuthView({ passwordRecovery, pendingVerificationEmail, notice }: { passwordRecovery: boolean; pendingVerificationEmail?: string; notice?: string }) {
  const [initialVerification] = useState(() => pendingVerificationEmail
    ? { email: pendingVerificationEmail, kind: 'google' as const }
    : readPendingVerification())
  const [screen, setScreen] = useState<AuthScreen>(passwordRecovery ? 'reset' : initialVerification ? 'verify-email' : 'sign-in')
  const [verificationKind, setVerificationKind] = useState<VerificationKind>(initialVerification?.kind ?? 'signup')
  const [fullName, setFullName] = useState('')
  const [grade, setGrade] = useState('8')
  const [email, setEmail] = useState(initialVerification?.email ?? '')
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [sentAt, setSentAt] = useState(() => initialVerification ? Number(sessionStorage.getItem(verificationSentAtKey) ?? 0) : 0)
  const [now, setNow] = useState(() => Date.now())
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [legalAccepted, setLegalAccepted] = useState(false)
  const passwordStrengthId = useId()
  const requiresStrongPassword = screen === 'sign-up' || screen === 'reset'
  const passwordIsValid = requiresStrongPassword ? isStrongPassword(password) : password.length >= 8
  const resendIn = verificationSecondsLeft(sentAt, emailResendDelay, now)
  const expiresIn = verificationSecondsLeft(sentAt, emailCodeLifetime, now)

  const formIsValid = screen === 'sign-up'
    ? fullName.trim().length >= 2 && isValidEmail(email) && passwordIsValid && legalAccepted
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
          redirectTo: `${window.location.origin}/?auth=reset`,
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
      const message = caught instanceof Error ? caught.message : ''
      if (message === 'name') setError('Введи имя')
      else if (message === 'weak password') setError('Выполни все требования к паролю')
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
    <div className="account-auth-view">
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
          <div className="account-password-field">
            <label>
              <span>{screen === 'reset' ? 'Новый пароль' : 'Пароль'}</span>
              <div className="account-input-shell">
                <LockKey size={19} weight="duotone" aria-hidden="true" />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={screen === 'sign-in' ? 'current-password' : 'new-password'}
                  minLength={requiresStrongPassword ? 12 : 8}
                  placeholder={requiresStrongPassword ? 'Не меньше 12 символов' : 'Твой пароль'}
                  aria-describedby={requiresStrongPassword ? passwordStrengthId : undefined}
                  required
                  autoFocus={screen === 'reset'}
                />
              </div>
            </label>
            {requiresStrongPassword && <PasswordStrength id={passwordStrengthId} value={password} />}
          </div>
        )}

        {screen === 'sign-up' && (
          <label className="account-consent">
            <input type="checkbox" checked={legalAccepted} onChange={(event) => setLegalAccepted(event.target.checked)} />
            <span aria-hidden="true"><Check size={14} weight="bold" /></span>
            <em>Я принимаю <a href="/terms" target="_blank" rel="noreferrer">условия использования</a> и <a href="/privacy" target="_blank" rel="noreferrer">политику конфиденциальности</a></em>
          </label>
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

  const selectAvatar = async (preset: AvatarPresetId) => {
    if (!supabase || loading) return
    setLoading(true)
    setStatus('')
    setError('')
    const { error: updateError } = await supabase.from('profiles').update({ avatar_path: `preset:${preset}` }).eq('id', user.id)
    if (updateError) setError('Не получилось выбрать аватар')
    else {
      await onReloadAccount()
      setStatus('Аватар обновлён')
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
  const selectedPreset = getAvatarPresetId(account?.profile.avatar_path)

  return (
    <div className="account-profile-view">
      <header className="account-profile-header">
        <div className="account-profile-identity">
          <div className="account-avatar-large">
            {account?.avatarUrl
              ? <img src={account.avatarUrl} alt="Фото профиля" />
              : <AccountAvatar preset={selectedPreset} initials={getInitials(displayName, user.email)} />}
          </div>
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
          <section className="account-profile-section account-avatar-section" aria-labelledby="avatar-section-title">
            <header><div><h3 id="avatar-section-title">Аватар</h3><p>Выбери готовый или загрузи своё фото.</p></div>
              <><input id="profile-avatar" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { void uploadAvatar(event.target.files?.[0] ?? null); event.currentTarget.value = '' }} /><label className="account-avatar-button" htmlFor="profile-avatar"><Camera size={18} weight="duotone" aria-hidden="true" /> Загрузить фото</label></>
            </header>
            <div className="account-avatar-presets">
              {avatarPresets.map((preset) => (
                <button key={preset.id} type="button" className={selectedPreset === preset.id ? 'is-selected' : ''} aria-label={`Выбрать аватар «${preset.label}»`} aria-pressed={selectedPreset === preset.id} onClick={() => { void selectAvatar(preset.id) }} disabled={loading}>
                  <AccountAvatar preset={preset.id} initials="" />
                  <span>{preset.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="account-profile-section" aria-labelledby="profile-data-title">
            <header><div><h3 id="profile-data-title">Личные данные</h3><p>Имя и класс используются в интерфейсе.</p></div></header>
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
            <div className="account-wallet-rate"><strong>1 ₽</strong><span>одно готовое решение</span></div>
          </section>

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
        <nav aria-label="Документы"><a href="/privacy" target="_blank" rel="noreferrer">Конфиденциальность</a><a href="/terms" target="_blank" rel="noreferrer">Правила сервиса</a></nav>
        <button type="button" onClick={() => { void signOut() }} disabled={loading}><SignOut size={18} weight="duotone" aria-hidden="true" /> Выйти</button>
      </footer>
    </div>
  )
}

export default function AccountDialog({ user, account, passwordRecovery, pendingVerificationEmail, notice, initialView, theme, onToggleTheme, onClose, onReloadAccount }: AccountDialogProps) {
  const reduceMotion = useReducedMotion()
  const dialogRef = useModalIsolation<HTMLElement>(true, onClose)

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
