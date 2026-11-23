import Foundation

/// Any JSON value: what the app keeps of a night without a type of its own (the diagnostics, fields
/// from older versions), so a night saved and sent again loses nothing.
public enum JSONValue: Codable, Equatable, Sendable {
  case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])

  public init(from d: Decoder) throws {
    let c = try d.singleValueContainer()
    if c.decodeNil() { self = .null }
    else if let b = try? c.decode(Bool.self) { self = .bool(b) }
    else if let n = try? c.decode(Double.self) { self = .number(n) }
    else if let s = try? c.decode(String.self) { self = .string(s) }
    else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
    else { self = .object(try c.decode([String: JSONValue].self)) }
  }

  public func encode(to e: Encoder) throws {
    var c = e.singleValueContainer()
    switch self {
    case .null: try c.encodeNil()
    case .bool(let b): try c.encode(b)
    case .number(let n): try c.encode(n)
    case .string(let s): try c.encode(s)
    case .array(let a): try c.encode(a)
    case .object(let o): try c.encode(o)
    }
  }

  public var number: Double? { if case .number(let n) = self { n } else { nil } }
  public var string: String? { if case .string(let s) = self { s } else { nil } }
  /// As JavaScript's String(v) prints it.
  var text: String {
    switch self {
    case .null: "null"
    case .bool(let b): b ? "true" : "false"
    case .number(let n): JS.num(n)
    case .string(let s): s
    case .array, .object: "[object]"
    }
  }
}

struct AnyKey: CodingKey {
  let stringValue: String
  init(_ s: String) { stringValue = s }
  init?(stringValue s: String) { stringValue = s }
  var intValue: Int? { nil }
  init?(intValue: Int) { nil }
}

/// A night as the phone keeps it and syncs it: when, how it was slept, what was heard. A deleted
/// night is a tombstone (`deleted`, `ts`). Times are ms since 1970, durations minutes.
public struct NightRecord: Codable, Equatable, Sendable {
  public var id: String
  public var bed: Double?, on: Double?, wake: Double?
  public var wakes: Int?, talks: Int?, coughs: Int?
  public var awakeMin: Double?, asleepMin: Double?, restfulMin: Double?, snoreMin: Double?
  public var events: [SoundEvent]?
  public var timeline: Timeline?
  public var alarm: Rang?
  public var diag: [String: JSONValue]?
  public var clips: [JSONValue]?
  public var source: String?
  public var deleted: Bool?
  /// The time of the last edit (ms): the newer edit wins in a sync.
  public var ts: Double?
  /// Fields this version does not know, or not in the shape it expects: kept as they came.
  public var extra: [String: JSONValue] = [:]

  public init(id: String) { self.id = id }

  public struct SoundEvent: Codable, Equatable, Sendable {
    public var t: Double, kind: String, sec: Double
  }
  /// When the alarm rang, and how many minutes before the wake time.
  public struct Rang: Codable, Equatable, Sendable {
    public var at: Double, early: Double
  }

  var isDeleted: Bool { deleted == true }
  /// JavaScript's `n.on` as a condition: a sleep time, and not 0.
  var fellAsleep: Double? { on.flatMap { $0 != 0 && !$0.isNaN ? $0 : nil } }

  public init(from d: Decoder) throws {
    let c = try d.container(keyedBy: AnyKey.self)
    var got = Set<String>()
    func take<T: Decodable>(_ k: String) -> T? {
      if (try? c.decodeNil(forKey: AnyKey(k))) == true { got.insert(k); return nil }   // null: nothing, as absent
      guard let v = try? c.decodeIfPresent(T.self, forKey: AnyKey(k)) else { return nil }
      got.insert(k); return v
    }
    id = take("id") ?? ""
    bed = take("bed"); on = take("on"); wake = take("wake")
    wakes = take("wakes"); talks = take("talks"); coughs = take("coughs")
    awakeMin = take("awakeMin"); asleepMin = take("asleepMin"); restfulMin = take("restfulMin"); snoreMin = take("snoreMin")
    events = take("events"); timeline = take("timeline"); alarm = take("alarm")
    diag = take("diag"); clips = take("clips"); source = take("source"); deleted = take("deleted"); ts = take("ts")
    for k in c.allKeys where !got.contains(k.stringValue) { extra[k.stringValue] = try c.decode(JSONValue.self, forKey: k) }
  }

