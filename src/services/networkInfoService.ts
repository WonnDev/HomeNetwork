import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { Network } from '@capacitor/network'
import { LocalNetworkPlugin } from '@wonn/local-network'
import type { AppPlatform, ConnectionStatus, NetworkInfo } from '../types/network'

const privateIpv4Pattern = /(?:^|\s)(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3})(?:$|\s)/

function getPlatform(): AppPlatform {
  const platform = Capacitor.getPlatform()
  return platform === 'ios' || platform === 'android' ? platform : 'web'
}

async function discoverLocalIp(): Promise<string | null> {
  if (typeof RTCPeerConnection === 'undefined') return null

  return new Promise((resolve) => {
    const peerConnection = new RTCPeerConnection({ iceServers: [] })
    const foundAddresses = new Set<string>()
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      peerConnection.close()
      resolve(foundAddresses.values().next().value ?? null)
    }

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate) {
        finish()
        return
      }

      const match = event.candidate.candidate.match(privateIpv4Pattern)
      if (match?.[1]) foundAddresses.add(match[1])
    }

    peerConnection.createDataChannel('network-info')
    void peerConnection.createOffer()
      .then((offer) => peerConnection.setLocalDescription(offer))
      .catch(() => finish())

    window.setTimeout(finish, 1200)
  })
}

function isIpv4Address(value: string | null | undefined): value is string {
  return value !== undefined && value !== null && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)
}

interface LocalAddresses {
  ipv4: string | null
  ipv6: string | null
}

async function resolveLocalAddresses(platform: AppPlatform): Promise<LocalAddresses> {
  if (platform === 'ios') {
    try {
      const nativeAddress = await LocalNetworkPlugin.getLocalIPAddress()
      return {
        ipv4: isIpv4Address(nativeAddress.ipAddress) ? nativeAddress.ipAddress : null,
        ipv6: nativeAddress.ipv6Address ?? null,
      }
    } catch {
      // Fall back to the browser resolver if the native plugin is unavailable.
    }
  }

  return { ipv4: await discoverLocalIp(), ipv6: null }
}

function normalizeStatus(connected: boolean): ConnectionStatus {
  return connected ? 'connected' : 'disconnected'
}

export async function getNetworkInfo(): Promise<NetworkInfo> {
  const platform = getPlatform()

  try {
    const [networkStatus, localAddresses] = await Promise.all([
      Network.getStatus(),
      resolveLocalAddresses(platform),
    ])

    return {
      platform,
      status: normalizeStatus(networkStatus.connected),
      connectionType: networkStatus.connectionType,
      localIp: localAddresses.ipv4,
      localIpv6: localAddresses.ipv6,
      ssid: null,
    }
  } catch {
    const localAddresses = await resolveLocalAddresses(platform)
    return {
      platform,
      status: normalizeStatus(navigator.onLine),
      connectionType: 'unknown',
      localIp: localAddresses.ipv4,
      localIpv6: localAddresses.ipv6,
      ssid: null,
    }
  }
}

export async function openWifiSettings(): Promise<void> {
  if (getPlatform() === 'ios') await LocalNetworkPlugin.openWifiSettings()
}

export function watchNetworkInfo(onChange: (info: NetworkInfo) => void): Promise<PluginListenerHandle> {
  return Network.addListener('networkStatusChange', async () => {
    onChange(await getNetworkInfo())
  })
}