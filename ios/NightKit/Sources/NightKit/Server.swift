import Foundation

/// The web app pairs mySleep Night with the server (Settings › Pair) by opening this link with a
/// token it got for it (api/server.js POST /api/devices). Kept in the Keychain by the app.
public struct Pairing: Codable, Equatable, Sendable {
  public let server: URL
  public let token: String
  public init(server: URL, token: String) { self.server = server; self.token = token }
}

/// What the web app opens mySleep Night with: mysleepnight://pair?server&token, and Sleep,
/// mysleepnight://sleep?alarm&smart&wake (lib/native.js). Anything else is ignored.
public enum AppLink: Equatable, Sendable {
  case pair(Pairing)
  case sleep(AlarmSettings?)   // nil: the app's own settings

  public static func parse(_ url: URL) -> AppLink? {
    guard url.scheme == "mysleepnight", let c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }
    let q = Dictionary((c.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
    switch url.host {
    case "pair":
      guard let s = q["server"], let server = URL(string: s), ["https", "http"].contains(server.scheme), server.host != nil,
            let token = q["token"], token.count >= 20 else { return nil }
      return .pair(Pairing(server: server, token: token))
    case "sleep":
      let hm = (q["wake"] ?? "").split(separator: ":").compactMap { Int($0) }
      guard hm.count == 2, (0..<24).contains(hm[0]), (0..<60).contains(hm[1]) else { return .sleep(nil) }
      return .sleep(AlarmSettings(on: q["alarm"] == "1", smart: q["smart"] == "1", hour: hm[0], minute: hm[1]))
    default: return nil
    }
  }
}

/// When the free signature runs out: the app's embedded.mobileprovision says, in the property list
/// inside its signed envelope.
public enum Provisioning {
  public static func expiry(of data: Data) -> Date? {
    guard let a = data.range(of: Data("<?xml".utf8)), let b = data.range(of: Data("</plist>".utf8), in: a.lowerBound..<data.endIndex),
          let plist = try? PropertyListSerialization.propertyList(from: data[a.lowerBound..<b.upperBound], format: nil) as? [String: Any] else { return nil }
    return plist["ExpirationDate"] as? Date
  }
}

/// The two requests the app makes, with its device token.
public enum ServerAPI {
  static func request(_ p: Pairing, _ method: String, _ path: String, _ body: Data) -> URLRequest {
    var r = URLRequest(url: p.server.appendingPathComponent(path))
    r.httpMethod = method
    r.setValue("Bearer " + p.token, forHTTPHeaderField: "Authorization")
    r.setValue("application/json", forHTTPHeaderField: "Content-Type")
    r.httpBody = body
    r.timeoutInterval = 60
    return r
  }

  /// A night's log (Night.json), for the web app to turn into the night.
  public static func upload(_ p: Pairing, night: String, body: Data) -> URLRequest { request(p, "PUT", "api/debug/\(night)", body) }

  /// When the app stops working, so the server can remind before it does.
  public static func status(_ p: Pairing, expires: Date?, build: String) -> URLRequest {
    let body: [String: Any] = ["expires": expires.map { Int64($0.timeIntervalSince1970 * 1000) } as Any? ?? NSNull(), "build": build]
    return request(p, "POST", "api/devices/status", try! JSONSerialization.data(withJSONObject: body))
  }
}

/// The night logs in Documents that the server has not taken yet go up when the app can: after a
/// night, and whenever it opens. A log is saved every minute under one name, so what is remembered
/// is each name *with its version* (when it was written): a log written again goes up again.
/// `done` keeps the versions taken, and those refused for good (4xx but 401, which pairing again
/// cures); the rest are tried next time. Versions of files no longer there are forgotten.
public enum Uploader {
  public static func run(files: [(name: String, version: String)], done: inout Set<String>, send: (String) async -> Int) async -> Int {
    var ok = 0
    let keys = Dictionary(files.map { ($0.name, "\($0.name)@\($0.version)") }, uniquingKeysWith: { a, _ in a })
    done.formIntersection(keys.values)
    for (name, key) in keys.sorted(by: { $0.key < $1.key }) where name.hasSuffix(".json") && !done.contains(key) {
      let code = await send(name)
      if (200..<300).contains(code) { done.insert(key); ok += 1 }
      else if (400..<500).contains(code) && code != 401 { done.insert(key) }
    }
    return ok
  }

  /// Logs to delete: the server has them (this very version), and they are older than `keepDays`.
  /// About 1 MB a night; one the server never took stays, however old.
  public static func old(files: [(name: String, version: String, modified: Date)], done: Set<String>, now: Date, keepDays: Double = 30) -> [String] {
    files.filter { done.contains("\($0.name)@\($0.version)") && now.timeIntervalSince($0.modified) > keepDays * 86400 }.map(\.name)
  }
}
