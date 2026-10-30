import SwiftUI

// mySleep Night: the one app on the iPhone: Tonight, the Journal, Trends and Settings. The night
// itself (NightViews) covers everything while it runs; the alarm covers the night.
@main struct MySleepNightApp: App {
  @StateObject private var engine = NightEngine()
  @StateObject private var server = ServerLink()
  @StateObject private var data = NightData()
  @Environment(\.scenePhase) private var phase
  var body: some Scene {
    WindowGroup {
      RootView().environmentObject(engine).environmentObject(engine.alarm).environmentObject(server).environmentObject(data)
        .preferredColorScheme(.dark).tint(Theme.accent)
        // the web app opens this app: to pair it, and from its Sleep button
        .onOpenURL { url in
          switch AppLink.parse(url) {
          case .pair(let p)?: server.pair(p); Task { await data.refresh(pairing: p) }
          case .sleep(let s)?:
            if let s { data.saveAlarm(s) }
            if engine.night == nil { Task { try? await engine.start(data.settings.alarmSettings) } }
          case nil: break
          }
        }
        .onAppear { engine.onFinished = { Task { await sync() } }; data.pairing = { server.pairing } }
        // at launch: a night iOS cut short is finished first, then everything goes up
        .task { await NightEngine.finishCutShort(); await sync() }
        // while open: again a minute after a sync, half a minute after a miss, not after a refusal
        .task(id: "\(phase)-\(server.pairing?.token ?? "")") {
          guard phase == .active else { return }
          while !Task.isCancelled, let wait = SyncSchedule.next(after: data.syncResult ?? .synced) {
            try? await Task.sleep(for: .seconds(wait))
            if !Task.isCancelled { await sync() }
          }
        }
        // a changed bedtime or reminder switch: scheduled again
        .onChange(of: data.settings) { _, s in Task { data.notify = await Notifier.apply(s, expires: server.expires) } }
    }
    .onChange(of: phase) { _, p in if p == .active { Task { await sync() } } }
  }

  /// The night into the nights here, then everything to and from the server.
  private func sync() async {
    await server.refresh()
    await data.refresh(pairing: server.pairing)
    data.notify = await Notifier.apply(data.settings, expires: server.expires)
  }
}

// The app's colours
enum Theme {
  static let bg = Color(red: 0x0b / 255, green: 0x0a / 255, blue: 0x09 / 255)
  static let card = Color(red: 0x1a / 255, green: 0x19 / 255, blue: 0x18 / 255)
  static let line = Color(red: 0x2a / 255, green: 0x29 / 255, blue: 0x28 / 255)
  static let accent = Color(red: 0x8b / 255, green: 0x8c / 255, blue: 0xf8 / 255)
  static let good = Color(red: 0x4c / 255, green: 0xd1 / 255, blue: 0x7f / 255)
  static let warn = Color(red: 1, green: 0x9f / 255, blue: 0x0a / 255)
  static let text2 = Color(red: 0xa3 / 255, green: 0xa1 / 255, blue: 0x9d / 255)
}

enum Tab: Hashable { case tonight, journal, trends, settings }

/// Which tab is showing, and the Journal's stack (a night's report on top of it, from the morning's button).
@MainActor final class Navigation: ObservableObject {
  @Published var tab: Tab = .tonight
  @Published var journalPath: [String] = []
  func openNight(_ id: String) { journalPath = [id]; tab = .journal }
}

struct RootView: View {
  @EnvironmentObject var engine: NightEngine
  @EnvironmentObject var alarm: AlarmController
  @StateObject private var nav = Navigation()

  var body: some View {
    ZStack {
      TabView(selection: $nav.tab) {
        TonightTab().tag(Tab.tonight)
          .tabItem { Label("Tonight", systemImage: "moon.fill") }
        JournalScreen().tag(Tab.journal)
          .tabItem { Label("Journal", systemImage: "calendar") }
        TrendsScreen().tag(Tab.trends)
          .tabItem { Label("Trends", systemImage: "chart.bar") }
        SettingsTab().tag(Tab.settings)
          .tabItem { Label("Settings", systemImage: "gearshape") }
      }
      // the night fades in slowly, as lights going out; the alarm comes up from a little larger
      if engine.night != nil { NightScreen().transition(.opacity) }
      if alarm.phase == .ringing || engine.selfRinging { RingingView().transition(.opacity.combined(with: .scale(scale: 1.06))) }
    }
    .environmentObject(nav)
    // a night ends on Tonight, where its morning summary is
    .onChange(of: engine.night == nil) { _, ended in if ended { nav.tab = .tonight } }
    .animation(.easeInOut(duration: 0.6), value: engine.night == nil)
    .animation(.spring(duration: 0.6, bounce: 0.1), value: alarm.phase == .ringing || engine.selfRinging)
  }
}

