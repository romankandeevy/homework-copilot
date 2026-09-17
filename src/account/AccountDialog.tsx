import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { User } from '@supabase/supabase-js'
import {
  ArrowRight,
  Check,
  CheckCircle,
  ClockCountdown,
  DeviceMobile,
  EnvelopeSimple,
  Eye,
  EyeSlash,
  LockKey,
  ShieldCheck,
  UserCircle,
  X,
} from '@phosphor-icons/react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { supabase } from '../lib/supabase'
import { applicationPath } from '../lib/appPath'
import { acceptanceSourceForUser, forgetPendingLegalAcceptance, rememberPendingLegalAcceptance } from '../lib/legalConsent'
import { getGuestId } from '../lib/guestSolutions'
import { preparePendingReferralClaim } from '../lib/referrals'
import { formatPhoneDigits, isRussianMobileDigits, phoneDigitsFromInput, russianPhoneE164 } from '../lib/phone'
import { startYandexSignIn } from '../lib/yandexAuth'
import { useModalIsolation } from '../lib/useModalIsolation'
import GradeSelect from './GradeSelect'
import PasswordStrength from './PasswordStrength'
import { evaluatePassword, isStrongPassword, passwordRequirementsHint } from './passwordStrengthRules'
import { authErrorMessage } from './authErrors'
import './AccountDialog.css'

type AuthScreen = 'sign-in' | 'sign-up' | 'forgot' | 'reset' | 'verify-email' | 'verify-phone'
type AuthMethod = 'email' | 'phone'
/** Способы входа кроме почты. Каждый включается флагом в админке
    (`auth_yandex`, `auth_phone`) и требует ключей на сервере. */
export type AuthMethods = { yandex: boolean; phone: boolean }
const onlyEmail: AuthMethods = { yandex: false, phone: false }
type VerificationKind = 'signup'

const emailResendDelay = 60
const emailCodeLifetime = 5 * 60
// Supabase не шлёт второе СМС на тот же номер раньше, чем через минуту.
const smsResendDelay = 60
const phoneFormatError = 'Нужен российский мобильный номер: +7 9XX XXX-XX-XX'
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
  if (!email || kind !== 'signup') return null
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

/* С 14 сентября 2026 окно - только вход и регистрация гостя, согласие с
   документами и новый пароль. Профиль и баланс - страницы `/profile` и
   `/balance` (ProfilePage, BalancePage): владелец хотел открывать их по
   ссылке с любого места и сохранять адрес. */
