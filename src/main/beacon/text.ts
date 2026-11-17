/**
 * Text helpers: normalization, episode codes, image sizing and search relevance.
 *
 * The search scoring here is an independent implementation. It scores in the
 * 0..1 range by token coverage rather than summing fixed weights, and parses
 * episode codes by walking normalized words instead of matching one regex.
 */

export function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const DIGITS = /^\d+$/

/**
 * Pull an episode code out of a title or a query. Accepts the forms people
 * actually type: "c4e12", "C4 E012", "campaign 4 episode 12".
 */
export function episodeCode(text: string): string | null {
  const words = normalize(text).split(' ').filter(Boolean)

  for (let i = 0; i < words.length; i++) {
    const compact = /^c(\d+)e(\d+)$/.exec(words[i])
    if (compact) return `c${Number(compact[1])}e${Number(compact[2])}`

    const campaign = /^(?:c|campaign)(\d+)$/.exec(words[i])
    if (campaign) {
      const marker = /^(?:e|ep|episode)(\d+)$/.exec(words[i + 1] ?? '')
      if (marker) return `c${Number(campaign[1])}e${Number(marker[1])}`
    }

    if (
      words[i] === 'campaign' &&
      DIGITS.test(words[i + 1] ?? '') &&
      /^(?:e|ep|episode)$/.test(words[i + 2] ?? '') &&
      DIGITS.test(words[i + 3] ?? '')
    ) {
      return `c${Number(words[i + 1])}e${Number(words[i + 3])}`
    }
  }

  return null
}

/**
 * The title a card shows: Beacon's editor-set short `ottTitle` when there is
 * one, otherwise the full `title`. The full title stays in the model for
 * episode-code parsing and the content page header.
 */
export function displayTitle(value: {
  title?: string | null
  ottTitle?: string | null
}): string {
  const short = value.ottTitle?.trim()
  return short || value.title?.trim() || ''
}

/**
 * Cloudflare Images URLs carry a `format=auto` segment that accepts a width,
 * e.g. `.../format=auto,width=480`. Ask for the size we actually render.
 */
export function imageUrl(url: string | null | undefined, width: number): string | null {
  if (!url) return null
  const marker = 'format=auto'
  const at = url.indexOf(marker)
  if (at === -1) return url
  const afterMarker = at + marker.length
  // Replace an existing width rather than stacking a second one.
  const existing = /^,width=\d+/.exec(url.slice(afterMarker))
  const tail = url.slice(afterMarker + (existing ? existing[0].length : 0))
  return `${url.slice(0, afterMarker)},width=${width}${tail}`
}

/** Levenshtein distance, abandoned as soon as it exceeds `limit`. */
function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)

  for (let i = 1; i <= a.length; i++) {
    const current: number[] = [i]
    let rowMinimum = i
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
      if (current[j] < rowMinimum) rowMinimum = current[j]
    }
    if (rowMinimum > limit) return limit + 1
    previous = current
  }

  return previous[b.length]
}

function tokenScore(query: string, token: string): number {
  if (token === query) return 1
  if (token.startsWith(query)) return 0.85
  // "sleepy time" should still find "sleepytime".
  if (query.length >= 4 && token.includes(query)) return 0.7
  if (query.length >= 4) {
    const allowed = query.length >= 8 ? 2 : 1
    if (editDistance(query, token.slice(0, query.length + allowed), allowed) <= allowed) return 0.6
  }
  return 0
}

export interface SearchDocument {
  /** Normalized title, for the whole-phrase bonus. */
  norm: string
  /** Normalized words from the title and its series. */
  tokens: string[]
}

/** Relevance in 0..1; 0 means "no match". */
export function relevance(query: string, document: SearchDocument): number {
  const normalized = normalize(query)
  if (!normalized) return 0

  const words = normalized.split(' ')
  let matched = 0
  let total = 0

  for (const word of words) {
    let best = 0
    for (const token of document.tokens) {
      const score = tokenScore(word, token)
      if (score > best) best = score
      if (best === 1) break
    }
    if (best > 0) {
      matched++
      total += best
    }
  }

  if (!matched) return 0

  const coverage = matched / words.length
  // Long queries may miss a word; short ones must match completely.
  if (coverage < (words.length > 2 ? 0.67 : 1)) return 0

  const phraseBonus = document.norm.includes(normalized) ? 0.15 : 0
  return (total / words.length) * 0.7 + coverage * 0.15 + phraseBonus
}
