import Testing
import Foundation
@testable import NightKit

// The sheet that puts a night's times right. A night without sleep found has no "fell asleep" time:
// the sheet must not invent one (saving it as the bedtime would make the night "slept at once").
@Suite struct CorrectionTests {
  @Test func aNightWithoutSleepStartsWithoutAFellAsleepTime() {
    let c = Correction(ReportView.Times(bed: "23:05", on: "", wake: "07:10"))
    #expect(c.on == nil)
    #expect(c.texts == Correction.Texts(bed: "23:05", on: "", wake: "07:10"))   // blank: the rules take that as "no sleep"
  }

  @Test func timesGoBackAsTheyCame() {
    let c = Correction(ReportView.Times(bed: "23:05", on: "23:40", wake: "07:10"))
    #expect(c.on != nil)
    #expect(c.texts == Correction.Texts(bed: "23:05", on: "23:40", wake: "07:10"))
  }

  @Test func aFellAsleepTimeCanBeAddedAndTakenAway() {
    var c = Correction(ReportView.Times(bed: "23:05", on: "", wake: "07:10"))
    c.addFellAsleep()
    #expect(c.texts.on == "23:05")   // it starts where the night does, to be moved
    c.removeFellAsleep()
    #expect(c.texts.on == "")
  }
}
