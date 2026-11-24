import Foundation

/// The nights and settings on the phone (NightState), saved as a file, and their sync with the
/// server (POST /api/sync, by the rules in Sync.swift). The app holds it, saves it and does the HTTP.
public final class NightStore {
  public enum SyncResult: Equatable, Sendable { case synced, offline, unauthorized, failed(Int) }

  public internal(set) var state: NightState

  public init(state: NightState = NightState()) { self.state = state }

  /// The state saved at `url`; none: an empty one. A file that cannot be read is moved aside
  /// (nights.unreadable-<ms>.json), never written over: the store starts empty and the next sync
  /// brings the server's nights back.
  public static func load(from url: URL, now: Date = Date()) -> NightStore {
    guard FileManager.default.fileExists(atPath: url.path) else { return NightStore() }
    // there but not readable (before the first unlock, say) is moved aside like a broken one
    if let data = try? Data(contentsOf: url), let state = try? JSONDecoder().decode(NightState.self, from: data) { return NightStore(state: state) }
    let aside = url.deletingLastPathComponent().appendingPathComponent("nights.unreadable-\(Int64(Clock.ms(now))).json")
    try? FileManager.default.moveItem(at: url, to: aside)
    return NightStore()
  }

  public func write(to url: URL) throws { try JSONEncoder().encode(state).write(to: url, options: .atomic) }

  /// Entries edited here that the server has not confirmed.
  public var dirtyCount: Int { state.dirty.count }

  /// A night saved or replaced; it goes up on the next sync.
  public func saveNight(_ n: NightRecord, now: Date) { state.save(n, ts: Clock.ms(now)) }
  public func deleteNight(_ id: String, now: Date) { state.delete(id, ts: Clock.ms(now)) }

  /// A finished night log of the app's own (Night.json), made into the night it holds, unless that
  /// night is here already (NightRecord.takeIn). True: a night was added.
  @discardableResult
  public func takeIn(log: Data, now: Date) -> Bool {
    guard let log = try? JSONDecoder().decode(NightLog.self, from: log), let n = NightRecord.takeIn(log, nights: state.nights) else { return false }
    saveNight(n, now: now)
    return true
  }

  /// A night's times put right by hand ("HH:MM"; `on` may be blank): the sleep is counted from them.
  /// The words to show when they cannot be (nothing is saved), nil when saved.
  @discardableResult
  public func correct(_ id: String, bed: String, on: String, wake: String, now: Date) -> String? {
    guard let n = state.nights[id], !n.isDeleted else { return "This night is gone." }
    switch n.corrected(bed: bed, on: on, wake: wake) {
    case .refused(let e): return e
    case .night(let c): saveNight(c, now: now); return nil
    }
  }

  /// Changes per request: the server takes 1000 at most and 4 MB (api/server.js).
  public static let batch = 400

  /// Push what was edited here, take what the server has that this has not, `batch` changes at a
  /// time until nothing is left. Edits made while a request is out stay to send. `send` does the
  /// HTTP: the status (0: no answer) and the body.
  public func sync(now: Date, send: (Data) async -> (status: Int, body: Data)) async -> SyncResult {
    while true {
      let before = state.dirty.count
      let (result, full) = await syncOnce(now: now, send: send)
      // a full batch: more may be waiting; none went clean: stop, not an endless loop
      guard result == .synced, full, !state.dirty.isEmpty, state.dirty.count < before else { return result }
    }
  }

  private func syncOnce(now: Date, send: (Data) async -> (status: Int, body: Data)) async -> (SyncResult, full: Bool) {
    let pushed = Array(state.pendingChanges().prefix(Self.batch))
    guard let request = try? JSONEncoder().encode(SyncBody(since: state.rev, changes: pushed)) else { return (.failed(-1), false) }
    let (status, body) = await send(request)
    switch status {
    case 200..<300: break
    case 0, 502...504: return (.offline, false)          // no answer, or Tailscale up with the API behind it not
    case 401: return (.unauthorized, false)
    default: return (.failed(status), false)
    }
    guard let reply = try? JSONDecoder().decode(SyncAnswer.self, from: body) else { return (.failed(-1), false) }
    // the state as it is now, not as it was: it may have been edited while the request was out
    state.afterSync(rev: reply.rev, changes: reply.changes, pushed: pushed, now: Clock.ms(now))
    return (.synced, pushed.count == Self.batch)
  }

  // What the screens show (Views.swift).
  public func report(_ id: String) -> ReportView? { state.reportView(id) }
  public func startMonth(now: Date) -> MonthID { state.startMonth(now: now) }
  public func journal(_ month: MonthID, selected: String?, now: Date) -> JournalView? { state.journalView(month, selected: selected, now: now) }
  public func trends(days: Int) -> TrendsView? { state.trendsView(days: days) }
}

/// When to sync again while the app is open (seconds), after how the last one went; nil: not until
/// something changes (a refusal means the pairing is gone).
public enum SyncSchedule {
  public static func next(after result: NightStore.SyncResult) -> TimeInterval? {
    switch result {
    case .synced: 60
    case .offline, .failed: 30
    case .unauthorized: nil
    }
  }
}
