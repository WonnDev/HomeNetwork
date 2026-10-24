import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { LocalNetworkPlugin } from '@wonn/local-network'
import type { DiscoveredService, DiscoveredSSDPService } from '../types/discovery'

export const bonjourServiceTypes = [
  '_http._tcp',
  '_https._tcp',
  '_rtsp._tcp',
  '_airplay._tcp',
  '_googlecast._tcp',
  '_companion-link._tcp',
  '_raop._tcp',
  '_remoted._tcp',
  '_rdlink._tcp',
] as const

export type SsdpDiscoveryStatus = 'available' | 'unavailable'

export function isBonjourDiscoveryAvailable(): boolean {
  return Capacitor.getPlatform() === 'ios'
}

export function isSsdpDiscoveryAvailable(): boolean {
  return Capacitor.getPlatform() !== 'ios'
}

export async function startDiscovery(): Promise<void> {
  if (!isBonjourDiscoveryAvailable()) return
  await LocalNetworkPlugin.startBonjourDiscovery({ serviceTypes: [...bonjourServiceTypes] })
}

export async function stopDiscovery(): Promise<void> {
  if (!isBonjourDiscoveryAvailable()) return
  await LocalNetworkPlugin.stopBonjourDiscovery()
}

export function subscribeToFound(listener: (service: DiscoveredService) => void): Promise<PluginListenerHandle> {
  return LocalNetworkPlugin.addListener('bonjourServiceFound', listener)
}

export function subscribeToLost(listener: (service: DiscoveredService) => void): Promise<PluginListenerHandle> {
  return LocalNetworkPlugin.addListener('bonjourServiceLost', listener)
}

export function subscribeToSSDPFound(listener: (service: DiscoveredSSDPService) => void): Promise<PluginListenerHandle> {
  return LocalNetworkPlugin.addListener('ssdpServiceFound', listener)
}

export async function discoverNetworkServices(durationMs = 5000): Promise<{
  bonjourServices: DiscoveredService[]
  ssdpServices: DiscoveredSSDPService[]
  ssdpStatus: SsdpDiscoveryStatus
}> {
  if (!isBonjourDiscoveryAvailable()) return { bonjourServices: [], ssdpServices: [], ssdpStatus: 'unavailable' }

  const bonjourServices = new Map<string, DiscoveredService>()
  const ssdpServices = new Map<string, DiscoveredSSDPService>()
  const foundHandle = await subscribeToFound((service) => bonjourServices.set(service.id, service))
  const lostHandle = await subscribeToLost((service) => bonjourServices.delete(service.id))
  const ssdpAvailable = isSsdpDiscoveryAvailable()
  const ssdpHandle = ssdpAvailable ? await subscribeToSSDPFound((service) => ssdpServices.set(service.id, service)) : null

  try {
    await Promise.all([
      startDiscovery(),
      ssdpAvailable ? LocalNetworkPlugin.startSSDPDiscovery() : Promise.resolve(),
    ])
    await new Promise<void>((resolve) => window.setTimeout(resolve, durationMs))
    return {
      bonjourServices: [...bonjourServices.values()],
      ssdpServices: [...ssdpServices.values()],
      ssdpStatus: ssdpAvailable ? 'available' : 'unavailable',
    }
  } finally {
    await Promise.all([
      stopDiscovery(),
      ssdpAvailable ? LocalNetworkPlugin.stopSSDPDiscovery() : Promise.resolve(),
    ])
    await foundHandle.remove()
    await lostHandle.remove()
    if (ssdpHandle) await ssdpHandle.remove()
  }
}

export async function discoverBonjourServices(durationMs = 5000): Promise<DiscoveredService[]> {
  const result = await discoverNetworkServices(durationMs)
  return result.bonjourServices
}