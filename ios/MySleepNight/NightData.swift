import Foundation

/// The nights and settings on this phone (NightKit's NightStore, kept in Application Support) and
/// their sync with the server. After a night the app's own log becomes the night here; the screens
/// read from `store` and refresh when `version` changes.
@MainActor final class NightData: ObservableObject {
  @Published private(set) var version = 0
  @Published private(set) var syncResult: NightStore.SyncResult?
  @Published private(set) var lastSync: Date?
  private(set) var store: NightStore?
  private let file: URL = {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("nights.json")
  }()

  init() {
    guard let url = Bundle.main.url(forResource: "rules", withExtension: "js"), let source = try? String(contentsOf: url, encoding: .utf8),
          let rules = try? Rules(source: source) else { return }
    store = try? NightStore(rules: rules, json: try? String(contentsOf: file, encoding: .utf8))
  }

  /// When the app opens, comes back, and after a night: the app's own logs into nights, then the
  /// sync (without a pairing, only the first).
  func refresh(pairing: Pairing?) async {
    guard let store else { return }
    takeInLogs(store)
    persist()
    guard let p = pairing else { return }
    let result = await store.sync(now: Date()) { body in
      do {
        let (data, res) = try await URLSession.shared.data(for: ServerAPI.sync(p, body: body))
        return ((res as? HTTPURLResponse)?.statusCode ?? 0, data)
      } catch { return (0, Data()) }
    }
    syncResult = result
    if result == .synced { lastSync = Date() }
    persist()
  }

  /// Every finished log in Documents not looked at in this version: the night it holds, if the
  /// store has not got it (NightStore.takeIn). A log is looked at again when it is written again.
  private func takeInLogs(_ store: NightStore) {
    let fm = FileManager.default, dir = NightEngine.documents
    var seen = Set(UserDefaults.standard.stringArray(forKey: "takenIn") ?? [])
    var now = Set<String>()
    for name in (try? fm.contentsOfDirectory(atPath: dir.path)) ?? [] where name.hasSuffix(".json") {
      let url = dir.appendingPathComponent(name)
      guard let m = (try? fm.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date else { continue }
      let key = "\(name)@\(Int64(m.timeIntervalSince1970 * 1000))"
      now.insert(key)
      if seen.contains(key) { continue }
      if let log = try? String(contentsOf: url, encoding: .utf8) { _ = try? store.takeIn(log: log, now: Date()) }
    }
    seen = now   // only what is there: the list does not grow
    UserDefaults.standard.set(Array(seen), forKey: "takenIn")
    version += 1
  }

  /// A night's times put right (HH:MM): nil when saved, else the words to show. Goes up on the next sync.
  func correct(_ id: String, bed: String, on: String, wake: String) -> String? {
    let error = (try? store?.correct(id, bed: bed, on: on, wake: wake, now: Date())) ?? nil
    persist()
    return error
  }

  func delete(_ id: String) {
    try? store?.deleteNight(id, now: Date())
    persist()
  }

  private func persist() {
    try? store?.write(to: file)
    version += 1
  }
}
