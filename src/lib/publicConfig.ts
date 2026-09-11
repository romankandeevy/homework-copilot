/* Настройки из админки, которые видит приложение: включённые предметы и их
   порядок, фиче-флаги и баннер. Меняются без деплоя.

   Конфигурация читается один раз на заход и запоминается в localStorage:
   при следующем заходе приложение сразу показывает прежний вид, а свежие
   значения приходят следом. Не прочиталась - работаем как до админки: все
   предметы, все функции, без баннера.

   Клиент Supabase приходит параметром: приложение грузит его отдельным
   чанком, и статический импорт затянул бы его в основной бандл. */

import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from './database.types'
import { solvableSubjects } from './subjects'
import type { SolvableSubject } from './subjects'

export type SiteBanner = {
  enabled: boolean
  text: string
  tone: 'info' | 'warning' | 'danger'
  link: string
}

export type PublicConfig = {
  subjects: { id: string; enabled: boolean }[]
  flags: Record<string, boolean>
  banner: SiteBanner
}

const storageKey = 'homework-copilot:public-config'

export const defaultPublicConfig: PublicConfig = {
  subjects: solvableSubjects.map((subject) => ({ id: subject.id, enabled: true })),
  flags: {},
  banner: { enabled: false, text: '', tone: 'info', link: '' },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parsePublicConfig(value: Json | unknown): PublicConfig {
  if (!isRecord(value)) return defaultPublicConfig
  const subjects = Array.isArray(value.subjects)
    ? value.subjects.filter(isRecord).map((item) => ({ id: String(item.id ?? ''), enabled: item.enabled !== false })).filter((item) => item.id)
    : defaultPublicConfig.subjects
  const flags = isRecord(value.flags)
    ? Object.fromEntries(Object.entries(value.flags).map(([key, flag]) => [key, flag !== false]))
    : {}
  const banner = isRecord(value.banner) ? value.banner : {}
  const tone = banner.tone === 'warning' || banner.tone === 'danger' ? banner.tone : 'info'
  const link = typeof banner.link === 'string' && /^(https?:\/\/|\/)/.test(banner.link) ? banner.link : ''
  return {
    subjects,
    flags,
    banner: {
      enabled: banner.enabled === true && typeof banner.text === 'string' && banner.text.trim().length > 0,
      text: typeof banner.text === 'string' ? banner.text.trim().slice(0, 300) : '',
      tone,
      link,
    },
  }
}

function readStored(): PublicConfig {
  try {
    const raw = window.localStorage.getItem(storageKey)
    return raw ? parsePublicConfig(JSON.parse(raw)) : defaultPublicConfig
  } catch {
    return defaultPublicConfig
  }
}

let latest: PublicConfig | null = null

export async function fetchPublicConfig(client: SupabaseClient<Database>, guestId: string | null): Promise<PublicConfig> {
  const { data, error } = await client.rpc('get_public_config', { p_guest_id: guestId })
  if (error) throw error
  const config = parsePublicConfig(data)
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(config))
  } catch {
    // Не запомнилось - прочитаем в следующий раз заново.
  }
  latest = config
  return config
}

export function usePublicConfig(client: SupabaseClient<Database> | null, guestId: string | null = null) {
  const [config, setConfig] = useState<PublicConfig>(() => latest ?? readStored())

  useEffect(() => {
    if (!client) return
    let active = true
    fetchPublicConfig(client, guestId)
      .then((next) => { if (active) setConfig(next) })
      .catch(() => undefined)
    return () => { active = false }
  }, [client, guestId])

  return config
}

/* Флаг функции: неизвестный или непрочитанный флаг считается включённым -
   админка выключает функции, а не включает их. */
export function featureEnabled(config: PublicConfig, key: string) {
  return config.flags[key] !== false
}

/* Предметы в порядке из админки; выключенные скрыты. Предмет, которого
   нет в настройках (добавлен в код позже), идёт в конце и включён. */
export function orderedSubjects(config: PublicConfig): SolvableSubject[] {
  const byId = new Map(solvableSubjects.map((subject) => [subject.id, subject]))
  const listed = config.subjects
    .filter((item) => item.enabled && byId.has(item.id))
    .map((item) => byId.get(item.id)!)
  const known = new Set(config.subjects.map((item) => item.id))
  const rest = solvableSubjects.filter((subject) => !known.has(subject.id))
  const result = [...listed, ...rest]
  return result.length ? result : [...solvableSubjects]
}
