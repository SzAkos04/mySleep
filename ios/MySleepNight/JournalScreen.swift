import SwiftUI

/// Every night as a month calendar coloured by score; the chosen night below, a tap opens its report.
struct JournalScreen: View {
  @EnvironmentObject var data: NightData
  @EnvironmentObject var nav: Navigation
  @State private var month: MonthID?
  @State private var sel: String?
  @State private var v: JournalView?

  var body: some View {
    NavigationStack(path: $nav.journalPath) {
      ScrollView {
        if let v {
          VStack(alignment: .leading, spacing: 12) {
            calendar(v).rise(0)
            if let s = v.selected {
              Button { nav.journalPath.append(s.id) } label: { selected(s) }.buttonStyle(Pressable()).rise(1)
            } else if let e = v.empty {
              Text(e).foregroundStyle(Theme.text2).frame(maxWidth: .infinity).padding(.top, 30)
            }
          }
          .padding(.horizontal, 20).padding(.bottom, 24)
        }
      }
      .background(Theme.bg)
      .navigationTitle(v?.title ?? "Journal").navigationBarTitleDisplayMode(.large)
      .toolbar {
        ToolbarItemGroup(placement: .topBarTrailing) {
          Button { step(-1) } label: { Image(systemName: "chevron.left") }.accessibilityLabel("Previous month")
          Button { step(1) } label: { Image(systemName: "chevron.right") }.disabled(v?.canNext != true).accessibilityLabel("Next month")
        }
      }
      .navigationDestination(for: String.self) { ReportScreen(id: $0) }
      .task(id: data.version) { load() }
    }
  }

  private func load() {
    guard let store = data.store else { return }
    let m = month ?? store.startMonth(now: Date())
    if month == nil { month = m }
    v = store.journal(m, selected: sel, now: Date())
  }

  private func step(_ d: Int) {
    guard var m = month else { return }
    m.month += d
    if m.month < 0 { m.month = 11; m.year -= 1 } else if m.month > 11 { m.month = 0; m.year += 1 }
    month = m
    withAnimation(.snappy(duration: 0.3)) { v = data.store?.journal(m, selected: sel, now: Date()) }
  }

  private func calendar(_ v: JournalView) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text(v.sub).font(.subheadline).foregroundStyle(Theme.text2).padding(.horizontal, 4)
      Card(padding: 12) {
        let cols = Array(repeating: GridItem(.flexible(), spacing: 6), count: 7)
        LazyVGrid(columns: cols, spacing: 6) {
          ForEach(Array("MTWTFSS".enumerated()), id: \.offset) { _, d in Text(String(d)).font(.footnote).foregroundStyle(Theme.text2) }
          ForEach(0..<v.lead, id: \.self) { _ in Color.clear.frame(height: 40) }
          ForEach(v.days, id: \.id) { day in dayCell(day, chosen: day.id == (sel ?? v.selected?.id)) }
        }
        .id(v.title)
        .transition(.opacity)
      }
    }
  }

  private func dayCell(_ d: JournalView.Day, chosen: Bool) -> some View {
    let fill: Color = d.kind == .scored ? (d.tone?.color ?? Theme.accent).opacity(0.30) : d.kind == .blank ? Theme.surface2 : .clear
    return Button { withAnimation(.snappy(duration: 0.25)) { sel = d.id; load() } } label: {
      Text("\(d.n)").font(.callout).monospacedDigit().frame(maxWidth: .infinity).frame(height: 40)
        .foregroundStyle(d.kind == .future ? Theme.text2.opacity(0.4) : d.kind == .none ? Theme.text2 : .primary)
        .background(fill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(chosen ? Theme.accent : .clear, lineWidth: 2))
    }
    .buttonStyle(Pressable())
    .disabled(d.kind == .none || d.kind == .future)
    .accessibilityLabel(d.kind == .scored ? "\(d.id), score \(d.score ?? 0)" : d.kind == .blank ? "\(d.id), nothing recorded" : "\(d.n)")
  }

  private func selected(_ s: JournalView.Selected) -> some View {
    Card {
      HStack(spacing: 14) {
        ScoreRing(score: s.score, tone: s.blank ? .warn : s.tone, size: 58)
        VStack(alignment: .leading, spacing: 2) {
          Eyebrow(text: s.title)
          Text(s.headline).font(.title3.weight(.semibold))
          if !s.line.isEmpty { Text(s.line).font(.footnote).foregroundStyle(Theme.text2) }
        }
        Spacer(minLength: 0)
        Image(systemName: "chevron.right").foregroundStyle(Theme.text2)
      }
      if let t = s.timeline { NightPicture(timeline: t).padding(.top, 12) }
    }
  }
}
