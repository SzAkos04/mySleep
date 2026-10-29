import SwiftUI

// The spike: one night recorded with the phone locked, to see whether a native app hears all night
// where the web app heard nothing (29 October). No alarm yet, no server: the night's log is saved
// in the app's Documents, for the Files app or scripts/ios-fetch-night.sh.
@main struct MySleepNightApp: App {
  @StateObject private var engine = NightEngine()
  var body: some Scene { WindowGroup { NightView().environmentObject(engine).preferredColorScheme(.dark) } }
}

struct NightView: View {
  @EnvironmentObject var engine: NightEngine
  @State private var error: String?
  @State private var now = Date()
  private let clock = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

  var body: some View {
    VStack(spacing: 28) {
      Spacer()
      Text(now, format: .dateTime.hour().minute()).font(.system(size: 88, weight: .thin)).monospacedDigit()
      if let n = engine.night {
        Text(engine.level == nil ? "Not hearing anything" : "Listening · \(minutes(n)) min")
          .foregroundStyle(engine.level == nil ? .orange : .green)
        // what the microphone hears, 20–90 on the tracker's scale, like the web app's meter
        Capsule().fill(.white.opacity(0.1)).frame(width: 160, height: 5)
          .overlay(alignment: .leading) { Capsule().fill(.green.opacity(0.8)).frame(width: 160 * fill, height: 5) }
          .accessibilityLabel("Sound level")
        if let s = engine.saved { Text("Saved \(s, format: .dateTime.hour().minute().second())").font(.footnote).foregroundStyle(.secondary) }
        Text("Lock the phone and leave it on the charger.").font(.footnote).foregroundStyle(.secondary)
      }
      Spacer()
      Button(engine.night == nil ? "Start the night" : "Stop") {
        if engine.night == nil { Task { do { try await engine.start() } catch { self.error = error.localizedDescription } } }
        else { engine.stop() }
      }
      .buttonStyle(.borderedProminent).controlSize(.large).tint(engine.night == nil ? .indigo : .gray)
      if let error { Text(error).foregroundStyle(.red).font(.footnote) }
    }
    .padding(32)
    .onReceive(clock) { now = $0 }
  }

  private var fill: Double { engine.level.map { max(0, min(1, ($0 - 20) / 70)) } ?? 0 }
  private func minutes(_ n: Night) -> Int { Int((NightEngine.nowMs - n.start) / 60000) }
}
