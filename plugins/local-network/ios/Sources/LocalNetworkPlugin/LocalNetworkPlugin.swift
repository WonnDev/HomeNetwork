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
            "ipv6Address": ipv6Address?.ipAddress ?? NSNull()
        ]
        if let address { result["interfaceName"] = address.interfaceName }
        call.resolve(result)
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
