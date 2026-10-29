import SwiftUI

// mySleep Night: the night only (record with the phone locked, ring the alarm); the web app shows
// the nights. The night's log is saved in the app's Documents, for scripts/ios-fetch-night.sh.
@main struct MySleepNightApp: App {
  @StateObject private var engine = NightEngine()
  var body: some Scene {
    WindowGroup { RootView().environmentObject(engine).environmentObject(engine.alarm).preferredColorScheme(.dark).tint(Theme.accent) }
  }
}

// The web app's colours (frontend/src/index.css)
enum Theme {
  static let bg = Color(red: 0x0b / 255, green: 0x0a / 255, blue: 0x09 / 255)
  static let card = Color.white.opacity(0.06)
  static let accent = Color(red: 0x8b / 255, green: 0x8c / 255, blue: 0xf8 / 255)
  static let good = Color(red: 0.36, green: 0.82, blue: 0.5)
  static let warn = Color.orange
}

struct RootView: View {
  @EnvironmentObject var engine: NightEngine
  @EnvironmentObject var alarm: AlarmController
  var body: some View {
    Group {
      if alarm.phase == .ringing || engine.selfRinging { RingingView() }
      else if engine.night != nil { NightScreen() }
      else { EveningView() }
    }
    .animation(.easeInOut(duration: 0.3), value: engine.night == nil)
    .animation(.easeInOut(duration: 0.3), value: alarm.phase)
  }
}

// MARK: before bed

struct EveningView: View {
  @EnvironmentObject var engine: NightEngine
  @EnvironmentObject var alarm: AlarmController
  @AppStorage("alarmOn") private var on = true
  @AppStorage("smart") private var smart = true
  @AppStorage("wakeHour") private var hour = 6
  @AppStorage("wakeMinute") private var minute = 45
  @State private var error: String?
  @State private var starting = false

  private var settings: AlarmSettings { AlarmSettings(on: on, smart: smart, hour: hour, minute: minute) }
  private var wake: Binding<Date> {
    Binding(get: { Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: Date()) ?? Date() },
            set: { let c = Calendar.current.dateComponents([.hour, .minute], from: $0); hour = c.hour ?? 6; minute = c.minute ?? 45 })
  }

  var body: some View {
    TimelineView(.everyMinute) { ctx in
      let plan = AlarmPlan.make(settings, from: ctx.date)
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          VStack(alignment: .leading, spacing: 4) {
            Text("Tonight").font(.largeTitle.bold())
            Text(ctx.date, format: .dateTime.weekday(.wide).day().month(.wide)).foregroundStyle(.secondary)
          }
          .padding(.top, 24)

          VStack(spacing: 0) {
            Row(icon: "alarm.fill", tint: Theme.warn, title: "Alarm") { Toggle("", isOn: $on).labelsHidden() }
            if on {
              Divider().padding(.leading, 52)
              Row(icon: "sun.max.fill", tint: Theme.warn, title: "Wake up") {
                DatePicker("", selection: wake, displayedComponents: .hourAndMinute).labelsHidden()
              }
              Divider().padding(.leading, 52)
              Row(icon: "sparkles", tint: Theme.accent, title: "Smart alarm", sub: "Up to 30 min earlier, when you stir") { Toggle("", isOn: $smart).labelsHidden() }
            }
          }
          .background(Theme.card, in: RoundedRectangle(cornerRadius: 16))

          if let plan {
            let left = plan.at.timeIntervalSince(ctx.date) / 60
            HStack(spacing: 10) {
              Fact(value: plan.label(), label: smart ? "alarm window" : "alarm")
              Fact(value: duration(left), label: "if you sleep now")
            }
          }
          if alarm.allowed == false && on {
            // AlarmKit's own question may not come (iOS 27 Simulator never shows it): one tap to the switch
            Button { UIApplication.shared.open(URL(string: UIApplication.openSettingsURLString)!) } label: {
              Note(text: "Alarms are off for mySleep Night: it can only ring while it runs, and not on the lock screen. Tap to turn on Alarms in its Settings.", color: Theme.warn)
            }
            .buttonStyle(.plain)
          }
          if let lastNight = engine.lastNight {
            HStack {
              VStack(alignment: .leading, spacing: 2) {
                Text("Last night saved").font(.subheadline.weight(.semibold))
                Text("\(duration(Double(lastNight.minutes))) recorded · heard \(duration(Double(lastNight.heard)))").font(.footnote).foregroundStyle(lastNight.heard < lastNight.minutes / 2 ? Theme.warn : .secondary)
              }
              Spacer()
              ShareLink(item: lastNight.file) { Image(systemName: "square.and.arrow.up") }
            }
            .padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 16))
          }
        }
        .padding(.horizontal, 20)
      }
      .safeAreaInset(edge: .bottom) {
        VStack(spacing: 10) {
          if let error { Text(error).font(.footnote).foregroundStyle(.red).multilineTextAlignment(.center) }
          Button {
            starting = true
            Task { defer { starting = false }
              do { try await engine.start(settings) } catch { self.error = error.localizedDescription } }
          } label: {
            Label("Sleep", systemImage: "moon.fill").font(.title3.weight(.semibold)).frame(maxWidth: .infinity).frame(height: 58)
          }
          .buttonStyle(.borderedProminent).buttonBorderShape(.capsule).disabled(starting)
          Text("Then lock the phone and leave it on the charger.").font(.footnote).foregroundStyle(.secondary)
        }
        .padding(.horizontal, 20).padding(.bottom, 8).background(Theme.bg)
      }
    }
    .background(Theme.bg)
  }
}

