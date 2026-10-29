import Foundation

/// What the native app's screens say, decided here so it is tested on the Mac.

/// How long this install runs: a free Apple ID signs the app for 7 days (embedded.mobileprovision).
public struct InstallStatus: Equatable, Sendable {
  public enum Level: Sendable { case fine, soon, today, expired, unknown }
  public let level: Level, title: String, detail: String

  public init(expires: Date?, now: Date, calendar: Calendar = .current) {
    guard let expires else { level = .unknown; title = "Installed from Xcode"; detail = "No end date"; return }
    let f = DateFormatter(); f.calendar = calendar; f.timeZone = calendar.timeZone; f.locale = Locale(identifier: "en_GB")
    f.dateFormat = "EEE d MMM"; let day = f.string(from: expires)
    f.dateFormat = "EEEE"; let before = f.string(from: expires.addingTimeInterval(-86400))
    let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: expires)).day ?? 0
    if now >= expires { level = .expired; title = "Stopped on \(day)"; detail = "Reinstall it from the Mac to record again" }
    else if days == 0 { level = .today; title = "Runs until today \(Self.clock(expires, calendar))"; detail = "Reinstall it from the Mac today" }
    else if days <= 2 { level = .soon; title = "Runs until \(day)"; detail = "Reinstall from the Mac by \(before)" }
    else { level = .fine; title = "Runs until \(day)"; detail = "Reinstall it from the Mac before then" }
  }

  static func clock(_ d: Date, _ c: Calendar) -> String {
    let f = DateFormatter(); f.calendar = c; f.timeZone = c.timeZone; f.dateFormat = "HH:mm"; return f.string(from: d)
  }
}

/// The morning, right after the night ends: the night at a glance, before the full report.
public struct Morning: Sendable {
  public let range: String, line: String
  public struct Fact: Equatable, Sendable {
    public let value: String, label: String
    public init(_ value: String, _ label: String) { self.value = value; self.label = label }
  }
  public let alarm: Fact?
  public let snooze: Fact?

  /// `early`: minutes the smart alarm rang before the wake time (nil: no alarm rang).
  public init(bed: Date, end: Date, heardMinutes: Int, early: Int?, snoozes: Int, calendar: Calendar = .current) {
    range = "\(InstallStatus.clock(bed, calendar)) – \(InstallStatus.clock(end, calendar))"
    let inBed = Int((end.timeIntervalSince(bed) / 60).rounded())
    line = "\(Self.duration(inBed)) in bed · " + (heardMinutes >= inBed * 95 / 100 ? "heard all of it" : "heard \(Self.duration(heardMinutes)) of it")
    alarm = early.map { $0 > 0 ? Fact("\($0) min early", "smart alarm, you stirred") : Fact("On time", "at your wake-up") }
    snooze = early == nil ? nil : Fact(snoozes == 0 ? "No snooze" : snoozes == 1 ? "Snoozed once" : "Snoozed \(snoozes) times", snoozes == 0 ? "up with the alarm" : "9 minutes each")
  }

  public static func duration(_ m: Int) -> String { m < 60 ? "\(m) min" : "\(m / 60)h \(String(format: "%02d", m % 60))m" }
}

/// The alarm plays at the phone's media volume: say so when it is low.
public struct VolumeAdvice: Sendable {
  public let low: Bool, text: String
  public init(volume: Float) {
    let pct = Int((volume * 100).rounded())
    low = volume < 0.5
    text = low ? "\(pct)% · turn it up" : "\(pct)%"
  }
}

/// The server's pages the app shows in its Journal and Trends tabs (the web app, embedded).
public enum WebPage: Equatable, Sendable {
  case journal, trends, night(String)
  public var path: String {
    switch self {
    case .journal: "/?embed=1#/journal"
    case .trends: "/?embed=1#/trends"
    case .night(let id): "/?embed=1#/night/\(id)"
    }
  }
  /// Whether a tab asks for a new sign-in code (which loads the page again): not to show what it shows.
  public func needsSignIn(showing: WebPage?, failed: Bool) -> Bool { failed || showing != self }
  /// Opened through a one-time code (api/server.js GET /api/session/code): signed in, no passkey.
  public func signIn(server: URL, code: String) -> URL {
    var c = URLComponents(url: server.appendingPathComponent("api/session/code"), resolvingAgainstBaseURL: false)!
    c.percentEncodedQueryItems = [URLQueryItem(name: "c", value: code), URLQueryItem(name: "to", value: path.addingPercentEncoding(withAllowedCharacters: Self.queryValue))]
    return c.url!
  }
  // a query value: '#', '&', '=' and '+' encoded, so the page path arrives whole
  static let queryValue = CharacterSet.urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&=+#"))
}
