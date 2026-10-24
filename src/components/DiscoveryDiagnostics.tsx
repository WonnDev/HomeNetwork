import type { NetworkDevice } from '../types/device'
import type { ServiceIdentityDiagnostic } from '../services/deviceAggregationService'
import type { HostDiscoveryProgress, HostDiscoveryResult } from '../services/hostDiscoveryService'

interface DiscoveryDiagnosticsProps {
  services: ServiceIdentityDiagnostic[]
  devices: NetworkDevice[]
  ssdpStatus: string
  hostDiscovery: HostDiscoveryResult
  progress: HostDiscoveryProgress
  bonjourDurationMs: number | null
  tcpDurationMs: number | null
}

export function DiscoveryDiagnostics({ services, devices, ssdpStatus, hostDiscovery, progress, bonjourDurationMs, tcpDurationMs }: DiscoveryDiagnosticsProps) {
  const currentDevice = devices.find((device) => device.isCurrentDevice)

  return (
    <details className="discovery-diagnostics">
      <summary>Discovery diagnostics</summary>
      <div className="diagnostics-grid">
        <span>Bonjour services</span><strong>{services.length}</strong>
        <span>Device candidates</span><strong>{devices.length}</strong>
        <span>Verified current device</span><strong>{currentDevice?.name ?? 'Unverified'}</strong>
        <span>SSDP</span><strong>{ssdpStatus}</strong>
        <span>Bonjour elapsed</span><strong>{bonjourDurationMs === null ? '—' : `${bonjourDurationMs}ms`}</strong>
        <span>TCP elapsed</span><strong>{tcpDurationMs === null ? '—' : `${tcpDurationMs}ms`}</strong>
        <span>Subnet</span><strong>{hostDiscovery.subnet ? `${hostDiscovery.subnet.networkAddress}/${hostDiscovery.subnet.prefixLength}` : '—'}</strong>
        <span>Target hosts</span><strong>{hostDiscovery.total === undefined ? '—' : Math.round(hostDiscovery.total / 5)}</strong>
        <span>TCP probes</span><strong>{hostDiscovery.processed === undefined ? `${progress.processed}/${progress.total}` : `${hostDiscovery.processed}/${hostDiscovery.total}`}</strong>
        <span>Pending cancelled</span><strong>{hostDiscovery.pendingCancelled ?? '—'}</strong>
      </div>
      {hostDiscovery.statsByPort && <ul className="diagnostics-list"><li><strong>TCP outcomes by port</strong><span>{Object.entries(hostDiscovery.statsByPort).map(([port, stats]) => `${port}: success ${stats.success ?? 0}, refused ${stats.refused ?? 0}, timeout ${stats.timeout ?? 0}, other ${stats.other ?? 0}, cancelled ${stats.cancelled ?? 0}`).join(' · ')}</span></li></ul>}
      {services.length > 0 && (
        <ul className="diagnostics-list">
          {services.map((service) => (
            <li key={service.serviceId}>
              <strong>{service.instanceName}</strong>
              <span>{service.serviceType} · {service.mergeReason}</span>
              <small>{service.candidateId ?? 'No candidate'}{service.matchesCurrentDevice ? ' · This iPhone' : ''}</small>
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}