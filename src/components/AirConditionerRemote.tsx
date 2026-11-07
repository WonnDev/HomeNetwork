import { useState } from 'react'

export function AirConditionerRemote() {
  const [temperature, setTemperature] = useState(24)
  const [mode, setMode] = useState('Cool')
  const [powerOn, setPowerOn] = useState(false)

  return (
    <main className="remote-main" aria-labelledby="remote-heading">
      <section className="remote-hero">
        <p className="eyebrow">Room control</p>
        <h2 id="remote-heading">Air conditioner remote</h2>
        <p className="remote-subtitle">Adjust the target temperature and mode once a compatible LAN controller is connected.</p>
      </section>
      <section className="remote-panel" aria-label="Air conditioner controls">
        <div className="remote-panel-header">
          <div>
            <p className="remote-device-name">Room air conditioner</p>
            <p className="remote-connection-status"><span className="status-dot" aria-hidden="true" /> Controller not connected</p>
          </div>
          <span className="remote-power-state">{powerOn ? 'On' : 'Off'}</span>
        </div>
        <div className="remote-temperature" aria-live="polite">
          <span>{temperature}</span><small>&deg;C target</small>
        </div>
        <div className="remote-stepper" aria-label="Target temperature">
          <button type="button" aria-label="Decrease target temperature" disabled={!powerOn} onClick={() => setTemperature((value) => Math.max(16, value - 1))}>-</button>
          <span>{powerOn ? 'Ready' : 'Power off'}</span>
          <button type="button" aria-label="Increase target temperature" disabled={!powerOn} onClick={() => setTemperature((value) => Math.min(30, value + 1))}>+</button>
        </div>
        <div className="remote-mode-group" aria-label="Air conditioner mode">
          {['Cool', 'Dry', 'Fan', 'Auto'].map((option) => (
            <button key={option} type="button" className={mode === option ? 'is-selected' : ''} disabled={!powerOn} onClick={() => setMode(option)}>{option}</button>
          ))}
        </div>
        <button className={`remote-power-button${powerOn ? ' is-on' : ''}`} type="button" onClick={() => setPowerOn((value) => !value)}>
          <span aria-hidden="true">⏻</span>{powerOn ? 'Turn off' : 'Turn on'}
        </button>
      </section>
      <section className="remote-setup" aria-labelledby="remote-setup-heading">
        <p className="eyebrow">Connection required</p>
        <h3 id="remote-setup-heading">Universal setup required</h3>
        <p>LAN control depends on the exact air conditioner model and its Wi-Fi/LAN module. This app has not connected to a controller yet, so the controls above do not send commands.</p>
        <p>Provide the brand/model before wiring the native protocol. If the unit has no Wi-Fi or LAN module, an IR gateway is required; an iPhone cannot replace a physical infrared remote by itself.</p>
      </section>
    </main>
  )
}