  public func encode(to e: Encoder) throws {
    var c = e.container(keyedBy: AnyKey.self)
    var put = Set<String>()
    func w<T: Encodable>(_ k: String, _ v: T?) throws { if let v { try c.encode(v, forKey: AnyKey(k)); put.insert(k) } }
    try w("id", id)
    try w("bed", bed); try w("on", on); try w("wake", wake)
    try w("wakes", wakes); try w("talks", talks); try w("coughs", coughs)
    try w("awakeMin", awakeMin); try w("asleepMin", asleepMin); try w("restfulMin", restfulMin); try w("snoreMin", snoreMin)
    try w("events", events); try w("timeline", timeline); try w("alarm", alarm)
    try w("diag", diag); try w("clips", clips); try w("source", source); try w("deleted", deleted); try w("ts", ts)
    for (k, v) in extra where !put.contains(k) { try c.encode(v, forKey: AnyKey(k)) }
  }
}

/// A night as the microphone heard it: loudness a minute at a time, and per half minute the estimate
/// (w awake, l light, s sleep, d restful, g not recorded) and what was heard (n snoring, t talking,
/// c coughing, m movement, x room noise).
public struct Timeline: Codable, Equatable, Sendable {
  public var start: Double
  public var states: String, events: String
  public var db: [Double?]

  public init(start: Double, states: String, events: String = "", db: [Double?] = []) {
    self.start = start; self.states = states; self.events = events; self.db = db
  }
  enum Keys: String, CodingKey { case start, states, events, db }
  public init(from d: Decoder) throws {
    let c = try d.container(keyedBy: Keys.self)
    start = (try? c.decodeIfPresent(Double.self, forKey: .start)) ?? 0
    states = (try? c.decodeIfPresent(String.self, forKey: .states)) ?? ""
    events = (try? c.decodeIfPresent(String.self, forKey: .events)) ?? ""
    db = (try? c.decodeIfPresent([Double?].self, forKey: .db)) ?? []
  }
}

/// A night's log as the app writes it (Night.json): what NightRecord.from(log:) makes the night of.
public struct NightLog: Decodable, Sendable {
  public var night: String
  public var start: Double
  public var final: Bool?
  public var samples: Samples
  public var events: [Event]
  public init(night: String, start: Double, final: Bool?, samples: Samples, events: [Event]) {
    self.night = night; self.start = start; self.final = final; self.samples = samples; self.events = events
  }

  public struct Samples: Decodable, Sendable {
    public var start: Double
    public var db: [Double?]
    public var low: [Double?]?, mid: [Double?]?, vr: [Double?]?, at: [Double?]?
    public init(start: Double, db: [Double?], low: [Double?]? = nil, mid: [Double?]? = nil, vr: [Double?]? = nil, at: [Double?]? = nil) {
      self.start = start; self.db = db; self.low = low; self.mid = mid; self.vr = vr; self.at = at
    }
  }
  /// `[ms since the start, type, data?]`
  public struct Event: Decodable, Sendable {
    public var ms: Double, type: String, data: [String: JSONValue]
    public init(ms: Double, type: String, data: [String: JSONValue] = [:]) { self.ms = ms; self.type = type; self.data = data }
    public init(from d: Decoder) throws {
      var c = try d.unkeyedContainer()
      ms = try c.decode(Double.self); type = try c.decode(String.self)
      data = c.isAtEnd ? [:] : (try? c.decode([String: JSONValue].self)) ?? [:]
    }
  }
}

/// What JavaScript did by itself, where the night's numbers and words depend on it.
enum JS {
  /// Math.round: halves go up, also below zero.
  static func round(_ x: Double) -> Double { (x + 0.5).rounded(.down) }
  /// Math.round as a whole number; nothing (NaN, ±∞) is 0, never a crash.
  static func int(_ x: Double) -> Int { x.isFinite ? Int(round(x)) : 0 }
  /// A number as a template string prints it: 12, 5.5.
  static func num(_ x: Double) -> String { x.isFinite && x == x.rounded() && abs(x) < 1e15 ? String(Int(x)) : "\(x)" }
  /// `x || 0`
  static func or0(_ x: Double?) -> Double { guard let x, !x.isNaN else { return 0 }; return x }
}
