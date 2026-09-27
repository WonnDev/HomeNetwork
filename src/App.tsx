import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { DeviceCard } from './components/DeviceCard'
import { DiscoveredServiceCard } from './components/DiscoveredServiceCard'
import { DiscoveredSSDPCard } from './components/DiscoveredSSDPCard'
import { Header } from './components/Header'
import { NetworkCard } from './components/NetworkCard'
import { ScanButton } from './components/ScanButton'
import { getNetworkInfo, openWifiSettings, watchNetworkInfo } from './services/networkInfoService'
import { scanNetwork } from './services/networkService'
import { discoverNetworkServices, isBonjourDiscoveryAvailable } from './services/networkDiscoveryService'
import type { NetworkInfo } from './types/network'
import type { NetworkDevice } from './types/device'
import type { DiscoveredService, DiscoveredSSDPService } from './types/discovery'
import './App.css'

function App() {
  const [devices, setDevices] = useState<NetworkDevice[]>([])
  const [isScanning, setIsScanning] = useState(false)
  const [hasScanned, setHasScanned] = useState(false)
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null)
  const [services, setServices] = useState<DiscoveredService[]>([])
  const [ssdpServices, setSsdpServices] = useState<DiscoveredSSDPService[]>([])
  const [pullDistance, setPullDistance] = useState(0)
  const touchStartY = useRef<number | null>(null)
  const networkKeyRef = useRef<string | null>(null)

  const scanCurrentNetwork = async () => {
    setIsScanning(true)

    try {
      if (isBonjourDiscoveryAvailable()) {
        const discoveredServices = await discoverNetworkServices()
        setServices(discoveredServices.bonjourServices)
        setSsdpServices(discoveredServices.ssdpServices)
        setDevices([])
      } else {
        setDevices(await scanNetwork())
        setServices([])
        setSsdpServices([])
      }
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
      setServices([])
      setSsdpServices([])
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
        <section className="devices-section" aria-labelledby="devices-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Local network</p>
              <h2 id="devices-heading">Devices Found</h2>
            </div>
            <span className="device-count" aria-label={`${isBonjourDiscoveryAvailable() ? services.length + ssdpServices.length : devices.length} results found`}>{isBonjourDiscoveryAvailable() ? services.length + ssdpServices.length : devices.length}</span>
          </div>
          {hasScanned ? (
            <div className="device-list">
              {isBonjourDiscoveryAvailable() ? (
                <>
                  <h3 className="service-group-heading">Bonjour Services</h3>
                  {services.length > 0 ? services.map((service) => <DiscoveredServiceCard key={service.id} service={service} />) : <p className="service-empty-state">No Bonjour services found.</p>}
                  <h3 className="service-group-heading">SSDP / UPnP Services</h3>
                  {ssdpServices.length > 0 ? ssdpServices.map((service) => <DiscoveredSSDPCard key={service.id} service={service} />) : <p className="service-empty-state">No SSDP services found.</p>}
                </>
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
      </main>
      <footer className="app-footer"><span className="footer-dot" aria-hidden="true" />Network info live · Bonjour on iOS · Mock fallback on web</footer>
    </div>
  )
}

export default App
