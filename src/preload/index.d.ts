import type { BeaconApi } from '@shared/types'

declare global {
  interface Window {
    beacon: BeaconApi
  }
}

export {}
