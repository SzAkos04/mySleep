import ActivityKit
import AVFoundation
import SwiftUI

/// The app's own settings: how long this install runs, the server, what iOS allows, the alarm test.
struct SettingsTab: View {
  @EnvironmentObject var engine: NightEngine
  @EnvironmentObject var alarm: AlarmController
  @EnvironmentObject var server: ServerLink
  @EnvironmentObject var data: NightData
  @State private var pickingBedtime = false
  @State private var micOn = AVAudioApplication.shared.recordPermission == .granted
  @State private var liveOn = ActivityAuthorizationInfo().areActivitiesEnabled
  @Environment(\.scenePhase) private var phase

  var body: some View {
    let install = InstallStatus(expires: server.expires, now: Date())
    NavigationStack {
      List {
        Section("This install") {
          Row(icon: "clock", tint: install.level == .fine || install.level == .unknown ? Theme.accent : Theme.warn, title: install.title,
              detail: install.detail, detailWarn: install.level != .fine && install.level != .unknown)
          if let p = server.pairing {
            Row(icon: "checkmark.icloud", tint: Theme.good, title: "Sends to \(p.server.host ?? "your server")",
                detail: server.problem ?? server.lastUpload.map { "Last sent \(InstallStatus.clock($0, .current))" } ?? "Nothing sent yet", detailWarn: server.problem != nil)
          } else {
            Row(icon: "icloud.slash", tint: Theme.warn, title: "Not paired with your server",
                detail: "Run scripts/pair.sh on the Mac, paste the link here and tap it", detailWarn: true)
          }
        }

        Section {
          Button { pickingBedtime = true } label: {
            HStack { Label("Go to bed", systemImage: "moon.fill"); Spacer(); Text(data.settings.bedtime).foregroundStyle(Theme.accent).monospacedDigit() }
          }
          Toggle(isOn: Binding(get: { data.settings.remind }, set: { v in data.change { $0.remind = v } })) {
            VStack(alignment: .leading, spacing: 1) { Text("Reminder"); Text("30 min before").font(.footnote).foregroundStyle(Theme.text2) }
          }
        } header: { Text("Bedtime") } footer: {
          if data.notify == .denied, data.settings.remind { Text("Notifications are off for mySleep: allow them in iOS Settings.").foregroundStyle(Theme.warn) }
          else if let r = Reminders.bedtime(data.settings), case .daily(let h, let m) = r.when { Text(String(format: "A reminder every evening at %02d:%02d.", h, m)) }
        }

        Section("Allowed") {
          Allowed(title: "Microphone", on: micOn)
          Allowed(title: "Alarms", detail: "Without them nothing wakes you", on: alarm.allowed == true)
          Allowed(title: "Live Activities", detail: "The card on the lock screen at night", on: liveOn)
        }

        Section {
          Button {
            engine.startAlarmTest()
          } label: {
            VStack(alignment: .leading, spacing: 1) {
              Label("Alarm test in 20 seconds", systemImage: "alarm.fill")
              Text(engine.alarmTest.text ?? "The same alarm as at night; lock the phone and listen")
                .font(.footnote).foregroundStyle(engine.alarmTest.warns ? Theme.warn : Theme.text2)
                .contentTransition(.numericText())
            }
            .animation(.snappy(duration: 0.25), value: engine.alarmTest)
          }
          .disabled(engine.night != nil || engine.alarmTest.busy)
          .sensoryFeedback(.selection, trigger: engine.alarmTest.busy)
        } header: { Text("Alarm") } footer: { Text("A soft piano rising from near silence in 25 s; it rings with the phone locked, silent or in Focus, even if iOS has closed mySleep.") }

        Section {
          HStack { Text("mySleep"); Spacer(); Text("\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") · build \(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?")").foregroundStyle(Theme.text2) }
        }
      }
      .scrollContentBackground(.hidden)
      // the last line clear of the floating tab bar's edge, also when a scroll bounces back
      .contentMargins(.bottom, 28, for: .scrollContent)
      .background(Theme.bg)
      .navigationTitle("Settings")
      .sheet(isPresented: $pickingBedtime) { TimeSheet(title: "Go to bed", time: Binding(get: { data.settings.bedtime }, set: { v in data.change { $0.bedtime = v } })).presentationDetents([.height(320)]) }
    }
    .onChange(of: phase) { _, p in
      if p == .active { micOn = AVAudioApplication.shared.recordPermission == .granted; liveOn = ActivityAuthorizationInfo().areActivitiesEnabled }
    }
  }
}

private struct Row: View {
  let icon: String, tint: Color, title: String, detail: String
  var detailWarn = false
  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: icon).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.bg)
        .frame(width: 30, height: 30).background(tint, in: RoundedRectangle(cornerRadius: 8))
      VStack(alignment: .leading, spacing: 1) {
        Text(title)
        Text(detail).font(.footnote).foregroundStyle(detailWarn ? Theme.warn : Theme.text2)
      }
    }
  }
}

/// A permission: On, or a button to the app's page in Settings.
private struct Allowed: View {
  let title: String
  var detail: String? = nil
  let on: Bool
  var body: some View {
    HStack {
      VStack(alignment: .leading, spacing: 1) {
        Text(title)
        if let detail { Text(detail).font(.footnote).foregroundStyle(Theme.text2) }
      }
      Spacer()
      // back from iOS Settings with it allowed: "Turn on" gives way to "On"
      Group {
        if on { HStack(spacing: 4) { Image(systemName: "checkmark").font(.footnote.weight(.bold)); Text("On") }.foregroundStyle(Theme.good) }
        else {
          Button("Turn on") { UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!) }
            .foregroundStyle(Theme.warn)
        }
      }
      .transition(.opacity.combined(with: .scale(scale: 0.85, anchor: .trailing)))
    }
    .animation(.snappy(duration: 0.3), value: on)
  }
}
