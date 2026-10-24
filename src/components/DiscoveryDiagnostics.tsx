import type { NetworkDevice } from '../types/device'
import type { ServiceIdentityDiagnostic } from '../services/deviceAggregationService'

interface DiscoveryDiagnosticsProps {
  services: ServiceIdentityDiagnostic[]
  devices: NetworkDevice[]
  ssdpStatus: string
}

export function DiscoveryDiagnostics({ services, devices, ssdpStatus }: DiscoveryDiagnosticsProps) {
  if (!import.meta.env.DEV) return null

  const currentDevice = devices.find((device) => device.isCurrentDevice)

  return (
    <details className="discovery-diagnostics">
      <summary>Discovery diagnostics</summary>
      <div className="diagnostics-grid">
        <span>Bonjour services</span><strong>{services.length}</strong>
        <span>Device candidates</span><strong>{devices.length}</strong>
        <span>Verified current device</span><strong>{currentDevice?.name ?? 'Unverified'}</strong>
        <span>SSDP</span><strong>{ssdpStatus}</strong>
      </div>
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