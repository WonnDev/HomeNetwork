import type { DeviceType, NetworkDevice } from '../types/device'
import { ServiceBadge } from './ServiceBadge'

interface DeviceCardProps {
  device: NetworkDevice
}

const deviceIcons: Record<DeviceType, string> = {
  router: '⌂',
  camera: '◉',
  tv: '▣',
  'air-conditioner': '≋',
  iot: '⌁',
  nas: '▤',
  unknown: '?',
}

const deviceLabels: Record<DeviceType, string> = {
  router: 'Router',
  camera: 'Camera',
  tv: 'TV',
  'air-conditioner': 'Air conditioner',
  iot: 'IoT device',
  nas: 'NAS',
  unknown: 'Unknown device',
}

const confidenceLabels = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
  unknown: 'Not enough evidence',
} as const

export function DeviceCard({ device }: DeviceCardProps) {
  const isOnline = device.status === 'online'

  return (
    <article className="device-card">
      <div className="device-card-top">
        <div className="device-identity">
          <span className="device-icon" aria-hidden="true">{deviceIcons[device.type]}</span>
          <div>
            <h3 className="device-name">{device.name}{device.isCurrentDevice && <span className="current-device-label">This iPhone</span>}</h3>
            <p className="device-ip">{device.ip}</p>
          </div>
        </div>
        <span className={`device-status${isOnline ? '' : ' offline'}`}>
          <span className="status-dot" aria-hidden="true" />
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
      <div className="device-meta">
        <div className="device-classification">
          <span className="device-type">{deviceLabels[device.type]}</span>
          <span className={`device-confidence device-confidence-${device.confidence}`}>{confidenceLabels[device.confidence]}</span>
        </div>
        {device.services.length > 0 && (
          <div className="services" aria-label="Services">
            {device.services.map((service) => <ServiceBadge key={service} service={service} />)}
          </div>
        )}
      </div>
      <details className="device-evidence">
        <summary>Why this classification</summary>
        <ul>{device.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
      </details>
    </article>
  )
}