type AccountDialogProps = {
  user: User | null
  passwordRecovery: boolean
  notice?: string
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement | null>
  /** У вошедшего нет ни одной отметки о согласии: окно не отпускает, пока их нет. */
  legalAcceptanceRequired?: boolean
  onLegalAccepted?: () => void
  onPasswordUpdated?: () => void
  authMethods?: AuthMethods
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

const consentErrorMessage = 'Прими соглашение, согласие на обработку данных и подтверди возраст'

type FormProblemField = 'name' | 'phone' | 'email' | 'password' | 'mfa' | 'consents'
type FormProblem = { field: FormProblemField; message: string }

/* Что мешает отправить форму - первым по порядку полей.

   Кнопки «Создать аккаунт» и «Войти» не гаснут: по серой кнопке
   четырнадцатилетний всё равно жмёт, ничего не происходит, и почему - не
   сказано. Это правило «Решить» (AGENTS.md, «Иерархия первого экрана»):
   нажатие отвечает строкой с причиной, курсор встаёт в поле. Класс в
   регистрации необязательный: база с 13 сентября хранит пустой. */
function authFormProblem(input: {
  screen: 'sign-in' | 'sign-up' | 'forgot' | 'reset'
  usingPhone: boolean
  fullName: string
  phoneValid: boolean
  email: string
  password: string
  consentsGiven: boolean
  mfaRequired: boolean
  mfaCode: string
}): FormProblem | null {
  const { screen } = input
  if (screen === 'sign-up' && input.fullName.trim().length < 2) {
    return { field: 'name', message: input.fullName.trim() ? 'Имя - хотя бы две буквы' : 'Введи имя' }
  }
  if (input.usingPhone) {
    if (!input.phoneValid) return { field: 'phone', message: phoneFormatError }
  } else {
    if (screen !== 'reset') {
      if (!input.email.trim()) return { field: 'email', message: 'Введи почту' }
      if (!isValidEmail(input.email)) return { field: 'email', message: 'Проверь почту: нужен адрес вида name@example.com' }
    }
    if (screen === 'sign-in') {
      if (!input.password) return { field: 'password', message: 'Введи пароль' }
      if (input.password.length < 8) return { field: 'password', message: 'Пароль не короче 8 символов - проверь, всё ли набрано' }
    }
    if (screen === 'sign-up' || screen === 'reset') {
      if (!input.password) return { field: 'password', message: `Придумай пароль: ${passwordRequirementsHint.toLocaleLowerCase('ru')}` }
      const strength = evaluatePassword(input.password)
      const unmet = strength.rules.filter((rule) => !rule.met)
      if (unmet.length > 0) return { field: 'password', message: `В пароле не хватает: ${unmet.map((rule) => rule.label.toLocaleLowerCase('ru')).join(', ')}` }
      if (strength.guessable) return { field: 'password', message: 'Пароль слишком легко угадать - придумай другой' }
    }
  }
  if (screen === 'reset' && input.mfaRequired && input.mfaCode.length !== 6) {
    return { field: 'mfa', message: 'Введи шесть цифр из приложения-аутентификатора' }
  }
  if (screen === 'sign-up' && !input.consentsGiven) return { field: 'consents', message: consentErrorMessage }
  return null
}

/* Три отметки согласия. Стоят в регистрации и в окне согласия для того, кто
   вошёл, а отметки о согласии у аккаунта нет. */
function LegalConsents({ agreementAccepted, personalDataAccepted, ageConfirmed, onAgreementChange, onPersonalDataChange, onAgeChange }: {
  agreementAccepted: boolean
  personalDataAccepted: boolean
  ageConfirmed: boolean
  onAgreementChange: (value: boolean) => void
  onPersonalDataChange: (value: boolean) => void
  onAgeChange: (value: boolean) => void
}) {
  return (
    <div className="account-legal-consents">
      <label className="account-consent">
        <input type="checkbox" checked={agreementAccepted} onChange={(event) => onAgreementChange(event.target.checked)} required />
        <span aria-hidden="true"><Check size={14} weight="bold" /></span>
        <em>Я принимаю <a href="/docs/terms" target="_blank" rel="noreferrer">пользовательское соглашение</a></em>
      </label>
      <label className="account-consent">
        <input type="checkbox" checked={personalDataAccepted} onChange={(event) => onPersonalDataChange(event.target.checked)} required />
        <span aria-hidden="true"><Check size={14} weight="bold" /></span>
        <em>Я отдельно даю <a href="/docs/consent" target="_blank" rel="noreferrer">согласие на обработку персональных данных</a> и прочитал <a href="/docs/privacy" target="_blank" rel="noreferrer">политику данных</a></em>
      </label>
      <label className="account-consent">
        <input type="checkbox" checked={ageConfirmed} onChange={(event) => onAgeChange(event.target.checked)} required />
        <span aria-hidden="true"><Check size={14} weight="bold" /></span>
        <em>Мне есть 14 лет или я регистрируюсь с согласия родителя</em>
      </label>
    </div>
  )
}

/* Окно согласия для вошедшего.

   Отметку о согласии ставит база при регистрации по почте, а при входе через
   Google - клиент, и только если кнопку нажали на вкладке «Регистрация».
   Новый человек, нажавший «Продолжить с Google» на вкладке «Вход», получал
   аккаунт без отметки. Теперь аккаунт без единой отметки дальше этого окна
   не пускает: принять документы или выйти. */
function LegalAcceptanceView({ user, onAccepted }: { user: User; onAccepted: () => void }) {
  const [agreementAccepted, setAgreementAccepted] = useState(false)
  const [personalDataAccepted, setPersonalDataAccepted] = useState(false)
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!agreementAccepted || !personalDataAccepted || !ageConfirmed) return
    setError((current) => (current === consentErrorMessage ? '' : current))
  }, [ageConfirmed, agreementAccepted, personalDataAccepted])

  const accept = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (loading) return
    if (!agreementAccepted || !personalDataAccepted || !ageConfirmed) {
      setError(consentErrorMessage)
      return
    }
    if (!supabase) return
    setLoading(true)
    setError('')
    const { error: acceptanceError } = await supabase.rpc('record_current_legal_acceptance', {
      p_source: acceptanceSourceForUser(user),
    })
    if (acceptanceError) {
      setError('Не получилось сохранить согласие. Попробуй ещё раз')
      setLoading(false)
      return
    }
    onAccepted()
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

  return (
    <div className="account-auth-view">
      <aside className="account-auth-context" aria-hidden="true">
        <div className="account-auth-wordmark"><span>HC</span><strong>Homework Copilot</strong></div>
        <div className="account-auth-context-copy">
          <ShieldCheck size={42} weight="duotone" />
          <strong>Остался один шаг.</strong>
          <p>Прими документы — и аккаунт готов к работе.</p>
        </div>
        <div className="account-auth-context-meta">
          <CheckCircle size={20} weight="duotone" />
          <span>Согласие записывается в аккаунт</span>
        </div>
      </aside>

      <section className="account-auth-panel">
        <div className="account-auth-brand">
          <span className="account-auth-mark"><ShieldCheck size={28} weight="duotone" aria-hidden="true" /></span>
          <div>
            <h2 id="account-dialog-title">Прими документы</h2>
            <p>Аккаунт создан, но согласие с документами в нём не записано.</p>
          </div>
        </div>

        {/* Без noValidate браузер сам останавливал отправку на пустой отметке
            и молчал: объяснение пришло бы только от нашей строки ошибки. */}
        <form className="account-auth-form" onSubmit={(event) => { void accept(event) }} noValidate>
          <LegalConsents
            agreementAccepted={agreementAccepted}
            personalDataAccepted={personalDataAccepted}
            ageConfirmed={ageConfirmed}
            onAgreementChange={setAgreementAccepted}
            onPersonalDataChange={setPersonalDataAccepted}
            onAgeChange={setAgeConfirmed}
          />

          {error && <p className="account-form-message is-error" role="alert">{error}</p>}

          <button className="account-primary-button" type="submit" disabled={loading}>
            {loading ? 'Подожди…' : 'Принять и продолжить'}
            {!loading && <ArrowRight size={18} weight="bold" aria-hidden="true" />}
          </button>
        </form>

        <div className="account-auth-secondary">
          <button type="button" onClick={() => { void signOut() }} disabled={loading}>Выйти из аккаунта</button>
        </div>
      </section>
    </div>
  )
}

