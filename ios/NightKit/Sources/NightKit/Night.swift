import Foundation

/// A night as the tracker keeps it: one value per second from the start (NaN where nothing was
/// heard), and the flight-recorder log, saved as JSON that the rules turn into the night
/// (lib/native.js nightFromLog) and shared/scripts/night-report.mjs reads.
/// Not Sendable by itself: the app calls it from one serial queue only (NightEngine's `night` queue).
public final class Night: @unchecked Sendable {
  public struct Event {
    public let ms: Int64          // since the start
    public let type: String
    public let data: [String: Any]
  }

  /// Exact zeros this long mean nothing reaches the microphone (the night of 29 October).
  public static let silentSec: Int64 = 10

  public let start: Int64         // ms since 1970
  public let night: String        // the night's id, the evening's date
  public let env: [String: Any]
  public private(set) var db: [Double] = [], low: [Double] = [], mid: [Double] = [], vr: [Double] = [], at: [Double] = []
  /// The body's movement through the phone's accelerometer: the largest jerk of each second, in milli-g (NaN: no reading).
  public private(set) var mv: [Double] = []
  public private(set) var events: [Event] = []
  public private(set) var silent = false
  public var hearing: Bool { !silent }

  private struct Second { var n = 0, db = -Double.infinity, low = 0.0, mid = 0.0, dbs: [Double] = [], at = 0.0, mv = Double.nan }
  private struct Minute { var reads = 0, zeros = 0, peak = -Double.infinity, floor = Double.infinity }
  private var acc = Second(), minute = Minute()
  private var lastDb: Double?, lastRead: Int64 = 0, quietSince: Int64 = 0

  public init(start: Int64, night: String = "", env: [String: Any] = [:]) {
    self.start = start; self.night = night; self.env = env
  }

  /// One audio frame (about every 100 ms).
  public func add(_ frame: [Float], sampleRate: Double, at now: Int64) {
    tick(at: now)
    minute.reads += 1
    guard let r = Features.read(frame, sampleRate: sampleRate) else {
      minute.zeros += 1
      if quietSince == 0 { quietSince = now }
      if !silent && now - quietSince >= Night.silentSec * 1000 {
        silent = true
        log("mic-silent", ["sec": Night.silentSec], at: now)
      }
      return
    }
    if silent { log("recovered", ["afterSec": (now - quietSince) / 1000], at: now) }
    silent = false; quietSince = 0
    minute.peak = max(minute.peak, r.db - 100); minute.floor = min(minute.floor, r.db - 100)
    acc.n += 1; acc.db = max(acc.db, r.db); acc.dbs.append(r.db); acc.low += r.low; acc.mid += r.mid
    if let l = lastDb { acc.at = max(acc.at, r.db - l) }
    lastDb = r.db
  }

  /// One accelerometer step: how far the acceleration moved since the last reading, in g.
  public func motion(_ jerk: Double, at now: Int64) {
    tick(at: now)
    acc.mv = max(acc.mv.isNaN ? 0 : acc.mv, jerk * 1000)
  }

  /// Closes the seconds up to `now`; seconds nothing was read in are gaps.
  public func tick(at now: Int64) {
    if lastRead != 0 && now - lastRead > 3000 { log("stall", ["ms": now - lastRead], at: now) }
    lastRead = now
    let sec = Int((now - start) / 1000)
    while db.count < sec { push(); acc = Second() }
  }

  /// A whole second as it was recorded (tests, and a night carried over from a saved log).
  func append(db d: Double, low l: Double, mid m: Double, vr v: Double, at a: Double) {
    db.append(d); low.append(l); mid.append(m); vr.append(v); at.append(a); mv.append(.nan)
  }

  private func push() {
    let n = Double(acc.n)
    db.append(acc.n > 0 ? acc.db : .nan)
    low.append(acc.n > 0 ? acc.low / n : 0)
    mid.append(acc.n > 0 ? acc.mid / n : 0)
    let mean = acc.n > 0 ? acc.dbs.reduce(0, +) / n : 0
    vr.append(acc.n > 0 ? (acc.dbs.reduce(0) { $0 + ($1 - mean) * ($1 - mean) } / n).squareRoot() : 0)
    at.append(acc.at)
    mv.append(acc.mv)
  }

  public func log(_ type: String, _ data: [String: Any] = [:], at: Int64? = nil) {
    let t = at ?? (lastRead > 0 ? lastRead : Int64(Date().timeIntervalSince1970 * 1000))
    events.append(Event(ms: t - start, type: type, data: data))
  }

  /// Once a minute: what the microphone delivered since the last beat, and whatever the app adds.
  public func heartbeat(at now: Int64, extra: [String: Any] = [:]) {
    tick(at: now)
    let last60 = db.suffix(60), heard = last60.filter { !$0.isNaN }
    var d: [String: Any] = [
      "sec": db.count, "missing60": last60.count - heard.count, "db": Int((heard.max() ?? -1).rounded()),
      "reads": minute.reads, "zeros": minute.zeros, "hearing": hearing
    ]
    if minute.reads > minute.zeros { d["peak"] = Int(minute.peak.rounded()); d["floor"] = Int(minute.floor.rounded()) }
    d.merge(extra) { _, new in new }
    log("beat", d, at: now)
    minute = Minute()
  }

  /// A log left unfinished (iOS ended the app in the night), finished where its readings stop, so
  /// it becomes a night like any other. nil: finished already, or not a night log.
  public static func recovered(_ data: Data) -> Data? {
    guard var o = try? JSONSerialization.jsonObject(with: data) as? [String: Any], o["final"] as? Bool == false,
          var events = o["events"] as? [Any], let db = (o["samples"] as? [String: Any])?["db"] as? [Any] else { return nil }
    events.append([db.count * 1000, "finish", ["recovered": true]] as [Any])
    o["events"] = events; o["final"] = true
    return try? JSONSerialization.data(withJSONObject: o, options: [.sortedKeys])
  }

  /// The log's JSON format: gaps as null, readings rounded to 0.1 or 0.01.
  public func json(final: Bool) throws -> Data {
    let r1 = { (v: Double) -> Any in v.isFinite ? (v * 10).rounded() / 10 : NSNull() }
    let r2 = { (v: Double) -> Any in v.isFinite ? (v * 100).rounded() / 100 : NSNull() }
    let body: [String: Any] = [
      "v": 1, "night": night, "start": start, "env": env, "final": final,
      "uploadedAt": Int64(Date().timeIntervalSince1970 * 1000),
      "events": events.map { e -> [Any] in e.data.isEmpty ? [e.ms, e.type] : [e.ms, e.type, e.data] },
      "samples": ["start": start, "db": db.map(r1), "low": low.map(r2), "mid": mid.map(r2), "vr": vr.map(r1), "at": at.map(r1), "mv": mv.map(r1)]
    ]
    return try JSONSerialization.data(withJSONObject: body, options: [.sortedKeys])
  }
}
