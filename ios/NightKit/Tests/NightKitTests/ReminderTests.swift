import Testing
import Foundation
@testable import NightKit

// The reminders the phone schedules itself (local notifications: a free Apple ID has no push). The
// rules and the words are the server's (api/reminders.js, the bedtime tick in api/server.js); the
// server's web push stops when the web app does.
@Suite struct ReminderTests {
  var cal: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/Budapest")!; return c }
  func at(_ d: Int, _ h: Int, _ m: Int = 0) -> Date { cal.date(from: DateComponents(year: 2026, month: 11, day: d, hour: h, minute: m))! }   // November: UTC+1

  @Test func bedtimeIsRemindedEveryDayHalfAnHourBefore() {
    var s = AppSettings()
    #expect(Reminders.bedtime(s) == Reminder(id: "bedtime", title: "Bedtime in 30 min", body: "Lights out at 23:00.", when: .daily(hour: 22, minute: 30)))
    s.bedtime = "00:10"
    #expect(Reminders.bedtime(s)?.when == .daily(hour: 23, minute: 40))   // across midnight
    s.bedtime = "22:15"
    #expect(Reminders.bedtime(s)?.when == .daily(hour: 21, minute: 45))
    s.remind = false
    #expect(Reminders.bedtime(s) == nil)
    s.remind = true; s.bedtime = "late"
    #expect(Reminders.bedtime(s) == nil)
  }

  @Test func theInstallRunsOutAndIsRemindedThreeTimesAtNine() {
    let expires = at(5, 20)   // Thursday 5 November, 20:00
    let r = Reminders.expiry(expires: expires, now: at(2, 12), calendar: cal)
    #expect(r.map(\.id) == ["reinstall-soon", "reinstall-today", "reinstall-expired"])
    #expect(r.map(\.when) == [.once(at(3, 9)), .once(at(5, 9)), .once(at(6, 9))])
    #expect(r[0].title == "mySleep Night stops on Thursday")
    #expect(r[0].body == "Reinstall it from the Mac before then: connect the iPhone and run the install.")
    #expect(r[1].title == "mySleep Night stops tonight")
    #expect(r[1].body == "Reinstall it from the Mac today, or tonight will not be recorded.")
    #expect(r[2].title == "mySleep Night has stopped")
    #expect(r[2].body == "It cannot record a night until it is reinstalled from the Mac.")
  }

  @Test func whatIsPastIsLeftOutAndNothingWithoutADate() {
    let expires = at(5, 20)
    #expect(Reminders.expiry(expires: expires, now: at(4, 12), calendar: cal).map(\.id) == ["reinstall-today", "reinstall-expired"])
    #expect(Reminders.expiry(expires: expires, now: at(5, 12), calendar: cal).map(\.id) == ["reinstall-expired"])
    #expect(Reminders.expiry(expires: expires, now: at(7, 12), calendar: cal).isEmpty)
    #expect(Reminders.expiry(expires: nil, now: at(2, 12), calendar: cal).isEmpty)
  }

  @Test func anInstallThatStopsBeforeNineHasNoTonight() {
    let r = Reminders.expiry(expires: at(5, 8), now: at(2, 12), calendar: cal)
    #expect(r.map(\.id) == ["reinstall-soon", "reinstall-expired"])
    #expect(r[1].when == .once(at(5, 9)))   // it has stopped by then: said the same day
  }

  @Test func everythingTheAppShouldHaveScheduled() {
    let all = Reminders.all(AppSettings(), expires: at(5, 20), now: at(2, 12), calendar: cal)
    #expect(all.map(\.id) == ["bedtime", "reinstall-soon", "reinstall-today", "reinstall-expired"])
    var off = AppSettings(); off.remind = false
    #expect(Reminders.all(off, expires: nil, now: at(2, 12), calendar: cal).isEmpty)
  }
}
