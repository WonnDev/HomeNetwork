import type { DiscoveredSSDPService } from '../types/discovery'

interface DiscoveredSSDPCardProps {
  service: DiscoveredSSDPService
}

export function DiscoveredSSDPCard({ service }: DiscoveredSSDPCardProps) {
  return (
    <article className="device-card">
      <div className="device-card-top">
        <div className="device-identity">
          <span className="device-icon" aria-hidden="true">◇</span>
          <div>
            <h3 className="device-name">{service.server ?? 'UPnP device'}</h3>
            <p className="device-ip">{service.location ?? 'Location unavailable'}</p>
          </div>
        </div>
        <span className="device-status"><span className="status-dot" aria-hidden="true" />Found</span>
      </div>
      <div className="device-meta">
        <span className="device-type">SSDP / UPnP</span>
        <div className="services" aria-label="SSDP metadata">
          {service.searchTarget && <span className="service-badge">{service.searchTarget}</span>}
          {service.usn && <span className="service-badge">USN</span>}
        </div>
      </div>
    </article>
  )
}
