import { Capacitor } from '@capacitor/core'
import { LocalNetworkPlugin } from '@wonn/local-network'
import { runWithDeadline } from './scanLifecycleService'

export const tcpDiscoveryPorts = [80, 443, 554, 8080, 8554] as const
export const maxScannableHosts = 1024

export interface ResponsiveIpHost {
  ipAddress: string
  ports: number[]
}

export interface Ipv4Subnet {
  networkAddress: string
  broadcastAddress: string
  prefixLength: number
  hostAddresses: string[]
}

export interface HostDiscoveryResult {
  status: 'complete' | 'partial-timeout' | 'cancelled' | 'unavailable' | 'failed'
  hosts: ResponsiveIpHost[]
  error?: string
  subnet?: Ipv4Subnet
  processed?: number
  total?: number
  statsByPort?: Record<string, Record<string, number>>
  pendingCancelled?: number
}

export interface HostDiscoveryProgress {
  processed: number
  total: number
  responsiveHosts: number
  ipAddress?: string
  port?: number
  statsByPort: Record<string, Record<string, number>>
  pendingCancelled?: number
}

export function groupResponsiveHostResults(results: Array<{ ipAddress: string; port: number }>): ResponsiveIpHost[] {
  const grouped = new Map<string, number[]>()
  results.forEach(({ ipAddress, port }) => {
    const ports = grouped.get(ipAddress) ?? []
    if (!ports.includes(port)) ports.push(port)
    grouped.set(ipAddress, ports)
  })
  return [...grouped.entries()].map(([ipAddress, ports]) => ({ ipAddress, ports: ports.sort((left, right) => left - right) }))
}

function parseIpv4(value: string): number[] | null {
  const octets = value.split('.').map(Number)
  return octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255) ? octets : null
}

function ipv4ToNumber(octets: number[]): number {
  return (((octets[0] << 24) >>> 0) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0
}

function numberToIpv4(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.')
}

function prefixFromMask(mask: string): number | null {
  const octets = parseIpv4(mask)
  if (!octets) return null
  const bits = octets.map((octet) => octet.toString(2).padStart(8, '0')).join('')
  if (!/^1*0*$/.test(bits)) return null
  return bits.indexOf('0') === -1 ? 32 : bits.indexOf('0')
}

export function calculateIpv4Subnet(ipAddress: string, subnetMask?: string | null, prefixLength?: number | null): Ipv4Subnet | null {
  const ip = parseIpv4(ipAddress)
  const prefix = prefixLength ?? (subnetMask ? prefixFromMask(subnetMask) : null)
  if (!ip || prefix === null || prefix === undefined || prefix < 16 || prefix > 30) return null

  const hostCount = (2 ** (32 - prefix)) - 2
  if (hostCount > maxScannableHosts) return null

  const mask = prefix === 32 ? 0xffffffff : (0xffffffff << (32 - prefix)) >>> 0
  const network = ipv4ToNumber(ip) & mask
  const broadcast = (network | (~mask >>> 0)) >>> 0
  const hostAddresses = Array.from({ length: hostCount }, (_, index) => numberToIpv4(network + index + 1))

  return {
    networkAddress: numberToIpv4(network),
    broadcastAddress: numberToIpv4(broadcast),
    prefixLength: prefix,
    hostAddresses,
  }
}

export async function cancelHostDiscovery(): Promise<void> {
  if (Capacitor.getPlatform() === 'ios') await LocalNetworkPlugin.cancelTcpScan()
}

export async function discoverResponsiveHosts(onProgress?: (progress: HostDiscoveryProgress) => void): Promise<HostDiscoveryResult> {
  if (Capacitor.getPlatform() !== 'ios') return { status: 'unavailable', hosts: [], error: 'Native TCP discovery is unavailable on this platform.' }

  try {
    const localAddress = await LocalNetworkPlugin.getLocalIPAddress()
    if (!localAddress.ipAddress) return { status: 'failed', hosts: [], error: 'Local IPv4 address is unavailable.' }
    const subnet = calculateIpv4Subnet(localAddress.ipAddress, localAddress.subnetMask, localAddress.prefixLength)
    if (!subnet) return { status: 'failed', hosts: [], error: 'The detected IPv4 subnet is unavailable or too large to scan safely.' }

    const partialHosts = new Map<string, number[]>()
    let partialStats: Record<string, Record<string, number>> = {}
    let partialProcessed = 0
    let partialTotal = subnet.hostAddresses.length * tcpDiscoveryPorts.length
    const progressHandle = await LocalNetworkPlugin.addListener('tcpScanProgress', (progress) => {
      partialStats = progress.statsByPort
      partialProcessed = progress.processed
      partialTotal = progress.total
      if (progress.ipAddress && progress.port !== undefined) {
        const ports = partialHosts.get(progress.ipAddress) ?? []
        if (!ports.includes(progress.port)) ports.push(progress.port)
        partialHosts.set(progress.ipAddress, ports)
      }
      onProgress?.(progress)
    })
    const scanPromise = LocalNetworkPlugin.scanTcpHosts({
      hosts: subnet.hostAddresses,
      ports: [...tcpDiscoveryPorts],
      timeoutMs: 350,
      maxConcurrency: 24,
    })
    let result: Awaited<typeof scanPromise>
    try {
      result = await runWithDeadline(scanPromise, 30000, () => void cancelHostDiscovery())
    } catch (error) {
      if (error instanceof Error && error.message === 'Operation timed out.') {
        return { status: 'partial-timeout', hosts: [...partialHosts.entries()].map(([ipAddress, ports]) => ({ ipAddress, ports: ports.sort((left, right) => left - right) })), processed: partialProcessed, total: partialTotal, statsByPort: partialStats, pendingCancelled: Math.max(0, partialTotal - partialProcessed), error: 'TCP discovery reached its 30-second deadline.' }
      }
      return { status: 'cancelled', hosts: [], error: 'TCP discovery was cancelled.' }
    } finally {
      await progressHandle.remove()
    }
    return {
      status: 'complete',
      subnet,
      hosts: groupResponsiveHostResults(result.hosts),
      processed: result.processed,
      total: result.total,
      statsByPort: result.statsByPort,
      pendingCancelled: result.pendingCancelled,
    }
  } catch (error) {
    return { status: 'failed', hosts: [], error: error instanceof Error ? error.message : 'TCP discovery failed.' }
  }
}
