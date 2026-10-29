import ActivityKit
import AVFoundation
import SwiftUI

/// The app's own settings: how long this install runs, the server, what iOS allows, the alarm sound.
struct SettingsTab: View {
  @EnvironmentObject var engine: NightEngine
  @EnvironmentObject var alarm: AlarmController
  @EnvironmentObject var server: ServerLink
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
                detail: "In mySleep on the web: Settings › Pair mySleep Night", detailWarn: true)
          }
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
            Label(engine.testing ? "Stop" : "Play it for 10 seconds", systemImage: engine.testing ? "stop.fill" : "play.fill")
          }
          .disabled(engine.night != nil)
          let advice = VolumeAdvice(volume: volume.level)
          HStack {
            VStack(alignment: .leading, spacing: 1) {
              Text("Media volume")
              Text("The alarm rings at this volume").font(.footnote).foregroundStyle(Theme.text2)
            }
            Spacer()
            Text(advice.text).foregroundStyle(advice.low ? Theme.warn : Theme.good)
          }
        } header: { Text("Alarm sound") } footer: { Text("A soft piano that rises from near silence; set the volume with the side buttons.") }

        if let p = server.pairing {
          Section {
            Link(destination: p.server) { Label("Open mySleep in Safari", systemImage: "safari") }
          } footer: {
            Text("mySleep Night \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "") · build \(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?")")
          }
        }
      }
      .scrollContentBackground(.hidden)
      .background(Theme.bg)
      .navigationTitle("Settings")
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
      if on { Text("On").foregroundStyle(Theme.good) }
      else {
        Button("Turn on") { UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!) }
          .foregroundStyle(Theme.warn)
      }
    }
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
