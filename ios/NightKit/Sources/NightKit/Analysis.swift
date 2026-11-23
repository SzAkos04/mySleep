import Foundation

/// A night's readings, one value per second from the start (the log's samples, Night's arrays):
///   db   loudest reading of the second (relative dB; NaN = not recorded)
///   low  share of the sound's energy under 500 Hz
///   mid  share between 500 and 3000 Hz (speech)
///   vr   spread of the 100 ms readings within the second, dB (syllables make it move)
///   at   largest rise from one 100 ms reading to the next, dB (a cough starts with a jump)
public struct Readings: Sendable {
  public var db: [Double], low: [Double], mid: [Double], vr: [Double], at: [Double]

  /// The other arrays are fitted to `db`: what is missing or not a number counts as 0.
  public init(db: [Double], low: [Double] = [], mid: [Double] = [], vr: [Double] = [], at: [Double] = []) {
    let n = db.count
    func fit(_ a: [Double]) -> [Double] { (0..<n).map { $0 < a.count && !a[$0].isNaN ? a[$0] : 0 } }
    self.db = db; self.low = fit(low); self.mid = fit(mid); self.vr = fit(vr); self.at = fit(at)
  }

  /// The last `seconds` of a night being recorded (the smart alarm's look).
  public init(_ n: Night, last seconds: Int = 660) {
    self.init(db: Array(n.db.suffix(seconds)), low: Array(n.low.suffix(seconds)), mid: Array(n.mid.suffix(seconds)),
              vr: Array(n.vr.suffix(seconds)), at: Array(n.at.suffix(seconds)))
  }

  func slice(from: Int) -> Readings {
    Readings(db: Array(db[from...]), low: Array(low[from...]), mid: Array(mid[from...]), vr: Array(vr[from...]), at: Array(at[from...]))
  }
}

/// Turns a night of per-second sound readings into what happened: asleep/awake, a rough
/// restful/light estimate, and sounds (snoring, talking, coughing, movement, room noise).
///
/// Method (docs/dev/MVP.md, SOUND_ANALYSIS.md): a second well above the room's own noise floor
/// is part of a sound. Each sound is told apart by its traits; movement per 30-s epoch, smoothed
/// over neighbouring epochs the way wrist actigraphy does it (Cole-Kripke weights), separates
/// awake from asleep. Sleep stages proper are not attempted: sound cannot tell them apart well.
public enum Analysis {
  // Tuning knobs. They are set on paper; real nights in a real bedroom will move them.
  static let loudDb = 6.0          // least dB above the noise floor that makes a second part of a sound
  static let wobbleK = 5.0         // ...or this many times the room's own wobble (floor to 75th percentile)
  static let loudMax = 12.0        // ...but never more: a rustle in bed is 15 dB and up
  static let floorPct = 0.1        // noise floor: this percentile of the last floorWin seconds
  static let floorWin = 600
  static let snoreLow = 0.5        // share of energy under 500 Hz for a snore (0.54–0.58 measured)
  static let snoreMaxLen = 4       // a snore lasts a few seconds at most
  static let snoreGap = (2, 9)     // seconds from one snore's start to the next (a breath)
  static let snoreRun = 3          // snores in a row before we call it snoring
  // Measured with replay (the JavaScript one, now night-tool replay) on speech (macOS say), and rough synthetic snoring and
  // coughing: every kind jumps; what differs is how sharply, where the energy sits, and length.
  static let snoreMaxJump = 22.0   // a snore swells (13–17 dB measured); speech and coughs snap on
  static let talkJump = 20.0       // syllables start sharply (30–37 dB measured)
  static let talkVar = 8.0         // ...and swing within each second (11–15 dB measured)
  static let coughJump = 25.0      // a cough is the sharpest start of all (38 dB measured)
  static let coughMid = 0.5        // ...with its energy above 500 Hz (0.66 measured; speech 0.3–0.45)
  static let coughMaxLen = 1
  static let noiseMinLen = 20      // one sound this long is the room (fan, traffic), not you
  static let mergeGap = 3          // sounds of one kind this close are one event
  static let wakeMove = 2.5        // weighted movement seconds per epoch that score awake (a turn or a restless spell is below it)
  static let gapSec = 15           // seconds without data that make an epoch a gap
  static let onsetEpochs = 20      // 10 min asleep in a row = fell asleep
  static let wakeEpochs = 4        // 2 min awake in a row = a wake-up; shorter runs are ignored
  static let restfulEpochs = 20    // 10 min asleep without movement, talk or cough = restful
  static let stirSec = 3           // movement seconds in the last minute that ring the smart alarm
  static let epoch = 30

  public enum Kind: UInt8, Sendable {
    case quiet, move, snore, talk, cough, noise
    public var name: String { ["quiet", "move", "snore", "talk", "cough", "noise"][Int(rawValue)] }
  }
  static let ck = [1.06, 0.54, 0.58, 0.76, 2.3, 0.74, 0.67]   // epochs -4 ... +2
  static let ckSum = ck.reduce(0, +)