private struct Row<Trailing: View>: View {
  let icon: String, tint: Color, title: String
  var sub: String? = nil
  @ViewBuilder let trailing: Trailing
  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: icon).font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
        .frame(width: 30, height: 30).background(tint, in: RoundedRectangle(cornerRadius: 8))
      VStack(alignment: .leading, spacing: 1) {
        Text(title)
        if let sub { Text(sub).font(.footnote).foregroundStyle(.secondary) }
      }
      Spacer()
      trailing
    }
    .padding(.horizontal, 12).padding(.vertical, 10)
  }
}

private struct Fact: View {
  let value: String, label: String
  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(value).font(.title3.weight(.semibold)).monospacedDigit()
      Text(label).font(.footnote).foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading).padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 16))
  }
}

private struct Note: View {
  let text: String, color: Color
  var body: some View { Text(text).font(.footnote).foregroundStyle(color).padding(14).frame(maxWidth: .infinity, alignment: .leading).background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 16)) }
}

func duration(_ minutes: Double) -> String {
  let m = Int(minutes.rounded())
  return m < 60 ? "\(m) min" : "\(m / 60)h \(String(format: "%02d", m % 60))m"
}

// MARK: the night

/// Black, as the web app's night screen: on the OLED panel black pixels are off. Lit for 30 s after
/// a tap, then only a dim clock. Ending the night needs a held press, so a sleepy hand cannot.
struct NightScreen: View {
  @EnvironmentObject var engine: NightEngine
  @EnvironmentObject var alarm: AlarmController
  @State private var lit = true
  @State private var dimTask: Task<Void, Never>?

  var body: some View {
    TimelineView(.periodic(from: .now, by: 1)) { ctx in
      ZStack {
        Color.black.ignoresSafeArea()
        VStack(spacing: 22) {
          if lit, let n = engine.night {
            Status(hearing: engine.level != nil, minutes: Int((NightEngine.nowMs - n.start) / 60000))
          }
          Spacer()
          Text(ctx.date, format: .dateTime.hour(.twoDigits(amPM: .omitted)).minute())
            .font(.system(size: 96, weight: .thin)).monospacedDigit()
            .foregroundStyle(.white.opacity(lit ? 0.92 : 0.22))
          if let plan = engine.plan, alarm.phase == .none {
            // no system alarm: the app rings by itself, but only while it runs; say so
            Text("Alarm \(plan.label())").foregroundStyle(.white.opacity(lit ? 0.7 : 0.18))
            if lit { Text("Alarms are off for mySleep Night: it rings by itself while it runs, so leave it running. For a sure wake-up, also set one in Clock.").font(.footnote).foregroundStyle(Theme.warn).multilineTextAlignment(.center).padding(.horizontal, 40) }
          } else if let plan = engine.plan {
            Text("Alarm \(plan.label())").foregroundStyle(.white.opacity(lit ? 0.7 : 0.18))
            if lit { Text("Up to \(duration(plan.at.timeIntervalSince(ctx.date) / 60)) of sleep").font(.subheadline).foregroundStyle(.secondary) }
          } else if lit {
            Text("No alarm").foregroundStyle(.secondary)
          }
          if lit { Meter(db: engine.level).padding(.top, 6) }
          Spacer()
          if lit {
            HoldButton(label: "Hold to wake up", systemImage: "sun.max") { engine.stop() }
            Text("Lock the phone: it keeps listening.").font(.footnote).foregroundStyle(.secondary)
          }
        }
        .padding(.vertical, 24)
      }
      .contentShape(Rectangle())
      .onTapGesture { light() }
      .onAppear { light() }
    }
  }