/* `onPasswordUpdated` есть, когда человек уже вошёл: ссылка из письма о смене
   пароля открывает сессию, и новый пароль задаётся изнутри аккаунта. */
function AuthView({ passwordRecovery, notice, onPasswordUpdated, authMethods = onlyEmail }: { passwordRecovery: boolean; notice?: string; onPasswordUpdated?: () => void; authMethods?: AuthMethods }) {
  const viewRef = useRef<HTMLDivElement>(null)
  const [initialVerification] = useState(() => readPendingVerification())
  const [screen, setScreen] = useState<AuthScreen>(passwordRecovery ? 'reset' : initialVerification ? 'verify-email' : 'sign-in')
  const [verificationKind, setVerificationKind] = useState<VerificationKind>(initialVerification?.kind ?? 'signup')
  const [fullName, setFullName] = useState('')
  // Класс никто не подставляет за ученика: восьмиклассников среди
  // пользователей не большинство, а подставленный класс уходит в решения.
  const [grade, setGrade] = useState('')
  const [email, setEmail] = useState(initialVerification?.email ?? '')
  const [password, setPassword] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  /* Аккаунт со вторым фактором (админы) меняет пароль только после кода из
     приложения: ссылка из письма даёт сессию первого уровня, и Supabase
     отвечает insufficient_aal. Код спрашивается прямо в форме пароля. */
  const [mfaRequired, setMfaRequired] = useState(false)
  const [mfaCode, setMfaCode] = useState('')
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
  /* Вход по номеру телефона: та же вкладка «Вход» или «Регистрация», только
     вместо почты и пароля - номер, а потом код из СМС. */
  const [method, setMethod] = useState<AuthMethod>('email')
  const [phoneDigits, setPhoneDigits] = useState('')
  const [phoneIntent, setPhoneIntent] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [phoneSentAt, setPhoneSentAt] = useState(0)
  const passwordStrengthId = useId()
  const passwordHelpId = useId()
  const phoneHelpId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const phoneRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const mfaRef = useRef<HTMLInputElement>(null)
  /* Поле, о котором сейчас говорит строка ошибки: человек его правит -
     строка уходит, иначе она висит над уже исправленной формой. */
  const [problemField, setProblemField] = useState<FormProblemField | null>(null)
  const requiresStrongPassword = screen === 'sign-up' || screen === 'reset'
  const resendIn = verificationSecondsLeft(sentAt, emailResendDelay, now)
  const expiresIn = verificationSecondsLeft(sentAt, emailCodeLifetime, now)

  useEffect(() => {
    if (screen !== 'reset' || !supabase) return
    let active = true
    void supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      if (active && data?.currentLevel === 'aal1' && data.nextLevel === 'aal2') setMfaRequired(true)
    })
    return () => { active = false }
  }, [screen])
  const phoneResendIn = verificationSecondsLeft(phoneSentAt, smsResendDelay, now)
  const usingPhone = method === 'phone' && (screen === 'sign-in' || screen === 'sign-up')
  const consentsGiven = agreementAccepted && personalDataAccepted && ageConfirmed
  const phoneIsValid = isRussianMobileDigits(phoneDigits)

  const clearProblem = (field: FormProblemField) => {
    if (problemField !== field) return
    setProblemField(null)
    setError('')
  }

  useEffect(() => {
    if (passwordRecovery) setScreen('reset')
  }, [passwordRecovery])

  useEffect(() => {
    if (screen !== 'verify-email' && screen !== 'verify-phone') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [screen])

  const switchScreen = (next: AuthScreen) => {
    if (screen === 'verify-email' && next !== 'verify-email') clearPendingVerification()
    setScreen(next)
    setStatus('')
    setError('')
    setProblemField(null)
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

  const resendEmail = async () => {
    if (!supabase || loading || resendIn > 0) return
    setLoading(true)
    setStatus('')
    setError('')
    const normalizedEmail = email.trim()
    const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: normalizedEmail })
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
      type: 'signup',
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

  /* Код из СМС. Supabase заводит аккаунт уже здесь, с неподтверждённым
     номером; подтверждает его ввод кода. Метаданные те же, что у
     регистрации по почте: метка браузера для стартовых 20 ₽, приглашение,
     отметка о согласии. На вкладке «Вход» новый номер тоже создаёт аккаунт,
     но без отметки о согласии - его остановит окно согласия. */
  const requestPhoneCode = async (intent: 'sign-in' | 'sign-up') => {
    if (!supabase) throw new Error('unavailable')
    const signUp = intent === 'sign-up'
    let referralClaimToken: string | null = null
    try {
      referralClaimToken = await preparePendingReferralClaim(supabase)
    } catch (referralError) {
      // Регистрация без приглашения хуже, чем повтор: как и по почте, просим повторить.
      if (signUp) throw referralError
    }
    const deviceId = getGuestId()
    const { error: otpError } = await supabase.auth.signInWithOtp({
      phone: russianPhoneE164(phoneDigits),
      options: {
        shouldCreateUser: true,
        data: {
          ...(signUp ? { legal_source: 'phone', full_name: fullName.trim(), grade } : {}),
          ...(deviceId ? { device_id: deviceId } : {}),
          ...(referralClaimToken ? { referral_claim_token: referralClaimToken } : {}),
        },
      },
    })
    if (otpError) throw otpError
    const nextSentAt = Date.now()
    setPhoneIntent(intent)
    setPhoneSentAt(nextSentAt)
    setNow(nextSentAt)
  }

  const sendPhoneCode = async () => {
    const intent = screen === 'sign-up' ? 'sign-up' : 'sign-in'
    try {
      if (intent === 'sign-up') {
        if (fullName.trim().length < 2) throw new Error('name')
        if (!consentsGiven) throw new Error('legal consent')
      }
      if (!phoneIsValid) throw new Error('phone format')
      if (intent === 'sign-up') rememberPendingLegalAcceptance('phone')
      await requestPhoneCode(intent)
      setVerificationCode('')
      setScreen('verify-phone')
    } catch (caught) {
      if (intent === 'sign-up') forgetPendingLegalAcceptance()
      const message = caught instanceof Error ? caught.message : ''
      if (message === 'name') setError('Введи имя')
      else if (message === 'legal consent') setError(consentErrorMessage)
      else if (message === 'phone format') setError(phoneFormatError)
      else setError(authErrorMessage(message, 'phone'))
    }
  }

  const resendPhoneCode = async () => {
    if (loading || phoneResendIn > 0) return
    setLoading(true)
    setStatus('')
    setError('')
    try {
      await requestPhoneCode(phoneIntent)
      setVerificationCode('')
      setStatus('Новый код отправлен. Предыдущий больше не действует')
    } catch (caught) {
      setError(authErrorMessage(caught instanceof Error ? caught.message : '', 'phone'))
    } finally {
      setLoading(false)
    }
  }

  const verifyPhoneCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || loading || verificationCode.length !== 6) return
    setLoading(true)
    setStatus('')
    setError('')
    const { error: verificationError } = await supabase.auth.verifyOtp({
      phone: russianPhoneE164(phoneDigits),
      token: verificationCode,
      type: 'sms',
    })
    if (verificationError) setError(authErrorMessage(verificationError.message, 'phone'))
    else setStatus('Номер подтверждён')
    setLoading(false)
  }

  /* Яндекс ID. На вкладке «Регистрация» документы принимаются до перехода,
     как и при регистрации по почте: отметка уходит в подписанный state и
     записывается при создании аккаунта. */
  const signInWithYandex = async () => {
    if (loading) return
    const consents = screen === 'sign-up'
    if (consents && !consentsGiven) {
      setError(consentErrorMessage)
      return
    }
    setLoading(true)
    setStatus('')
    setError('')
    if (consents) rememberPendingLegalAcceptance('yandex')
    try {
      await startYandexSignIn(consents)
      // Вкладка уходит на Яндекс: кнопка остаётся занятой до перехода.
    } catch (caught) {
      if (consents) forgetPendingLegalAcceptance()
      const message = caught instanceof Error ? caught.message : ''
      setError(/[а-яё]/iu.test(message) ? message : 'Не получилось перейти к Яндексу. Попробуй ещё раз')
      setLoading(false)
    }
  }

  const chooseMethod = (next: AuthMethod) => {
    setMethod(next)
    setStatus('')
    setError('')
    setProblemField(null)
  }

  const focusProblem = (field: FormProblemField) => {
    if (field === 'consents') {
      formRef.current?.querySelector<HTMLInputElement>('.account-legal-consents input:not(:checked)')?.focus()
      return
    }
    const target = { name: nameRef, phone: phoneRef, email: emailRef, password: passwordRef, mfa: mfaRef }[field].current
    target?.focus()
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (loading) return
    if (screen === 'sign-in' || screen === 'sign-up' || screen === 'forgot' || screen === 'reset') {
      const problem = authFormProblem({ screen, usingPhone, fullName, phoneValid: phoneIsValid, email, password, consentsGiven, mfaRequired, mfaCode })
      if (problem) {
        setStatus('')
        setError(problem.message)
        setProblemField(problem.field)
        focusProblem(problem.field)
        return
      }
    }
    if (!supabase) return
    setLoading(true)
    setStatus('')
    setError('')
    setProblemField(null)

    if (usingPhone) {
      await sendPhoneCode()
      setLoading(false)
      return
    }

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
        // Метку читаем прямо перед отправкой: она живёт в localStorage и
        // могла появиться уже после того, как диалог открыли.
        const deviceId = getGuestId()
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
              /* Метка браузера - та же, по которой гостю выдаётся первое
                 бесплатное решение. Стартовые 20 ₽ выдаются один раз на
                 метку: до этого одноразовая почта стоила нам двадцати
                 рублей подарка, и ящиков таких бесконечно. Метки нет
                 (приватный режим, отключённое хранилище) - деньги всё
                 равно выдаются: честный ученик дороже редкого обхода. */
              ...(deviceId ? { device_id: deviceId } : {}),
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
      if (mfaRequired) {
        const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors()
        if (factorsError) throw factorsError
        const factor = (factors?.all ?? []).find((item) => item.factor_type === 'totp' && item.status === 'verified')
        if (!factor) throw new Error('mfa factor missing')
        const { error: mfaError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: mfaCode.trim() })
        if (mfaError) throw new Error('mfa code')
      }
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) {
        // Проверка уровня при открытии формы могла не успеть или ошибиться.
        if (updateError.code === 'insufficient_aal' || /aal2/iu.test(updateError.message)) {
          setMfaRequired(true)
          throw new Error('mfa required')
        }
        throw updateError
      }
      setStatus('Пароль обновлён')
      window.history.replaceState({}, '', window.location.pathname)
      if (onPasswordUpdated) {
        onPasswordUpdated()
        return
      }
      setScreen('sign-in')
      setPassword('')
    } catch (caught) {
      if (screen === 'sign-up') forgetPendingLegalAcceptance()
      const message = caught instanceof Error ? caught.message : ''
      if (message === 'name') setError('Введи имя')
      else if (message === 'weak password') setError('Выполни все требования к паролю')
      else if (message === 'legal consent') setError(consentErrorMessage)
      else if (message === 'mfa required') setError('Аккаунт защищён вторым фактором: введи шесть цифр из приложения-аутентификатора и сохрани ещё раз')
      else if (message === 'mfa code') setError('Код из приложения не подошёл. Проверь время на телефоне и введи новый код')
      else if (message === 'mfa factor missing') setError('Второй фактор аккаунта не найден. Напиши в поддержку')
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
        : screen === 'verify-email' || screen === 'verify-phone'
          ? 'Введи код'
        : 'Войди в аккаунт'

  const subtitle = screen === 'sign-up'
    ? 'Новому аккаунту — 20 ₽ на первые решения, один раз на устройство.'
    : screen === 'verify-email'
      ? 'Шесть цифр из письма — и аккаунт готов.'
      : screen === 'verify-phone'
        ? 'Шесть цифр из СМС — и ты в аккаунте.'
        : screen === 'forgot'
          ? 'Пришлём безопасную ссылку для нового пароля.'
          : screen === 'reset'
            ? 'Придумай новый надёжный пароль.'
            : usingPhone
              ? 'Пришлём код в СМС на этот номер.'
              : 'Войди по почте и паролю.'

  return (
    <div className="account-auth-view" ref={viewRef}>
      <aside className="account-auth-context" aria-hidden="true">
        <div className="account-auth-wordmark"><span>HC</span><strong>Homework Copilot</strong></div>
        <div className="account-auth-context-copy">
          {screen === 'verify-email' || screen === 'verify-phone' ? <ShieldCheck size={42} weight="duotone" /> : <LockKey size={42} weight="duotone" />}
          <strong>{screen === 'verify-email' ? 'Код остаётся на этом устройстве.' : screen === 'verify-phone' ? 'Код приходит в СМС.' : 'Аккаунт без лишних переходов.'}</strong>
          <p>{screen === 'verify-email' ? 'Открой письмо где угодно, а шесть цифр введи здесь.' : screen === 'verify-phone' ? 'Шесть цифр из сообщения введи здесь.' : 'Баланс и готовые решения будут ждать тебя после входа.'}</p>
        </div>
        <div className="account-auth-context-meta">
          <ClockCountdown size={20} weight="duotone" />
          <span>{screen === 'verify-email' ? 'Код действует 5 минут' : screen === 'verify-phone' ? 'Не пришёл за минуту — запроси новый' : 'Подтверждение занимает меньше минуты'}</span>
        </div>
      </aside>

      <section className="account-auth-panel">
        <div className="account-auth-brand">
          <span className="account-auth-mark">{screen === 'verify-email' ? <EnvelopeSimple size={28} weight="duotone" aria-hidden="true" /> : screen === 'verify-phone' || usingPhone ? <DeviceMobile size={28} weight="duotone" aria-hidden="true" /> : <UserCircle size={28} weight="duotone" aria-hidden="true" />}</span>
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

      {screen === 'verify-phone' && (
        <div className="account-email-check">
          <div className="account-email-check-lead">
            <div>
              <strong>Код отправлен</strong>
              <p>+7 {formatPhoneDigits(phoneDigits)}</p>
            </div>
          </div>
          <form className="account-verify-form" onSubmit={verifyPhoneCode}>
            <label htmlFor="account-phone-code">Код из СМС</label>
            <input
              id="account-phone-code"
              className="account-otp-input"
              value={verificationCode}
              onChange={(event) => { setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              placeholder="000000"
              aria-describedby="account-phone-code-help"
              autoFocus
              required
              data-initial-focus=""
            />
            <p id="account-phone-code-help">Телефон может подставить код из СМС сам.</p>
            <button className="account-primary-button" type="submit" disabled={loading || verificationCode.length !== 6}>
              {loading ? 'Проверяем…' : 'Подтвердить и войти'}
              {!loading && <ArrowRight size={18} weight="bold" aria-hidden="true" />}
            </button>
          </form>
        </div>
      )}

      {screen !== 'verify-email' && screen !== 'verify-phone' && <form className="account-auth-form" onSubmit={submit} noValidate ref={formRef}>
        {screen === 'sign-up' && (
          <div className="account-field-row">
            <label>
              <span>Имя</span>
              <div className="account-input-shell">
                <UserCircle size={19} weight="duotone" aria-hidden="true" />
                <input ref={nameRef} value={fullName} onChange={(event) => { setFullName(event.target.value); clearProblem('name') }} autoComplete="name" maxLength={80} placeholder="Как к тебе обращаться" required autoFocus aria-invalid={problemField === 'name' || undefined} data-initial-focus={screen === 'sign-up' ? '' : undefined} />
              </div>
            </label>
            <div className="account-grade-field">
              <span>Класс <small>по желанию</small></span>
              <GradeSelect value={grade} onChange={setGrade} compact />
            </div>
          </div>
        )}

        {usingPhone && (
          <label>
            <span>Номер телефона</span>
            <div className="account-input-shell">
              <DeviceMobile size={19} weight="duotone" aria-hidden="true" />
              <span className="account-phone-prefix" aria-hidden="true">+7</span>
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={formatPhoneDigits(phoneDigits)}
                ref={phoneRef}
                onChange={(event) => { setPhoneDigits(phoneDigitsFromInput(event.target.value)); setError(''); setProblemField(null) }}
                aria-invalid={problemField === 'phone' || undefined}
                placeholder="900 000-00-00"
                aria-describedby={phoneHelpId}
                required
                autoFocus={screen === 'sign-in'}
                data-initial-focus={screen === 'sign-in' ? '' : undefined}
              />
            </div>
          </label>
        )}
        {usingPhone && <small id={phoneHelpId} className="account-field-help">Только российский мобильный номер.</small>}

        {screen !== 'reset' && !usingPhone && (
          <label>
            <span>Почта</span>
            <div className="account-input-shell">
              <EnvelopeSimple size={19} weight="duotone" aria-hidden="true" />
              <input ref={emailRef} type="email" value={email} onChange={(event) => { setEmail(event.target.value); clearProblem('email') }} autoComplete="email" placeholder="name@example.com" required autoFocus={screen !== 'sign-up'} aria-invalid={problemField === 'email' || undefined} data-initial-focus={screen === 'sign-in' || screen === 'forgot' ? '' : undefined} />
            </div>
          </label>
        )}

        {screen !== 'forgot' && !usingPhone && (
          <div className="account-password-field">
            <label>
              <span>{screen === 'reset' ? 'Новый пароль' : 'Пароль'}</span>
              <div className="account-input-shell">
                <LockKey size={19} weight="duotone" aria-hidden="true" />
                <input
                  ref={passwordRef}
                  type={passwordVisible ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => { setPassword(event.target.value); clearProblem('password') }}
                  autoComplete={screen === 'sign-in' ? 'current-password' : 'new-password'}
                  minLength={8}
                  placeholder={requiresStrongPassword ? 'Не меньше 8 символов' : 'Твой пароль'}
                  aria-describedby={requiresStrongPassword ? (password ? passwordStrengthId : passwordHelpId) : undefined}
                  aria-invalid={problemField === 'password' || undefined}
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
            {/* Требования списком показываются, когда человек начал набирать:
                до этого правило целиком стоит одной строкой под полем, а
                четыре строки правил только удлиняют окно. */}
            {requiresStrongPassword && password.length === 0 && <small id={passwordHelpId} className="account-field-help">{passwordRequirementsHint}.</small>}
            {requiresStrongPassword && password.length > 0 && <PasswordStrength id={passwordStrengthId} value={password} />}
          </div>
        )}

        {screen === 'reset' && mfaRequired && (
          <label>
            <span>Код из приложения-аутентификатора</span>
            <div className="account-input-shell">
              <ShieldCheck size={19} weight="duotone" aria-hidden="true" />
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                ref={mfaRef}
                value={mfaCode}
                onChange={(event) => { setMfaCode(event.target.value.replace(/\D/g, '')); clearProblem('mfa') }}
                aria-invalid={problemField === 'mfa' || undefined}
                placeholder="6 цифр"
                required
              />
            </div>
          </label>
        )}

        {screen === 'sign-up' && (
          <LegalConsents
            agreementAccepted={agreementAccepted}
            personalDataAccepted={personalDataAccepted}
            ageConfirmed={ageConfirmed}
            onAgreementChange={setAgreementAccepted}
            onPersonalDataChange={setPersonalDataAccepted}
            onAgeChange={setAgeConfirmed}
          />
        )}

        {error && <p className="account-form-message is-error" role="alert">{error}</p>}
        {status && <p className="account-form-message is-success" role="status"><CheckCircle size={18} weight="fill" aria-hidden="true" />{status}</p>}

        <button className="account-primary-button" type="submit" disabled={loading}>
          {loading ? 'Подожди…' : usingPhone ? 'Получить код' : screen === 'sign-up' ? 'Создать аккаунт' : screen === 'forgot' ? 'Отправить ссылку' : screen === 'reset' ? 'Сохранить пароль' : 'Войти'}
          {!loading && <ArrowRight size={18} weight="bold" aria-hidden="true" />}
        </button>
      </form>}

      {(screen === 'verify-email' || screen === 'verify-phone') && (
        <>
          {error && <p className="account-form-message is-error" role="alert">{error}</p>}
          {status && <p className="account-form-message is-success" role="status"><CheckCircle size={18} weight="fill" aria-hidden="true" />{status}</p>}
        </>
      )}

      {/* Другие способы входа. Каждый виден, только когда его включили в
          админке: без ключей на сервере кнопка вела бы в отказ. */}
      {(screen === 'sign-in' || screen === 'sign-up') && (authMethods.yandex || authMethods.phone) && (
        <div className="account-auth-alternatives">
          <div className="account-auth-divider">или</div>
          {authMethods.yandex && (
            <button className="account-provider-button" type="button" onClick={() => { void signInWithYandex() }} disabled={loading}>
              <span className="account-provider-mark is-yandex" aria-hidden="true">Я</span>
              Войти с Яндекс ID
            </button>
          )}
          {authMethods.phone && (
            <button className="account-provider-button" type="button" onClick={() => chooseMethod(method === 'phone' ? 'email' : 'phone')} disabled={loading}>
              {method === 'phone'
                ? <EnvelopeSimple size={19} weight="duotone" aria-hidden="true" />
                : <DeviceMobile size={19} weight="duotone" aria-hidden="true" />}
              {method === 'phone' ? 'По почте и паролю' : 'По номеру телефона'}
            </button>
          )}
        </div>
      )}

      <div className="account-auth-secondary">
        {/* У аккаунта, вошедшего по телефону, пароля нет - и восстанавливать нечего. */}
        {screen === 'sign-in' && !usingPhone && <button type="button" onClick={() => switchScreen('forgot')}>Не помню пароль</button>}
        {(screen === 'forgot' || (screen === 'reset' && !onPasswordUpdated)) && <button type="button" onClick={() => switchScreen('sign-in')}>Вернуться ко входу</button>}
        {screen === 'verify-email' && (
          <>
            <button type="button" onClick={() => { void resendEmail() }} disabled={loading || resendIn > 0}>{resendIn > 0 ? `Новый код через ${formatCountdown(resendIn)}` : 'Отправить новый код'}</button>
            <button type="button" onClick={() => switchScreen('sign-up')}>Изменить почту</button>
          </>
        )}
        {screen === 'verify-phone' && (
          <>
            <button type="button" onClick={() => { void resendPhoneCode() }} disabled={loading || phoneResendIn > 0}>{phoneResendIn > 0 ? `Новый код через ${formatCountdown(phoneResendIn)}` : 'Отправить новый код'}</button>
            <button type="button" onClick={() => switchScreen(phoneIntent)}>Изменить номер</button>
          </>
        )}
      </div>

      </section>
    </div>
  )
}

export default function AccountDialog({ user, passwordRecovery, notice, onClose, returnFocusRef, legalAcceptanceRequired = false, onLegalAccepted, onPasswordUpdated, authMethods = onlyEmail }: AccountDialogProps) {
  const reduceMotion = useReducedMotion()
  const dialogRef = useModalIsolation<HTMLElement>(true, onClose, returnFocusRef)
  /* Ссылка из письма о смене пароля открывает сессию: человек уже вошёл, и
     профиль прятал форму нового пароля - задать его было негде. Вошедшему
     без согласия и без смены пароля окно не нужно: приложение его закрывает. */
  const view = !user ? 'auth' : legalAcceptanceRequired ? 'legal' : 'reset'

  return createPortal((
    <AnimatePresence>
      <motion.div
        className="account-dialog-backdrop is-auth-backdrop"
        role="presentation"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reduceMotion ? 0 : 0.18 }}
        onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}
      >
        <motion.section
          ref={dialogRef}
          className="account-dialog is-auth"
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-dialog-title"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.985, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, scale: 0.985, y: 8 }}
          transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          {view !== 'legal' && <button className="account-dialog-close" type="button" aria-label="Закрыть окно аккаунта" onClick={onClose}><X size={20} weight="bold" aria-hidden="true" /></button>}
          {user && view === 'legal'
            ? <LegalAcceptanceView user={user} onAccepted={() => onLegalAccepted?.()} />
            : <AuthView passwordRecovery={passwordRecovery || view === 'reset'} notice={notice} onPasswordUpdated={user ? onPasswordUpdated ?? (() => undefined) : undefined} authMethods={authMethods} />}
        </motion.section>
      </motion.div>
    </AnimatePresence>
  ), document.body)
}
