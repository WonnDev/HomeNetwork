import type { DiscoveredService } from '../types/discovery'

interface DiscoveredServiceCardProps {
  service: DiscoveredService
}

export function DiscoveredServiceCard({ service }: DiscoveredServiceCardProps) {
  return (
    <article className="device-card">
      <div className="device-card-top">
        <div className="device-identity">
          <span className="device-icon" aria-hidden="true">⌁</span>
          <div>
            <h3 className="device-name">{service.name}</h3>
            <p className="device-ip">{service.hostname ?? service.domain}</p>
          </div>
        </div>
        <span className="device-status"><span className="status-dot" aria-hidden="true" />Found</span>
      </div>
      <div className="device-meta">
        <span className="device-type">Bonjour service</span>
        <div className="services" aria-label="Service metadata">
          <span className="service-badge">{service.type}</span>
          {service.port !== undefined && <span className="service-badge">Port {service.port}</span>}
          {service.ipAddress && <span className="service-badge">{service.ipAddress}</span>}
        </div>
      </div>
    </article>
  )
}