export function getInitials(name: string | null | undefined, email?: string | null) {
  const source = name?.trim() || email?.split('@')[0] || 'Ученик'
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toLocaleUpperCase('ru')
}
