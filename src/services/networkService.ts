import { mockDevices } from '../data/mockDevices'
import type { NetworkDevice } from '../types/device'

export function scanNetwork(): Promise<NetworkDevice[]> {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(mockDevices), 1500)
  })
}
