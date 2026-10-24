import { describe, expect, it } from 'vitest'
import { aggregateDiscoveredDevices, createServiceIdentityDiagnostics } from './deviceAggregationService'
import type { DiscoveredService, DiscoveredSSDPService } from '../types/discovery'

const bonjour = (overrides: Partial<DiscoveredService> = {}): DiscoveredService => ({
  id: 'bonjour-1',
  name: 'Living Room Camera',
  type: '_http._tcp',
  domain: 'local.',
  ...overrides,
})

const ssdp = (overrides: Partial<DiscoveredSSDPService> = {}): DiscoveredSSDPService => ({
  id: 'ssdp-1',
  usn: 'uuid:camera-1::upnp:rootdevice',
  location: 'http://192.168.1.20:80/device.xml',
  searchTarget: 'upnp:rootdevice',
  ...overrides,
})

const signature = (devices: ReturnType<typeof aggregateDiscoveredDevices>) => devices.map((device) => ({
  ...device,
  services: [...device.services].sort(),
}))

describe('aggregateDiscoveredDevices', () => {
  it('T1 returns an empty list without discovery records', () => {
    expect(aggregateDiscoveredDevices([], [])).toEqual([])
  })

  it('T2 and T3 merge repeated SSDP responses and UUID suffixes', () => {
    const devices = aggregateDiscoveredDevices([], [
      ssdp({ id: 'one', usn: 'uuid:router-1::upnp:rootdevice' }),
      ssdp({ id: 'two', usn: 'uuid:router-1::urn:schemas-upnp-org:device:InternetGatewayDevice:1' }),
    ])
    expect(devices).toHaveLength(1)
  })

  it('T4 merges multiple Bonjour types with the same device identity', () => {
    const devices = aggregateDiscoveredDevices([
      bonjour({ id: 'http', type: '_http._tcp' }),
      bonjour({ id: 'rtsp', type: '_rtsp._tcp' }),
    ], [])
    expect(devices).toHaveLength(1)
    expect(devices[0].services).toEqual(['_http._tcp', '_rtsp._tcp'])
  })

  it('T5 merges Bonjour and SSDP when the resolved host matches', () => {
    const devices = aggregateDiscoveredDevices([bonjour({ hostname: 'camera.local' })], [
      ssdp({ location: 'http://camera.local:80/device.xml' }),
    ])
    expect(devices).toHaveLength(1)
  })

  it('T6 keeps different UUIDs separate even with the same name and host', () => {
    const devices = aggregateDiscoveredDevices([], [
      ssdp({ id: 'one', usn: 'uuid:one::upnp:rootdevice', server: 'Same TV' }),
      ssdp({ id: 'two', usn: 'uuid:two::upnp:rootdevice', server: 'Same TV' }),
    ])
    expect(devices).toHaveLength(2)
  })

  it('T7 does not merge generic Bonjour names', () => {
    const devices = aggregateDiscoveredDevices([
      bonjour({ id: 'one', name: 'Unknown' }),
      bonjour({ id: 'two', name: 'Unknown' }),
    ], [])
    expect(devices).toHaveLength(2)
  })

  it('keeps same-name Bonjour devices separate when hostnames conflict', () => {
    const devices = aggregateDiscoveredDevices([
      bonjour({ id: 'one', hostname: 'one.local' }),
      bonjour({ id: 'two', hostname: 'two.local' }),
    ], [])
    expect(devices).toHaveLength(2)
  })

  it('T8 keeps valid SSDP data when optional headers are missing', () => {
    const devices = aggregateDiscoveredDevices([], [ssdp({ usn: undefined })])
    expect(devices).toHaveLength(1)
    expect(devices[0].ip).toBe('192.168.1.20')
  })

  it('T9 produces the same grouping regardless of input order', () => {
    const records = [bonjour({ id: 'one', name: 'Camera A' }), bonjour({ id: 'two', name: 'Camera B' })]
    expect(signature(aggregateDiscoveredDevices(records, []))).toEqual(signature(aggregateDiscoveredDevices([...records].reverse(), [])))
  })

  it('T10 does not create duplicates when scanning the same data again', () => {
    const records = [ssdp(), ssdp({ id: 'duplicate' })]
    expect(aggregateDiscoveredDevices([], records)).toHaveLength(1)
  })

  it('T11 classifies weak metadata as unknown', () => {
    const [device] = aggregateDiscoveredDevices([bonjour({ name: 'Kitchen service', type: '_airplay._tcp' })], [])
    expect(device.type).toBe('unknown')
  })

  it('T12 keeps services from multiple protocols on one device', () => {
    const [device] = aggregateDiscoveredDevices([bonjour({ hostname: 'camera.local', type: '_http._tcp' })], [
      ssdp({ location: 'http://camera.local/device.xml', searchTarget: 'urn:schemas-upnp-org:device:MediaRenderer:1' }),
    ])
    expect(device.services).toEqual(['_http._tcp', 'urn:schemas-upnp-org:device:MediaRenderer:1'])
  })

  it('marks the current device only when a service IP matches local IPv4', () => {
    const services = [bonjour({ ipAddress: '192.168.2.43', hostname: 'iphone.local' })]
    const devices = aggregateDiscoveredDevices(services, [])
    const [diagnostic] = createServiceIdentityDiagnostics(services, devices, '192.168.2.43')
    expect(diagnostic.matchesCurrentDevice).toBe(true)
    expect(diagnostic.mergeReason).toBe('resolved-host')
  })

  it('does not infer the current device from a display name alone', () => {
    const services = [bonjour({ name: 'Bò Trưởng Lão 🐮' })]
    const devices = aggregateDiscoveredDevices(services, [])
    const [diagnostic] = createServiceIdentityDiagnostics(services, devices, '192.168.2.43')
    expect(diagnostic.matchesCurrentDevice).toBe(false)
  })
})