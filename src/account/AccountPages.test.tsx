import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { User } from '@supabase/supabase-js'
import type { AccountData } from '../lib/supabase'
import ProfilePage from './ProfilePage'
import BalancePage from './BalancePage'

/* Страницы профиля и баланса (с 14 сентября 2026 - страницы, а не окно).
   Supabase, оплата и приглашения подменены: тест не ходит в сеть. */
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  range: vi.fn(),
  loadPaymentConfig: vi.fn(),
  loadReferralStatus: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: mocks.rpc,
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ range: mocks.range }) }) }) }),
    auth: { signOut: vi.fn(async () => ({ error: null })) },
  },
}))
vi.mock('../lib/payments', () => ({ loadPaymentConfig: mocks.loadPaymentConfig, createPayment: vi.fn() }))
vi.mock('../lib/referrals', () => ({ loadReferralStatus: mocks.loadReferralStatus }))

// На загруженной машине профиль рендерился дольше пятисекундного срока.
vi.setConfig({ testTimeout: 20_000 })

const user = { id: 'user-1', email: 'roman@example.com' } as User

function entry(index: number) {
  return {
    id: `entry-${index}`,
    user_id: user.id,
    amount: index === 0 ? 2000 : -400,
    kind: index === 0 ? 'credit' : 'debit',
    description: index === 0 ? 'Стартовый баланс' : `Решение задачи ${index}`,
    idempotency_key: `key-${index}`,
    created_at: '2026-09-14T10:00:00.000Z',
  }
}

function accountWith(entryCount: number): AccountData {
  return {
    profile: {
      id: user.id,
      full_name: 'Роман',
      grade: 8,
      avatar_path: 'preset:orbit',
      created_at: '2026-08-24T00:00:00.000Z',
      last_seen_at: null,
      updated_at: '2026-08-24T00:00:00.000Z',
    },
    balance: 2000,
    control: null,
    entries: Array.from({ length: entryCount }, (_, index) => entry(index)),
  }
}

const noop = () => undefined
const reload = async () => undefined

beforeEach(() => {
  mocks.rpc.mockReset()
  mocks.range.mockReset()
  mocks.loadPaymentConfig.mockReset()
  mocks.loadReferralStatus.mockReset()
  mocks.rpc.mockImplementation(async () => ({ data: { isAdmin: false }, error: null }))
  mocks.loadPaymentConfig.mockResolvedValue({ enabled: false, testMode: false, minKopecks: 5000, maxKopecks: 1500000 })
  mocks.loadReferralStatus.mockResolvedValue({
    code: 'ROMA01', invitedCount: 0, pendingCount: 0, rewardedCount: 0, earnedAmount: 0,
    joinedViaReferral: false, joinedRewardStatus: null, referrerRewardAmount: 1000, inviteeRewardAmount: 500,
  })
})

const renderProfile = (overrides: Partial<Parameters<typeof ProfilePage>[0]> = {}) => render(
  <ProfilePage user={user} account={accountWith(1)} theme="dark" onToggleTheme={noop} onReloadAccount={reload} onNavigate={noop} onSignIn={noop} onSignedOut={noop} {...overrides} />,
)

const renderBalance = (overrides: Partial<Parameters<typeof BalancePage>[0]> = {}) => render(
  <BalancePage user={user} account={accountWith(1)} promoEnabled onReloadAccount={reload} onNavigate={noop} onSignIn={noop} {...overrides} />,
)

