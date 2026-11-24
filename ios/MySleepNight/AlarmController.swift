import AlarmKit
import SwiftUI

/// The alarm is the system's (AlarmKit): it rings on the lock screen, through silent mode and Focus,
/// with Stop and Snooze there, and it rings even if iOS has closed this app in the night. The app
/// sets it for the wake time when the night starts; in the smart window it brings it forward to now.
/// The sound is the app's piano with its rise in the file (alarm-rise.wav, from scripts/make-alarm-rise.py):
/// the system plays it at full volume from the first instant, so it starts near silence by itself.
@MainActor final class AlarmController: ObservableObject {
  typealias Phase = AlarmPhase
  @Published private(set) var phase: Phase = .none
  @Published private(set) var allowed: Bool?
  /// Why the last set() did not schedule (nil: it did).
  private(set) var lastError: String?
  /// When ours is set for (nil: none), so a move that fails can put it back (AlarmMove).
  private(set) var setFor: Date?
  /// Each change of phase, as AlarmKit reports it (the engine follows the morning with it).
  var onPhase: ((Phase, Phase) -> Void)?
  var log: (String, [String: Any]) -> Void = { _, _ in }

  // one alarm of ours at a time, so a reschedule replaces it
  private let id = UUID(uuidString: "5B1D7E0A-3C2F-4E8B-9A61-6D0C2F8E4B17")!
  private let manager = AlarmManager.shared
  private var watching: Task<Void, Never>?

  init() {
    // known at once, so the evening screen can say so before the night starts
    switch manager.authorizationState {
    case .authorized: allowed = true
    case .denied: allowed = false
    default: allowed = nil
    }
    watch()
  }

  func ask() async -> Bool {
    if manager.authorizationState == .authorized { allowed = true; return true }
    let state = try? await manager.requestAuthorization()
    allowed = state == .authorized
    log("alarm-permission", ["state": "\(String(describing: state))"])
    return allowed == true
  }

  /// Ours set for `date`, replacing the one there was; if that fails, the one there was stays.
  /// True: set for `date`.
  @discardableResult
  func set(at date: Date) async -> Bool {
    lastError = nil
    guard await ask() else { lastError = "not allowed"; return false }
    let attributes = AlarmAttributes<NightAlarm>(
      presentation: AlarmPresentation(alert: .init(
        title: "Good morning",
        stopButton: AlarmButton(text: "Stop", textColor: .white, systemImageName: "sun.max.fill"),
        secondaryButton: AlarmButton(text: "Snooze", textColor: .white, systemImageName: "zzz"),
        secondaryButtonBehavior: .countdown)),
      tintColor: Theme.accent)
    let (manager, id) = (manager, id)
    let r = await AlarmMove.run(from: setFor, to: date, now: Date()) { at in
      try? manager.cancel(id: id)
      let config = AlarmManager.AlarmConfiguration(
        countdownDuration: Alarm.CountdownDuration(preAlert: nil, postAlert: Double(AlarmPlan.snoozeMinutes) * 60),
        schedule: .fixed(at), attributes: attributes, sound: .named("alarm-rise.wav"))
      _ = try await manager.schedule(id: id, configuration: config)
    }
    setFor = r.at
    if let e = r.error {
      lastError = "\(e)"
      log("alarm-failed", ["error": "\(e)", "kept": r.at.map { Int64($0.timeIntervalSince1970 * 1000) } as Any? ?? NSNull()])
      return false
    }
    phase = .set
    log("alarm-set", ["at": Int64(date.timeIntervalSince1970 * 1000)])
    return true
  }

  /// The smart window, the sleeper stirring: ring now.
  @discardableResult
  func ringNow() async -> Bool { await set(at: Date().addingTimeInterval(2)) }

  func cancel() {
    try? manager.cancel(id: id)
    if phase != .none { log("alarm-cancelled", [:]) }
    phase = .none; setFor = nil
  }

  func stop() { try? manager.stop(id: id) }
  func snooze() { try? manager.countdown(id: id) }

  private func watch() {
    watching = Task { [weak self] in
      guard let updates = self?.manager.alarmUpdates else { return }
      for await alarms in updates {
        guard let self else { return }
        let ours = alarms.first { $0.id == self.id }
        let was = self.phase
        switch ours?.state {
        case .alerting?: self.phase = .ringing
        case .countdown?: self.phase = .snoozed
        case .scheduled?, .paused?: self.phase = .set
        case nil: self.phase = .none
        @unknown default: break
        }
        if self.phase != was { self.log("alarm-" + "\(self.phase)", [:]); self.onPhase?(was, self.phase) }
      }
    }
  }
}
