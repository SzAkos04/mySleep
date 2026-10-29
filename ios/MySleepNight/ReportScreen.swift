import SwiftUI

/// One night: its score and what it means, three numbers, the night as a picture, how the score adds
/// up, what was heard. (The web app's night page.)
struct ReportScreen: View {
  let id: String
  @EnvironmentObject var data: NightData
  @State private var v: ReportView?
  @State private var parts = false

  var body: some View {
    ScrollView {
      if let v {
        VStack(alignment: .leading, spacing: 12) {
          Text(v.range).font(.subheadline).foregroundStyle(Theme.text2).monospacedDigit().padding(.horizontal, 4).rise(0)
          hero(v).rise(1)
          Button { withAnimation(.snappy(duration: 0.3)) { parts.toggle() } } label: {
            Text(parts ? "Hide how the score adds up" : "How the score adds up").font(.subheadline).foregroundStyle(Theme.accent).frame(maxWidth: .infinity)
          }
          .buttonStyle(Pressable())
          if parts { Card(padding: 4) { ForEach(v.parts, id: \.label) { p in partRow(p) } }.transition(.opacity.combined(with: .scale(scale: 0.97, anchor: .top))) }
          if !v.insights.isEmpty {
            Card { VStack(alignment: .leading, spacing: 10) { ForEach(v.insights, id: \.self) { line in
              HStack(alignment: .firstTextBaseline, spacing: 10) { Circle().fill(Theme.accent).frame(width: 6, height: 6).offset(y: -2); Text(line).fixedSize(horizontal: false, vertical: true) }
            } } }.rise(2)
          }
          if let t = v.timeline {
            Card {
              Eyebrow(text: "What the microphone heard").padding(.bottom, 12)
              NightPicture(timeline: t, full: true)
              PictureLegend().padding(.top, 10)
              Text("Light and restful are a rough estimate from how still and quiet you were, not measured sleep stages.\(v.alarm.map { " " + $0 } ?? "")")
                .font(.footnote).foregroundStyle(Theme.text2).padding(.top, 10)
            }
            .rise(3)
          }
          if !v.sounds.isEmpty {
            Card(padding: 4) {
              Text("Sounds").font(.footnote.weight(.semibold)).foregroundStyle(Theme.text2).padding(.horizontal, 14).padding(.top, 10)
              ForEach(Array(v.sounds.enumerated()), id: \.offset) { _, s in
                HStack { VStack(alignment: .leading) { Text(s.label); Text(s.time).font(.footnote).foregroundStyle(Theme.text2).monospacedDigit() }; Spacer(); Text(s.length).foregroundStyle(Theme.text2) }.padding(14)
              }
            }
          }
          if !v.diag.isEmpty {
            Card(padding: 4) {
              Text("Diagnostics · the full log is on your server").font(.footnote.weight(.semibold)).foregroundStyle(Theme.text2).padding(.horizontal, 14).padding(.top, 10)
              ForEach(v.diag, id: \.label) { d in HStack { Text(d.label); Spacer(); Text(d.value).foregroundStyle(d.bad ? Theme.warn : Theme.text2) }.padding(14) }
            }
          }
        }
        .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 24)
      } else {
        Text("This night is gone.").foregroundStyle(Theme.text2).frame(maxWidth: .infinity).padding(.top, 80)
      }
    }
    .background(Theme.bg)
    .navigationTitle(v?.title ?? "Night").navigationBarTitleDisplayMode(.large)
    .task(id: data.version) { v = data.store?.report(id) }
  }

  private func hero(_ v: ReportView) -> some View {
    Card {
      HStack(spacing: 16) {
        ScoreRing(score: v.score, tone: v.blank ? .warn : v.tone)
        VStack(alignment: .leading, spacing: 3) {
          Eyebrow(text: "Sleep score")
          Text(v.verdict).font(.title3.weight(.semibold))
          if let w = v.vsWeek { Text(w).font(.footnote).foregroundStyle(Theme.text2) }
        }
        Spacer(minLength: 0)
      }
      HStack(alignment: .top) {
        ForEach(Array(v.facts.enumerated()), id: \.offset) { _, f in
          VStack(alignment: .leading, spacing: 2) { Text(f.value).font(.title3.weight(.semibold)).monospacedDigit(); Text(f.label).font(.footnote).foregroundStyle(Theme.text2) }
          Spacer(minLength: 0)
        }
      }
      .padding(.top, 16)
      if let t = v.timeline { NightPicture(timeline: t).padding(.top, 14) }
    }
  }

  private func partRow(_ p: ReportView.Part) -> some View {
    HStack { VStack(alignment: .leading, spacing: 1) { Text(p.label); Text(p.note).font(.footnote).foregroundStyle(Theme.text2) }; Spacer(); Text("\(p.pts)/\(p.max)").monospacedDigit().foregroundStyle(Theme.text2) }.padding(14)
  }
}
