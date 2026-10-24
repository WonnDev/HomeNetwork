import Foundation
import Capacitor
import Darwin
import Network
import UIKit

@objc(LocalNetworkPlugin)
public class LocalNetworkPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LocalNetworkPlugin"
    public let jsName = "LocalNetworkPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getLocalIPAddress", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanTcpHosts", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelTcpScan", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openWifiSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startBonjourDiscovery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopBonjourDiscovery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startSSDPDiscovery", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSSDPDiscovery", returnType: CAPPluginReturnPromise)
    ]

    private let browserQueue = DispatchQueue(label: "com.wonn.local-network.bonjour")
    private var browsers: [String: NWBrowser] = [:]
    private var discoveredServices: [String: DiscoveredService] = [:]
    private var ssdpConnectionGroup: NWConnection?
    private var discoveredSSDPServices: [String: DiscoveredSSDPService] = [:]
    private let tcpScanQueue = DispatchQueue(label: "com.wonn.local-network.tcp-scan", attributes: .concurrent)
    private let tcpSchedulerQueue = DispatchQueue(label: "com.wonn.local-network.tcp-scheduler")
    private var tcpScanGeneration = 0
    private var tcpScanConnections: [Int: [ObjectIdentifier: NWConnection]] = [:]
    private var tcpScanJobs: [(host: String, port: NWEndpoint.Port, portNumber: Int)] = []
    private var tcpScanNextJob = 0
    private var tcpScanActive = 0
    private var tcpScanMaxConcurrency = 24
    private var tcpScanTimeoutMs = 350
    private var tcpScanProcessed = 0
    private var tcpScanStatsByPort: [String: [String: Int]] = [:]
    private var tcpScanReachable: [[String: Any]] = []
    private var tcpScanCall: CAPPluginCall?

    @objc func openWifiSettings(_ call: CAPPluginCall) {
        guard let settingsUrl = URL(string: "App-Prefs:root=WIFI") else {
            call.reject("Wi-Fi settings URL is unavailable")
            return
        }

        DispatchQueue.main.async {
            UIApplication.shared.open(settingsUrl) { opened in
                if opened { call.resolve() } else { call.reject("Unable to open Wi-Fi settings") }
            }
        }
    }

    @objc func getLocalIPAddress(_ call: CAPPluginCall) {
        var interfaces: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&interfaces) == 0, let firstInterface = interfaces else {
            call.resolve(["ipAddress": NSNull(), "ipv6Address": NSNull()])
            return
        }
        defer { freeifaddrs(interfaces) }

        var currentInterface: UnsafeMutablePointer<ifaddrs>? = firstInterface
        var fallbackAddress: (ipAddress: String, interfaceName: String)?
        var wifiAddress: (ipAddress: String, interfaceName: String)?
        var fallbackIpv6Address: (ipAddress: String, interfaceName: String)?
        var wifiIpv6Address: (ipAddress: String, interfaceName: String)?

        while let interface = currentInterface {
            let flags = Int32(interface.pointee.ifa_flags)
            let isUp = (flags & Int32(IFF_UP)) != 0
            let isLoopback = (flags & Int32(IFF_LOOPBACK)) != 0

            if isUp && !isLoopback, let address = interface.pointee.ifa_addr {
                let interfaceName = String(cString: interface.pointee.ifa_name)
                if address.pointee.sa_family == UInt8(AF_INET), let ipAddress = ipv4Address(from: address) {
                    let result = (ipAddress, interfaceName)
                    if interfaceName == "en0" {
                        wifiAddress = result
                    } else if fallbackAddress == nil {
                        fallbackAddress = result
                    }
                } else if address.pointee.sa_family == UInt8(AF_INET6), let ipAddress = ipv6Address(from: address) {
                    let result = (ipAddress, interfaceName)
                    if interfaceName == "en0" && !ipAddress.lowercased().hasPrefix("fe80:") {
                        wifiIpv6Address = result
                    } else if fallbackIpv6Address == nil && !ipAddress.lowercased().hasPrefix("fe80:") {
                        fallbackIpv6Address = result
                    }
                }
            }

            currentInterface = interface.pointee.ifa_next
        }

        let address = wifiAddress ?? fallbackAddress
        let ipv6Address = wifiIpv6Address ?? fallbackIpv6Address
        var result: [String: Any] = [
            "ipAddress": address?.ipAddress ?? NSNull(),
            "ipv6Address": ipv6Address?.ipAddress ?? NSNull(),
            "subnetMask": address.flatMap { subnetMask(for: firstInterface, interfaceName: $0.interfaceName) } ?? NSNull()
        ]
        if let mask = result["subnetMask"] as? String { result["prefixLength"] = prefixLength(for: mask) }
        if let address { result["interfaceName"] = address.interfaceName }
        call.resolve(result)
    }

    @objc func scanTcpHosts(_ call: CAPPluginCall) {
        let hosts = call.getArray("hosts", String.self) ?? []
        let ports = call.getArray("ports", Int.self) ?? []
        let timeoutMs = max(100, min(call.getInt("timeoutMs") ?? 350, 2000))
        let maxConcurrency = max(1, min(call.getInt("maxConcurrency") ?? 24, 64))
        guard hosts.count <= 1024 else {
            call.reject("The requested subnet is too large to scan safely")
            return
        }
        guard !hosts.isEmpty, !ports.isEmpty else {
            call.resolve(["hosts": []])
            return
        }

        let jobs = hosts.flatMap { host in
            ports.compactMap { port in
                NWEndpoint.Port(rawValue: UInt16(port)).map { (host: host, port: $0, portNumber: port) }
            }
        }
        let generation = browserQueue.sync { () -> Int in
            cancelTcpScanLocked()
            tcpScanGeneration += 1
            tcpScanConnections[tcpScanGeneration] = [:]
            tcpScanJobs = jobs
            tcpScanNextJob = 0
            tcpScanActive = 0
            tcpScanMaxConcurrency = maxConcurrency
            tcpScanTimeoutMs = timeoutMs
            tcpScanProcessed = 0
            tcpScanStatsByPort = [:]
            tcpScanReachable = []
            tcpScanCall = call
            return tcpScanGeneration
        }
        tcpSchedulerQueue.async { [weak self] in
            self?.scheduleTcpProbes(generation: generation)
        }
    }

    @objc func cancelTcpScan(_ call: CAPPluginCall) {
        browserQueue.async { [weak self] in
            self?.cancelTcpScanLocked()
        }
        call.resolve()
    }

    private func cancelTcpScanLocked() {
        let pending = max(0, tcpScanJobs.count - tcpScanNextJob)
        let active = tcpScanActive
        if tcpScanCall != nil {
            notifyListeners("tcpScanProgress", data: [
                "processed": tcpScanProcessed,
                "total": tcpScanJobs.count,
                "responsiveHosts": Set(tcpScanReachable.compactMap { $0["ipAddress"] as? String }).count,
                "statsByPort": tcpScanStatsByPort,
                "pendingCancelled": pending + active,
            ])
            tcpScanCall?.reject("TCP scan cancelled")
            tcpScanCall = nil
        }
        tcpScanGeneration += 1
        let connections = tcpScanConnections.values.flatMap { $0.values }
        tcpScanConnections.removeAll()
        connections.forEach { $0.cancel() }
        tcpScanJobs = []
        tcpScanNextJob = 0
        tcpScanActive = 0
    }

    private func scheduleTcpProbes(generation: Int) {
        guard browserQueue.sync(execute: { tcpScanGeneration == generation && tcpScanCall != nil }) else { return }
        while tcpScanActive < tcpScanMaxConcurrency && tcpScanNextJob < tcpScanJobs.count {
            let job = tcpScanJobs[tcpScanNextJob]
            tcpScanNextJob += 1
            tcpScanActive += 1
            probeTcpHost(job.host, port: job.port, timeoutMs: tcpScanTimeoutMs, generation: generation) { [weak self] outcome in
                self?.tcpSchedulerQueue.async {
                    self?.completeTcpProbe(job: job, outcome: outcome, generation: generation)
                }
            }
        }
        if tcpScanNextJob == tcpScanJobs.count && tcpScanActive == 0 {
            finishTcpScan(generation: generation)
        }
    }

    private func completeTcpProbe(job: (host: String, port: NWEndpoint.Port, portNumber: Int), outcome: TcpProbeOutcome, generation: Int) {
        guard browserQueue.sync(execute: { tcpScanGeneration == generation && tcpScanCall != nil }) else { return }
        tcpScanActive -= 1
        tcpScanProcessed += 1
        let portKey = String(job.portNumber)
        var portStats = tcpScanStatsByPort[portKey, default: [:]]
        portStats[outcome.rawValue, default: 0] += 1
        tcpScanStatsByPort[portKey] = portStats
        if outcome == .success { tcpScanReachable.append(["ipAddress": job.host, "port": job.portNumber]) }
        var progress: [String: Any] = [
            "processed": tcpScanProcessed,
            "total": tcpScanJobs.count,
            "responsiveHosts": Set(tcpScanReachable.compactMap { $0["ipAddress"] as? String }).count,
            "statsByPort": tcpScanStatsByPort,
        ]
        if outcome == .success {
            progress["ipAddress"] = job.host
            progress["port"] = job.portNumber
        }
        notifyListeners("tcpScanProgress", data: progress)
        scheduleTcpProbes(generation: generation)
    }

    private func finishTcpScan(generation: Int) {
        browserQueue.async { [weak self] in
            guard let self, self.tcpScanGeneration == generation, let call = self.tcpScanCall else { return }
            self.tcpScanConnections.removeValue(forKey: generation)
            self.tcpScanCall = nil
            call.resolve([
                "hosts": self.tcpScanReachable,
                "processed": self.tcpScanProcessed,
                "total": self.tcpScanJobs.count,
                "statsByPort": self.tcpScanStatsByPort,
                "pendingCancelled": 0,
            ])
        }
    }

    private enum TcpProbeOutcome: String {
        case success
        case refused
        case timeout
        case other
        case cancelled
    }

    private func probeTcpHost(_ host: String, port: NWEndpoint.Port, timeoutMs: Int, generation: Int, completion: @escaping (TcpProbeOutcome) -> Void) {
        let connection = NWConnection(host: NWEndpoint.Host(host), port: port, using: .tcp)
        let connectionId = ObjectIdentifier(connection)
        let registered = browserQueue.sync { () -> Bool in
            guard tcpScanGeneration == generation else { return false }
            tcpScanConnections[generation, default: [:]][connectionId] = connection
            return true
        }
        guard registered else {
            completion(.cancelled)
            return
        }
        let lock = NSLock()
        var finished = false
        let finish: (TcpProbeOutcome) -> Void = { outcome in
            lock.lock()
            guard !finished else { lock.unlock(); return }
            finished = true
            lock.unlock()
            connection.cancel()
            self.browserQueue.async {
                self.tcpScanConnections[generation]?[connectionId] = nil
            }
            completion(outcome)
        }
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                finish(.success)
            case .failed(let error):
                if case .posix(let code) = error, code == .ECONNREFUSED {
                    finish(.refused)
                } else if case .posix(let code) = error, code == .ETIMEDOUT {
                    finish(.timeout)
                } else {
                    finish(.other)
                }
            case .cancelled:
                finish(.cancelled)
            default:
                break
            }
        }
        connection.start(queue: tcpScanQueue)
        tcpScanQueue.asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) {
            finish(.timeout)
        }
    }

    @objc func startBonjourDiscovery(_ call: CAPPluginCall) {
        let serviceTypes = call.getArray("serviceTypes", String.self) ?? []
        browserQueue.async { [weak self] in
            guard let self else { return }
            self.stopBrowsers()
            self.discoveredServices.removeAll()

            for serviceType in serviceTypes where !serviceType.isEmpty {
                let browser = NWBrowser(for: .bonjour(type: serviceType, domain: "local."), using: .tcp)
                browser.stateUpdateHandler = { [weak self] state in
                    if case .failed = state {
                        browser.cancel()
                        self?.browsers.removeValue(forKey: serviceType)
                    }
                }
                browser.browseResultsChangedHandler = { [weak self] results, _ in
                    self?.handleResults(results, serviceType: serviceType)
                }
                self.browsers[serviceType] = browser
                browser.start(queue: self.browserQueue)
            }
        }
        call.resolve()
    }

    @objc func stopBonjourDiscovery(_ call: CAPPluginCall) {
        browserQueue.async { [weak self] in
            self?.stopBrowsers()
            self?.discoveredServices.removeAll()
        }
        call.resolve()
    }

    @objc func startSSDPDiscovery(_ call: CAPPluginCall) {
        browserQueue.async { [weak self] in
            guard let self else { return }
            self.stopSSDPDiscovery()
            self.discoveredSSDPServices.removeAll()

            let connection = NWConnection(
                host: NWEndpoint.Host("239.255.255.250"),
                port: NWEndpoint.Port(rawValue: 1900)!,
                using: .udp
            )
            self.ssdpConnectionGroup = connection
            connection.stateUpdateHandler = { state in
                if case .failed(let error) = state {
                    CAPLog.print("SSDP connection failed: \(error)")
                }
            }
            connection.start(queue: self.browserQueue)

            let request = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:discover\"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n"
            connection.send(content: request.data(using: .utf8), completion: .contentProcessed { error in
                if let error { CAPLog.print("SSDP request failed: \(error)") }
            })
            self.receiveSSDPResponse(on: connection)
        }
        call.resolve()
    }

    @objc func stopSSDPDiscovery(_ call: CAPPluginCall) {
        browserQueue.async { [weak self] in
            self?.stopSSDPDiscovery()
            self?.discoveredSSDPServices.removeAll()
        }
        call.resolve()
    }

    private func stopSSDPDiscovery() {
        ssdpConnectionGroup?.cancel()
        ssdpConnectionGroup = nil
    }

    private func receiveSSDPResponse(on connection: NWConnection) {
        connection.receiveMessage { [weak self] data, _, _, error in
            guard let self else { return }
            if let data, let response = self.parseSSDPResponse(data) {
                let id = response["id"] as? String ?? UUID().uuidString
                if self.discoveredSSDPServices[id] == nil {
                    self.discoveredSSDPServices[id] = DiscoveredSSDPService(dictionary: response)
                    self.notifyListeners("ssdpServiceFound", data: response)
                }
            }

            if error == nil, self.ssdpConnectionGroup != nil {
                self.receiveSSDPResponse(on: connection)
            }
        }
    }

    private func parseSSDPResponse(_ data: Data) -> [String: Any]? {
        guard let text = String(data: data, encoding: .utf8) else { return nil }
        let lines = text.components(separatedBy: "\r\n")
        guard lines.first?.uppercased().hasPrefix("HTTP/1.1") == true else { return nil }

        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            let parts = line.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: true)
            guard parts.count == 2 else { continue }
            headers[String(parts[0]).lowercased()] = String(parts[1]).trimmingCharacters(in: .whitespaces)
        }

        let location = headers["location"]
        let searchTarget = headers["st"]
        let usn = headers["usn"]
        guard location != nil || searchTarget != nil || usn != nil else { return nil }

        let id = usn ?? "\(location ?? "")|\(searchTarget ?? "")"
        var response: [String: Any] = ["id": id]
        if let location { response["location"] = location }
        if let searchTarget { response["searchTarget"] = searchTarget }
        if let usn { response["usn"] = usn }
        if let server = headers["server"] { response["server"] = server }
        if let cacheControl = headers["cache-control"] { response["cacheControl"] = cacheControl }
        return response
    }

    private func stopBrowsers() {
        browsers.values.forEach { $0.cancel() }
        browsers.removeAll()
    }

    private func handleResults(_ results: Set<NWBrowser.Result>, serviceType: String) {
        for result in results {
            guard case let .service(name, type, domain, _) = result.endpoint else { continue }
            let service = DiscoveredService(
                id: "\(name)|\(type)|\(domain)",
                name: name,
                type: type,
                domain: domain
            )

            if discoveredServices[service.id] == nil {
                discoveredServices[service.id] = service
                notifyListeners("bonjourServiceFound", data: service.dictionary)
            }
        }

        let activeIds = Set(results.compactMap { result -> String? in
            guard case let .service(name, type, domain, _) = result.endpoint else { return nil }
            return "\(name)|\(type)|\(domain)"
        })
        let removedIds = discoveredServices.keys.filter { id in
            id.contains("|\(serviceType)|") && !activeIds.contains(id)
        }
        for id in removedIds {
            guard let service = discoveredServices.removeValue(forKey: id) else { continue }
            notifyListeners("bonjourServiceLost", data: service.dictionary)
        }
    }

    private func ipv4Address(from address: UnsafeMutablePointer<sockaddr>) -> String? {
        var addressCopy = address.pointee
        var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))

        let result = withUnsafePointer(to: &addressCopy) { pointer in
            pointer.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { sockaddrPointer in
                var ipv4Address = sockaddrPointer.pointee.sin_addr
                return inet_ntop(AF_INET, &ipv4Address, &buffer, socklen_t(INET_ADDRSTRLEN))
            }
        }

        guard result != nil else { return nil }
        return String(cString: buffer)
    }

    private func subnetMask(for firstInterface: UnsafeMutablePointer<ifaddrs>, interfaceName: String) -> String? {
        var currentInterface: UnsafeMutablePointer<ifaddrs>? = firstInterface
        while let interface = currentInterface {
            let name = String(cString: interface.pointee.ifa_name)
            if name == interfaceName, let mask = interface.pointee.ifa_netmask, mask.pointee.sa_family == UInt8(AF_INET) {
                return ipv4Address(from: mask)
            }
            currentInterface = interface.pointee.ifa_next
        }
        return nil
    }

    private func prefixLength(for mask: String) -> Int {
        mask.split(separator: ".").reduce(0) { count, octet in
            count + (Int(octet).map { UInt8($0).nonzeroBitCount } ?? 0)
        }
    }

    private func ipv6Address(from address: UnsafeMutablePointer<sockaddr>) -> String? {
        var addressCopy = address.pointee
        var buffer = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN))

        let result = withUnsafePointer(to: &addressCopy) { pointer in
            pointer.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { sockaddrPointer in
                var ipv6Address = sockaddrPointer.pointee.sin6_addr
                return inet_ntop(AF_INET6, &ipv6Address, &buffer, socklen_t(INET6_ADDRSTRLEN))
            }
        }

        guard result != nil else { return nil }
        return String(cString: buffer)
    }
}

private struct DiscoveredService {
    let id: String
    let name: String
    let type: String
    let domain: String

    var dictionary: [String: String] {
        ["id": id, "name": name, "type": type, "domain": domain]
    }
}

private struct DiscoveredSSDPService {
    let id: String
    let location: String?
    let searchTarget: String?
    let usn: String?
    let server: String?
    let cacheControl: String?

    init(dictionary: [String: Any]) {
        id = dictionary["id"] as? String ?? UUID().uuidString
        location = dictionary["location"] as? String
        searchTarget = dictionary["searchTarget"] as? String
        usn = dictionary["usn"] as? String
        server = dictionary["server"] as? String
        cacheControl = dictionary["cacheControl"] as? String
    }
}
