import Testing
import Foundation
@testable import NightKit

@Suite struct ClockTests {
  @Test func namesANightAfterItsEveningAndPlacesClockTimesOnTheRightDay() {
    #expect(Clock.nightId(at(21, 2, 30)) == "2026-10-20")
    #expect(Clock.nightId(at(20, 23, 30)) == "2026-10-20")
    #expect(Clock.atClock("2026-10-20", "23:12") == at(20, 23, 12))
    #expect(Clock.atClock("2026-10-20", "06:48") == at(21, 6, 48))
    #expect(Clock.atClock("2026-10-31", "07:00") == at(1, 7, 0, month: 11))   // month end
  }

  @Test func noonBelongsToItsOwnDateAMinuteBeforeToTheNext() {
    #expect(Clock.atClock("2026-10-20", "12:00") == at(20, 12, 0))
    #expect(Clock.atClock("2026-10-20", "11:59") == at(21, 11, 59))
  }

  @Test func durRollsMinutesOverIntoTheHourInsteadOfPrinting60m() {
    #expect(Clock.dur(119.6) == "2h 00m")
    #expect(Clock.dur(59.5) == "1h 00m")
    #expect(Clock.dur(179.5) == "3h 00m")
    #expect(Clock.dur(59.4) == "59 min")
    #expect(Clock.dur(125) == "2h 05m")
  }

  @Test func labelsAndClockTimes() {
    #expect(Clock.dayLabel("2026-10-28") == "Wed, Oct 28")
    #expect(Clock.clockOf(at(29, 0, 5)) == "00:05")
    #expect(Clock.noonToClock(Clock.fromNoon(at(29, 23, 50))) == "23:50")
    #expect(Clock.toNoon("23:00") == 660 && Clock.toNoon("06:45") == 1125)
  }

  @Test func javaScriptsRoundingWhereTheWordsDependOnIt() {
    #expect(JS.round(2.5) == 3 && JS.round(-2.5) == -2 && JS.round(0.49) == 0)
    #expect(JS.int(.nan) == 0 && JS.int(.infinity) == 0)
    #expect(JS.num(12) == "12" && JS.num(5.5) == "5.5")
  }
}
