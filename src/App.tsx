import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { DeviceCard } from './components/DeviceCard'
import { DiscoveryDiagnostics } from './components/DiscoveryDiagnostics'
import { ResponsiveHostCard } from './components/ResponsiveHostCard'
import { DeviceInventorySection } from './components/DeviceInventorySection'
import { Header } from './components/Header'
import { NetworkCard } from './components/NetworkCard'
import { ScanButton } from './components/ScanButton'
import { getNetworkInfo, openWifiSettings, watchNetworkInfo } from './services/networkInfoService'
import { scanNetwork } from './services/networkService'
import { cancelNetworkDiscovery, discoverNetworkServices, isBonjourDiscoveryAvailable, type SsdpDiscoveryStatus } from './services/networkDiscoveryService'
import { aggregateDiscoveredDevices, createServiceIdentityDiagnostics, type ServiceIdentityDiagnostic } from './services/deviceAggregationService'
import { cancelHostDiscovery, discoverResponsiveHosts, type HostDiscoveryProgress, type HostDiscoveryResult, type ResponsiveIpHost } from './services/hostDiscoveryService'
import { createScanToken } from './services/scanLifecycleService'
import { applyScanObservations, createManualInventoryRecord, loadInventory, saveInventory, updateInventoryRecord, type DeviceInventoryRecord, type InventoryObservation, type InventoryRecognition } from './services/deviceInventoryService'
import type { NetworkInfo } from './types/network'
import type { NetworkDevice } from './types/device'
import './App.css'

type ScanPhase = 'idle' | 'bonjour' | 'tcp'
type ScanTerminalStatus = 'idle' | 'scanning' | 'completed' | 'partial-timeout' | 'cancelled' | 'failed'

