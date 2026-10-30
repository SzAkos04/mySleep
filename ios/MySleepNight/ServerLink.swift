import Foundation
import Security

/// mySleep Night and the server: the pairing (kept in the Keychain), the nights' logs going up after
/// each night and whenever the app opens, and when the app's free signature runs out, so an uptime
/// monitor can see it (api/status.js).
@MainActor final class ServerLink: ObservableObject {
  @Published private(set) var pairing: Pairing? = Keychain.load()
  @Published private(set) var lastUpload: Date?
  @Published private(set) var problem: String?
  /// When this install stops working (embedded.mobileprovision); nil in the Simulator.
  let expires: Date? = Bundle.main.url(forResource: "embedded", withExtension: "mobileprovision")
    .flatMap { try? Data(contentsOf: $0) }.flatMap(Provisioning.expiry)
  private let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?"
  private var busy = false, again = false

  func pair(_ p: Pairing) {
    Keychain.save(p)
    pairing = p
    problem = nil
    Task { await refresh() }
  }

  /// When the app opens and after a night: say when it stops, send what has not gone up.
  func refresh() async {
    // asked again while at it (the launch's and the foreground's together): once more after
    if busy { again = true; return }
    busy = true; defer { busy = false }
    repeat { again = false; await refreshOnce() } while again
  }

  private func refreshOnce() async {
    guard let p = pairing else { return }
    let code = await send(ServerAPI.status(p, expires: expires, build: build))
    if code == 401 { problem = "The server does not know this app any more: run scripts/pair.sh on the Mac and open the link here."; return }
    problem = code == 0 ? "The server could not be reached; the nights go up later." : nil
    var done = Set(UserDefaults.standard.stringArray(forKey: "uploaded") ?? [])
    let dir = NightEngine.documents, fm = FileManager.default
    // each log with when it was last written: a log saved again since it went up goes up again
    let files = ((try? fm.contentsOfDirectory(atPath: dir.path)) ?? []).compactMap { name -> (name: String, version: String, modified: Date)? in
      guard let m = (try? fm.attributesOfItem(atPath: dir.appendingPathComponent(name).path))?[.modificationDate] as? Date else { return nil }
      return (name, String(Int64(m.timeIntervalSince1970 * 1000)), m)
    }
    let ok = await Uploader.run(files: files.map { ($0.name, $0.version) }, done: &done) { [weak self] name in
      guard let self, let data = try? Data(contentsOf: dir.appendingPathComponent(name)) else { return 400 }
      return await self.send(ServerAPI.upload(p, night: String(name.prefix(10)), body: data))
    }
    UserDefaults.standard.set(Array(done), forKey: "uploaded")
    for name in Uploader.old(files: files, done: done, now: Date()) { try? fm.removeItem(at: dir.appendingPathComponent(name)) }
    if ok > 0 { lastUpload = Date() }
  }

  private func send(_ r: URLRequest) async -> Int {
    do { let (_, res) = try await URLSession.shared.data(for: r); return (res as? HTTPURLResponse)?.statusCode ?? 0 }
    catch { return 0 }
  }
}

/// The device token is a credential: the Keychain, not UserDefaults.
enum Keychain {
  private static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "mysleep-night", kSecAttrAccount as String: "pairing"]

  static func load() -> Pairing? {
    var item: CFTypeRef?
    guard SecItemCopyMatching(query.merging([kSecReturnData as String: true]) { $1 } as CFDictionary, &item) == errSecSuccess,
          let data = item as? Data else { return nil }
    return try? JSONDecoder().decode(Pairing.self, from: data)
  }

  static func save(_ p: Pairing) {
    SecItemDelete(query as CFDictionary)
    guard let data = try? JSONEncoder().encode(p) else { return }
    SecItemAdd(query.merging([kSecValueData as String: data, kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]) { $1 } as CFDictionary, nil)
  }
}
