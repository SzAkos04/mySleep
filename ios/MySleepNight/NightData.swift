import Foundation

/// The nights and settings on this phone (NightKit's NightStore, kept in Application Support) and
/// their sync with the server. After a night the app's own log becomes the night here; the screens
/// read from `store` and refresh when `version` changes.
@MainActor final class NightData: ObservableObject {
  @Published private(set) var version = 0
  @Published private(set) var syncResult: NightStore.SyncResult?
  @Published private(set) var lastSync: Date?
  @Published private(set) var settings = AppSettings()
  /// What came of scheduling the reminders (Notifier): shown in Settings.
  @Published var notify: NotifyStatus = .unknown
  let store: NightStore
  /// The pairing, for the sync that follows an edit (set by the app).
  var pairing: () -> Pairing? = { nil }
  private var pending: Task<Void, Never>?
  private let file: URL = {
    let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("nights.json")
  }()

  /// Saves in order, off the main thread: a year of nights is 2 MB of JSON.
  private let writer = DispatchQueue(label: "nights.json")

  init() {
    store = NightStore.load(from: file)
    adoptLegacyAlarm()
    settings = store.settings
  }

  /// The alarm as the app kept it before the settings were synced (UserDefaults): taken in once.
  private func adoptLegacyAlarm() {
    let d = UserDefaults.standard
    guard d.object(forKey: "wakeHour") != nil else { return }
    let a = AlarmSettings(on: d.object(forKey: "alarmOn") as? Bool ?? true, smart: d.object(forKey: "smart") as? Bool ?? true,
                          hour: d.integer(forKey: "wakeHour"), minute: d.object(forKey: "wakeMinute") as? Int ?? 45)
    store.adopt(legacy: a)
    try? store.write(to: file)
    ["alarmOn", "smart", "wakeHour", "wakeMinute"].forEach(d.removeObject(forKey:))
  }

  /// A change to the settings, sent up a moment later (a run of edits is one sync).
  func change(_ edit: (inout AppSettings) -> Void) {
    store.change(now: Date(), edit)
    persist(); syncSoon()
  }

  func saveAlarm(_ a: AlarmSettings) { store.saveAlarm(a, now: Date()); persist(); syncSoon() }

  private func syncSoon() {
    pending?.cancel()
    pending = Task { try? await Task.sleep(for: .milliseconds(800)); if !Task.isCancelled { await refresh(pairing: pairing()) } }
  }

  /// When the app opens, comes back, and after a night: the app's own logs into nights, then the
  /// sync (without a pairing, only the first).
  func refresh(pairing: Pairing?) async {
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
    let seen = Set(UserDefaults.standard.stringArray(forKey: "takenIn") ?? [])
    var now = Set<String>()
    for name in (try? fm.contentsOfDirectory(atPath: dir.path)) ?? [] where name.hasSuffix(".json") {
      let url = dir.appendingPathComponent(name)
      guard let m = (try? fm.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date else { continue }
      let key = "\(name)@\(Int64(m.timeIntervalSince1970 * 1000))"
      now.insert(key)
      if seen.contains(key) { continue }
      if let log = try? Data(contentsOf: url) { store.takeIn(log: log, now: Date()) }
    }
    UserDefaults.standard.set(Array(now), forKey: "takenIn")   // only what is there: the list does not grow
    version += 1
  }

  /// A night's times put right (HH:MM): nil when saved, else the words to show. Goes up on the next sync.
  func correct(_ id: String, bed: String, on: String, wake: String) -> String? {
    let error = store.correct(id, bed: bed, on: on, wake: wake, now: Date())
    persist(); syncSoon()
    return error
  }

  func delete(_ id: String) {
    store.deleteNight(id, now: Date())
    persist(); syncSoon()
  }

  /// Waits for the saves still on their way.
  func flush() { writer.sync {} }

  private func persist() {
    let state = store.state, file = file
    writer.async { try? NightStore(state: state).write(to: file) }
    settings = store.settings
    version += 1
  }
}
