import SwiftUI

// mySleep Night: the one app on the iPhone. Tonight and Settings are its own; Journal and Trends
// are the server's web app, shown inside it and signed in (WebTab). The night itself (NightViews)
// covers everything while it runs; the alarm covers the night.
@main struct MySleepNightApp: App {
  @StateObject private var engine = NightEngine()
  @StateObject private var server = ServerLink()
  @Environment(\.scenePhase) private var phase
  var body: some Scene {
    WindowGroup {
      RootView().environmentObject(engine).environmentObject(engine.alarm).environmentObject(server)
        .preferredColorScheme(.dark).tint(Theme.accent)
        // the web app opens this app: to pair it, and from its Sleep button
        .onOpenURL { url in
          switch AppLink.parse(url) {
          case .pair(let p)?: server.pair(p)
          case .sleep(let s)?:
            if let s { Self.remember(s) }
            if engine.night == nil { Task { try? await engine.start(Self.stored) } }
          case nil: break
          }
        }
        .onAppear { engine.onFinished = { Task { await server.refresh() } } }
    }
    .onChange(of: phase) { _, p in if p == .active { Task { await server.refresh() } } }
  }

  // the alarm as the Tonight tab keeps it (@AppStorage), so a Sleep link sets it there too
  static func remember(_ s: AlarmSettings) {
    let d = UserDefaults.standard
    d.set(s.on, forKey: "alarmOn"); d.set(s.smart, forKey: "smart"); d.set(s.hour, forKey: "wakeHour"); d.set(s.minute, forKey: "wakeMinute")
  }
  static var stored: AlarmSettings {
    let d = UserDefaults.standard
    return AlarmSettings(on: d.object(forKey: "alarmOn") as? Bool ?? true, smart: d.object(forKey: "smart") as? Bool ?? true,
                         hour: d.object(forKey: "wakeHour") as? Int ?? 6, minute: d.object(forKey: "wakeMinute") as? Int ?? 45)
  }
}

// The web app's colours (frontend/src/index.css)
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

/// Which tab is showing, and which night the Journal should open (the morning's button).
@MainActor final class Navigation: ObservableObject {
  @Published var tab: Tab = .tonight
  @Published var journalPage: WebPage = .journal
  func openNight(_ id: String) { journalPage = .night(id); tab = .journal }
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
        WebTab(page: nav.journalPage).tag(Tab.journal)
          .tabItem { Label("Journal", systemImage: "calendar") }
        WebTab(page: .trends).tag(Tab.trends)
          .tabItem { Label("Trends", systemImage: "chart.bar") }
        SettingsTab().tag(Tab.settings)
          .tabItem { Label("Settings", systemImage: "gearshape") }
      }
      if engine.night != nil { NightScreen().transition(.opacity) }
      if alarm.phase == .ringing || engine.selfRinging { RingingView().transition(.opacity) }
    }
    .environmentObject(nav)
    // a night ends on Tonight, where its morning summary is
    .onChange(of: engine.night == nil) { _, ended in if ended { nav.tab = .tonight } }
    .animation(.easeInOut(duration: 0.35), value: engine.night == nil)
    .animation(.easeInOut(duration: 0.35), value: alarm.phase == .ringing || engine.selfRinging)
  }
}

// MARK: shared pieces

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
  var body: some View {
    Button(action: action) {
      HStack(spacing: 10) {
        if !trailing { Image(systemName: systemImage) }
        Text(title)
        if trailing { Image(systemName: systemImage).font(.body.weight(.bold)) }
      }
      .font(.title3.weight(.semibold)).frame(maxWidth: .infinity).frame(height: 58)
      .foregroundStyle(Theme.bg).background(Theme.accent, in: Capsule())
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
  }
}

func duration(_ minutes: Double) -> String { Morning.duration(Int(minutes.rounded())) }
