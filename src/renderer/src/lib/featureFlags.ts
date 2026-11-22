/**
 * Code-level switches for visual features.
 *
 * There is deliberately no settings UI yet: a flag is a hardcoded default that
 * a developer can change here, and a future settings screen can write to the
 * same object. Accessibility settings still win at runtime; nothing that moves
 * bypasses `prefers-reduced-motion` just because its flag is on.
 */
export interface FeatureFlags {
  /**
   * Crossfade between pages and carry the focused artwork into the new page
   * header (and back). Off makes every navigation take effect instantly.
   */
  pageTransitions: boolean
}

export type FeatureFlag = keyof FeatureFlags

export const featureFlags: FeatureFlags = {
  pageTransitions: true
}

export function featureEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag]
}
