import SwiftUI

// The night's pictures: the score ring, the night as the microphone heard it. Plain shapes and one Canvas each: light work for an iPhone 11.

extension Tone {
  var color: Color { switch self { case .good: Theme.good; case .accent: Theme.accent; case .warn: Theme.warn } }
}

extension Theme {
  static let snore = Color(red: 0x40 / 255, green: 0xc8 / 255, blue: 0xe0 / 255)
  static let talk = Color(red: 1, green: 0xd6 / 255, blue: 0x0a / 255)
  static let cough = Color(red: 1, green: 0x45 / 255, blue: 0x3a / 255)
  static let move = Color(red: 235 / 255, green: 235 / 255, blue: 245 / 255).opacity(0.45)
  static let noise = Color(red: 235 / 255, green: 235 / 255, blue: 245 / 255).opacity(0.14)
  static let surface3 = Color(red: 0x36 / 255, green: 0x33 / 255, blue: 0x30 / 255)
  static let surface2 = Color(red: 0x27 / 255, green: 0x25 / 255, blue: 0x22 / 255)
}

/// The sleep score as a ring that fills when it first shows.
struct ScoreRing: View {
  let score: Int, tone: Tone
  var size: CGFloat = 88
  @State private var shown = false
  @Environment(\.accessibilityReduceMotion) private var still
  var body: some View {
    ZStack {
      Circle().stroke(Theme.surface2, lineWidth: size * 0.08)
      Circle().trim(from: 0, to: shown || still ? CGFloat(score) / 100 : 0)
        .stroke(tone.color, style: StrokeStyle(lineWidth: size * 0.08, lineCap: .round)).rotationEffect(.degrees(-90))
      Text("\(score)").font(.system(size: size * 0.32, weight: .bold)).monospacedDigit()
    }
    .frame(width: size, height: size)
    .onAppear { withAnimation(.easeOut(duration: 0.9)) { shown = true } }
    .accessibilityElement().accessibilityLabel("Sleep score \(score)")
  }
}

/// The night as the microphone heard it: loudness, then (full) three rows (awake, light, restful) and
/// the sounds, with the hours; (small) one coloured lane.
struct NightPicture: View {
  let timeline: Timeline
  var full = false

  static func state(_ c: Character) -> Color? {
    switch c { case "w": Theme.warn; case "l", "s": Theme.accent.opacity(0.55); case "d": Theme.accent; default: nil }
  }
  static func sound(_ c: Character) -> (Color, Bool)? {   // colour, tall
    switch c { case "n": (Theme.snore, true); case "t": (Theme.talk, true); case "c": (Theme.cough, true); case "m": (Theme.move, false); case "x": (Theme.noise, true); default: nil }
  }

