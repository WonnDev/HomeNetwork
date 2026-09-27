interface ScanButtonProps {
  isScanning: boolean
  onScan: () => void
}

export function ScanButton({ isScanning, onScan }: ScanButtonProps) {
  return (
    <button className="scan-button" type="button" onClick={onScan} disabled={isScanning}>
      {isScanning && <span className="spinner" aria-hidden="true" />}
      {isScanning ? 'Scanning...' : 'Scan Network'}
    </button>
  )
}
