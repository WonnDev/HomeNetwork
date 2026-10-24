import { describe, expect, it } from 'vitest'
import {
  applyScanObservations,
  createManualInventoryRecord,
  loadInventory,
  saveInventory,
  type DeviceInventoryRecord,
  type InventoryObservation,
  type InventoryStorage,
} from './deviceInventoryService'

const observation = (overrides: Partial<InventoryObservation> = {}): InventoryObservation => ({
  name: 'Unidentified device',
  ipAddress: '192.168.2.1',
  bonjourServices: [],
  responsivePorts: [80, 443],
  evidence: ['TCP port 80', 'TCP port 443'],
  ...overrides,
})

const storage = (initial: string | null = null): InventoryStorage & { value: string | null } => ({
  value: initial,
  async get() { return this.value },
  async set(value) { this.value = value },
})

const fixedDate = new Date('2026-10-24T12:00:00.000Z')

describe('device inventory', () => {
  it('creates an unrecognized record from a scan observation', () => {
    const [record] = applyScanObservations([], [observation()], fixedDate)
    expect(record.recognition).toBe('unrecognized')
    expect(record.lastObservedIp).toBe('192.168.2.1')
    expect(record.observedInLatestCompletedScan).toBe(true)
  })

  it('matches a stable hostname and preserves firstSeen while updating lastSeen', () => {
    const first = applyScanObservations([], [observation({ hostname: 'router.local' })], fixedDate)
    const second = applyScanObservations(first, [observation({ hostname: 'router.local', ipAddress: '192.168.2.253' })], new Date('2026-10-25T12:00:00.000Z'))
    expect(second).toHaveLength(1)
    expect(second[0].firstSeen).toBe(fixedDate.toISOString())
    expect(second[0].lastObservedIp).toBe('192.168.2.253')
  })

  it('keeps IP-only observations separate because IP is not definitive identity', () => {
    const first = applyScanObservations([], [observation()], fixedDate)
    const second = applyScanObservations(first, [observation()], new Date('2026-10-25T12:00:00.000Z'))
    expect(second).toHaveLength(2)
  })

  it('does not merge records by display name or shared port', () => {
    const records = applyScanObservations([], [observation({ name: 'Same name', ipAddress: '192.168.2.2' }), observation({ name: 'Same name', ipAddress: '192.168.2.6' })], fixedDate)
    expect(records).toHaveLength(2)
  })

  it('preserves known status and does not mark records absent after partial scan', () => {
    const known: DeviceInventoryRecord = { ...createManualInventoryRecord('My MacBook', '192.168.2.19', fixedDate), recognition: 'known' }
    const result = applyScanObservations([known], [observation({ hostname: 'other.local' })], fixedDate, false)
    expect(result.find((record) => record.id === known.id)?.recognition).toBe('known')
    expect(result.find((record) => record.id === known.id)?.observedInLatestCompletedScan).toBe(false)
  })

  it('creates manual baseline records as known with explicit evidence', () => {
    const record = createManualInventoryRecord('Redmi Note 11 Pro', '192.168.2.2', fixedDate)
    expect(record.source).toBe('manual')
    expect(record.recognition).toBe('known')
    expect(record.evidence).toEqual(['Manual router baseline'])
  })

  it('persists valid records and safely ignores invalid stored data', async () => {
    const memory = storage()
    const record = createManualInventoryRecord('Gateway', '192.168.2.253', fixedDate)
    await saveInventory([record], memory)
    expect((await loadInventory(memory))[0].name).toBe('Gateway')
    const invalid = storage('{"not":"inventory"}')
    expect(await loadInventory(invalid)).toEqual([])
  })
})
