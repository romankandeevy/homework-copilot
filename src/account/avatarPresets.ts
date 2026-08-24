export const avatarPresets = [
  { id: 'orbit', label: 'Орбита' },
  { id: 'spark', label: 'Искра' },
  { id: 'wave', label: 'Волна' },
  { id: 'grid', label: 'Сетка' },
  { id: 'signal', label: 'Сигнал' },
  { id: 'focus', label: 'Фокус' },
] as const

export type AvatarPresetId = (typeof avatarPresets)[number]['id']

export function getAvatarPresetId(path: string | null | undefined): AvatarPresetId | null {
  if (!path?.startsWith('preset:')) return null
  const id = path.slice('preset:'.length)
  return avatarPresets.some((preset) => preset.id === id) ? id as AvatarPresetId : null
}
