import { Preferences } from '@capacitor/preferences'

export type InventoryRecognition = 'known' | 'unrecognized'
export type InventorySource = 'manual' | 'scan'

export interface InventoryObservation {
  name: string
  ipAddress?: string
  hostname?: string
  bonjourServices: string[]
  responsivePorts: number[]
  evidence: string[]
}

export interface DeviceInventoryRecord {
  id: string
  name: string
  recognition: InventoryRecognition
  source: InventorySource
  firstSeen: string
  lastSeen: string
  lastObservedIp?: string
  hostname?: string
  bonjourServices: string[]
  responsivePorts: number[]
  evidence: string[]
  observedInLatestCompletedScan: boolean
}

export const inventoryStorageKey = 'home-network-scanner.device-inventory.v1'

export interface InventoryStorage {
  get(): Promise<string | null>
  set(value: string): Promise<void>
}

const preferencesStorage: InventoryStorage = {
  async get() {
    return (await Preferences.get({ key: inventoryStorageKey })).value
  },
  async set(value) {
    await Preferences.set({ key: inventoryStorageKey, value })
  },
}

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function validRecord(value: unknown): value is DeviceInventoryRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as Partial<DeviceInventoryRecord>
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && (record.recognition === 'known' || record.recognition === 'unrecognized')
    && (record.source === 'manual' || record.source === 'scan')
    && typeof record.firstSeen === 'string'
    && typeof record.lastSeen === 'string'
    && Array.isArray(record.bonjourServices)
    && Array.isArray(record.responsivePorts)
    && Array.isArray(record.evidence)
    && typeof record.observedInLatestCompletedScan === 'boolean'
}

export async function loadInventory(storage: InventoryStorage = preferencesStorage): Promise<DeviceInventoryRecord[]> {
  try {
    const stored = await storage.get()
    if (!stored) return []
    const parsed: unknown = JSON.parse(stored)
    return Array.isArray(parsed) ? parsed.filter(validRecord) : []
  } catch {
    return []
  }
}

export async function saveInventory(records: DeviceInventoryRecord[], storage: InventoryStorage = preferencesStorage): Promise<void> {
  await storage.set(JSON.stringify(records))
}

function findMatch(records: DeviceInventoryRecord[], observation: InventoryObservation): DeviceInventoryRecord | undefined {
  const hostname = observation.hostname && normalize(observation.hostname)
  if (!hostname) return undefined
  return records.find((record) => record.hostname && normalize(record.hostname) === hostname)
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort()
}

export function applyScanObservations(
  existingRecords: DeviceInventoryRecord[],
  observations: InventoryObservation[],
  now = new Date(),
  scanCompleted = true,
): DeviceInventoryRecord[] {
  const records = existingRecords.map((record) => ({
    ...record,
    observedInLatestCompletedScan: scanCompleted ? false : record.observedInLatestCompletedScan,
  }))
  const timestamp = now.toISOString()

  observations.forEach((observation) => {
    const match = findMatch(records, observation)
    if (match) {
      match.lastSeen = timestamp
      match.observedInLatestCompletedScan = scanCompleted
      if (observation.ipAddress) match.lastObservedIp = observation.ipAddress
      if (observation.hostname) match.hostname = observation.hostname
      match.bonjourServices = unique([...match.bonjourServices, ...observation.bonjourServices])
      match.responsivePorts = [...new Set([...match.responsivePorts, ...observation.responsivePorts])].sort((left, right) => left - right)
      match.evidence = unique([...match.evidence, ...observation.evidence])
      return
    }

    records.push({
      id: `inventory-${crypto.randomUUID()}`,
      name: observation.name || 'Unidentified device',
      recognition: 'unrecognized',
      source: 'scan',
      firstSeen: timestamp,
      lastSeen: timestamp,
      lastObservedIp: observation.ipAddress,
      hostname: observation.hostname,
      bonjourServices: unique(observation.bonjourServices),
      responsivePorts: [...new Set(observation.responsivePorts)].sort((left, right) => left - right),
      evidence: unique(observation.evidence),
      observedInLatestCompletedScan: scanCompleted,
    })
  })

  return records.sort((left, right) => left.firstSeen.localeCompare(right.firstSeen))
}

export function createManualInventoryRecord(name: string, ipAddress: string, now = new Date()): DeviceInventoryRecord {
  const timestamp = now.toISOString()
  return {
    id: `manual-${crypto.randomUUID()}`,
    name: name.trim() || 'Known device',
    recognition: 'known',
    source: 'manual',
    firstSeen: timestamp,
    lastSeen: timestamp,
    lastObservedIp: ipAddress.trim() || undefined,
    bonjourServices: [],
    responsivePorts: [],
    evidence: ['Manual router baseline'],
    observedInLatestCompletedScan: false,
  }
}

export async function updateInventoryRecord(
  records: DeviceInventoryRecord[],
  id: string,
  changes: Pick<Partial<DeviceInventoryRecord>, 'name' | 'recognition'>,
  storage: InventoryStorage = preferencesStorage,
): Promise<DeviceInventoryRecord[]> {
  const updated = records.map((record) => record.id === id ? { ...record, ...changes } : record)
  await saveInventory(updated, storage)
  return updated
}