  /// `sorted` ascending.
  static func percentile(_ sorted: [Double], _ p: Double) -> Double {
    sorted.isEmpty ? .nan : sorted[min(sorted.count - 1, Int((p * Double(sorted.count)).rounded(.down)))]
  }

  /// One floor per epoch, from the seconds before and including it, and the margin above it that
  /// makes a second loud: loudDb, or more in a room whose level wobbles by itself (a very quiet room
  /// sits at the microphone's own noise: 21 dB, moving 3-4 dB for nothing).
  static func noiseFloors(_ db: [Double]) -> (floor: [Double], margin: [Double]) {
    let E = (db.count + epoch - 1) / epoch
    var floor = [Double](repeating: 0, count: E), margin = floor
    for e in 0..<E {
      let hi = min(db.count, (e + 1) * epoch), lo = max(0, hi - floorWin)
      let vals = db[lo..<hi].filter(\.isFinite).sorted()
      floor[e] = percentile(vals, floorPct)
      margin[e] = min(loudMax, max(loudDb, wobbleK * (percentile(vals, 0.75) - floor[e])))
    }
    return (floor, margin)
  }

  public struct Sound: Sendable { public internal(set) var start: Int, end: Int, low: Double, mid: Double, vr: Double, at: Double, kind = Kind.move, snorish = false }

  /// Every sound of the night, its traits averaged over its seconds (`at`: the largest).
  public static func sounds(_ f: Readings) -> [Sound] {
    let db = f.db, (floor, margin) = noiseFloors(db)
    var out: [Sound] = []
    for s in db.indices {
      let e = s / epoch
      guard db[s] > floor[e] + margin[e] else { continue }
      if let i = out.indices.last, out[i].end == s {
        out[i].end += 1; out[i].low += f.low[s]; out[i].mid += f.mid[s]; out[i].vr += f.vr[s]
        out[i].at = max(out[i].at, f.at[s])
      } else { out.append(Sound(start: s, end: s + 1, low: f.low[s], mid: f.mid[s], vr: f.vr[s], at: f.at[s])) }
    }
    for i in out.indices {
      let len = out[i].end - out[i].start, n = Double(len)
      out[i].low /= n; out[i].mid /= n; out[i].vr /= n
      let b = out[i]
      out[i].kind = len >= noiseMinLen ? .noise
        : len <= coughMaxLen && b.at >= coughJump && b.mid >= coughMid ? .cough
        : b.at >= talkJump && b.vr >= talkVar ? .talk
        : .move
      out[i].snorish = out[i].kind == .move && len <= snoreMaxLen && b.low >= snoreLow && b.at < snoreMaxJump
    }
    // chains of snore-like sounds at breathing pace
    var chain: [Int] = []
    func flush() { if chain.count >= snoreRun { for i in chain { out[i].kind = .snore } }; chain = [] }
    for i in out.indices {
      let b = out[i]
      if !b.snorish { if b.kind != .move || b.end - b.start > snoreMaxLen { flush() }; continue }
      if let p = chain.last {
        let d = b.start - out[p].start
        if d < snoreGap.0 || d > snoreGap.1 { flush() }
      }
      chain.append(i)
    }
    flush()
    return out
  }

  /// Per second: what it was part of.
  static func classify(_ f: Readings) -> [Kind] {
    var kind = [Kind](repeating: .quiet, count: f.db.count)
    for b in sounds(f) { for s in b.start..<b.end { kind[s] = b.kind } }
    return kind
  }

  /// The night's events worth listing (not plain movement): sounds of one kind close together
  /// become one, so a snoring episode or a sentence is one line. `start`: the tracking start (ms).
  public static func events(_ f: Readings, start: Double) -> [NightRecord.SoundEvent] {
    var out: [(kind: Kind, start: Int, end: Int)] = []
    for b in sounds(f) where b.kind != .move {
      let gap = b.kind == .snore ? snoreGap.1 : mergeGap
      if let i = out.lastIndex(where: { $0.kind == b.kind }), b.start - out[i].end <= gap { out[i].end = b.end }
      else { out.append((b.kind, b.start, b.end)) }
    }
    return out.sorted { $0.start < $1.start }
      .map { NightRecord.SoundEvent(t: start + Double($0.start) * 1000, kind: $0.kind.name, sec: Double($0.end - $0.start)) }
  }

  struct Epoch { var move = 0, snore = 0, talk = 0, cough = 0, noise = 0, gap = 0
    /// Movement that counts towards being awake: a cough usually wakes you, talking in your sleep does not.
    var restless: Int { move + cough }
  }

  static func epochs(_ f: Readings) -> [Epoch] {
    let kind = classify(f), db = f.db, E = (db.count + epoch - 1) / epoch
    var out: [Epoch] = []
    for e in 0..<E {
      var ep = Epoch()
      for s in (e * epoch)..<min(db.count, (e + 1) * epoch) {
        if !db[s].isFinite { ep.gap += 1; continue }
        switch kind[s] {
        case .quiet: break
        case .move: ep.move += 1
        case .snore: ep.snore += 1
        case .talk: ep.talk += 1
        case .cough: ep.cough += 1
        case .noise: ep.noise += 1
        }
      }
      if e == E - 1 { ep.gap += (e + 1) * epoch - db.count }   // a short last epoch
      out.append(ep)
    }
    return out
  }

