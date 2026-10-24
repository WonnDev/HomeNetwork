import type { ResponsiveIpHost } from '../services/hostDiscoveryService'

interface ResponsiveHostCardProps {
  host: ResponsiveIpHost
}

export function ResponsiveHostCard({ host }: ResponsiveHostCardProps) {
  return (
    <article className="responsive-host-card">
      <div>
        <h3>{host.ipAddress}</h3>
        <p>Responsive IP host</p>
      </div>
      <div className="services" aria-label="Responsive ports">
        {host.ports.map((port) => <span className="service-badge" key={port}>TCP {port}</span>)}
      </div>
    </article>
  )
}
