import Foundation

/// The settings (settings:main, synced with the nights): tonight's
/// alarm, the bedtime and its reminder. `ts` is the time of the last edit; 0 means never edited.
public struct AppSettings: Decodable, Equatable, Sendable {
  public var alarm = true, smart = true, remind = true
  public var wake = "06:45", bedtime = "23:00"
  public var tz = TimeZone.current.identifier
  public var ts: Int64 = 0

  enum Keys: String, CodingKey { case alarm, smart, remind, wake, bedtime, tz, ts }
  public init() {}
  public init(from d: Decoder) throws {
    let c = try d.container(keyedBy: Keys.self), base = AppSettings()
    alarm = try c.decodeIfPresent(Bool.self, forKey: .alarm) ?? base.alarm
    smart = try c.decodeIfPresent(Bool.self, forKey: .smart) ?? base.smart
    remind = try c.decodeIfPresent(Bool.self, forKey: .remind) ?? base.remind
    wake = try c.decodeIfPresent(String.self, forKey: .wake) ?? base.wake
    bedtime = try c.decodeIfPresent(String.self, forKey: .bedtime) ?? base.bedtime
    tz = try c.decodeIfPresent(String.self, forKey: .tz) ?? base.tz
    ts = try c.decodeIfPresent(Int64.self, forKey: .ts) ?? 0
  }

  /// Tonight's alarm, for the night engine.
  public var alarmSettings: AlarmSettings {
    let hm = wake.split(separator: ":").compactMap { Int($0) }
    return AlarmSettings(on: alarm, smart: smart, hour: hm.first ?? 6, minute: hm.count > 1 ? hm[1] : 45)
  }
}

extension NightStore {
  public var settings: AppSettings { view("S.settings", AppSettings.self) ?? AppSettings() }

  /// A change to settings (the keys that changed); the time zone goes with it, the server's
  /// reminders run on the phone's clock.
  public func change(_ patch: [String: Any], now: Date) throws {
    var p = patch
    p["tz"] = TimeZone.current.identifier
    try saveSettings(String(decoding: try JSONSerialization.data(withJSONObject: p), as: UTF8.self), now: now)
  }

  /// Tonight's alarm (the Sleep link, the Tonight tab).
  public func saveAlarm(_ a: AlarmSettings, now: Date) throws { try change(Self.patch(a), now: now) }

  /// The alarm as the app kept it before settings were synced: taken in once, and as the oldest
  /// edit there is (time 1 ms), so anything the server has is newer and wins.
  public func adopt(legacy a: AlarmSettings) throws {
    guard settings.ts == 0 else { return }
    try change(Self.patch(a), now: Date(timeIntervalSince1970: 0.001))
  }

  private static func patch(_ a: AlarmSettings) -> [String: Any] { ["alarm": a.on, "smart": a.smart, "wake": a.time] }
}
