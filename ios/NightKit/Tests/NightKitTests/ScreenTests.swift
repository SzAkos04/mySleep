import Testing
import Foundation
@testable import NightKit

// What the native app's screens say (ios/MySleepNight), decided here so it is tested on the Mac.

@Suite struct InstallStatusTests {
  // a free Apple ID signs the app for 7 days
  func nov(_ d: Int, _ h: Int, _ m: Int = 0) -> Date { cal.date(from: DateComponents(year: 2026, month: 11, day: d, hour: h, minute: m))! }
  var until: Date { nov(5, 13, 46) }   // Thu 5 Nov

  @Test func fineWithTimeToSpare() {
    let s = InstallStatus(expires: until, now: at(12, 0, day: 31), calendar: cal)
    #expect(s.level == .fine)
    #expect(s.title == "Runs until Thu 5 Nov")
    #expect(s.detail == "Reinstall it from the Mac before then")
  }
  @Test func soonSaysTheLastDayToReinstall() {
    let s = InstallStatus(expires: until, now: nov(4, 9), calendar: cal)
    #expect(s.level == .soon)
    #expect(s.detail == "Reinstall from the Mac by Wednesday")
  }
  @Test func theLastDayAndAfter() {
    #expect(InstallStatus(expires: until, now: nov(5, 9), calendar: cal).level == .today)
    let gone = InstallStatus(expires: until, now: nov(5, 14), calendar: cal)
    #expect(gone.level == .expired)
    #expect(gone.title == "Stopped on Thu 5 Nov")
  }
  @Test func noProfileInTheSimulator() {
    let s = InstallStatus(expires: nil, now: Date(), calendar: cal)
    #expect(s.level == .unknown)
    #expect(s.title == "Installed from Xcode")
  }
}

@Suite struct MorningTests {
  let bed = at(23, 4), end = at(6, 31, day: 29)

  @Test func theNightAtAGlance() {
    let m = Morning(bed: bed, end: end, heardMinutes: 447, early: 14, snoozes: 1, calendar: cal)
    #expect(m.range == "23:04 – 06:31")
    #expect(m.line == "7h 27m in bed · heard all of it")
    #expect(m.alarm == Morning.Fact("14 min early", "smart alarm, you stirred"))
    #expect(m.snooze == Morning.Fact("Snoozed once", "9 minutes each"))
  }
  @Test func saysWhatItMissed() {
    let m = Morning(bed: bed, end: end, heardMinutes: 300, early: 0, snoozes: 0, calendar: cal)
    #expect(m.line == "7h 27m in bed · heard 5h 00m of it")
    #expect(m.alarm == Morning.Fact("On time", "at your wake-up"))
    #expect(m.snooze == Morning.Fact("No snooze", "up with the alarm"))
  }
  @Test func noRingNoAlarmCards() {
    // ended by hand before the alarm (or no alarm): nothing to say about it, not "up with the alarm"
    let m = Morning(bed: bed, end: end, heardMinutes: 447, early: nil, snoozes: 0, calendar: cal)
    #expect(m.alarm == nil)
    #expect(m.snooze == nil)
  }
  @Test func showsUntilPutAwayEachNightByItsEnd() {
    let now = end.addingTimeInterval(600)
    #expect(Morning.shows(end: end, seen: nil, now: now))
    #expect(!Morning.shows(end: end, seen: end, now: now))                       // Done
    // kept as seconds since 1970 (AppStorage): back as a Date, a hair off
    #expect(!Morning.shows(end: end.addingTimeInterval(0.123456), seen: Date(timeIntervalSince1970: end.addingTimeInterval(0.1234).timeIntervalSince1970), now: now))
    // a night started again the same evening (same date, so same id) is another night
    #expect(Morning.shows(end: end, seen: end.addingTimeInterval(-3600), now: now))
    #expect(!Morning.shows(end: end, seen: nil, now: end.addingTimeInterval(12 * 3600)))   // stale by evening
  }
  @Test func snoozesCounted() {
    let m = Morning(bed: bed, end: end, heardMinutes: 447, early: 0, snoozes: 2, calendar: cal)
    #expect(m.snooze == Morning.Fact("Snoozed 2 times", "9 minutes each"))
  }
}

@Suite struct VolumeTests {
  @Test func saysToTurnItUpBelowHalf() {
    #expect(VolumeAdvice(volume: 0.4).text == "40% · turn it up")
    #expect(VolumeAdvice(volume: 0.4).low)
    #expect(VolumeAdvice(volume: 0.8).text == "80%")
    #expect(!VolumeAdvice(volume: 0.8).low)
  }
}
