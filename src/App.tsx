import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { DeviceCard } from './components/DeviceCard'
import { DiscoveryDiagnostics } from './components/DiscoveryDiagnostics'
import { Header } from './components/Header'
import { NetworkCard } from './components/NetworkCard'
import { ScanButton } from './components/ScanButton'
import { getNetworkInfo, openWifiSettings, watchNetworkInfo } from './services/networkInfoService'
import { scanNetwork } from './services/networkService'
import { discoverNetworkServices, isBonjourDiscoveryAvailable, type SsdpDiscoveryStatus } from './services/networkDiscoveryService'
import { aggregateDiscoveredDevices, createServiceIdentityDiagnostics, type ServiceIdentityDiagnostic } from './services/deviceAggregationService'
import type { NetworkInfo } from './types/network'
import type { NetworkDevice } from './types/device'
import './App.css'

function App() {
  const [devices, setDevices] = useState<NetworkDevice[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [hasScanned, setHasScanned] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null)
  const [ssdpStatus, setSsdpStatus] = useState<SsdpDiscoveryStatus>('unavailable')
  const [identityDiagnostics, setIdentityDiagnostics] = useState<ServiceIdentityDiagnostic[]>([])
  const [pullDistance, setPullDistance] = useState(0)
  const touchStartY = useRef<number | null>(null)
  const networkKeyRef = useRef<string | null>(null)

  const scanCurrentNetwork = async () => {
    if (isScanning) return
    setIsScanning(true)
    setScanError(null)
    setHasScanned(false)

    try {
      if (isBonjourDiscoveryAvailable()) {
        const discoveredServices = await discoverNetworkServices()
        setSsdpStatus(discoveredServices.ssdpStatus)
        const aggregatedDevices = aggregateDiscoveredDevices(discoveredServices.bonjourServices, discoveredServices.ssdpServices)
        const diagnostics = createServiceIdentityDiagnostics(discoveredServices.bonjourServices, aggregatedDevices, networkInfo?.localIp ?? null)
        const currentCandidateIds = new Set(diagnostics.filter((diagnostic) => diagnostic.matchesCurrentDevice && diagnostic.candidateId).map((diagnostic) => diagnostic.candidateId))
        setIdentityDiagnostics(diagnostics)
        setDevices(aggregatedDevices.map((device) => ({ ...device, isCurrentDevice: currentCandidateIds.has(device.id) })))
      } else {
        setSsdpStatus('unavailable')
        setIdentityDiagnostics([])
        setDevices(await scanNetwork())
      }
      setHasScanned(true)
    } catch {
      setDevices([])
      setIdentityDiagnostics([])
      setScanError('Scan failed. Check Local Network permission and try again.')
      setHasScanned(true)
    } finally {
      setIsScanning(false)
    }
  }

  const refreshNetworkInfo = async () => {
    const info = await getNetworkInfo()
    const networkKey = `${info.ssid ?? ''}|${info.localIp ?? ''}|${info.connectionType}`
    const networkChanged = networkKeyRef.current !== null && networkKeyRef.current !== networkKey
    networkKeyRef.current = networkKey
    setNetworkInfo(info)

    if (networkChanged && info.status === 'connected') {
      setDevices([])
      setIdentityDiagnostics([])
      void scanCurrentNetwork()
    }
  }
  const refreshNetworkInfoEvent = useEffectEvent(refreshNetworkInfo)

  useEffect(() => {
    let isMounted = true

    void Promise.resolve().then(() => refreshNetworkInfoEvent())

    const networkListener = watchNetworkInfo(() => {
      if (isMounted) void refreshNetworkInfoEvent()
    })
    const appStateListener = CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void refreshNetworkInfoEvent()
    })

    return () => {
      isMounted = false
      void networkListener.then((handle) => handle.remove())
      void appStateListener.then((handle) => handle.remove())
    }
  }, [])

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isScanning && window.scrollY === 0) touchStartY.current = event.touches[0].clientY
  }

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartY.current === null) return
    const distance = event.touches[0].clientY - touchStartY.current
    if (distance > 0) setPullDistance(Math.min(distance * 0.45, 72))
  }

  const handleTouchEnd = () => {
    const shouldScan = pullDistance >= 52 && !isScanning
    touchStartY.current = null
    setPullDistance(0)
    if (shouldScan) void scanCurrentNetwork()
  }

  return (
    <div
      className="app-shell"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className={`pull-refresh-indicator${pullDistance > 0 ? ' is-visible' : ''}`} style={{ transform: `translateY(${pullDistance - 30}px)` }} aria-live="polite">
        {pullDistance >= 52 ? 'Release to scan' : 'Pull to scan'}
      </div>
      <Header />
      <main className="app-main">
        <NetworkCard networkInfo={networkInfo} onChangeWifi={() => void openWifiSettings()} />
        <ScanButton isScanning={isScanning} onScan={() => void scanCurrentNetwork()} />
        {isBonjourDiscoveryAvailable() && <p className="discovery-note" role="status">Bonjour enabled · {ssdpStatus === 'unavailable' ? 'SSDP unavailable: multicast entitlement not granted' : 'SSDP enabled'}</p>}
        {!isScanning && scanError && <p className="scan-status scan-status-error" role="alert">{scanError}</p>}
        {!isScanning && hasScanned && !scanError && <p className="scan-status" role="status">Scan complete · results depend on services advertised by devices on this network.</p>}
        <section className="devices-section" aria-labelledby="devices-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Local network</p>
              <h2 id="devices-heading">{isBonjourDiscoveryAvailable() ? 'Discovery Candidates' : 'Devices Found'}</h2>
            </div>
            <span className="device-count" aria-label={`${devices.length} ${isBonjourDiscoveryAvailable() ? 'candidates' : 'devices'} found`}>{devices.length}</span>
          </div>
          {hasScanned ? (
            <div className="device-list">
              {isBonjourDiscoveryAvailable() ? (
                devices.length > 0 ? devices.map((device) => <DeviceCard key={device.id} device={device} />) : <p className="service-empty-state">No discovery candidates found.</p>
              ) : devices.map((device) => <DeviceCard key={device.id} device={device} />)}
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-state-icon" aria-hidden="true">⌁</span>
              <p>Ready to scan your network.</p>
              <span>Discovered devices will appear here.</span>
            </div>
          )}
        </section>
        <DiscoveryDiagnostics services={identityDiagnostics} devices={devices} ssdpStatus={ssdpStatus} />
      </main>
      <footer className="app-footer"><span className="footer-dot" aria-hidden="true" />Network info live · Bonjour on iOS · Mock fallback on web</footer>
    </div>
  )
}

export default App
