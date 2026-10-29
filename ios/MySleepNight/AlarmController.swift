import AlarmKit
import SwiftUI

/// The alarm is the system's (AlarmKit): it rings on the lock screen, through silent mode and Focus,
/// with Stop and Snooze there, and it rings even if iOS has closed this app in the night. The app
/// sets it for the wake time when the night starts; in the smart window it brings it forward to now.
/// The sound is the app's piano (alarm-piano.wav, a resource of the app).
@MainActor final class AlarmController: ObservableObject {
  enum Phase: Equatable { case none, set, ringing, snoozed }
  @Published private(set) var phase: Phase = .none
  @Published private(set) var allowed: Bool?
  /// Called when the alarm was stopped (not snoozed): the night is over.
  var onStopped: (() -> Void)?
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

  func set(at date: Date) async {
    guard await ask() else { return }
    try? manager.cancel(id: id)
    let attributes = AlarmAttributes<NightAlarm>(
      presentation: AlarmPresentation(alert: .init(
        title: "Good morning",
        stopButton: AlarmButton(text: "Stop", textColor: .white, systemImageName: "sun.max.fill"),
        secondaryButton: AlarmButton(text: "Snooze", textColor: .white, systemImageName: "zzz"),
        secondaryButtonBehavior: .countdown)),
      tintColor: Theme.accent)
    let config = AlarmManager.AlarmConfiguration(
      countdownDuration: Alarm.CountdownDuration(preAlert: nil, postAlert: Double(AlarmPlan.snoozeMinutes) * 60),
      schedule: .fixed(date), attributes: attributes, sound: .named("alarm-piano.wav"))
    do {
      _ = try await manager.schedule(id: id, configuration: config)
      phase = .set
      log("alarm-set", ["at": Int64(date.timeIntervalSince1970 * 1000)])
    } catch {
      log("alarm-failed", ["error": "\(error)"])
    }
  }

  /// The smart window, the sleeper stirring: ring now.
  func ringNow() async { await set(at: Date().addingTimeInterval(2)) }

  func cancel() {
    try? manager.cancel(id: id)
    if phase != .none { log("alarm-cancelled", [:]) }
    phase = .none
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
        if self.phase != was { self.log("alarm-" + "\(self.phase)", [:]) }
        // gone after ringing: Stop on the lock screen or here; the night is over
        if self.phase == .none && (was == .ringing || was == .snoozed) { self.onStopped?() }
      }
    }
  }
}
