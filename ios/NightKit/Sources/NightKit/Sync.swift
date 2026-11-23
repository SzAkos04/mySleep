import Foundation

/// Everything the phone keeps: the nights by id, the one settings record, the server revision it
/// has seen, and what was edited here that the server has not confirmed (`dirty`: "night:<id>",
/// "settings:main"). Saved as JSON (Application Support/nights.json).
public struct NightState: Codable, Equatable, Sendable {
  public var nights: [String: NightRecord] = [:]
  public var settings = AppSettings()
  public var rev = 0
  public var dirty: [String: Bool] = [:]
  public var lastSynced: Double?

  public init() {}
  enum Keys: String, CodingKey { case nights, settings, rev, dirty, lastSynced }
  public init(from d: Decoder) throws {
    let c = try d.container(keyedBy: Keys.self)
    nights = try c.decode([String: NightRecord].self, forKey: .nights)
    settings = (try? c.decodeIfPresent(AppSettings.self, forKey: .settings)) ?? AppSettings()
    rev = (try? c.decodeIfPresent(Double.self, forKey: .rev)).flatMap { $0.map { Int($0) } } ?? 0
    dirty = try c.decode([String: Bool].self, forKey: .dirty)
    lastSynced = try? c.decodeIfPresent(Double.self, forKey: .lastSynced)
  }
}

/// One entry of POST /api/sync, either way: a night or the settings, its edit time, its data or
/// that it was deleted.
public struct Change: Codable, Equatable, Sendable {
  public var kind: String, id: String, ts: Double
  public var deleted = false
  public var night: NightRecord?
  public var settings: AppSettings?

  enum Keys: String, CodingKey { case kind, id, ts, deleted, data }
  public init(kind: String, id: String, ts: Double, deleted: Bool = false, night: NightRecord? = nil, settings: AppSettings? = nil) {
    self.kind = kind; self.id = id; self.ts = ts; self.deleted = deleted; self.night = night; self.settings = settings
  }
  public init(from d: Decoder) throws {
    let c = try d.container(keyedBy: Keys.self)
    kind = try c.decode(String.self, forKey: .kind); id = try c.decode(String.self, forKey: .id); ts = try c.decode(Double.self, forKey: .ts)
    deleted = (try? c.decodeIfPresent(Bool.self, forKey: .deleted)) ?? false
    if !deleted {
      if kind == "settings" { settings = try c.decodeIfPresent(AppSettings.self, forKey: .data) }
      else { night = try c.decodeIfPresent(NightRecord.self, forKey: .data) }
    }
  }
  public func encode(to e: Encoder) throws {
    var c = e.container(keyedBy: Keys.self)
    try c.encode(kind, forKey: .kind); try c.encode(id, forKey: .id); try c.encode(ts, forKey: .ts)
    if deleted { try c.encode(true, forKey: .deleted) }
    else if let night { try c.encode(night, forKey: .data) }
    else if let settings { try c.encode(settings, forKey: .data) }
  }
}

/// What the phone sends and what the server answers.
struct SyncBody: Codable { var since: Int, changes: [Change] }
struct SyncAnswer: Decodable { var rev: Int, changes: [Change] }

/// The sync's rules, as plain functions of the state. Every night (and the settings record)
/// carries `ts`, the time of its last edit; the newer edit wins per entry, on the server and here.
extension NightState {
  static func split(_ key: String) -> (kind: String, id: String) {
    guard let i = key.firstIndex(of: ":") else { return (key, "") }
    return (String(key[..<i]), String(key[key.index(after: i)...]))
  }
  func ts(of key: String) -> Double? {
    let (kind, id) = Self.split(key)
    return kind == "settings" ? Double(settings.ts) : nights[id]?.ts
  }

  /// The entries edited here, to send. A mark with nothing behind it is skipped: it must not fail
  /// every sync after it.
  public func pendingChanges() -> [Change] {
    dirty.keys.sorted().compactMap { key in
      let (kind, id) = Self.split(key)
      if kind == "settings" { return Change(kind: kind, id: id, ts: Double(settings.ts), settings: settings) }
      guard let n = nights[id] else { return nil }
      return n.isDeleted ? Change(kind: kind, id: id, ts: n.ts ?? 0, deleted: true) : Change(kind: kind, id: id, ts: n.ts ?? 0, night: n)
    }
  }

  /// Remote changes in; a local edit newer than the remote one stays.
  mutating func merge(_ changes: [Change]) {
    for c in changes {
      if c.kind == "settings" {
        if Double(settings.ts) >= c.ts { continue }
        var s = c.settings ?? AppSettings(); s.ts = Int64(c.ts)
        settings = s
      } else {
        if let local = nights[c.id], (local.ts ?? .nan) >= c.ts { continue }
        var n = c.deleted ? NightRecord(id: c.id) : c.night ?? NightRecord(id: c.id)
        if c.deleted { n.deleted = true }
        n.ts = c.ts
        nights[c.id] = n
      }
    }
  }

  /// Still dirty after a push: the entries edited again while it was out.
  func stillDirty(after pushed: [Change]) -> [String: Bool] {
    var d = dirty
    for c in pushed where ts(of: c.kind + ":" + c.id) == c.ts { d[c.kind + ":" + c.id] = nil }
    return d
  }

  /// The edits; `ts` is the time of the edit (ms).
  public mutating func save(_ n: NightRecord, ts: Double) { var n = n; n.ts = ts; nights[n.id] = n; dirty["night:" + n.id] = true }
  public mutating func delete(_ id: String, ts: Double) { var n = NightRecord(id: id); n.deleted = true; n.ts = ts; nights[id] = n; dirty["night:" + id] = true }
  public mutating func editSettings(ts: Double, _ edit: (inout AppSettings) -> Void) { edit(&settings); settings.ts = Int64(ts); dirty["settings:main"] = true }

  /// The state after a sync: what the server sent merged in, its revision, and what was pushed
  /// clean. A server behind this phone's revision was put back from a backup: everything here goes
  /// up again (the newer edit still wins on the server, so nothing it has is overwritten by an older one).
  public mutating func afterSync(rev serverRev: Int, changes: [Change], pushed: [Change], now: Double) {
    let behind = serverRev < rev
    let clean = stillDirty(after: pushed)
    merge(changes)
    dirty = behind ? everything() : clean
    rev = serverRev; lastSynced = now
  }
  func everything() -> [String: Bool] {
    var d = Dictionary(uniqueKeysWithValues: nights.keys.map { ("night:" + $0, true) })
    if settings.ts > 0 { d["settings:main"] = true }
    return d
  }
}
