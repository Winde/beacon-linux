import type { NextEpisode } from '@shared/types'

/**
 * Which video the player may chain into when the current one ends.
 *
 * Beacon's `fetchSeries(...) { next }` pointer is editorial rather than
 * arithmetic: it skips trailers, level-ups and opening titles filed inside a
 * series, resolves two-part episodes, and crosses season boundaries. What it
 * does *not* do is refuse a candidate that belongs to a different run, so the
 * rules below are the difference between "the next episode" and "some other
 * video that happens to be numbered next".
 *
 * Everything here was checked against the live CMS; the comments name the
 * cases that motivated each rule.
 */

/** What the player knows about the video that is ending. */
export interface UpNextContext {
  /** The collection the video belongs to, if any. */
  collectionId: string | null
  isSeries: boolean
  episodeNumber: number | null
}

/** A candidate answered by Beacon's series `next` pointer. */
export interface UpNextCandidate {
  slug: string
  title: string
  image: string | null
  minutes: number | null
  /** true when the account's tier is too low for the candidate */
  locked: boolean
  episodeNumber: number | null
  /** `primaryCollection.id` of the candidate */
  collectionId: string
}

/**
 * The candidate to offer after `context`, or null to let the video end.
 *
 * Only series chain. Collection folders are release-ordered anthologies — the
 * one-shot and live-show folders have no watch order, so a next item there is
 * not a next anything. Their `fetchSeries` call answers HTTP 500 anyway.
 */
export function chooseUpNext(
  context: UpNextContext,
  candidate: UpNextCandidate | null
): NextEpisode | null {
  if (!candidate || !context.isSeries || !context.collectionId) return null

  // A video outside any collection has no sequence to continue.
  if (candidate.collectionId !== context.collectionId) return null

  // Locked next: no overlay at all rather than a countdown into an error.
  if (candidate.locked) return null

  // Both sides must carry an episode number; without one there is no way to
  // tell "the next episode" from "the next row".
  if (context.episodeNumber == null || candidate.episodeNumber == null) return null

  // Must be later in the same run. This is the rule that keeps autoplay honest
  // where Beacon's numbering restarts:
  //
  //   Exandria Unlimited: Kymal E2  -> Calamity E1     (another miniseries)
  //   Midst S1 finale               -> S2 E1           (a new season)
  //   Cooldown: Shattered Legends E1 -> C4 E001        (another show's cooldown;
  //                                                     nine shows share ep 1)
  //
  // Campaigns are unaffected: their seasons continue numbering (C3 season 1 is
  // E1-18, season 2 is E19-38), so a season boundary is still a later episode.
  // Two-part episodes pass because the pointer reports Part 2 one number up.
  if (candidate.episodeNumber <= context.episodeNumber) return null

  return {
    slug: candidate.slug,
    title: candidate.title,
    image: candidate.image,
    minutes: candidate.minutes
  }
}
