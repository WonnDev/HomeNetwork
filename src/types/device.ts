export type DeviceType =
  | 'router'
  | 'camera'
  | 'tv'
  | 'air-conditioner'
  | 'iot'
  | 'nas'
  | 'unknown'

export type DeviceStatus = 'online' | 'offline'

export interface NetworkDevice {
  id: string
  name: string
  ip: string
  type: DeviceType
  status: DeviceStatus
  services: string[]
}
