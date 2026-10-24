export type AppPlatform = 'web' | 'ios' | 'android'
export type ConnectionStatus = 'connected' | 'disconnected'

export interface NetworkInfo {
  platform: AppPlatform
  status: ConnectionStatus
  connectionType: string
  localIp: string | null
  localIpv6: string | null
  ssid: string | null
}