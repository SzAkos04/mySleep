import Testing
import Foundation
@testable import NightKit

// The settings are one synced record (settings:main), synced with the nights: the alarm,
// the smart window, the wake time, the bedtime and its reminder.
@Suite struct SettingsTests {
  func store() -> NightStore { NightStore() }
  let t0 = Date(timeIntervalSince1970: 1000)

  @Test func startAsTheWebAppDoes() throws {
    let s = store().settings
    #expect(s.alarm && s.smart && s.remind)
    #expect(s.wake == "06:45" && s.bedtime == "23:00" && s.ts == 0)
    #expect(s.alarmSettings == AlarmSettings(on: true, smart: true, hour: 6, minute: 45))
  }

  @Test func aChangeIsMergedStampedAndWaitsToGoUp() throws {
    let st = store()
    st.change(now: t0) { $0.wake = "07:10"; $0.smart = false }
    #expect(st.settings.alarmSettings == AlarmSettings(on: true, smart: false, hour: 7, minute: 10))
    #expect(st.settings.bedtime == "23:00" && st.settings.ts == 1_000_000)
    #expect(st.dirtyCount == 1)
  }

  @Test func theAlarmAsItWasKeptBeforeIsAdoptedOnceAndNeverOverTheServers() async throws {
    // before the settings were synced the app kept the alarm on its own: that moves in, as the oldest
    // edit there is, so anything the server has wins
    let mine = AlarmSettings(on: true, smart: false, hour: 7, minute: 30)
    let st = store()
    st.adopt(legacy: mine)
    #expect(st.settings.alarmSettings == mine && st.settings.ts == 1)
    st.adopt(legacy: AlarmSettings(on: false, smart: true, hour: 1, minute: 1))   // only the first time
    #expect(st.settings.alarmSettings == mine)

    let other = store()
    let reply = #"{"rev":4,"changes":[{"kind":"settings","id":"main","ts":500,"data":{"wake":"06:00","alarm":true,"smart":true,"bedtime":"22:00","remind":true}}]}"#
    _ = await other.sync(now: t0) { _ in (200, Data(reply.utf8)) }
    other.adopt(legacy: mine)
    #expect(other.settings.wake == "06:00" && other.settings.bedtime == "22:00")
  }

  @Test func anAdoptedAlarmGoesUpWhenTheServerHasNone() async throws {
    let st = store()
    st.adopt(legacy: AlarmSettings(on: true, smart: false, hour: 7, minute: 30))
    var sent = ""
    _ = await st.sync(now: t0) { body in sent = String(decoding: body, as: UTF8.self); return (200, Data(#"{"rev":1,"changes":[]}"#.utf8)) }
    #expect(sent.contains("\"kind\":\"settings\"") && sent.contains("07:30"))
  }

  @Test func theSleepLinkSetsTonightsAlarm() throws {
    let st = store()
    st.saveAlarm(AlarmSettings(on: false, smart: false, hour: 8, minute: 5), now: t0)
    #expect(st.settings.alarm == false && st.settings.smart == false && st.settings.wake == "08:05")
  }
}