  var body: some View {
    let t = timeline, states = Array(t.states), events = Array(t.events), E = max(states.count, 1)
    let sH: CGFloat = full ? 34 : 30, rowH: CGFloat = full ? 18 : 10, top = sH + 8
    let evY = top + 3 * rowH + 8
    let height: CGFloat = full ? evY + 34 : 66
    Canvas { ctx, size in
      let left: CGFloat = full ? 42 : 0, w = size.width - left
      let x = { (e: Int) in left + CGFloat(e) / CGFloat(E) * w }
      // loudness, a minute a value
      let vals = t.db.compactMap { $0 }
      if let lo = vals.min() {
        let hi = max(lo + 10, vals.max() ?? lo), y = { (v: Double) in sH - CGFloat((v - lo) / (hi - lo)) * sH }
        var p = Path(); p.move(to: CGPoint(x: left, y: sH))
        for (m, v) in t.db.enumerated() { p.addLine(to: CGPoint(x: x(m * 2), y: v.map(y) ?? sH)) }
        p.addLine(to: CGPoint(x: left + w, y: sH)); p.closeSubpath()
        ctx.fill(p, with: .color(Color.white.opacity(0.14)))
      }
      // runs of one state
      var s = 0
      for e in 1...E {
        if e == E || states[e] != states[s] {
          let k = states[s], level: CGFloat = k == "w" ? 0 : k == "d" ? 2 : 1
          let color = Self.state(k) ?? (full ? nil : Theme.surface3)
          if let color {
            let r = CGRect(x: x(s), y: top + (full ? level * rowH : 0), width: max(x(e) - x(s) - (full ? 0.4 : 0.6), 1), height: full ? rowH - 3 : rowH)
            ctx.fill(Path(roundedRect: r, cornerRadius: 2), with: .color(color))
          }
          s = e
        }
      }
      guard full else { return }
      for (i, name) in ["Awake", "Light", "Restful"].enumerated() {
        ctx.draw(Text(name).font(.system(size: 9)).foregroundStyle(Theme.text2), at: CGPoint(x: 0, y: top + CGFloat(i) * rowH + rowH * 0.5), anchor: .leading)
      }
      // what was heard
      for (e, c) in events.enumerated() {
        guard let (color, tall) = Self.sound(c) else { continue }
        ctx.fill(Path(CGRect(x: x(e), y: evY + (tall ? 0 : 4), width: max(w / CGFloat(E), 1.2), height: tall ? 12 : 8)), with: .color(color))
      }
      // the hours
      let cal = Calendar.current, startDate = Date(timeIntervalSince1970: t.start / 1000)
      var h = cal.nextDate(after: startDate.addingTimeInterval(-1), matching: DateComponents(minute: 0, second: 0), matchingPolicy: .nextTime) ?? startDate
      let end = startDate.addingTimeInterval(Double(E) * 30)
      while h < end {
        let hx = x(Int(h.timeIntervalSince(startDate) / 30))
        ctx.stroke(Path { $0.move(to: CGPoint(x: hx, y: 0)); $0.addLine(to: CGPoint(x: hx, y: evY + 14)) }, with: .color(Color.white.opacity(0.14)), lineWidth: 0.5)
        ctx.draw(Text(h, format: .dateTime.hour(.twoDigits(amPM: .omitted)).minute()).font(.system(size: 9)).foregroundStyle(Theme.text2), at: CGPoint(x: hx, y: evY + 26), anchor: .center)
        h = h.addingTimeInterval(3600)
      }
    }
    .frame(height: height)
    .accessibilityElement().accessibilityLabel("The night: loudness, awake, light and restful sleep, and the sounds heard")
  }
}

struct PictureLegend: View {
  var body: some View {
    let items: [(String, Color)] = [("Awake", Theme.warn), ("Light", Theme.accent.opacity(0.55)), ("Restful", Theme.accent), ("Snoring", Theme.snore),
                                    ("Talking", Theme.talk), ("Coughing", Theme.cough), ("Movement", Theme.move), ("Room noise", Theme.noise)]
    FlowLayout(spacing: 12) {
      ForEach(items, id: \.0) { name, color in
        HStack(spacing: 5) { RoundedRectangle(cornerRadius: 2).fill(color).frame(width: 9, height: 9); Text(name).font(.caption).foregroundStyle(Theme.text2) }
      }
    }
  }
}

/// Items wrapping onto new lines (chips, legends).
struct FlowLayout: Layout {
  var spacing: CGFloat = 8
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let w = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0
    for s in subviews {
      let d = s.sizeThatFits(.unspecified)
      if x > 0 && x + d.width > w { x = 0; y += row + spacing; row = 0 }
      x += d.width + spacing; row = max(row, d.height)
    }
    return CGSize(width: w == .infinity ? x : w, height: y + row)
  }
  func placeSubviews(in b: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = b.minX, y = b.minY, row: CGFloat = 0
    for s in subviews {
      let d = s.sizeThatFits(.unspecified)
      if x > b.minX && x + d.width > b.maxX { x = b.minX; y += row + spacing; row = 0 }
      s.place(at: CGPoint(x: x, y: y), proposal: .unspecified)
      x += d.width + spacing; row = max(row, d.height)
    }
  }
}
