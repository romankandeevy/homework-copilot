import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowSquareOut, CheckCircle, Moon, SignOut, Sun, Trash } from '@phosphor-icons/react'
import type { AccountData } from '../lib/supabase'
import { supabase } from '../lib/supabase'
import { applicationPath } from '../lib/appPath'
import { deleteMyAccount } from '../lib/accountDeletion'
import { formatPhoneForDisplay } from '../lib/phone'
import GradeSelect from './GradeSelect'
import { AccountGuest, AccountPageHeader } from './AccountPageHeader'
import type { AccountPageName } from './AccountPageHeader'
import './AccountDialog.css'
import './AccountPages.css'

type Theme = 'light' | 'dark'

type ProfilePageProps = {
  user: User | null
  account: AccountData | null
  notice?: string
  theme: Theme
  onToggleTheme: () => void
  onReloadAccount: () => Promise<void>
  onNavigate: (page: AccountPageName) => void
  onSignIn: () => void
  onSignedOut: () => void
}

/* Ссылка на админку - только у сотрудников.

   Спрашиваем ту же `get_admin_context`, по которой пускает сама админка.
   Ученику она отвечает `isAdmin: false` без ошибки, в журнал обращений не
   пишет (журнал ведёт `require_admin`) и второго фактора не требует - то
   есть дешёвая проверка без шума в журнале и в консоли. Один запрос при
   открытии профиля, не на каждой странице. Ссылка - подсказка: пускает в
   админку по-прежнему база. */
function useStaffAccess(userId: string) {
  const [staff, setStaff] = useState(false)

  useEffect(() => {
    if (!supabase) return
    let active = true
    // Запрос supabase-js ленивый: без then он не уходит вовсе.
    supabase.rpc('get_admin_context').then(({ data }) => {
      if (!active || !data || typeof data !== 'object' || Array.isArray(data)) return
      setStaff((data as Record<string, unknown>).isAdmin === true)
    }, () => undefined)
    return () => { active = false }
  }, [userId])

  return staff
}

function ProfileContent({ user, account, notice, theme, onToggleTheme, onReloadAccount, onNavigate, onSignedOut }: Omit<ProfilePageProps, 'user' | 'onSignIn'> & { user: User }) {
  const [fullName, setFullName] = useState(account?.profile.full_name ?? '')
  const [grade, setGrade] = useState(account?.profile.grade ? String(account.profile.grade) : '')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [deletionOpen, setDeletionOpen] = useState(false)
  const [deletionWord, setDeletionWord] = useState('')
  const staff = useStaffAccess(user.id)

  useEffect(() => {
    setFullName(account?.profile.full_name ?? '')
    setGrade(account?.profile.grade ? String(account.profile.grade) : '')
  }, [account])

  const saveProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || loading) return
    setLoading(true)
    setStatus('')
    setError('')
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim(), grade: grade ? Number(grade) : null })
      .eq('id', user.id)

    if (updateError) setError('Не получилось сохранить профиль')
    else {
      await onReloadAccount()
      setStatus('Профиль сохранён')
    }
    setLoading(false)
  }

  /* После выхода на профиле смотреть не на что: приложение уводит на
     главную, а не открывает окно входа поверх опустевшей страницы. */
  const signOut = async () => {
    if (!supabase || loading) return
    setLoading(true)
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' })
    if (signOutError) {
      setError('Не получилось выйти из аккаунта')
      setLoading(false)
      return
    }
    onSignedOut()
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

  const phoneLabel = formatPhoneForDisplay(user.phone)

  return (
    <section className="route-page account-page" aria-labelledby="account-page-title">
      <AccountPageHeader
        user={user}
        account={account}
        current="profile"
        onNavigate={onNavigate}
        action={staff && (
          /* Админка открывается в новой вкладке: владелец не должен терять
             то, что делает сейчас (14 сентября 2026). */
          <a className="account-admin-link" href={applicationPath('/admin')} target="_blank" rel="noopener">
            Админка
            <ArrowSquareOut size={17} weight="bold" aria-hidden="true" />
            <span className="sr-only">(откроется в новой вкладке)</span>
          </a>
        )}
      />

      {notice && <p className="account-page-notice" role="status">{notice}</p>}

      <div className="account-profile-body">
        <section className="account-page-section" aria-labelledby="profile-data-title">
          <header><h2 id="profile-data-title">Личные данные</h2><p>Имя и класс используются в интерфейсе.</p></header>
          <form className="account-profile-form" onSubmit={saveProfile}>
            <label>
              <span>Имя</span>
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={80} autoComplete="name" required />
            </label>
            <div className="account-grade-field">
              <span>Класс</span>
              <GradeSelect value={grade} onChange={setGrade} />
            </div>
            {(user.email || !phoneLabel) && (
              <label className="account-email-field">
                <span>Почта</span>
                <input value={user.email ?? ''} readOnly />
              </label>
            )}
            {phoneLabel && (
              <label className="account-email-field">
                <span>Телефон</span>
                <input value={phoneLabel} readOnly />
              </label>
            )}

            {error && <p className="account-form-message is-error" role="alert">{error}</p>}
            {status && <p className="account-form-message is-success" role="status"><CheckCircle size={18} weight="fill" aria-hidden="true" />{status}</p>}

            <button className="account-primary-button" type="submit" disabled={loading || fullName.trim().length < 1}>Сохранить</button>
          </form>
        </section>

        <section className="account-page-section" aria-labelledby="profile-theme-title">
          <header><h2 id="profile-theme-title">Тема</h2><p>Настрой вид приложения на этом устройстве.</p></header>
          <div className="account-theme-options">
            <button type="button" className={theme === 'light' ? 'is-selected' : ''} aria-pressed={theme === 'light'} onClick={() => { if (theme !== 'light') onToggleTheme() }}><Sun size={20} weight="regular" aria-hidden="true" /> Светлая</button>
            <button type="button" className={theme === 'dark' ? 'is-selected' : ''} aria-pressed={theme === 'dark'} onClick={() => { if (theme !== 'dark') onToggleTheme() }}><Moon size={20} weight="regular" aria-hidden="true" /> Тёмная</button>
          </div>
        </section>
      </div>

      <footer className="account-page-footer">
        {/* Названия те же, что в подвале сайта: два документа с тремя именами
            читались как три разных документа. */}
        <nav className="account-page-links" aria-label="Документы">
          <a href="/docs/privacy">Политика данных</a>
          <a href="/docs/terms">Пользовательское соглашение</a>
        </nav>
        <div className="account-page-footer-actions">
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
          <h2>Удалить аккаунт навсегда?</h2>
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
    </section>
  )
}

export default function ProfilePage(props: ProfilePageProps) {
  if (!props.user) return <AccountGuest page="profile" onSignIn={props.onSignIn} />
  return <ProfileContent {...props} user={props.user} />
}
