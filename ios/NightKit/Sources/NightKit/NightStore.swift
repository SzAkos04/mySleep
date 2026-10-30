import Foundation

/// The nights and settings on the phone, and their sync with the server (POST /api/sync, the same
/// route and rules as the web app: shared/lib/sync.js, run by `Rules`). The state is the
/// web store's own JSON: `nights`, `settings`, `rev`, `dirty`; the app only holds it, writes it to
/// a file and does the HTTP.
public final class NightStore {
  public enum SyncResult: Equatable, Sendable { case synced, offline, unauthorized, failed(Int) }

  let rules: Rules
  public private(set) var json: String

  /// `json`: a saved state; anything else (nothing, not JSON, not a state) starts empty.
  public init(rules: Rules, json: String? = nil) throws {
    self.rules = rules
    if let json, let o = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any], o["nights"] is [String: Any], o["dirty"] is [String: Any] {
      self.json = json
    } else {
      self.json = try rules.evaluate("JSON.stringify({user:null,nights:{},settings:MySleepRules.defaultSettings(),rev:0,dirty:{},lastSynced:null})") ?? "{}"
    }
  }

  public func write(to url: URL) throws { try Data(json.utf8).write(to: url, options: .atomic) }

  /// Entries edited here that the server has not confirmed.
  public var dirtyCount: Int { Int((try? rules.evaluate("Object.keys(JSON.parse(\(Self.lit(json))).dirty).length")) ?? "") ?? 0 }

  /// A night record (JSON) saved or replaced; it goes up on the next sync.
  public func saveNight(_ night: String, now: Date) throws { try update("withNight", night, now) }
  public func deleteNight(_ id: String, now: Date) throws { try update("withoutNight", Self.lit(id), now) }
  /// A change to the settings (JSON object of the keys that changed).
  public func saveSettings(_ patch: String, now: Date) throws { try update("withSettings", patch, now) }

  /// A finished night log (JSON) of the app's own, made into the night it holds, unless that night
  /// is here already (the web app's rule, `takeIn`). True: a night was added.
  @discardableResult
  public func takeIn(log: String, now: Date) throws -> Bool {
    let night = try rules.evaluate("(function(){const N=MySleepRules.takeIn(JSON.parse(\(Self.lit(log))),JSON.parse(\(Self.lit(json))).nights);return N?JSON.stringify(N):undefined})()")
    guard let night else { return false }
    try saveNight(night, now: now)
    return true
  }

  /// A night's times put right by hand ("HH:MM"; `on` may be blank): the sleep is counted from them.
  /// The words to show when they cannot be (nothing is saved), nil when saved. (lib/night.js corrected)
  @discardableResult
  public func correct(_ id: String, bed: String, on: String, wake: String, now: Date) throws -> String? {
    let times = "{bed:\(Self.lit(bed)),on:\(Self.lit(on)),wake:\(Self.lit(wake))}"
    let out = try rules.evaluate("(function(){const S=JSON.parse(\(Self.lit(json)));const N=S.nights[\(Self.lit(id))];if(!N||N.deleted)return JSON.stringify({error:'This night is gone.'});const R=MySleepRules.corrected(N,\(times));return JSON.stringify(R.error?{error:R.error}:{night:JSON.stringify(R.night)})})()") ?? "{}"
    let o = (try? JSONSerialization.jsonObject(with: Data(out.utf8))) as? [String: Any] ?? [:]
    if let e = o["error"] as? String { return e }
    if let night = o["night"] as? String { try saveNight(night, now: now) }
    return nil
  }

  private func update(_ fn: String, _ arg: String, _ now: Date) throws {
    json = try rules.evaluate("(function(){const S=JSON.parse(\(Self.lit(json)));return JSON.stringify({...S,...MySleepRules.\(fn)(S,\(arg),\(Self.ms(now)))})})()") ?? json
  }

  /// Push what was edited here, take what the server has that this has not. Edits made while the
  /// request is out stay to send. `send` does the HTTP: the status (0: no answer) and the body.
  public func sync(now: Date, send: (Data) async -> (status: Int, body: Data)) async -> SyncResult {
    do {
      let request = try rules.evaluate("(function(){const S=JSON.parse(\(Self.lit(json)));return JSON.stringify({since:S.rev||0,changes:MySleepRules.pendingChanges(S)})})()") ?? "{}"
      let (status, body) = await send(Data(request.utf8))
      switch status {
      case 200..<300: break
      case 0, 502...504: return .offline          // no answer, or nginx up with the API behind it not
      case 401: return .unauthorized
      default: return .failed(status)
      }
      // the state as it is now, not as it was: it may have been edited while the request was out
      json = try rules.evaluate("(function(){const S=JSON.parse(\(Self.lit(json))),R=JSON.parse(\(Self.lit(String(decoding: body, as: UTF8.self)))),P=JSON.parse(\(Self.lit(request))).changes;return JSON.stringify({...S,...MySleepRules.afterSync(S,R,P,\(Self.ms(now)))})})()") ?? json
      return .synced
    } catch { return .failed(-1) }
  }

  static func ms(_ d: Date) -> Int64 { Int64((d.timeIntervalSince1970 * 1000).rounded()) }
  /// Text as a JavaScript string literal.
  static func lit(_ s: String) -> String { (try? JSONEncoder().encode(s)).flatMap { String(data: $0, encoding: .utf8) } ?? "\"\"" }
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