// MARK: shared pieces

// Motion: opacity, offset, scale, numbers rolling and symbol effects only; these the A13 draws at
// 60 fps without effort. No animated blur, nothing running for good; none of it with Reduce Motion.

/// Buttons sink a little under the finger.
struct Pressable: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.96 : 1)
      .opacity(configuration.isPressed ? 0.88 : 1)
      .animation(.spring(duration: 0.25, bounce: 0.35), value: configuration.isPressed)
  }
}

/// Rises into place the first time it shows (the tabs keep their state, so once); `order`
/// staggers a screen's parts.
struct Rise: ViewModifier {
  let order: Int
  @State private var shown = false
  @Environment(\.accessibilityReduceMotion) private var still
  func body(content: Content) -> some View {
    content.opacity(shown || still ? 1 : 0).offset(y: shown || still ? 0 : 16)
      .onAppear {
        guard !shown else { return }
        withAnimation(.spring(duration: 0.55, bounce: 0.2).delay(Double(order) * 0.07)) { shown = true }
      }
  }
}
extension View { func rise(_ order: Int = 0) -> some View { modifier(Rise(order: order)) } }

/// A card: the app's one surface, rounded like the web app's.
struct Card<Content: View>: View {
  var padding: CGFloat = 18
  @ViewBuilder let content: Content
  var body: some View {
    VStack(alignment: .leading, spacing: 0) { content }
      .frame(maxWidth: .infinity, alignment: .leading).padding(padding)
      .background(Theme.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
  }
}

struct Eyebrow: View {
  let text: String
  var body: some View { Text(text.uppercased()).font(.footnote.weight(.semibold)).kerning(0.6).foregroundStyle(Theme.text2) }
}

/// A figure and what it means, two to a row.
struct FactCard: View {
  let value: String, label: String
  var warn = false
  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(value).font(.title3.weight(.semibold)).monospacedDigit().lineLimit(1).minimumScaleFactor(0.7)
        .foregroundStyle(warn ? Theme.warn : .primary)
        .contentTransition(.numericText()).animation(.smooth, value: value)
      Text(label).font(.footnote).foregroundStyle(Theme.text2).lineLimit(2, reservesSpace: true)
    }
    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 16).padding(.vertical, 14)
    .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
  }
}

/// A small status chip: green when fine, orange when it needs you.
struct Chip: View {
  let text: String
  var warn = false
  var body: some View {
    Text(text).font(.footnote.weight(.medium)).padding(.horizontal, 11).padding(.vertical, 6)
      .foregroundStyle(warn ? Theme.warn : Theme.good)
      .background((warn ? Theme.warn : Theme.good).opacity(0.14), in: Capsule())
  }
}

/// The big button at the bottom of a screen.
struct PrimaryButton: View {
  let title: String, systemImage: String
  var trailing = false
  let action: () -> Void
  @State private var taps = 0
  var body: some View {
    Button { taps += 1; action() } label: {
      HStack(spacing: 10) {
        if !trailing { Image(systemName: systemImage).contentTransition(.symbolEffect(.replace)) }
        Text(title).contentTransition(.opacity)
        if trailing { Image(systemName: systemImage).font(.body.weight(.bold)).contentTransition(.symbolEffect(.replace)) }
      }
      .animation(.smooth(duration: 0.3), value: title)
      .font(.title3.weight(.semibold)).frame(maxWidth: .infinity).frame(height: 58)
      .foregroundStyle(Theme.bg).background(Theme.accent, in: Capsule())
      .contentShape(Capsule())
    }
    .buttonStyle(Pressable())
    .sensoryFeedback(.impact(weight: .medium), trigger: taps)
  }
}

func duration(_ minutes: Double) -> String { Morning.duration(Int(minutes.rounded())) }
