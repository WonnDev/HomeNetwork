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

export function DeviceCard({ device }: DeviceCardProps) {
  const isOnline = device.status === 'online'

  return (
    <article className="device-card">
      <div className="device-card-top">
        <div className="device-identity">
          <span className="device-icon" aria-hidden="true">{deviceIcons[device.type]}</span>
          <div>
            <h3 className="device-name">{device.name}</h3>
            <p className="device-ip">{device.ip}</p>
          </div>
        </div>
        <span className={`device-status${isOnline ? '' : ' offline'}`}>
          <span className="status-dot" aria-hidden="true" />
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>
      <div className="device-meta">
        <span className="device-type">{deviceLabels[device.type]}</span>
        {device.services.length > 0 && (
          <div className="services" aria-label="Services">
            {device.services.map((service) => <ServiceBadge key={service} service={service} />)}
          </div>
        )}
      </div>
    </article>
  )
}
