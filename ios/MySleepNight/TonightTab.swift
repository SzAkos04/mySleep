import ActivityKit
import AVFoundation
import SwiftUI

/// The first tab: the evening (the alarm, then Sleep) or, after a night, the morning's summary.
struct TonightTab: View {
  @EnvironmentObject var engine: NightEngine
  @AppStorage("morningSeenEnd") private var seenEnd = 0.0

  var body: some View {
    let morning = engine.lastNight.flatMap { Morning.shows(end: $0.end, seen: Date(timeIntervalSince1970: seenEnd), now: Date()) ? $0 : nil }
    ZStack {
      if let last = morning {
        MorningView(night: last) { seenEnd = last.end.timeIntervalSince1970 }.transition(.opacity.combined(with: .offset(y: -12)))
      } else {
        EveningView().transition(.opacity.combined(with: .offset(y: 12)))
      }
    }
    .animation(.smooth(duration: 0.45), value: morning?.end)
  }
}

// MARK: evening

struct EveningView: View {
  @EnvironmentObject var engine: NightEngine
  @EnvironmentObject var alarm: AlarmController
  @EnvironmentObject var server: ServerLink
  @EnvironmentObject var nav: Navigation
  @EnvironmentObject var data: NightData
  @State private var picking = false
  @State private var error: String?
  @State private var starting = false

  // tonight's alarm is the synced settings' (Settings.swift): a change is saved and goes up
  private var on: Bool { data.settings.alarm }
  private var smart: Bool { data.settings.smart }
  private var settings: AlarmSettings { data.settings.alarmSettings }
  private func flag(_ key: String) -> Binding<Bool> { Binding(get: { key == "alarm" ? data.settings.alarm : data.settings.smart }, set: { data.change([key: $0]) }) }

  var body: some View {
    TimelineView(.everyMinute) { ctx in
      let plan = AlarmPlan.make(settings, from: ctx.date)
      let install = InstallStatus(expires: server.expires, now: ctx.date)
      ScrollView {
        VStack(alignment: .leading, spacing: 10) {
          HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 2) {
              Text("Tonight").font(.largeTitle.bold())
              Text(ctx.date, format: .dateTime.weekday(.wide).day().month(.wide)).foregroundStyle(Theme.text2)
            }
            Spacer()
            Button { nav.tab = .settings } label: {
              Image(systemName: server.pairing == nil ? "icloud.slash" : server.problem == nil ? "checkmark.icloud" : "exclamationmark.icloud")
                .contentTransition(.symbolEffect(.replace))
                .font(.system(size: 18, weight: .medium)).frame(width: 44, height: 44)
                .foregroundStyle(server.pairing != nil && server.problem == nil ? Theme.good : Theme.warn)
                .background(Theme.card, in: Circle())
            }
            .buttonStyle(Pressable())
            .accessibilityLabel("Server")
          }
          .padding(.bottom, 12)
          .rise(0)

          // the alarm, the screen's one decision
          Card {
            HStack {
              Eyebrow(text: "Wake up")
              Spacer()
              Toggle("Alarm", isOn: flag("alarm")).labelsHidden()
            }
            if let plan {
              VStack(alignment: .leading, spacing: 0) {
                Button { picking = true } label: {
                  HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(settings.time).font(.system(size: 64, weight: .ultraLight)).monospacedDigit().kerning(-2)
                      .contentTransition(.numericText())
                    Text("in \(duration(plan.at.timeIntervalSince(ctx.date) / 60))").foregroundStyle(Theme.text2)
                      .contentTransition(.numericText())
                  }
                }
                .buttonStyle(Pressable()).accessibilityHint("Change the wake-up time")
                Rectangle().fill(Theme.line).frame(height: 1).padding(.vertical, 14)
                HStack(spacing: 12) {
                  Image(systemName: "sparkles").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.bg)
                    .frame(width: 30, height: 30).background(smart ? Theme.accent : Theme.line, in: RoundedRectangle(cornerRadius: 8))
                    .symbolEffect(.bounce, value: smart)
                  VStack(alignment: .leading, spacing: 1) {
                    Text("Smart alarm")
                    Text(smart ? "From \(InstallStatus.clock(plan.at.addingTimeInterval(-Double(AlarmPlan.smartMinutes) * 60), .current)), as soon as you stir" : "Up to 30 min earlier, when you stir")
                      .font(.footnote).foregroundStyle(Theme.text2).contentTransition(.opacity)
                  }
                  Spacer()
                  Toggle("Smart alarm", isOn: flag("smart")).labelsHidden()
                }
              }
              .transition(.opacity.combined(with: .offset(y: -8)))
            } else {
              VStack(alignment: .leading, spacing: 0) {
                Text("No alarm").font(.system(size: 44, weight: .ultraLight)).foregroundStyle(Theme.text2).padding(.top, 6)
                Text("Turn it on to be woken gently.").font(.footnote).foregroundStyle(Theme.text2)
              }
              .transition(.opacity.combined(with: .offset(y: 8)))
            }
          }
          .animation(.snappy(duration: 0.35), value: on)
          .animation(.smooth(duration: 0.3), value: smart)
          .animation(.smooth(duration: 0.4), value: settings.time)
          .rise(1)

          // about the alarm, so gone with it
          VStack {
            if let plan {
              HStack(spacing: 10) {
                FactCard(value: duration(plan.at.timeIntervalSince(ctx.date) / 60), label: "of sleep if you go now")
                FactCard(value: "Gentle", label: "piano, rising in 25 s")
              }
              .transition(.opacity.combined(with: .scale(scale: 0.96, anchor: .top)))
            }
          }
          .animation(.snappy(duration: 0.35), value: on)
          .rise(2)

