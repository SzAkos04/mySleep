import ActivityKit
import AVFoundation
import SwiftUI

/// The app's own settings: how long this install runs, the server, what iOS allows, the alarm sound.
struct SettingsTab: View {
  @EnvironmentObject var engine: NightEngine
  @EnvironmentObject var alarm: AlarmController
  @EnvironmentObject var server: ServerLink
  @EnvironmentObject var data: NightData
  @State private var pickingBedtime = false
  @StateObject private var volume = VolumeWatcher()
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
          Toggle(isOn: Binding(get: { data.settings.remind }, set: { data.change(["remind": $0]) })) {
            VStack(alignment: .leading, spacing: 1) { Text("Reminder"); Text("30 min before").font(.footnote).foregroundStyle(Theme.text2) }
          }
        } header: { Text("Bedtime") } footer: {
          if data.notify == .denied, data.settings.remind { Text("Notifications are off for mySleep Night: allow them in iOS Settings.").foregroundStyle(Theme.warn) }
          else if let r = Reminders.bedtime(data.settings), case .daily(let h, let m) = r.when { Text(String(format: "A reminder every evening at %02d:%02d.", h, m)) }
        }

        Section("Allowed") {
          Allowed(title: "Microphone", on: micOn)
          Allowed(title: "Alarms", detail: "The loud backup, 2 min behind the gentle one", on: alarm.allowed == true)
          Allowed(title: "Live Activities", detail: "The card on the lock screen at night", on: liveOn)
        }

        Section {
          Button {
            engine.testing ? engine.stopTestSound() : engine.playTestSound()
          } label: {
            HStack {
              Label {
                Text(engine.testing ? "Stop" : "Play it for 10 seconds").contentTransition(.opacity)
              } icon: {
                Image(systemName: engine.testing ? "stop.fill" : "play.fill").contentTransition(.symbolEffect(.replace))
              }
              Spacer()
              if engine.testing {
                Image(systemName: "speaker.wave.3.fill").foregroundStyle(Theme.accent)
                  .symbolEffect(.variableColor.iterative, options: .repeating)
                  .transition(.opacity.combined(with: .scale(scale: 0.6)))
              }
            }
            .animation(.snappy(duration: 0.3), value: engine.testing)
          }
          .disabled(engine.night != nil)
          .sensoryFeedback(.selection, trigger: engine.testing)
          let advice = VolumeAdvice(volume: volume.level)
          HStack {
            VStack(alignment: .leading, spacing: 1) {
              Text("Media volume")
              Text("The alarm rings at this volume").font(.footnote).foregroundStyle(Theme.text2)
            }
            Spacer()
            Text(advice.text).foregroundStyle(advice.low ? Theme.warn : Theme.good)
              .contentTransition(.numericText()).animation(.snappy(duration: 0.25), value: advice.text)
          }
        } header: { Text("Alarm sound") } footer: { Text("A soft piano that rises from near silence; set the volume with the side buttons.") }

        Section {
          HStack { Text("mySleep Night"); Spacer(); Text("\(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") · build \(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?")").foregroundStyle(Theme.text2) }
        }
      }
      .scrollContentBackground(.hidden)
      // the last line clear of the floating tab bar's edge, also when a scroll bounces back
      .contentMargins(.bottom, 28, for: .scrollContent)
      .background(Theme.bg)
      .navigationTitle("Settings")
      .sheet(isPresented: $pickingBedtime) { TimeSheet(title: "Go to bed", time: Binding(get: { data.settings.bedtime }, set: { data.change(["bedtime": $0]) })).presentationDetents([.height(320)]) }
    }
    .onAppear { volume.start() }
    .onChange(of: phase) { _, p in
      if p == .active { micOn = AVAudioApplication.shared.recordPermission == .granted; liveOn = ActivityAuthorizationInfo().areActivitiesEnabled; volume.start() }
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

/// The phone's media volume, followed as the side buttons change it (the alarm plays at it).
@MainActor final class VolumeWatcher: ObservableObject {
  @Published var level: Float = AVAudioSession.sharedInstance().outputVolume
  private var watch: NSKeyValueObservation?
  func start() {
    let s = AVAudioSession.sharedInstance()
    // outputVolume follows the buttons only while a session is active; ambient leaves other audio alone
    if s.category != .playAndRecord { try? s.setCategory(.ambient, options: .mixWithOthers); try? s.setActive(true) }
    level = s.outputVolume
    watch = s.observe(\.outputVolume) { [weak self] s, _ in
      let v = s.outputVolume
      Task { @MainActor in self?.level = v }
    }
  }
}
