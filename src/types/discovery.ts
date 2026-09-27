export interface DiscoveredService {
  id: string
  name: string
  type: string
  domain: string
  hostname?: string
  port?: number
  ipAddress?: string
}

export interface DiscoveredSSDPService {
  id: string
  location?: string
  searchTarget?: string
  usn?: string
  server?: string
  cacheControl?: string
}