/**
 * Category and field normalization for trailer inventory data.
 * Maps dealer-specific terminology to standard categories.
 */

const TYPE_MAP: Record<string, string> = {
  // Utility
  'utility trailer': 'Utility',
  'utility': 'Utility',
  'landscape trailer': 'Utility',
  'landscape': 'Utility',
  'pipe top utility': 'Utility',

  // Enclosed
  'enclosed trailer': 'Enclosed',
  'enclosed': 'Enclosed',
  'cargo trailer': 'Enclosed',
  'cargo': 'Enclosed',
  'cargo/enclosed': 'Enclosed',
  'enclosed cargo': 'Enclosed',
  'vending trailer': 'Enclosed',
  'concession trailer': 'Enclosed',

  // Dump
  'dump trailer': 'Dump',
  'dump': 'Dump',
  'low profile dump': 'Dump',
  'dump equipment': 'Dump',

  // Equipment / Flatbed
  'equipment trailer': 'Equipment',
  'equipment': 'Equipment',
  'flatbed trailer': 'Flatbed',
  'flatbed': 'Flatbed',
  'deckover': 'Flatbed',
  'deckover equipment': 'Flatbed',
  'tilt': 'Tilt',
  'tilt trailer': 'Tilt',

  // Gooseneck
  'gooseneck trailer': 'Gooseneck',
  'gooseneck': 'Gooseneck',
  'gooseneck dump': 'Gooseneck Dump',
  'gooseneck equipment': 'Gooseneck Equipment',
  'gooseneck flatbed': 'Gooseneck Flatbed',

  // Car hauler
  'car hauler': 'Car Hauler',
  'car hauler trailer': 'Car Hauler',
  'auto transport': 'Car Hauler',

  // Livestock
  'livestock trailer': 'Livestock',
  'livestock': 'Livestock',
  'horse trailer': 'Livestock',

  // Aluminum
  'aluminum trailer': 'Aluminum',
  'aluminum': 'Aluminum',
}

/** Normalize trailer type to standard category */
export function normalizeType(raw: string | undefined | null): string | null {
  if (!raw) return null
  const key = raw.toLowerCase().trim()
  return TYPE_MAP[key] || titleCase(raw.trim())
}

/** Normalize make/brand name */
export function normalizeMake(raw: string | undefined | null): string | null {
  if (!raw) return null
  return titleCase(raw.trim())
}

/** Parse price string to number */
export function parsePrice(raw: string | number | undefined | null): number | null {
  if (raw == null) return null
  if (typeof raw === 'number') return raw > 0 ? raw : null
  const cleaned = raw.replace(/[$,\s]/g, '')
  const num = parseFloat(cleaned)
  if (isNaN(num) || num <= 0) return null
  return num
}

/** Build a title from parts if not provided */
export function buildTitle(item: {
  year?: string
  make?: string
  model?: string
  type?: string
  size?: string
}): string {
  const parts = [item.year, item.make, item.model || item.size, item.type].filter(Boolean)
  return parts.join(' ') || 'Unknown Trailer'
}

function titleCase(str: string): string {
  return str
    .toLowerCase()
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