describe('ProfilePage', () => {
  it('keeps the profile contents and links to the documents under /docs', async () => {
    const toggleTheme = vi.fn()
    renderProfile({ onToggleTheme: toggleTheme })

    expect(screen.getByRole('heading', { level: 1, name: 'Роман' })).toBeInTheDocument()
    const tabs = screen.getByRole('navigation', { name: 'Раздел аккаунта' })
    expect(within(tabs).getByRole('link', { name: 'Профиль' })).toHaveAttribute('aria-current', 'page')
    expect(within(tabs).getByRole('link', { name: /Баланс/ })).toHaveAttribute('href', '/balance')

    const grade = screen.getByRole('combobox', { name: 'Класс' })
    expect(grade).toHaveTextContent('8 класс')
    fireEvent.click(grade)
    expect(screen.getAllByRole('option')).toHaveLength(7)
    expect(screen.getByDisplayValue('roman@example.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Тёмная' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Светлая' }))
    expect(toggleTheme).toHaveBeenCalledOnce()

    // Названия те же, что в подвале сайта.
    expect(screen.getByRole('link', { name: 'Политика данных' })).toHaveAttribute('href', '/docs/privacy')
    expect(screen.getByRole('link', { name: 'Пользовательское соглашение' })).toHaveAttribute('href', '/docs/terms')
    expect(screen.getByRole('button', { name: /Удалить аккаунт/ })).toBeEnabled()

    // Ученику ссылки на админку нет: get_admin_context ответил isAdmin: false.
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('get_admin_context'))
    expect(screen.queryByRole('link', { name: /Админка/ })).not.toBeInTheDocument()
  })

  // Админка открывается в новой вкладке и видна только сотрудникам.
  it('shows the admin link to staff and opens it in a new tab', async () => {
    mocks.rpc.mockImplementation(async () => ({ data: { isAdmin: true, role: 'owner' }, error: null }))
    renderProfile()

    const admin = await screen.findByRole('link', { name: /Админка/ })
    expect(admin).toHaveAttribute('href', '/admin')
    expect(admin).toHaveAttribute('target', '_blank')
    expect(admin).toHaveAttribute('rel', 'noopener')
  })

  it('switches to the balance by router and leaves modified clicks to the browser', () => {
    const navigate = vi.fn()
    renderProfile({ onNavigate: navigate })
    const balance = within(screen.getByRole('navigation', { name: 'Раздел аккаунта' })).getByRole('link', { name: /Баланс/ })

    fireEvent.click(balance, { ctrlKey: true })
    expect(navigate).not.toHaveBeenCalled()
    fireEvent.click(balance)
    expect(navigate).toHaveBeenCalledWith('balance')
  })

  // У аккаунта, вошедшего по телефону, почты нет: в шапке и профиле - номер.
  it('shows the phone instead of an email for an account that signs in by phone', () => {
    const phoneUser = { id: 'user-2', email: '', phone: '79123456789', app_metadata: { provider: 'phone' } } as unknown as User
    renderProfile({ user: phoneUser })

    expect(screen.getByText('+7 912 345-67-89')).toBeInTheDocument()
    expect(screen.getByDisplayValue('+7 912 345-67-89')).toBeInTheDocument()
    expect(screen.queryByText('Почта')).not.toBeInTheDocument()
  })

  it('asks a guest to sign in instead of showing an empty profile', () => {
    const signIn = vi.fn()
    renderProfile({ user: null, account: null, onSignIn: signIn })
    fireEvent.click(screen.getByRole('button', { name: /Войти/ }))
    expect(signIn).toHaveBeenCalledOnce()
    expect(screen.queryByRole('navigation', { name: 'Раздел аккаунта' })).not.toBeInTheDocument()
  })
})

describe('BalancePage', () => {
  it('puts the available sum first and shows no tariff', async () => {
    renderBalance()

    const card = screen.getByRole('region', { name: 'Доступно сейчас' })
    expect(within(card).getByText('20 ₽')).toBeInTheDocument()
    /* Цена зависит от размера задачи (solutionPricing): кошелёк обещает
       пол цены - то, что верно для любой задачи. */
    expect(within(card).getByText('от 4 ₽')).toBeInTheDocument()
    expect(within(card).getByText('за решение, точная цена зависит от задачи')).toBeInTheDocument()
    // Тарифов и подписки у продукта нет.
    expect(screen.queryByText(/Тариф/)).not.toBeInTheDocument()
    expect(screen.queryByText(/в сутки/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Промокод' })).toBeInTheDocument()
    expect(await screen.findByText(/Пополнение пока недоступно/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Перейти к оплате' })).not.toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Публичная оферта' })).toHaveAttribute('href', '/docs/offer')
    expect(screen.getByRole('link', { name: 'Оплата и возвраты' })).toHaveAttribute('href', '/docs/terms#section-8')
    expect(screen.getByRole('link', { name: 'Как это работает' })).toHaveAttribute('href', '/support#faq')
    expect(screen.getByRole('link', { name: 'Реквизиты' })).toHaveAttribute('href', '/docs/contacts')
  })

  it('shows the top-up form only when the server turned payments on', async () => {
    mocks.loadPaymentConfig.mockResolvedValue({ enabled: true, testMode: false, minKopecks: 5000, maxKopecks: 1500000 })
    renderBalance()
    expect(await screen.findByRole('button', { name: 'Перейти к оплате' })).toBeInTheDocument()
    expect(screen.getByText(/^от 50 ₽ до 15\s000 ₽$/u)).toBeInTheDocument()
    expect(screen.queryByText(/Пополнение пока недоступно/)).not.toBeInTheDocument()
  })

  // Аудит 16 сентября, Г3: заглушка без выхода была тупиком.
  it('offers support instead of a dead end while payments are off', async () => {
    const openSupport = vi.fn()
    renderBalance({ onOpenSupport: openSupport })
    expect(await screen.findByText(/подключаем оплату картой, скоро заработает/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Написать в поддержку' }))
    expect(openSupport).toHaveBeenCalledOnce()
  })

  // Аудит 16 сентября, Г2: после пополнения и после нехватки денег - к задачам.
  it('leads back to the tasks from the notice that asks for it', () => {
    const back = vi.fn()
    const { rerender } = renderBalance({ notice: 'Баланс пополнен на 100 ₽', onBackToTasks: back })
    expect(screen.getByText('Баланс пополнен на 100 ₽')).toHaveAttribute('role', 'status')
    fireEvent.click(screen.getByRole('button', { name: 'Вернуться к задачам' }))
    expect(back).toHaveBeenCalledOnce()

    rerender(<BalancePage user={user} account={accountWith(1)} promoEnabled onReloadAccount={reload} onNavigate={noop} onSignIn={noop} notice="Проверяем платёж…" />)
    expect(screen.queryByRole('button', { name: 'Вернуться к задачам' })).not.toBeInTheDocument()
  })

  // Выключенный промокод не упоминается и в строке про пополнение.
  it('hides the promo code block when the admin turned it off', async () => {
    renderBalance({ promoEnabled: false })
    expect(screen.queryByRole('heading', { name: 'Промокод' })).not.toBeInTheDocument()
    expect(await screen.findByText(/Рубли приходят за приглашённого друга/)).toBeInTheDocument()
  })

  it('announces a wrong promo code as an error', async () => {
    mocks.rpc.mockImplementation(async (name: string) => (name === 'redeem_promo_code'
      ? { data: null, error: { message: 'promo code not found' } }
      : { data: null, error: null }))
    renderBalance()

    fireEvent.change(screen.getByRole('textbox', { name: 'Промокод' }), { target: { value: 'nope' } })
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Такого промокода нет')
    expect(alert).toHaveClass('account-inline-error')
    expect(screen.getByRole('textbox', { name: 'Промокод' })).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows the latest operations and loads the rest on request', async () => {
    mocks.range.mockResolvedValue({ data: Array.from({ length: 7 }, (_, index) => entry(index)), error: null })
    renderBalance({ account: accountWith(5) })

    const history = screen.getByRole('region', { name: 'История операций' })
    expect(within(history).getAllByRole('listitem')).toHaveLength(5)
    fireEvent.click(within(history).getByRole('button', { name: 'Показать ещё' }))
    await waitFor(() => expect(within(history).getAllByRole('listitem')).toHaveLength(7))
    expect(mocks.range).toHaveBeenCalledWith(0, 19)
    // Пришло меньше страницы - больше догружать нечего.
    expect(within(history).queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument()
  })

  it('does not offer more operations when the first ones are all there are', () => {
    renderBalance({ account: accountWith(2) })
    expect(screen.queryByRole('button', { name: 'Показать ещё' })).not.toBeInTheDocument()
  })

  // Ссылка «Скопировать ссылку» из админки: /balance?promo=КОД.
  it('fills the promo code from the link and drops it from the address', () => {
    window.history.replaceState({}, '', '/balance?promo=school-7f3k9q&from=admin')
    try {
      renderBalance()
      expect(screen.getByRole('textbox', { name: 'Промокод' })).toHaveValue('SCHOOL-7F3K9Q')
      expect(window.location.search).toBe('?from=admin')
    } finally {
      window.history.replaceState({}, '', '/')
    }
  })

  it('explains that a code is only for new accounts', async () => {
    mocks.rpc.mockImplementation(async (name: string) => (name === 'redeem_promo_code'
      ? { data: null, error: { message: 'promo code for new accounts only' } }
      : { data: null, error: null }))
    renderBalance()

    fireEvent.change(screen.getByRole('textbox', { name: 'Промокод' }), { target: { value: 'NEWBIE' } })
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Промокод только для новых аккаунтов')
  })

  /* С миграции 20260915130000 база отвечает на неверный код строкой
     { ok: false, error }, а не ошибкой: иначе откатывалась запись о попытке
     и лимит перебора не работал. Отказ строкой - та же красная ошибка. */
  it('treats an { ok: false } answer as a refusal, not as a credit', async () => {
    mocks.rpc.mockImplementation(async (name: string) => (name === 'redeem_promo_code'
      ? { data: { ok: false, error: 'promo code not found' }, error: null }
      : { data: null, error: null }))
    renderBalance()

    fireEvent.change(screen.getByRole('textbox', { name: 'Промокод' }), { target: { value: 'START20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Такого промокода нет')
    expect(screen.queryByText(/Начислено/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Промокод' })).toHaveValue('START20')
  })

  it('still credits on an { ok: true } answer', async () => {
    mocks.rpc.mockImplementation(async (name: string) => (name === 'redeem_promo_code'
      ? { data: { ok: true, kind: 'balance', amount: 2000, balance: 4000 }, error: null }
      : { data: null, error: null }))
    renderBalance()

    fireEvent.change(screen.getByRole('textbox', { name: 'Промокод' }), { target: { value: 'START20' } })
    fireEvent.click(screen.getByRole('button', { name: 'Применить' }))
    expect(await screen.findByText('Начислено 20 ₽')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
