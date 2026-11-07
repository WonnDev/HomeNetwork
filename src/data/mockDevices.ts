import type { NetworkDevice } from '../types/device'

export const mockDevices: NetworkDevice[] = [
  {
    id: 'router-1',
    name: 'Home Router',
    ip: '192.168.1.1',
    type: 'router',
    status: 'online',
    services: ['HTTP', 'HTTPS'],
    confidence: 'medium',
    evidence: ['Name suggests router'],
  },
  {
    id: 'camera-1',
    name: 'Living Room Camera',
    ip: '192.168.1.20',
    type: 'camera',
    status: 'online',
    services: ['RTSP', 'ONVIF'],
    confidence: 'high',
    evidence: ['Name or metadata suggests camera', 'Service evidence: RTSP, ONVIF'],
  },
  {
    id: 'tv-1',
    name: 'Samsung TV',
    ip: '192.168.1.30',
    type: 'tv',
    status: 'online',
    services: ['HTTP', 'SSDP'],
    confidence: 'medium',
    evidence: ['Name suggests tv'],
  },
  {
    id: 'unknown-1',
    name: 'Unknown Device',
    ip: '192.168.1.45',
    type: 'unknown',
    status: 'offline',
    services: [],
    confidence: 'unknown',
    evidence: ['Insufficient evidence for a device category'],
  },
]
