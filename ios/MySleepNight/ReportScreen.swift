import SwiftUI

/// One night: its score and what it means, three numbers, the night as a picture, how the score adds
/// up, what was heard.
struct ReportScreen: View {
  let id: String
  @EnvironmentObject var data: NightData
  @EnvironmentObject var server: ServerLink
  @EnvironmentObject var nav: Navigation
  @State private var v: ReportView?
  @State private var parts = false
  @State private var editing = false
  @State private var confirming = false

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
    .toolbar {
      if v != nil {
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            Button("Correct the times", systemImage: "pencil") { editing = true }
            Button("Delete night", systemImage: "trash", role: .destructive) { confirming = true }
          } label: { Image(systemName: "ellipsis.circle") }.accessibilityLabel("More")
        }
      }
    }
    .sheet(isPresented: $editing) { if let v { CorrectSheet(report: v) { sync() }.presentationDetents([.height(380)]) } }
    .confirmationDialog("Delete \(v?.title ?? "this night")?", isPresented: $confirming, titleVisibility: .visible) {
      Button("Delete", role: .destructive) { data.delete(id); if !nav.journalPath.isEmpty { nav.journalPath.removeLast() }; sync() }
    } message: { Text("The night and its summary go from every device.") }
    .task(id: data.version) { v = data.store?.report(id) }
  }

  private func sync() { Task { await data.refresh(pairing: server.pairing) } }

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

/// The times of a night, when the microphone got them wrong: when you went to bed, fell asleep, woke.
/// A night without sleep found has no "fell asleep" time until one is added.
private struct CorrectSheet: View {
  let report: ReportView
  let saved: () -> Void
  @EnvironmentObject var data: NightData
  @Environment(\.dismiss) private var dismiss
  @State private var times: Correction
  @State private var error: String?

  init(report: ReportView, saved: @escaping () -> Void) {
    self.report = report; self.saved = saved
    _times = State(initialValue: Correction(report.times))
  }

  var body: some View {
    VStack(spacing: 0) {
      HStack { Text("Correct the times").font(.headline); Spacer(); Button("Cancel") { dismiss() } }.padding(20)
      VStack(spacing: 0) {
        row("In bed", $times.bed); Divider().overlay(Theme.line)
        fellAsleep; Divider().overlay(Theme.line)
        row("Woke up", $times.wake)
      }
      .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous)).padding(.horizontal, 20)
      .animation(.snappy(duration: 0.25), value: times.on == nil)
      if let error { Text(error).font(.footnote).foregroundStyle(.red).padding(.top, 10).padding(.horizontal, 20) }
      Spacer()
      PrimaryButton(title: "Save", systemImage: "checkmark") {
        let t = times.texts
        if let e = data.correct(report.id, bed: t.bed, on: t.on, wake: t.wake) { withAnimation(.snappy) { error = e } }
        else { saved(); dismiss() }
      }
      .padding(20)
    }
    .background(Theme.bg)
  }

  @ViewBuilder private var fellAsleep: some View {
    if let on = times.on {
      HStack {
        Text("Fell asleep"); Spacer()
        DatePicker("Fell asleep", selection: Binding(get: { on }, set: { times.on = $0 }), displayedComponents: .hourAndMinute).labelsHidden()
        Button { times.removeFellAsleep() } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.text2) }
          .buttonStyle(Pressable()).accessibilityLabel("No sleep")
      }
      .padding(.horizontal, 16).padding(.vertical, 8)
    } else {
      HStack {
        Text("Fell asleep"); Spacer()
        Button("Not found · add") { times.addFellAsleep() }
      }
      .padding(.horizontal, 16).padding(.vertical, 14)
    }
  }

  private func row(_ title: String, _ date: Binding<Date>) -> some View {
    HStack { Text(title); Spacer(); DatePicker(title, selection: date, displayedComponents: .hourAndMinute).labelsHidden() }.padding(.horizontal, 16).padding(.vertical, 8)
  }
}