          // what needs you before the night, and only that
          FlowLayout(spacing: 8) {
            Group {
              if server.pairing == nil { Button { nav.tab = .settings } label: { Chip(text: "Not paired with your server", warn: true) } }
              else { Chip(text: "Sends to \(server.pairing?.server.host ?? "your server")") }
              if install.level != .unknown {
                Button { nav.tab = .settings } label: { Chip(text: install.title, warn: install.level != .fine) }
              }
              if alarm.allowed == false && on {
                Button { nav.tab = .settings } label: { Chip(text: "Alarms off · no loud backup", warn: true) }
              }
            }
            .buttonStyle(Pressable())
            .transition(.scale(scale: 0.85).combined(with: .opacity))
          }
          .animation(.snappy(duration: 0.3), value: on)
          .animation(.snappy(duration: 0.3), value: server.pairing == nil)
          .padding(.top, 4)
          .rise(3)
        }
        .padding(.horizontal, 20).padding(.top, 8)
      }
      .scrollBounceBehavior(.basedOnSize)
      .safeAreaInset(edge: .bottom) {
        VStack(spacing: 10) {
          if let error {
            Text(error).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center)
              .transition(.opacity.combined(with: .offset(y: 6)))
          }
          PrimaryButton(title: "Sleep", systemImage: "moon.fill") {
            guard !starting else { return }
            starting = true
            Task { defer { starting = false }
              do { try await engine.start(settings) } catch { withAnimation(.snappy) { self.error = error.localizedDescription } } }
          }
          Text("Then lock the phone and leave it on the charger.").font(.footnote).foregroundStyle(Theme.text2)
        }
        .padding(.horizontal, 20).padding(.top, 10).padding(.bottom, 8).background(Theme.bg)
        .rise(4)
      }
    }
    .background(Theme.bg)
    .sheet(isPresented: $picking) { WakePicker(time: Binding(get: { data.settings.wake }, set: { data.change(["wake": $0]) })).presentationDetents([.height(320)]) }
  }
}

/// A time of day ("HH:MM"), as a wheel in a short sheet.
struct TimeSheet: View {
  let title: String
  @Binding var time: String
  @Environment(\.dismiss) private var dismiss
  static let format: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm"; f.locale = Locale(identifier: "en_US_POSIX"); return f }()
  var body: some View {
    let date = Binding<Date>(get: { Self.format.date(from: time) ?? Date() }, set: { time = Self.format.string(from: $0) })
    VStack(spacing: 0) {
      HStack {
        Text(title).font(.headline)
        Spacer()
        Button("Done") { dismiss() }.font(.headline)
      }
      .padding(20)
      DatePicker(title, selection: date, displayedComponents: .hourAndMinute).datePickerStyle(.wheel).labelsHidden()
      Spacer()
    }
    .background(Theme.card)
  }
}

private func WakePicker(time: Binding<String>) -> some View { TimeSheet(title: "Wake up", time: time) }

// MARK: morning

/// Right after the night: the night at a glance, and one way on to the full report.
struct MorningView: View {
  let night: NightEngine.Finished
  let done: () -> Void
  @EnvironmentObject var server: ServerLink
  @EnvironmentObject var data: NightData
  @EnvironmentObject var nav: Navigation
  @State private var opening = false

  var body: some View {
    let m = Morning(bed: night.bed, end: night.end, heardMinutes: night.heardMinutes, early: night.early, snoozes: night.snoozes)
    ScrollView {
      VStack(alignment: .leading, spacing: 10) {
        VStack(alignment: .leading, spacing: 2) {
          Text("Good morning").font(.largeTitle.bold())
          Text(night.end, format: .dateTime.weekday(.wide).day().month(.wide)).foregroundStyle(Theme.text2)
        }
        .padding(.bottom, 12)
        .rise(0)

        Card {
          HStack {
            Eyebrow(text: "Last night")
            Spacer()
            Group {
              if let sent = server.lastUpload { Label("Sent \(InstallStatus.clock(sent, .current))", systemImage: "checkmark").foregroundStyle(Theme.good) }
              else if server.pairing == nil { Text("Not paired").foregroundStyle(Theme.warn) }
              else { Text("Sending…").foregroundStyle(Theme.text2) }
            }
            .font(.footnote).labelStyle(.titleAndIcon)
            .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .trailing)))
          }
          .animation(.snappy, value: server.lastUpload)
          Text(m.range).font(.system(size: 44, weight: .ultraLight)).monospacedDigit().kerning(-1.5).padding(.top, 6)
          Text(m.line).foregroundStyle(Theme.text2).padding(.top, 2)
        }
        .rise(1)

        HStack(spacing: 10) {
          if let a = m.alarm { FactCard(value: a.value, label: a.label) }
          if let s = m.snooze { FactCard(value: s.value, label: s.label) }
        }
        .rise(2)
      }
      .padding(.horizontal, 20).padding(.top, 8)
    }
    .safeAreaInset(edge: .bottom) {
      VStack(spacing: 10) {
        PrimaryButton(title: opening ? "Sending the night…" : "See your night and score", systemImage: opening ? "arrow.up.circle" : "chevron.right", trailing: true) {
          guard !opening else { return }
          opening = true
          // the night must be on the server before its page is opened
          Task { await server.refresh(); await data.refresh(pairing: server.pairing); opening = false; nav.openNight(night.id); done() }
        }
        Button("Done", action: done).font(.subheadline).foregroundStyle(Theme.text2).padding(.bottom, 4).buttonStyle(Pressable())
      }
      .padding(.horizontal, 20).padding(.top, 10).padding(.bottom, 8).background(Theme.bg)
      .rise(3)
    }
    .background(Theme.bg)
  }
}
