import ActivityKit
import Foundation

/// The night's lock screen card (NightActivity). Started with the night, while the app is in front
/// (iOS allows no other way); updated each minute and whenever the microphone stops or comes back,
/// each update saying it goes stale in 3 minutes, so a closed app's card says so; ended by the app
/// itself 10 minutes before iOS's 8-hour limit, with content that stays right on its own (NightKit's
/// LivePlan), and at once when the alarm rings or the night ends.
@MainActor final class LiveCardController {
  var log: (String, [String: Any]) -> Void = { _, _ in }
  private var activity: Activity<NightActivity>?
  private var card: LiveCard?

  func start(night: String, started: Date, plan: AlarmPlan?) async {
    // a card left from a night whose app was closed: gone before the new one, one card at a time
    // (ended alongside the request, the new card did not show at the first lock)
    for old in Activity<NightActivity>.activities { await old.end(nil, dismissalPolicy: .immediate) }
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { log("live-off", [:]); return }
    let c = LiveCard(started: started, ringFrom: plan?.from, ringAt: plan?.at, hearing: true, updated: Date())
    do {
      activity = try Activity.request(attributes: NightActivity(night: night), content: ActivityContent(state: c, staleDate: LivePlan.staleDate(updated: c.updated)))
      card = c
      log("live-start", [:])
    } catch {
      log("live-failed", ["error": "\(error)"])
    }
  }

  /// Each minute, and when hearing changes. Past the hand-over time: the last, lasting content.
  func update(hearing: Bool, now: Date = Date()) {
    guard let activity, var c = card, !c.handedOver else { return }
    c.hearing = hearing; c.updated = now
    if now >= LivePlan.handOver(started: c.started) {
      c.handedOver = true
      let until = LivePlan.dismissal(ended: now, ringAt: c.ringAt)
      Task { await activity.end(ActivityContent(state: c, staleDate: nil), dismissalPolicy: .after(until)) }
      log("live-handover", ["until": Int64(until.timeIntervalSince1970 * 1000)])
    } else {
      Task { await activity.update(ActivityContent(state: c, staleDate: LivePlan.staleDate(updated: now))) }
    }
    card = c
  }

  /// The app's own alarm rings, or stops ringing (snooze): the card says Good morning, with Snooze.
  func ringing(_ on: Bool) {
    guard let activity, var c = card else { return }
    c.ringing = on; c.updated = Date()
    // a card already handed over (iOS's 8 hours) is ended: it cannot ring along
    if c.handedOver { return }
    Task { await activity.update(ActivityContent(state: c, staleDate: LivePlan.staleDate(updated: c.updated))) }
    card = c
  }

  /// Snoozed: back to listening, the card saying when it rings next.
  func snoozed(until next: Date) {
    guard let activity, let c = card, !c.handedOver else { return }
    let s = c.snoozed(until: next, now: Date())
    Task { await activity.update(ActivityContent(state: s, staleDate: LivePlan.staleDate(updated: s.updated))) }
    card = s
  }

  /// The system alarm rings (its own screen takes over) or the night ends.
  func end() {
    guard let activity else { return }
    self.activity = nil; card = nil
    Task { await activity.end(nil, dismissalPolicy: .immediate) }
    log("live-end", [:])
  }
}
