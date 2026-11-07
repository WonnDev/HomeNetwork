import type { NetworkDevice, DeviceType } from '../types/device'
import type { DiscoveredService, DiscoveredSSDPService } from '../types/discovery'
import type { ResponsiveIpHost } from './hostDiscoveryService'

export interface ServiceIdentityDiagnostic {
  serviceId: string
  instanceName: string
  serviceType: string
  domain: string
  hostname?: string
  ipAddress?: string
  candidateId: string | null
  mergeReason: 'resolved-host' | 'display-name-only' | 'unique-service'
  matchesCurrentDevice: boolean
}

type AggregatedDevice = Omit<NetworkDevice, 'confidence' | 'evidence'> & {
  identityKeys: Set<string>
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function getLocationHost(location?: string): string | undefined {
  if (!location) return undefined

  try {
    return new URL(location).hostname
  } catch {
    return undefined
  }
}

function getUuid(usn?: string): string | undefined {
  const match = usn?.match(/uuid:([^:]+)/i)
  return match?.[1]?.toLowerCase()
}

function inferDeviceType(name: string, services: string[]): DeviceType {
  const searchableText = normalize(`${name} ${services.join(' ')}`)
  if (/(camera|onvif|rtsp)/.test(searchableText)) return 'camera'
  if (/(tv|roku|samsung)/.test(searchableText)) return 'tv'
  if (/(router|gateway|upnp igd)/.test(searchableText)) return 'router'
  if (/(nas|storage|synology|qnap)/.test(searchableText)) return 'nas'
  if (/(air conditioner|thermostat)/.test(searchableText)) return 'air-conditioner'
  return 'unknown'
}

function classifyConfidence(name: string, services: string[], type: DeviceType): { confidence: NetworkDevice['confidence']; evidence: string[] } {
  if (type === 'unknown') return { confidence: 'unknown', evidence: ['Insufficient evidence for a device category'] }

  const searchableText = normalize(`${name} ${services.join(' ')}`)
  const strongServicePatterns: Partial<Record<DeviceType, RegExp>> = {
    camera: /rtsp|onvif/,
    tv: /airplay|googlecast|roku/,
    router: /upnp|igd|gateway/,
    nas: /smb|nfs|synology|qnap/,
    'air-conditioner': /air conditioner|thermostat/,
    iot: /matter|homekit/,
  }
  const servicePattern = strongServicePatterns[type]
  const categoryEvidence = servicePattern ? services.filter((service) => servicePattern.test(normalize(service))) : []
  const nameEvidence = new RegExp(type === 'air-conditioner' ? 'air conditioner|thermostat' : type, 'i').test(searchableText)

  if (nameEvidence && categoryEvidence.length > 0) {
    return { confidence: 'high', evidence: [`Name or metadata suggests ${type}`, `Service evidence: ${categoryEvidence.join(', ')}`] }
  }
  if (categoryEvidence.length > 0 || nameEvidence) {
    return { confidence: 'medium', evidence: [nameEvidence ? `Name suggests ${type}` : `Service evidence: ${categoryEvidence.join(', ')}`] }
  }
  return { confidence: 'low', evidence: [`Weak metadata suggests ${type}`] }
}

function findMatchingDevice(devices: AggregatedDevice[], identityKeys: string[]): AggregatedDevice | undefined {
  const incomingUuid = identityKeys.find((key) => key.startsWith('uuid:'))
  const incomingHost = identityKeys.find((key) => key.startsWith('host:'))
  return devices.find((device) => {
    const existingUuid = [...device.identityKeys].find((key) => key.startsWith('uuid:'))
    const existingHost = [...device.identityKeys].find((key) => key.startsWith('host:'))
    if (incomingUuid && existingUuid && incomingUuid !== existingUuid) return false
    if (incomingHost && existingHost && incomingHost !== existingHost) return false
    return identityKeys.some((key) => device.identityKeys.has(key))
  })
}

function addService(device: AggregatedDevice, service: string) {
  if (!device.services.includes(service)) device.services.push(service)
  device.type = inferDeviceType(device.name, device.services)
}

function addDevice(
  devices: AggregatedDevice[],
  input: Omit<AggregatedDevice, 'identityKeys' | 'services' | 'type'> & { identityKeys: string[]; services: string[] },
) {
  const existing = findMatchingDevice(devices, input.identityKeys)
  if (existing) {
    input.services.forEach((service) => addService(existing, service))
    if (existing.ip === 'Address unavailable' && input.ip !== 'Address unavailable') existing.ip = input.ip
    if (existing.name === 'Unknown device' && input.name !== 'Unknown device') existing.name = input.name
    existing.identityKeys = new Set([...existing.identityKeys, ...input.identityKeys])
    return
  }

  devices.push({
    ...input,
    type: inferDeviceType(input.name, input.services),
    identityKeys: new Set(input.identityKeys),
  })
}

function bonjourIdentity(service: DiscoveredService): string[] {
  const name = normalize(service.name)
  const genericNames = new Set(['unknown', 'unknown device', 'device', 'localhost'])
  const identityKeys = name && !genericNames.has(name) ? [`bonjour-name:${name}`] : [`bonjour:${service.id}`]
  const host = service.hostname ?? service.ipAddress
  if (host) identityKeys.push(`host:${normalize(host)}`)
  return identityKeys
}

function ssdpIdentity(service: DiscoveredSSDPService): string[] {
  const host = getLocationHost(service.location)
  const uuid = getUuid(service.usn)
  const identityKeys = [`ssdp:${service.id}`]
  if (uuid) identityKeys.push(`uuid:${uuid}`)
  if (host) identityKeys.push(`host:${normalize(host)}`)
  return identityKeys
}

export function aggregateDiscoveredDevices(
  bonjourServices: DiscoveredService[],
  ssdpServices: DiscoveredSSDPService[],
): NetworkDevice[] {
  const devices: AggregatedDevice[] = []

  bonjourServices.forEach((service) => {
    const ip = service.ipAddress ?? service.hostname ?? 'Address unavailable'
    addDevice(devices, {
      id: `bonjour-${service.name}`,
      name: service.name || 'Unknown device',
      ip,
      status: 'online',
      identityKeys: bonjourIdentity(service),
      services: [service.type],
    })
  })

  ssdpServices.forEach((service) => {
    const host = getLocationHost(service.location)
    const name = service.server?.split('/')[0]?.trim() || host || 'Unknown device'
    const serviceName = service.searchTarget ?? 'SSDP'
    addDevice(devices, {
      id: `ssdp-${service.id}`,
      name,
      ip: host ?? 'Address unavailable',
      status: 'online',
      identityKeys: ssdpIdentity(service),
      services: [serviceName],
    })
  })

  return devices.sort((left, right) => left.id.localeCompare(right.id)).map((device) => ({
    ...classifyConfidence(device.name, device.services, device.type),
    id: device.id,
    name: device.name,
    ip: device.ip,
    type: device.type,
    status: device.status,
    services: [...device.services].sort(),
  }))
}

export function createCameraCandidatesFromHosts(hosts: ResponsiveIpHost[]): NetworkDevice[] {
  return hosts
    .filter((host) => host.ports.includes(554) || host.ports.includes(8554))
    .map((host) => {
      const rtspPorts = host.ports.filter((port) => port === 554 || port === 8554)
      return {
        id: `tcp-camera-${host.ipAddress}`,
        name: 'Camera candidate',
        ip: host.ipAddress,
        type: 'camera' as const,
        status: 'online' as const,
        services: rtspPorts.map((port) => `RTSP port ${port}`),
        confidence: 'low' as const,
        evidence: rtspPorts.map((port) => `TCP port ${port} may provide RTSP`),
      }
    })
}

export function createServiceIdentityDiagnostics(
  bonjourServices: DiscoveredService[],
  devices: NetworkDevice[],
  localIp: string | null,
): ServiceIdentityDiagnostic[] {
  return bonjourServices.map((service) => {
    const resolvedHost = service.ipAddress ?? service.hostname
    const hostMatch = resolvedHost ? devices.find((device) => device.ip === resolvedHost) : undefined
    const nameMatches = devices.filter((device) => device.name === (service.name || 'Unknown device'))
    const candidate = hostMatch ?? (nameMatches.length === 1 ? nameMatches[0] : undefined)
    const matchesCurrentDevice = Boolean(localIp && (service.ipAddress === localIp || service.hostname === localIp))

    return {
      serviceId: service.id,
      instanceName: service.name,
      serviceType: service.type,
      domain: service.domain,
      hostname: service.hostname,
      ipAddress: service.ipAddress,
      candidateId: candidate?.id ?? null,
      mergeReason: hostMatch ? 'resolved-host' : nameMatches.length === 1 ? 'display-name-only' : 'unique-service',
      matchesCurrentDevice,
    }
  })
}