interface ScanButtonProps {
  isScanning: boolean
  onScan: () => void
  onCancel: () => void
}

export function ScanButton({ isScanning, onScan, onCancel }: ScanButtonProps) {
  if (isScanning) {
    return <button className="scan-button scan-button-cancel" type="button" onClick={onCancel}><span className="spinner" aria-hidden="true" />Cancel scan</button>
  }

  return <button className="scan-button" type="button" onClick={onScan}>Scan Network</button>
}
