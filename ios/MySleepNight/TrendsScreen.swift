import Charts
import SwiftUI

/// The week, month or year: the average score and four numbers, then a chart each for the score, the
/// hours, when you slept and snoring.
struct TrendsScreen: View {
  @EnvironmentObject var data: NightData
  @State private var days = 7
  @State private var v: TrendsView?

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 12) {
          Picker("Period", selection: $days) { Text("Week").tag(7); Text("Month").tag(30); Text("Year").tag(365) }.pickerStyle(.segmented)
          if let v {
            if let e = v.empty {
              Text(e).foregroundStyle(Theme.text2).frame(maxWidth: .infinity).padding(.top, 40)
            } else {
              hero(v).rise(0)
              if let s = v.scores { chart("Score per night", nil, s, max: 100, ticks: [0, 50, 100], fmt: { "\(Int($0))" }) { b in b.tone?.color ?? Theme.accent } .rise(1) }
              if let h = v.hours {
                chart("Hours asleep", "Against the 8h most adults need", h, max: 540, ticks: [0, 180, 360, 540], fmt: { "\(Int($0) / 60)h" }, target: 480) { b in b.full == true ? Theme.accent : Theme.accent.opacity(0.55) }.rise(2)
              }
              if let w = v.windows, let t = v.target { windows(w, t).rise(3) }
              if let s = v.snoring { chart("Snoring", "Minutes per night", s, max: max(20, s.map(\.value).max() ?? 0), ticks: [0], fmt: { _ in "0" }) { _ in Theme.snore }.rise(4) }
            }
          }
        }
        .padding(.horizontal, 20).padding(.bottom, 24)
        .animation(.smooth(duration: 0.3), value: days)
      }
      .background(Theme.bg)
      .navigationTitle("Trends").navigationBarTitleDisplayMode(.large)
      .task(id: "\(data.version)-\(days)") { v = data.store?.trends(days: days) }
    }
  }

  private func hero(_ v: TrendsView) -> some View {
    Card {
      Eyebrow(text: v.label ?? "")
      Text("\(v.avg ?? 0)").font(.system(size: 44, weight: .bold)).monospacedDigit().contentTransition(.numericText()).padding(.top, 4)
      Text("Average sleep score" + (v.change.map { " · " + $0 } ?? "")).foregroundStyle(Theme.text2)
      LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 12) {
        ForEach(Array((v.kpis ?? []).enumerated()), id: \.offset) { _, k in
          VStack(alignment: .leading, spacing: 2) { Text(k.value).font(.title3.weight(.semibold)).monospacedDigit(); Text(k.label).font(.footnote).foregroundStyle(Theme.text2) }
            .frame(maxWidth: .infinity, alignment: .leading).padding(12).background(Theme.bg.opacity(0.5), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
      }
      .padding(.top, 14)
    }
  }

  private func chart(_ title: String, _ sub: String?, _ bars: [TrendsView.Bar], max top: Double, ticks: [Double], fmt: @escaping (Double) -> String,
                     target: Double? = nil, color: @escaping (TrendsView.Bar) -> Color) -> some View {
    let labels = Dictionary(bars.map { ($0.id, $0.label) }, uniquingKeysWith: { a, _ in a })
    return Card {
      Eyebrow(text: title)
      if let sub { Text(sub).font(.title3.weight(.semibold)).padding(.top, 2) }
      Chart {
        ForEach(bars, id: \.id) { b in
          // a night with nothing to show keeps its place on the axis (a bar of no height)
          BarMark(x: .value("Night", b.id), y: .value("Value", min(b.value, top))).foregroundStyle(color(b)).cornerRadius(3)
        }
        if let target { RuleMark(y: .value("Target", target)).lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3])).foregroundStyle(Theme.text2) }
      }
      .chartYScale(domain: 0...top)
      .chartYAxis { AxisMarks(values: ticks) { v in AxisGridLine().foregroundStyle(Color.white.opacity(0.14)); AxisValueLabel { if let d = v.as(Double.self) { Text(fmt(d)).font(.caption2) } } } }
      .chartXAxis { AxisMarks { v in AxisValueLabel { if let id = v.as(String.self) { Text(labels[id] ?? "").font(.caption2) } } } }
      .frame(height: 140).padding(.top, 10)
    }
  }

  /// A bar from falling asleep to waking on a clock axis (minutes after noon), against the target.
  /// Earlier is higher up, so the axis is mirrored (Charts has no reversed range): a time m is drawn at flip(m).
  private static func flip(_ m: Double) -> Double { 1860 - m }
  private func windows(_ w: [TrendsView.Window], _ t: TrendsView.Target) -> some View {
    let labels = Dictionary(w.map { ($0.id, $0.label) }, uniquingKeysWith: { a, _ in a })
    return Card {
      Eyebrow(text: "Consistency")
      Text("When you slept").font(.title3.weight(.semibold)).padding(.top, 2)
      Chart {
        ForEach(w, id: \.id) { n in
          if let on = n.on, let wake = n.wake { BarMark(x: .value("Night", n.id), yStart: .value("Asleep", Self.flip(on)), yEnd: .value("Awake", Self.flip(wake))).foregroundStyle(Theme.accent).cornerRadius(3) }
          else { BarMark(x: .value("Night", n.id), yStart: .value("Asleep", 660), yEnd: .value("Awake", 660)).foregroundStyle(.clear) }
        }
        RuleMark(y: .value("Bedtime", Self.flip(t.bed))).lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3])).foregroundStyle(Theme.text2)
        RuleMark(y: .value("Wake", Self.flip(t.wake))).lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3])).foregroundStyle(Theme.text2)
      }
      .chartYScale(domain: 600...1260)
      .chartYAxis { AxisMarks(values: [660, 780, 900, 1020, 1140, 1260]) { v in AxisGridLine().foregroundStyle(Color.white.opacity(0.14)); AxisValueLabel { if let m = v.as(Double.self) { Text(Self.clock(Self.flip(m))).font(.caption2) } } } }
      .chartXAxis { AxisMarks { v in AxisValueLabel { if let id = v.as(String.self) { Text(labels[id] ?? "").font(.caption2) } } } }
      .frame(height: 170).padding(.top, 10)
      HStack(spacing: 14) {
        HStack(spacing: 5) { RoundedRectangle(cornerRadius: 2).fill(Theme.accent).frame(width: 9, height: 9); Text("Asleep") }
        Text("Target \(t.label)")
      }
      .font(.caption).foregroundStyle(Theme.text2).padding(.top, 8)
    }
  }

  /// Minutes after noon as a clock time: 660 is 23:00.
  static func clock(_ m: Double) -> String { let c = (Int(m) + 720) % 1440; return String(format: "%02d:%02d", c / 60, c % 60) }
}