  private func light() {
    lit = true
    dimTask?.cancel()
    dimTask = Task { try? await Task.sleep(for: .seconds(30)); if !Task.isCancelled { lit = false } }
  }
}

private struct Status: View {
  let hearing: Bool, minutes: Int
  var body: some View {
    HStack(spacing: 8) {
      Circle().fill(hearing ? Theme.good : Theme.warn).frame(width: 8, height: 8)
      Text(hearing ? "Listening · \(minutes < 1 ? "just started" : duration(Double(minutes)))" : "Not hearing anything")
    }
    .font(.subheadline).foregroundStyle(hearing ? .white.opacity(0.85) : Theme.warn)
    .padding(.horizontal, 14).padding(.vertical, 8).background(.white.opacity(0.07), in: Capsule())
  }
}

/// What the microphone hears: 20–90 on the tracker's dB scale, like the web app's meter.
struct Meter: View {
  let db: Double?
  var body: some View {
    let fill = db.map { max(0, min(1, ($0 - 20) / 70)) } ?? 0
    Capsule().fill(.white.opacity(0.08)).frame(width: 140, height: 4)
      .overlay(alignment: .leading) { Capsule().fill(Theme.good.opacity(0.8)).frame(width: 140 * fill, height: 4).animation(.easeOut(duration: 0.25), value: fill) }
      .accessibilityElement().accessibilityLabel("Sound level").accessibilityValue("\(Int(fill * 100)) percent")
  }
}

/// Ends something only after a press held for 1.5 s; letting go early does nothing.
struct HoldButton: View {
  let label: String, systemImage: String
  var light = false
  let action: () -> Void
  @State private var holding = false
  var body: some View {
    VStack(spacing: 12) {
      ZStack {
        Circle().fill(light ? .white.opacity(0.92) : .white.opacity(0.06)).frame(width: 92, height: 92)
        Circle().trim(from: 0, to: holding ? 1 : 0).stroke(light ? Theme.accent : .white.opacity(0.85), style: StrokeStyle(lineWidth: 3, lineCap: .round))
          .rotationEffect(.degrees(-90)).frame(width: 88, height: 88)
          .animation(holding ? .linear(duration: 1.5) : .easeOut(duration: 0.2), value: holding)
        Image(systemName: systemImage).font(.system(size: 28, weight: .medium)).foregroundStyle(light ? .black : .white)
      }
      .onLongPressGesture(minimumDuration: 1.5, perform: action, onPressingChanged: { holding = $0 })
      .accessibilityLabel(label).accessibilityAddTraits(.isButton)
      Text(holding ? "Keep holding" : label).font(.subheadline).foregroundStyle(.white.opacity(0.75))
    }
  }
}

// MARK: the alarm, when the app is open as it rings (locked, the system shows its own screen)

struct RingingView: View {
  @EnvironmentObject var engine: NightEngine
  var body: some View {
    TimelineView(.everyMinute) { ctx in
      ZStack {
        LinearGradient(colors: [.black, Color(red: 0.25, green: 0.13, blue: 0.1), Color(red: 0.8, green: 0.45, blue: 0.2)], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
        VStack(spacing: 18) {
          Spacer()
          Text(ctx.date, format: .dateTime.hour(.twoDigits(amPM: .omitted)).minute()).font(.system(size: 96, weight: .thin)).monospacedDigit()
          Text("Good morning").font(.title.weight(.semibold))
          Spacer()
          HoldButton(label: "Hold to stop", systemImage: "sun.max.fill", light: true) { engine.stopAlarm() }
          Button("Snooze \(AlarmPlan.snoozeMinutes) min") { engine.snoozeAlarm() }.font(.title3).foregroundStyle(.white.opacity(0.85)).padding(.top, 6)
        }
        .padding(.vertical, 32)
      }
    }
  }
}
