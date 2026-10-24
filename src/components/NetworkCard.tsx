import type { NetworkInfo } from '../types/network'

interface NetworkCardProps {
  networkInfo: NetworkInfo | null
  onChangeWifi: () => void
}

export function NetworkCard({ networkInfo, onChangeWifi }: NetworkCardProps) {
  const isConnected = networkInfo?.status === 'connected'
  const connectionLabel = networkInfo ? (isConnected ? 'Connected' : 'Disconnected') : 'Loading...'

  return (
    <section className="network-card" aria-labelledby="network-status-heading">
      <div className="network-card-header">
        <div className="network-card-title">
          <span aria-hidden="true">⌁</span>
          <span id="network-status-heading">{networkInfo?.ssid ?? 'Wi-Fi network unavailable'}</span>
        </div>
        <span className={`status${isConnected ? '' : ' status-muted'}`}><span className="status-dot" aria-hidden="true" />{connectionLabel}</span>
      </div>
      <dl className="network-details">
        <div className="network-detail"><dt>Connection</dt><dd>{networkInfo?.connectionType ?? 'Detecting...'}</dd></div>
        <div className="network-detail"><dt>Your IP</dt><dd>{networkInfo?.localIp ?? 'Unavailable'}</dd></div>
        <div className="network-detail network-detail-wide"><dt>IPv6</dt><dd>{networkInfo?.localIpv6 ?? 'Unavailable'}</dd></div>
        <div className="network-detail network-detail-wide"><dt>Wi-Fi network</dt><dd>{networkInfo?.ssid ?? 'Unavailable'}</dd></div>
        <div className="network-detail"><dt>Platform</dt><dd>{networkInfo?.platform ?? 'Detecting...'}</dd></div>
      </dl>
      <button className="network-change-button" type="button" onClick={onChangeWifi}>Change Wi-Fi</button>
    </section>
  )
}
