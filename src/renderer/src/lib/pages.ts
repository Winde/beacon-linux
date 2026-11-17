import type { CachedPages, CollectionData, ContentData } from '@shared/types'

/**
 * Pages loaded during this run. The screen paints from here before the first
 * request, and the persisted copy from the last launch is loaded in at boot.
 *
 * A page is account-specific, so the app clears this on sign-out or a session
 * the account check rejects. The count matches the disk store's guard; the
 * disk store's 2 MiB budget is the real bound, and this only keeps the map from
 * growing without limit during a long browse.
 */
const MAX_PAGES = 60

const collections = new Map<string, CollectionData>()
const contents = new Map<string, ContentData>()

function remember<T extends { slug: string }>(pages: Map<string, T>, page: T): void {
  // Re-inserting makes this the most recently used entry; Map order is what
  // the eviction below relies on.
  pages.delete(page.slug)
  pages.set(page.slug, page)
  while (pages.size > MAX_PAGES) {
    const oldest = pages.keys().next()
    if (oldest.done) break
    pages.delete(oldest.value)
  }
}

function get<T>(pages: Map<string, T>, slug: string): T | null {
  const page = pages.get(slug)
  if (!page) return null
  pages.delete(slug)
  pages.set(slug, page)
  return page
}

export const pageCache = {
  collection: (slug: string): CollectionData | null => get(collections, slug),
  content: (slug: string): ContentData | null => get(contents, slug),
  rememberCollection: (page: CollectionData): void => remember(collections, page),
  rememberContent: (page: ContentData): void => remember(contents, page),
  forgetCollection: (slug: string): void => {
    collections.delete(slug)
  },
  forgetContent: (slug: string): void => {
    contents.delete(slug)
  },
  /** Seed the memory from the slots the last launch left on disk. */
  load: (pages: CachedPages): void => {
    for (const page of pages.collections) remember(collections, page)
    for (const page of pages.contents) remember(contents, page)
  },
  clear: (): void => {
    collections.clear()
    contents.clear()
  }
}
