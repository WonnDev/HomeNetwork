import { describe, expect, it } from 'vitest'
import { calculateIpv4Subnet, groupResponsiveHostResults, maxScannableHosts } from './hostDiscoveryService'

describe('calculateIpv4Subnet', () => {
  it('calculates a /24 host range without assuming a fixed network address', () => {
    const subnet = calculateIpv4Subnet('192.168.2.17', '255.255.255.0')
    expect(subnet?.networkAddress).toBe('192.168.2.0')
    expect(subnet?.broadcastAddress).toBe('192.168.2.255')
    expect(subnet?.hostAddresses).toHaveLength(254)
    expect(subnet?.hostAddresses[0]).toBe('192.168.2.1')
    expect(subnet?.hostAddresses.at(-1)).toBe('192.168.2.254')
  })

  it('supports a non-/24 subnet using prefix length', () => {
    const subnet = calculateIpv4Subnet('10.20.3.9', null, 28)
    expect(subnet?.networkAddress).toBe('10.20.3.0')
    expect(subnet?.broadcastAddress).toBe('10.20.3.15')
    expect(subnet?.hostAddresses).toHaveLength(14)
  })

  it('rejects invalid or non-contiguous masks', () => {
    expect(calculateIpv4Subnet('192.168.1.5', '255.0.255.0')).toBeNull()
    expect(calculateIpv4Subnet('192.168.1.5', null, 12)).toBeNull()
  })

  it('rejects subnets larger than the safe scan limit', () => {
    expect(calculateIpv4Subnet('192.168.0.5', null, 15)).toBeNull()
    expect(maxScannableHosts).toBe(1024)
  })

  it('preserves partial responsive hosts before an overall timeout', () => {
    expect(groupResponsiveHostResults([
      { ipAddress: '192.168.2.17', port: 80 },
      { ipAddress: '192.168.2.17', port: 443 },
      { ipAddress: '192.168.2.253', port: 80 },
    ])).toEqual([
      { ipAddress: '192.168.2.17', ports: [80, 443] },
      { ipAddress: '192.168.2.253', ports: [80] },
    ])
  })
})
