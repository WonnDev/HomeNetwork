import { useState } from 'react'
import type { DeviceInventoryRecord, InventoryRecognition } from '../services/deviceInventoryService'

interface DeviceInventorySectionProps {
  records: DeviceInventoryRecord[]
  storageError: string | null
  onUpdate: (id: string, changes: { name?: string; recognition?: InventoryRecognition }) => Promise<void>
  onClear: () => Promise<void>
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString()
}

export function DeviceInventorySection({ records, storageError, onUpdate, onClear }: DeviceInventorySectionProps) {
  const [showAll, setShowAll] = useState(false)
  const visibleRecords = showAll ? records : records.slice(0, 5)

  return (
    <section className="devices-section inventory-section" aria-labelledby="inventory-heading">
      <div className="section-heading">
        <div><p className="eyebrow">Persistent local records</p><h2 id="inventory-heading">Device Inventory</h2></div>
        {records.length > 0 && <button className="inventory-clear-button" type="button" onClick={() => { if (window.confirm('Clear all local inventory records?')) void onClear() }}>Clear all</button>}
        <span className="device-count" aria-label={`${records.length} inventory records`}>{records.length}</span>
      </div>
      {storageError && <p className="scan-status scan-status-error" role="alert">{storageError}</p>}
      {records.length === 0 && <p className="service-empty-state">No inventory records yet. Add a router baseline or complete a scan.</p>}
      <div className="inventory-list">
        {visibleRecords.map((record) => (
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
      {records.length > 5 && <button className="list-expand-button" type="button" onClick={() => setShowAll((expanded) => !expanded)} aria-label={showAll ? 'Show fewer inventory records' : `Show all ${records.length} inventory records`} title={showAll ? 'Show fewer' : 'Show more'}>{showAll ? '⌃' : '⌄'}</button>}
    </section>
  )
}
