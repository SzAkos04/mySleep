import Testing
import Foundation
@testable import NightKit

// The alarm's decisions, the same cases as the web app's (frontend/src/lib/night.test.js).
let cal: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "Europe/Budapest")!; return c }()
func at(_ h: Int, _ m: Int, day: Int = 28) -> Date { cal.date(from: DateComponents(year: 2026, month: 10, day: day, hour: h, minute: m))! }

@Suite struct Plans {
  let smart = AlarmSettings(on: true, smart: true, hour: 6, minute: 45)

  @Test func ringsAtTheNextWakeTimeAndSmartOpensHalfAnHourBefore() {
    #expect(AlarmPlan.make(AlarmSettings(on: true, smart: false, hour: 6, minute: 45), from: at(23, 0), calendar: cal) == AlarmPlan(from: at(6, 45, day: 29), at: at(6, 45, day: 29)))
    #expect(AlarmPlan.make(smart, from: at(23, 0), calendar: cal) == AlarmPlan(from: at(6, 15, day: 29), at: at(6, 45, day: 29)))
  }

  @Test func afterMidnightStillThisMorningAfterTheWakeTimeTomorrow() {
    #expect(AlarmPlan.make(smart, from: at(1, 0, day: 29), calendar: cal)?.at == at(6, 45, day: 29))
    #expect(AlarmPlan.make(smart, from: at(6, 50, day: 29), calendar: cal)?.at == at(6, 45, day: 30))
  }

  @Test func insideTheWindowAlreadyTheWindowStartsNow() {
    let p = AlarmPlan.make(smart, from: at(6, 30, day: 29), calendar: cal)
    #expect(p == AlarmPlan(from: at(6, 30, day: 29), at: at(6, 45, day: 29)))
  }

  @Test func nothingWithTheAlarmOff() {
    #expect(AlarmPlan.make(AlarmSettings(on: false, smart: true, hour: 6, minute: 45), from: at(23, 0), calendar: cal) == nil)
  }

  @Test func ringsAtTheWakeTimeOrInTheWindowWhenStirringAndOnlyLooksInsideIt() {
    let p = AlarmPlan(from: at(6, 15, day: 29), at: at(6, 45, day: 29))
    var asked = 0
    let stirring = { asked += 1; return true }
    #expect(p.shouldRing(at: at(5, 0, day: 29), smart: true, isStirring: stirring) == false)
    #expect(asked == 0)   // checked every few seconds: no analysis outside the window
    #expect(p.shouldRing(at: at(6, 20, day: 29), smart: true, isStirring: stirring) == true)
    #expect(p.shouldRing(at: at(6, 20, day: 29), smart: true, isStirring: { false }) == false)
    #expect(p.shouldRing(at: at(6, 20, day: 29), smart: false, isStirring: stirring) == false)
    #expect(p.shouldRing(at: at(6, 45, day: 29), smart: true, isStirring: { false }) == true)
  }

  @Test func saysTheWindowAndHowLongIsLeft() {
    let p = AlarmPlan(from: at(6, 15, day: 29), at: at(6, 45, day: 29))
    #expect(p.label(calendar: cal) == "06:15 – 06:45")
    #expect(AlarmPlan(from: at(6, 45, day: 29), at: at(6, 45, day: 29)).label(calendar: cal) == "06:45")
    #expect(AlarmSettings(on: true, smart: true, hour: 7, minute: 5).time == "07:05")
  }
}

@Suite struct SharedAnalysis {
  // the web app's analysis.js itself, run by JavaScriptCore: one implementation for both apps
  static let source = try! String(contentsOf: URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appendingPathComponent("../../../../frontend/src/lib/analysis.js").standardized, encoding: .utf8)

  func night(_ seconds: Int, moving: (Int) -> Bool) -> Night {
    let n = Night(start: 0)
    for s in 0..<seconds {
      let m = moving(s)
      n.append(db: m ? 45 : 30 + Double(s % 5) / 4, low: 0.3, mid: 0.3, vr: 1, at: m ? 2 : 1)
    }
    return n
  }

  @Test func aStillSleeperIsNotStirring() throws {
    let a = try Analysis(source: Self.source)
    #expect(a.stirring(night(900) { _ in false }) == false)
  }

  @Test func turningOverInTheLastMinuteIsStirring() throws {
    let a = try Analysis(source: Self.source)
    #expect(a.stirring(night(900) { $0 > 860 && $0 % 10 < 2 }) == true)
  }

  @Test func gapsAreNotMovement() throws {
    let a = try Analysis(source: Self.source)
    let n = night(900) { _ in false }
    for _ in 0..<60 { n.append(db: .nan, low: 0, mid: 0, vr: 0, at: 0) }
    #expect(a.stirring(n) == false)
  }

  @Test func aBrokenSourceSaysSo() {
    #expect(throws: (any Error).self) { try Analysis(source: "this is not javascript (") }
  }
}

@Suite struct Rise {
  // the web app's alarm curve (tracker.js riseCurve): from -42 dB, easing into full at 25 s, held
  @Test func fromNearSilenceToFullInTwentyFiveSecondsSmoothly() {
    #expect(abs(RiseCurve.gain(at: 0) - pow(10, -42.0 / 20)) < 1e-6)
    #expect(RiseCurve.gain(at: 25) == 1)
    #expect(RiseCurve.gain(at: 90) == 1)
    #expect(RiseCurve.gain(at: -3) == RiseCurve.gain(at: 0))
    var last = 0.0
    for t in stride(from: 0.0, through: 25, by: 0.25) {
      let g = RiseCurve.gain(at: t)
      #expect(g >= last)
      // never a step a person hears as one: at most 1 dB per quarter second
      if last > 0 { #expect(20 * log10(g / last) <= 1.0) }
      last = g
    }
  }
}

@Suite struct GentleFirst {
  // The system alarm (AlarmKit) rings at full volume at once (29 October: it frightened). So the
  // app rings first, rising from near silence, and the system alarm waits behind it: it rings only
  // if the app could not, or nobody stopped it.
  let p = AlarmPlan(from: at(6, 15, day: 29), at: at(6, 45, day: 29))

  @Test func theSystemAlarmIsSetTwoMinutesBehindTheWakeTime() {
    #expect(AlarmPlan.backupDelay == 120)
    #expect(p.backup == at(6, 47, day: 29))
  }

  @Test func whenTheAppRingsTheSystemAlarmMovesTwoMinutesBehindIt() {
    #expect(AlarmPlan.backup(afterRingingAt: at(6, 20, day: 29)) == at(6, 22, day: 29))
  }

  @Test func snoozeNineMinutesWithTheSystemAlarmBehindItAgain() {
    let s = AlarmPlan.snoozed(at: at(6, 45, day: 29))
    #expect(s == AlarmPlan(from: at(6, 54, day: 29), at: at(6, 54, day: 29)))
    #expect(s.backup == at(6, 56, day: 29))
  }
}

@Suite struct AudioSessionChoice {
  // 29 October evening: the alarm played through the recording session (.playAndRecord,
  // .measurement), which iOS plays quietly through the speaker: medium even at full volume. Ringing
  // is played as playback, at the phone's full media volume; listening goes back to recording.
  @Test func ringingIsPlaybackListeningIsRecording() {
    #expect(AudioPlan.forListening == AudioPlan(category: "AVAudioSessionCategoryPlayAndRecord", mode: "AVAudioSessionModeMeasurement"))
    #expect(AudioPlan.forRinging == AudioPlan(category: "AVAudioSessionCategoryPlayback", mode: "AVAudioSessionModeDefault"))
  }
}
