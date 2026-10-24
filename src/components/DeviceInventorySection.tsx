import { useState } from 'react'
import type { DeviceInventoryRecord, InventoryRecognition } from '../services/deviceInventoryService'

interface DeviceInventorySectionProps {
  records: DeviceInventoryRecord[]
  storageError: string | null
  onAddManual: (name: string, ipAddress: string) => Promise<void>
  onUpdate: (id: string, changes: { name?: string; recognition?: InventoryRecognition }) => Promise<void>
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

export function DeviceInventorySection({ records, storageError, onAddManual, onUpdate }: DeviceInventorySectionProps) {
  const [name, setName] = useState('')
  const [ipAddress, setIpAddress] = useState('')

  const addManualRecord = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || !ipAddress.trim()) return
    await onAddManual(name, ipAddress)
    setName('')
    setIpAddress('')
  }

  return (
    <section className="devices-section inventory-section" aria-labelledby="inventory-heading">
      <div className="section-heading">
        <div><p className="eyebrow">Persistent local records</p><h2 id="inventory-heading">Device Inventory</h2></div>
        <span className="device-count" aria-label={`${records.length} inventory records`}>{records.length}</span>
      </div>
      <form className="inventory-form" onSubmit={(event) => void addManualRecord(event)}>
        <input aria-label="Device name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Device name" />
        <input aria-label="Device IP address" value={ipAddress} onChange={(event) => setIpAddress(event.target.value)} placeholder="IP address" inputMode="decimal" />
        <button type="submit">Add known device</button>
      </form>
      {storageError && <p className="scan-status scan-status-error" role="alert">{storageError}</p>}
      {records.length === 0 && <p className="service-empty-state">No inventory records yet. Add a router baseline or complete a scan.</p>}
      <div className="inventory-list">
        {records.map((record) => (
          <article className="inventory-card" key={record.id}>
            <div className="inventory-card-header">
              <div>
                <h3>{record.name}</h3>
                <p>{record.recognition === 'known' ? 'Known' : 'Unrecognized'} · {record.source === 'manual' ? 'Manual baseline' : record.observedInLatestCompletedScan ? 'Observed in latest scan' : 'Not observed in latest completed scan'}</p>
              </div>
              <button type="button" onClick={() => void onUpdate(record.id, { recognition: record.recognition === 'known' ? 'unrecognized' : 'known' })}>{record.recognition === 'known' ? 'Mark unrecognized' : 'Mark known'}</button>
            </div>
            <dl className="inventory-details">
              <dt>Last IP</dt><dd>{record.lastObservedIp ?? 'Unavailable'}</dd>
              <dt>First seen</dt><dd>{formatDate(record.firstSeen)}</dd>
              <dt>Last seen</dt><dd>{formatDate(record.lastSeen)}</dd>
              <dt>Evidence</dt><dd>{record.evidence.join(', ') || 'None'}</dd>
            </dl>
            <label className="inventory-name-editor">Friendly name<input value={record.name} onChange={(event) => void onUpdate(record.id, { name: event.target.value })} /></label>
          </article>
        ))}
      </div>
    </section>
  )
}
