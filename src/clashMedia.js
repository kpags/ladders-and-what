export function clashMeleeAssetDirection(direction) {
  const normalized = String(direction || '').toLowerCase()
  if (normalized.startsWith('north')) return 'north'
  if (normalized.startsWith('south')) return 'south'
  if (normalized === 'east') return 'east'
  if (normalized === 'west') return 'west'
  return null
}
