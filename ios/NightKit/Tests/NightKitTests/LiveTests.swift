import Testing
import Foundation
@testable import NightKit

// The lock screen card during the night (a Live Activity). iOS keeps one updating for 8 hours at
// most, then ends it; one cannot be started again from the background. So the times on it count by
// themselves, the app hands it over shortly before the 8 hours (ending it itself, still showing the
// night, kept on the lock screen up to 4 hours more, gone half an hour after the alarm), and a card
// the app stopped updating says so instead of claiming to listen.
@Suite struct LiveCardTests {
  let start = at(23, 0)
  var card: LiveCard { LiveCard(started: start, ringFrom: at(6, 15, day: 29), ringAt: at(6, 45, day: 29), hearing: true, updated: start) }

  @Test func handsOverTenMinutesBeforeIOSWouldEndIt() {
    #expect(LivePlan.handOver(started: start) == start.addingTimeInterval(8 * 3600 - 600))
  }

  @Test func afterTheHandOverItStaysUntilHalfAnHourAfterTheAlarmButNoMoreThanIOSAllows() {
    let end = LivePlan.handOver(started: start)   // 06:50
    #expect(LivePlan.dismissal(ended: end, ringAt: at(6, 55, day: 29)) == at(7, 25, day: 29))
    // a late alarm: as long as iOS keeps an ended card, 4 hours
    #expect(LivePlan.dismissal(ended: end, ringAt: at(13, 0, day: 29)) == end.addingTimeInterval(4 * 3600))
    #expect(LivePlan.dismissal(ended: end, ringAt: nil) == end.addingTimeInterval(4 * 3600))
    // the alarm already past: soon
    #expect(LivePlan.dismissal(ended: at(7, 30, day: 29), ringAt: at(6, 45, day: 29)) == at(7, 30, day: 29).addingTimeInterval(600))
  }

  @Test func staleThreeMinutesAfterEachUpdate() {
    #expect(LivePlan.staleDate(updated: start) == start.addingTimeInterval(180))
  }

  @Test func whatTheCardSays() {
    #expect(card.status(stale: false, calendar: cal) == .listening)
    var deaf = card; deaf.hearing = false
    #expect(deaf.status(stale: false, calendar: cal) == .notHearing)
    var late = card; late.updated = at(3, 12, day: 29)
    #expect(late.status(stale: true, calendar: cal) == .stale(since: "03:12"))
    #expect(LiveCard.Status.listening.text == "Listening")
    #expect(LiveCard.Status.notHearing.text == "Not hearing anything")
    #expect(LiveCard.Status.stale(since: "03:12").text == "Not heard from since 03:12 · open mySleep Night")
  }

  @Test func handedOverItSaysTheAppStillListensButTheCardNoLongerFollows() {
    var last = card; last.handedOver = true
    #expect(last.status(stale: false, calendar: cal) == .handedOver)
    #expect(LiveCard.Status.handedOver.text == "Still listening · live status in the app")
  }

  @Test func theAlarmLine() {
    #expect(card.alarmLine(calendar: cal) == "Alarm 06:15 – 06:45")
    var plain = card; plain.ringFrom = plain.ringAt
    #expect(plain.alarmLine(calendar: cal) == "Alarm 06:45")
    var none = card; none.ringFrom = nil; none.ringAt = nil
    #expect(none.alarmLine(calendar: cal) == "No alarm")
  }

  @Test func encodesForActivityKit() throws {
    let back = try JSONDecoder().decode(LiveCard.self, from: JSONEncoder().encode(card))
    #expect(back == card)
  }
}

@Suite struct AlarmCardTests {
  // the alarm's own card (AlarmKit): what it says in each state, never "Snoozing" while it rings
  @Test func saysWhatTheAlarmIsDoing() {
    #expect(AlarmCard.text(.ringing) == AlarmCard.Text(title: "Good morning", subtitle: "mySleep Night is ringing", showsTime: false))
    #expect(AlarmCard.text(.snoozing) == AlarmCard.Text(title: "Snoozing", subtitle: "mySleep Night rings again at", showsTime: true))
    #expect(AlarmCard.text(.paused) == AlarmCard.Text(title: "Alarm paused", subtitle: "Open mySleep Night", showsTime: false))
  }
}
