import Foundation

/// The settings (settings:main, synced with the nights): tonight's
/// alarm, the bedtime and its reminder. `ts` is the time of the last edit; 0 means never edited.
public struct AppSettings: Codable, Equatable, Sendable {
  public var alarm = true, smart = true, remind = true
  public var wake = "06:45", bedtime = "23:00"
  public var tz = TimeZone.current.identifier
  public var ts: Int64 = 0

  enum CodingKeys: String, CodingKey { case alarm, smart, remind, wake, bedtime, tz, ts }
  public init() {}
  public init(from d: Decoder) throws {
    let c = try d.container(keyedBy: CodingKeys.self), base = AppSettings()
    alarm = try c.decodeIfPresent(Bool.self, forKey: .alarm) ?? base.alarm
    smart = try c.decodeIfPresent(Bool.self, forKey: .smart) ?? base.smart
    remind = try c.decodeIfPresent(Bool.self, forKey: .remind) ?? base.remind
    wake = try c.decodeIfPresent(String.self, forKey: .wake) ?? base.wake
    bedtime = try c.decodeIfPresent(String.self, forKey: .bedtime) ?? base.bedtime
    tz = try c.decodeIfPresent(String.self, forKey: .tz) ?? base.tz
    ts = Int64((try? c.decodeIfPresent(Double.self, forKey: .ts)) ?? 0)
  }

  /// Tonight's alarm, for the night engine.
  public var alarmSettings: AlarmSettings {
    let hm = wake.split(separator: ":").compactMap { Int($0) }
    return AlarmSettings(on: alarm, smart: smart, hour: hm.first ?? 6, minute: hm.count > 1 ? hm[1] : 45)
  }
}

extension NightStore {
  public var settings: AppSettings { state.settings }

  /// A change to the settings; the time zone goes with it, the server's reminders run on the
  /// phone's clock.
  public func change(now: Date, _ edit: (inout AppSettings) -> Void) {
    state.editSettings(ts: Clock.ms(now)) { s in edit(&s); s.tz = TimeZone.current.identifier }
  }

  /// Tonight's alarm (the Sleep link, the Tonight tab).
  public func saveAlarm(_ a: AlarmSettings, now: Date) { change(now: now) { $0.alarm = a.on; $0.smart = a.smart; $0.wake = a.time } }

  /// The alarm as the app kept it before settings were synced: taken in once, and as the oldest
  /// edit there is (time 1 ms), so anything the server has is newer and wins.
  public func adopt(legacy a: AlarmSettings) {
    guard settings.ts == 0 else { return }
    saveAlarm(a, now: Date(timeIntervalSince1970: 0.001))
  }
}