function App() {
  const [devices, setDevices] = useState<NetworkDevice[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [hasScanned, setHasScanned] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null)
  const [ssdpStatus, setSsdpStatus] = useState<SsdpDiscoveryStatus>('unavailable')
  const [identityDiagnostics, setIdentityDiagnostics] = useState<ServiceIdentityDiagnostic[]>([])
  const [responsiveHosts, setResponsiveHosts] = useState<ResponsiveIpHost[]>([])
  const [hostDiscovery, setHostDiscovery] = useState<HostDiscoveryResult>({ status: 'unavailable', hosts: [] })
  const [scanPhase, setScanPhase] = useState<ScanPhase>('idle')
  const [scanStatus, setScanStatus] = useState<ScanTerminalStatus>('idle')
  const [scanProgress, setScanProgress] = useState<HostDiscoveryProgress>({ processed: 0, total: 0, responsiveHosts: 0, statsByPort: {} })
  const [scanElapsedMs, setScanElapsedMs] = useState(0)
  const [bonjourDurationMs, setBonjourDurationMs] = useState<number | null>(null)
  const [tcpDurationMs, setTcpDurationMs] = useState<number | null>(null)
  const [inventoryRecords, setInventoryRecords] = useState<DeviceInventoryRecord[]>([])
  const [inventoryError, setInventoryError] = useState<string | null>(null)
  const [pullDistance, setPullDistance] = useState(0)
  const touchStartY = useRef<number | null>(null)
  const networkKeyRef = useRef<string | null>(null)
  const scanTokenRef = useRef(createScanToken())
  const scanStartedAtRef = useRef<number | null>(null)
  const inventoryRef = useRef<DeviceInventoryRecord[]>([])

  useEffect(() => {
    void loadInventory().then((records) => {
      inventoryRef.current = records
      setInventoryRecords(records)
    }).catch(() => setInventoryError('Unable to load local device inventory.'))
  }, [])

  const persistScanInventory = async (
    diagnostics: ServiceIdentityDiagnostic[],
    aggregatedDevices: NetworkDevice[],
    hosts: ResponsiveIpHost[],
    scanCompleted: boolean,
  ) => {
    const candidateObservations = new Map<string, InventoryObservation>()
    diagnostics.forEach((diagnostic) => {
      const candidate = aggregatedDevices.find((device) => device.id === diagnostic.candidateId)
      const key = diagnostic.candidateId ?? `service:${diagnostic.serviceId}`
      const existing = candidateObservations.get(key)
      const observation: InventoryObservation = existing ?? {
        name: candidate?.name ?? diagnostic.instanceName,
        ipAddress: candidate?.ip !== 'Unknown address' ? candidate?.ip : diagnostic.ipAddress,
        hostname: diagnostic.hostname,
        bonjourServices: [],
        responsivePorts: [],
        evidence: [],
      }
      observation.bonjourServices.push(diagnostic.serviceType)
      observation.evidence.push(`Bonjour ${diagnostic.serviceType}`)
      candidateObservations.set(key, observation)
    })
    const observations = [...candidateObservations.values()]
    hosts.forEach((host) => observations.push({
      name: host.ipAddress,
      ipAddress: host.ipAddress,
      bonjourServices: [],
      responsivePorts: host.ports,
      evidence: host.ports.map((port) => `TCP port ${port}`),
    }))
    const updated = applyScanObservations(inventoryRef.current, observations, new Date(), scanCompleted)
    try {
      await saveInventory(updated)
      inventoryRef.current = updated
      setInventoryRecords(updated)
      setInventoryError(null)
    } catch {
      setInventoryError('Unable to save local device inventory.')
    }
  }

  const addManualInventoryRecord = async (name: string, ipAddress: string) => {
    const updated = [...inventoryRef.current, createManualInventoryRecord(name, ipAddress)]
    await saveInventory(updated)
    inventoryRef.current = updated
    setInventoryRecords(updated)
  }

  const updateInventory = async (id: string, changes: { name?: string; recognition?: InventoryRecognition }) => {
    const updated = await updateInventoryRecord(inventoryRef.current, id, changes)
    inventoryRef.current = updated
    setInventoryRecords(updated)
  }

  const scanCurrentNetwork = async () => {
    if (isScanning) return
    const scanRun = scanTokenRef.current.start()
    setIsScanning(true)
    setScanStatus('scanning')
    setScanPhase(isBonjourDiscoveryAvailable() ? 'bonjour' : 'idle')
    scanStartedAtRef.current = Date.now()
    setScanElapsedMs(0)
    setScanProgress({ processed: 0, total: 0, responsiveHosts: 0, statsByPort: {} })
    setBonjourDurationMs(null)
    setTcpDurationMs(null)
    setScanError(null)
    setHasScanned(false)
    setResponsiveHosts([])
    setHostDiscovery({ status: 'unavailable', hosts: [] })

    try {
      if (isBonjourDiscoveryAvailable()) {
        const bonjourStartedAt = Date.now()
        const bonjourOutcome = await Promise.allSettled([discoverNetworkServices()]).then(([outcome]) => outcome)
        setBonjourDurationMs(Date.now() - bonjourStartedAt)
        if (!scanTokenRef.current.isCurrent(scanRun)) return
        setScanPhase('tcp')
        const tcpStartedAt = Date.now()
        const hostOutcome = await Promise.allSettled([discoverResponsiveHosts((progress) => {
          if (scanTokenRef.current.isCurrent(scanRun)) setScanProgress(progress)
        })]).then(([outcome]) => outcome)
        setTcpDurationMs(Date.now() - tcpStartedAt)
        if (!scanTokenRef.current.isCurrent(scanRun)) return
        const discoveredServices = bonjourOutcome.status === 'fulfilled'
          ? bonjourOutcome.value
          : { bonjourServices: [], ssdpServices: [], ssdpStatus: 'unavailable' as const }
        const hostResult = hostOutcome.status === 'fulfilled'
          ? hostOutcome.value
          : { status: 'failed' as const, hosts: [], error: 'TCP discovery failed before returning results.' }
        setSsdpStatus(discoveredServices.ssdpStatus)
        setResponsiveHosts(hostResult.hosts)
        setHostDiscovery(hostResult)
        const aggregatedDevices = aggregateDiscoveredDevices(discoveredServices.bonjourServices, discoveredServices.ssdpServices)
        const diagnostics = createServiceIdentityDiagnostics(discoveredServices.bonjourServices, aggregatedDevices, networkInfo?.localIp ?? null)
        const currentCandidateIds = new Set(diagnostics.filter((diagnostic) => diagnostic.matchesCurrentDevice && diagnostic.candidateId).map((diagnostic) => diagnostic.candidateId))
        setIdentityDiagnostics(diagnostics)
        setDevices(aggregatedDevices.map((device) => ({ ...device, isCurrentDevice: currentCandidateIds.has(device.id) })))
        if (bonjourOutcome.status === 'rejected') setScanError('Bonjour discovery failed; TCP results may be partial.')
        setScanStatus(hostResult.status === 'partial-timeout' ? 'partial-timeout' : hostResult.status === 'cancelled' ? 'cancelled' : hostResult.status === 'failed' ? 'failed' : 'completed')
        void persistScanInventory(diagnostics, aggregatedDevices, hostResult.hosts, bonjourOutcome.status === 'fulfilled' && hostResult.status === 'complete')
      } else {
        setSsdpStatus('unavailable')
        setIdentityDiagnostics([])
        setDevices(await scanNetwork())
      }
      setHasScanned(true)
      if (!isBonjourDiscoveryAvailable()) setScanStatus('completed')
    } catch {
      setDevices([])
      setIdentityDiagnostics([])
      setScanError('Scan failed. Check Local Network permission and try again.')
      setHasScanned(true)
      setScanStatus('failed')
    } finally {
      if (scanTokenRef.current.isCurrent(scanRun)) {
        setIsScanning(false)
        if (scanStartedAtRef.current !== null) setScanElapsedMs(Date.now() - scanStartedAtRef.current)
      }
    }
  }

  const cancelScan = () => {
    if (!isScanning) return
    scanTokenRef.current.cancel()
    void Promise.all([cancelHostDiscovery(), cancelNetworkDiscovery()])
    setIsScanning(false)
    setScanPhase('idle')
    setScanStatus('cancelled')
    if (scanStartedAtRef.current !== null) setScanElapsedMs(Date.now() - scanStartedAtRef.current)
    setScanError('Scan cancelled.')
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
    if (!isScanning) return
    const timer = window.setInterval(() => {
      if (scanStartedAtRef.current !== null) setScanElapsedMs(Date.now() - scanStartedAtRef.current)
    }, 250)
    return () => window.clearInterval(timer)
  }, [isScanning])

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
        <ScanButton isScanning={isScanning} onScan={() => void scanCurrentNetwork()} onCancel={cancelScan} />
        {isBonjourDiscoveryAvailable() && <p className="discovery-note" role="status">Bonjour enabled · {ssdpStatus === 'unavailable' ? 'SSDP unavailable: multicast entitlement not granted' : 'SSDP enabled'}</p>}
        {isScanning && <p className="scan-status scan-status-progress" role="status">{scanPhase === 'bonjour' ? 'Bonjour discovery' : 'TCP host discovery'} · {scanPhase === 'tcp' && `${scanProgress.processed}/${scanProgress.total} probes · ${scanProgress.responsiveHosts} responsive hosts · `}{Math.round(scanElapsedMs / 1000)}s elapsed</p>}
        {!isScanning && scanError && <p className="scan-status scan-status-error" role="alert">{scanError}</p>}
        {!isScanning && scanStatus === 'partial-timeout' && <p className="scan-status scan-status-warning" role="status">Partial Results — Timed Out · responsive hosts found before the 30-second deadline are shown.</p>}
        {!isScanning && scanStatus === 'cancelled' && <p className="scan-status" role="status">Cancelled · partial results were not committed.</p>}
        {!isScanning && scanStatus === 'completed' && hasScanned && !scanError && <p className="scan-status" role="status">Completed · results depend on services advertised by devices on this network.</p>}
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
        {isBonjourDiscoveryAvailable() && <section className="devices-section" aria-labelledby="hosts-heading">
          <div className="section-heading">
            <div><p className="eyebrow">TCP evidence</p><h2 id="hosts-heading">Responsive IP Hosts</h2></div>
            <span className="device-count" aria-label={`${responsiveHosts.length} responsive hosts`}>{responsiveHosts.length}</span>
          </div>
          {hostDiscovery.status === 'failed' && <p className="service-empty-state">{hostDiscovery.error}</p>}
          {hostDiscovery.status === 'complete' && responsiveHosts.length === 0 && <p className="service-empty-state">No supported TCP ports responded. This does not prove hosts are absent.</p>}
          {responsiveHosts.length > 0 && <div className="device-list">{responsiveHosts.map((host) => <ResponsiveHostCard key={host.ipAddress} host={host} />)}</div>}
        </section>}
        <DiscoveryDiagnostics services={identityDiagnostics} devices={devices} ssdpStatus={ssdpStatus} hostDiscovery={hostDiscovery} progress={scanProgress} bonjourDurationMs={bonjourDurationMs} tcpDurationMs={tcpDurationMs} />
        <DeviceInventorySection records={inventoryRecords} storageError={inventoryError} onAddManual={addManualInventoryRecord} onUpdate={updateInventory} />
      </main>
      <footer className="app-footer"><span className="footer-dot" aria-hidden="true" />Network info live · Bonjour on iOS · Mock fallback on web</footer>
    </div>
  )
}

export default App