  // the states, as ASCII
  static let w = UInt8(ascii: "w"), s = UInt8(ascii: "s"), l = UInt8(ascii: "l"), d = UInt8(ascii: "d"), g = UInt8(ascii: "g")

  /// 'w' awake, 'l' light, 'd' restful, 'g' no data, per epoch; the epoch sleep began at and the
  /// one after it ended (-1 both without sleep).
  static func sleepWake(_ eps: [Epoch]) -> (states: [UInt8], onset: Int, end: Int) {
    let E = eps.count
    let awake = (0..<E).map { e in
      var score = 0.0
      for k in -4...2 { score += ck[k + 4] * (e + k >= 0 && e + k < E ? Double(eps[e + k].restless) : 0) }
      return score / ckSum > wakeMove
    }
    // fell asleep: the first run of onsetEpochs asleep (gaps break it)
    var onset = -1, run = 0
    for e in 0..<E {
      run = !awake[e] && eps[e].gap <= gapSec ? run + 1 : 0
      if run == onsetEpochs { onset = e - onsetEpochs + 1; break }
    }
    var st = (0..<E).map { e in eps[e].gap > gapSec ? g : onset < 0 || e < onset || awake[e] ? w : s }
    if onset < 0 { return (st, onset, -1) }
    // Runs too short to count take their neighbours' state: a quiet minute while getting up is not
    // sleep, a single restless minute is not a wake-up. Sleep first, so the night ends where it should.
    shortRuns(&st, s, w, onset + onsetEpochs, E)
    let end = (st.lastIndex(of: s) ?? -1) + 1
    shortRuns(&st, w, s, onset, end)
    // restful: long stretches of sleep with nothing from you in them
    var e = 0
    while e < E {
      guard st[e] == s else { e += 1; continue }
      var f = e
      while f < E && st[f] == s && eps[f].restless == 0 && eps[f].talk == 0 { f += 1 }
      let to = max(f, e + 1)
      for i in e..<to { st[i] = f - e >= restfulEpochs ? d : l }
      e = to
    }
    return (st, onset, end)
  }

  static func shortRuns(_ st: inout [UInt8], _ from: UInt8, _ to: UInt8, _ lo: Int, _ hi: Int) {
    var e = lo
    while e < hi {
      guard st[e] == from else { e += 1; continue }
      var f = e
      while f < hi && st[f] == from { f += 1 }
      let before = e > 0 ? st[e - 1] : 0, after = f < st.count ? st[f] : 0
      if f - e < wakeEpochs && before != g && after != g { for i in e..<f { st[i] = to } }
      e = f + 1
    }
  }

  struct Summary: Equatable {
    var on: Double?
    var wakes: Int, awakeMin: Double, asleepMin: Double, restfulMin: Double, snoreMin: Double
    var talks: Int, coughs: Int
    var events: [NightRecord.SoundEvent]
    var timeline: Timeline
  }

  static func summarize(_ f: Readings, start: Double) -> Summary {
    let eps = epochs(f), (st, onset, end) = sleepWake(eps)
    let mid = onset >= 0 && end > onset ? Array(st[onset..<end]) : []
    var dbMin: [Double?] = []
    for s0 in stride(from: 0, to: f.db.count, by: 60) {
      var m = -Double.infinity
      for i in s0..<min(f.db.count, s0 + 60) where f.db[i] > m { m = f.db[i] }
      dbMin.append(m.isFinite ? JS.round(m) : nil)
    }
    let ev = events(f, start: start)
    let runs = mid.indices.filter { mid[$0] == w && ($0 == 0 || mid[$0 - 1] != w) }.count
    func count(_ a: [UInt8], _ set: Set<UInt8>) -> Double { Double(a.filter(set.contains).count) }
    let marks = eps.map { ep -> Character in
      ep.cough > 0 ? "c" : ep.talk > 0 ? "t" : ep.snore > 0 ? "n" : ep.move >= 2 ? "m" : ep.noise >= 15 ? "x" : "."
    }
    return Summary(
      on: onset >= 0 ? start + Double(onset * epoch * 1000) : nil,
      wakes: runs, awakeMin: count(mid, [w]) / 2,
      asleepMin: count(st, [l, d]) / 2, restfulMin: count(st, [d]) / 2,
      snoreMin: Double(eps.filter { $0.snore > 0 }.count) / 2,
      talks: ev.filter { $0.kind == "talk" }.count, coughs: ev.filter { $0.kind == "cough" }.count,
      events: ev,
      timeline: Timeline(start: start, states: String(decoding: st, as: UTF8.self), events: String(marks), db: dbMin))
  }

  /// Smart alarm: is the sleeper moving right now? Looks at the last 11 minutes only, so it is
  /// cheap to call every few seconds.
  public static func stirring(_ f: Readings) -> Bool {
    let kind = classify(f.slice(from: max(0, f.db.count - 660)))
    return kind.suffix(60).filter { $0 == .move || $0 == .cough }.count >= stirSec
  }
}
