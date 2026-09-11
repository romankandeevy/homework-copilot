/* Общий контекст админки: кто вошёл, что ему можно, как открыть карточку
   пользователя или другой раздел из любого места. */

import { createContext, useContext } from 'react'

export type AdminRole = 'owner' | 'admin' | 'support'

export type AdminPermissions = {
  /** Просмотр пользователей и карточки. Есть у всех ролей. */
  users: boolean
  /** Обращения в поддержку. Есть у всех ролей. */
  support: boolean
  /** Бан, лимиты, тарифы, антифрод, вход под пользователем. admin и owner. */
  moderate: boolean
  /** Баланс, пополнения, финансы. admin и owner. */
  money: boolean
  /** Настройки, промокоды, промпты, флаги, уведомления, мониторинг. admin и owner. */
  settings: boolean
  /** Удаление данных (решений, тарифов). Только owner. */
  delete: boolean
  /** Возвраты денег. Только owner. */
  payouts: boolean
  /** Назначение ролей администраторам. Только owner. */
  admins: boolean
}

export type AdminAccess = {
  userId: string
  email: string
  role: AdminRole
  permissions: AdminPermissions
}

export type AdminSection =
  | 'dashboard'
  | 'users'
  | 'fraud'
  | 'support'
  | 'monitoring'
  | 'finance'
  | 'library'
  | 'settings'
  | 'notifications'
  | 'audit'

export type AdminSignals = {
  /** Обращения, ждущие ответа администратора. */
  pendingTickets: number
  /** Из них просрочены по SLA. */
  overdueTickets: number
  /** Открытые флаги антифрода. */
  openFlags: number
  /** Новые и неразобранные группы ошибок. */
  openErrors: number
  /** Счётчик событий Realtime: меняется при новой ошибке или сообщении. */
  pulse: number
}

export type AdminContextValue = {
  access: AdminAccess
  signals: AdminSignals
  /** Открыть карточку пользователя поверх текущего раздела. */
  openUser: (userId: string) => void
  /** Перейти в раздел; params попадут в адрес как фильтры раздела. */
  openSection: (section: AdminSection, params?: Record<string, string>) => void
  /** Пересчитать счётчики в меню (после действия, меняющего их). */
  refreshSignals: () => void
}

export const AdminContext = createContext<AdminContextValue | null>(null)

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext)
  if (!value) throw new Error('useAdmin вызван вне админки')
  return value
}
