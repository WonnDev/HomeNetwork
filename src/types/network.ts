export type AppPlatform = 'web' | 'ios' | 'android'
export type ConnectionStatus = 'connected' | 'disconnected'

export interface NetworkInfo {
  platform: AppPlatform
  status: ConnectionStatus
  connectionType: string
  localIp: string | null
  ssid: string | null
}