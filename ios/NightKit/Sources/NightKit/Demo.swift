import Foundation

extension NightState {
  /// A month of made-up nights ending last night, the same every time, for the demo mode
  /// (MYSLEEP_DEMO=1) and the UI tests. Not real sleep: the shapes are plausible, nothing more.
  public static func demo(now: Date) -> NightState {
    var s = NightState()
    let last = Clock.noon(Clock.nightId(Clock.ms(now) - 12 * 3600e3))   // last night, not tonight's
    for i in 0..<30 {
      let id = Clock.id(of: Clock.cal.date(byAdding: .day, value: -i, to: last) ?? last)
      s.nights[id] = demoNight(id, seed: UInt32(i + 7))
    }
    return s
  }

  static func demoNight(_ id: String, seed: UInt32) -> NightRecord {
    var x = seed
    func r() -> Double { x = x &* 1_664_525 &+ 1_013_904_223; return Double(x) / 4_294_967_296 }
    func pick(_ lo: Int, _ hi: Int) -> Int { lo + Int(r() * Double(hi - lo + 1)) }
    let bed = Clock.atClock(id, "23:00") + Double(pick(-25, 70)) * 60e3
    let fall = pick(6, 38), wake = Clock.atClock(id, "06:45") + Double(pick(-25, 55)) * 60e3
    let epochs = Int((wake - bed) / 30e3)
    var states = String(repeating: "w", count: fall * 2), marks = String(repeating: ".", count: fall * 2)
    while states.count < epochs {   // ninety-minute cycles: light, restful, a stir now and then
      let run = min(epochs - states.count, pick(40, 80)), deep = Int(Double(run) * (0.3 + r() * 0.3))
      states += String(repeating: "l", count: max(0, run - deep - 2)) + String(repeating: "d", count: deep) + (r() < 0.5 ? "ww" : "ll")
      marks += String((0..<run).map { _ in r() < 0.05 ? "n" : r() < 0.03 ? "m" : "." })
    }
    states = String(states.prefix(epochs)); marks = String(marks.prefix(epochs)).padding(toLength: epochs, withPad: ".", startingAt: 0)
    let st = Array(states.utf8), count = { (c: UInt8) in Double(st.filter { $0 == c }.count) }
    let snores = marks.enumerated().filter { $0.element == "n" }.map { bed + Double($0.offset) * 30e3 }
    var n = NightRecord(id: id)
    n.bed = bed; n.on = bed + Double(fall) * 60e3; n.wake = wake
    n.wakes = st.indices.filter { st[$0] == Analysis.w && ($0 == 0 || st[$0 - 1] != Analysis.w) }.count - 1
    n.awakeMin = count(Analysis.w) / 2 - Double(fall); n.asleepMin = (count(Analysis.l) + count(Analysis.d)) / 2
    n.restfulMin = count(Analysis.d) / 2; n.snoreMin = Double(snores.count) / 2; n.talks = 0; n.coughs = 0
    n.events = snores.prefix(6).map { .init(t: $0, kind: "snore", sec: 30) }
    n.timeline = Timeline(start: bed, states: states, events: marks, db: (0..<((epochs + 1) / 2)).map { _ in Double(pick(24, 38)) })
    n.clips = []; n.source = "native"
    return n
  }
}
