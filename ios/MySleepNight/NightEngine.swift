import AVFoundation
import UIKit

/// The microphone all night, with the phone locked: an audio session for recording, kept alive by
/// the `audio` background mode, an engine whose input is read in frames into a `Night` (NightKit).
/// Everything iOS does to it is logged: interruptions, route changes, media services resets, the
/// screen locking, the app going to the background, battery and heat, once a minute a heartbeat.
/// The log is saved every minute to Documents/<night>.json. The alarm is the system's (AlarmController):
/// set for the wake time at the start, brought forward in the smart window when the sleeper stirs.
@MainActor final class NightEngine: ObservableObject {
  @Published private(set) var night: Night?
  @Published private(set) var level: Double?       // the last second's loudness, nil = nothing heard
  @Published private(set) var saved: Date?
  @Published private(set) var plan: AlarmPlan?     // tonight's alarm, nil = none
  /// The night just finished: what the morning screen shows, and which night to open in the Journal.
  struct Finished {
    let id: String, file: URL, bed: Date, end: Date, heardMinutes: Int
    let early: Int?, snoozes: Int   // early: minutes before the wake time it rang; nil: it did not ring
  }
  @Published private(set) var lastNight: Finished?
  @Published private(set) var ringingEarly = 0   // the alarm screen: how early it rang (0: at the wake time)

  let alarm = AlarmController()
  var onFinished: (() -> Void)?   // the night saved: send it up
  private var smart = false, rangEarly = false, lastCheck: Int64 = 0
  private var tally = WakeTally()

  private let live = LiveCardController()
  private var wasHearing = true

  init() {
    alarm.log = { [weak self] type, data in self?.logNow(type, data) }
    live.log = { [weak self] type, data in self?.logNow(type, data) }
    alarm.onPhase = { [weak self] from, to in self?.alarmChanged(from: from, to: to) }
  }

  private func logNow(_ type: String, _ data: [String: Any]) {
    guard let n = night else { return }
    queue.async { n.log(type, data, at: NightEngine.nowMs) }
  }

  private let engine = AVAudioEngine()
  private let queue = DispatchQueue(label: "night")   // every Night call runs here
  private var timer: Timer?, observers: [NSObjectProtocol] = [], restarts = 0, lastRestart: Int64 = 0, lastBeat: Int64 = 0

  nonisolated static let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]

  /// iOS may end the app in the night; its log stays unfinished, and only finished logs become
  /// nights. At launch, before a night starts, the last few days' unfinished logs are finished
  /// where their readings stop (Night.recovered), so they go up like any other.
  nonisolated static func finishCutShort() async {
    await Task.detached(priority: .utility) {
      let fm = FileManager.default, dir = documents
      for name in (try? fm.contentsOfDirectory(atPath: dir.path)) ?? [] where name.hasSuffix(".json") {
        let url = dir.appendingPathComponent(name)
        guard let m = (try? fm.attributesOfItem(atPath: url.path))?[.modificationDate] as? Date, Date().timeIntervalSince(m) < 3 * 86400,
              let data = try? Data(contentsOf: url), let done = Night.recovered(data) else { continue }
        try? done.write(to: url, options: .atomic)
      }
    }.value
  }
  nonisolated static var nowMs: Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

  func start(_ settings: AlarmSettings) async throws {
    guard await AVAudioApplication.requestRecordPermission() else { throw NSError(domain: "mySleep", code: 1, userInfo: [NSLocalizedDescriptionKey: "mySleep needs the microphone: allow it in Settings."]) }
    let start = Self.nowMs, device = UIDevice.current
    device.isBatteryMonitoringEnabled = true
    let n = Night(start: start, night: Clock.nightId(Double(start)), env: [
      "app": "native", "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?",
      "system": "\(device.systemName) \(device.systemVersion)", "model": device.model
    ])
    night = n; nightForQueue = n; lastBeat = start
    n.log("start", ["battery": device.batteryLevel, "charging": device.batteryState == .charging || device.batteryState == .full])
    smart = settings.smart; rangEarly = false; tally = WakeTally(); ringingEarly = 0; lastNight = nil
    restarts = 0; lastRestart = 0; lastCheck = 0
    alarmTest = .idle   // a test still running gives way: its alarm is replaced by tonight's
    plan = AlarmPlan.make(settings, from: Date())
    // the alarm first: whatever happens to the microphone, it rings at the wake time
    if let p = plan {
      n.log("night", ["ringFrom": Int64(p.from.timeIntervalSince1970 * 1000), "ringAt": Int64(p.at.timeIntervalSince1970 * 1000), "smart": smart])
      await alarm.set(at: p.at)
    }
    do { try startAudio(reason: "start") } catch {
      // no night without the microphone (a call, say): back to the evening, which says why; the
      // alarm stays set
      night = nil; nightForQueue = nil; plan = nil
      let set = alarm.phase == .set ? " The alarm is still set." : ""
      throw NSError(domain: "mySleep", code: 2, userInfo: [NSLocalizedDescriptionKey: "The microphone could not start (\(error.localizedDescription)).\(set) Try again in a moment."])
    }
    watch()
    // the lock screen card: only now, while the app is in front, may it be started
    await live.start(night: n.night, started: Date(timeIntervalSince1970: Double(start) / 1000), plan: plan)
    wasHearing = true
    timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in Task { @MainActor in self?.everySecond() } }
  }

  func stop() {
    guard let n = night else { return }
    timer?.invalidate(); timer = nil
    observers.forEach(NotificationCenter.default.removeObserver); observers = []
    engine.inputNode.removeTap(onBus: 0)
    engine.stop()
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    alarm.cancel()
    live.end()
    queue.sync { n.tick(at: Self.nowMs); n.log("finish") }
    save(final: true)
    let heard = queue.sync { n.db.filter { !$0.isNaN }.count }
    lastNight = Finished(id: n.night, file: fileURL(n), bed: Date(timeIntervalSince1970: Double(n.start) / 1000), end: Date(),
                         heardMinutes: heard / 60, early: tally.early, snoozes: tally.snoozes)
    night = nil; nightForQueue = nil; level = nil; plan = nil
    onFinished?()
  }

  // MARK: audio

  private func startAudio(reason: String) throws {
    let session = AVAudioSession.sharedInstance()
    // .measurement: no automatic gain or noise suppression; mixing, so other audio and the alarm are left be
    try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .mixWithOthers])
    try session.setActive(true)
    let input = engine.inputNode, format = input.outputFormat(forBus: 0), rate = format.sampleRate
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 4800, format: format) { [queue, weak self] buffer, _ in
      guard let ch = buffer.floatChannelData?[0] else { return }
      let n = Int(buffer.frameLength), take = min(n, 2048)
      // the last 2048 samples of the buffer
      let frame = take == 2048 ? Array(UnsafeBufferPointer(start: ch + (n - take), count: take)) : []
      let now = NightEngine.nowMs
      queue.async { if let night = self?.nightForQueue { night.add(frame, sampleRate: rate, at: now) } }
    }
    engine.prepare()
    try engine.start()
    let route = session.currentRoute.inputs.map { "\($0.portType.rawValue):\($0.portName)" }
    queue.async { [weak self] in self?.nightForQueue?.log("audio", ["reason": reason, "rate": rate, "channels": format.channelCount, "route": route, "category": session.category.rawValue, "mode": session.mode.rawValue]) }
  }

  // the Night, read from the audio queue (set once at start; the class is not Sendable)
  nonisolated(unsafe) private var nightForQueue: Night?

  private func everySecond() {
    guard let n = night else { return }
    let now = Self.nowMs
    let (lvl, silent): (Double?, Bool) = queue.sync { n.tick(at: now); let v = n.db.last ?? .nan; return (n.hearing && v.isFinite ? v : nil, n.silent) }
    level = lvl
    // the card follows the microphone at once
    if !silent != wasHearing { wasHearing = !silent; live.update(hearing: wasHearing) }
    // nothing arriving for 10 s: restart the audio, at most once a minute, logged (not while the
    // alarm rings: it has the sound then)
    if silent && alarm.phase != .ringing && now - lastRestart > 60_000 {
      lastRestart = now; restarts += 1
      engine.stop()
      do { try startAudio(reason: "silent") } catch { queue.async { n.log("restart-failed", ["error": "\(error)"]) } }
    }
    if now - lastBeat >= 60_000 { lastBeat = now; minute(now); live.update(hearing: wasHearing) }
    // every 10 s in the smart window: the sleeper stirring brings the alarm forward to now. Only while
    // it waits: rung, snoozed or not set, it is left as it is
    if let p = plan, smart, !rangEarly, alarm.phase == .set, now - lastCheck >= 10_000 {
      lastCheck = now
      let date = Date()
      if p.ringsEarly(at: date, smart: smart, isStirring: { [queue] in queue.sync { Analysis.stirring(Readings(n)) } }) {
        rangEarly = true
        let early = max(1, Int(p.at.timeIntervalSince(date) / 60))
        ringingEarly = early
        queue.async { n.log("wake", ["early": early], at: now) }
        // not moved (AlarmKit refused): the wake-time alarm stays, and the next check tries again
        Task { if await !alarm.ringNow() { rangEarly = false; ringingEarly = 0 } }
      }
    }
  }

  /// AlarmKit's alarm changed: ringing (the night card makes way for the alarm's own), snoozed, or
  /// stopped, on the lock screen or here: then the night is over.
  private func alarmChanged(from: AlarmPhase, to: AlarmPhase) {
    if to == .ringing { live.end() }
    if from == .ringing && to == .snoozed { logNow("snooze", [:]) }
    if tally.step(from: from, to: to, early: rangEarly ? ringingEarly : 0), night != nil { stop() }
  }

  private func minute(_ now: Int64) {
    guard let n = night else { return }
    let s = AVAudioSession.sharedInstance(), d = UIDevice.current, app = UIApplication.shared
    let extra: [String: Any] = [
      "engine": engine.isRunning, "restarts": restarts,
      "app": app.applicationState == .active ? "active" : app.applicationState == .background ? "background" : "inactive",
      "locked": !app.isProtectedDataAvailable,
      "category": s.category.rawValue, "otherAudio": s.isOtherAudioPlaying,
      "route": s.currentRoute.inputs.map(\.portType.rawValue),
      "battery": d.batteryLevel, "charging": d.batteryState == .charging || d.batteryState == .full,
      "thermal": ["nominal", "fair", "serious", "critical"][ProcessInfo.processInfo.thermalState.rawValue],
      "lowPower": ProcessInfo.processInfo.isLowPowerModeEnabled
    ]
    queue.sync { n.heartbeat(at: now, extra: extra) }
    save(final: false)
  }

  private func save(final: Bool) {
    guard let n = night else { return }
    let data = queue.sync { try? n.json(final: final) }
    guard let data else { return }
    // one file per start, so a second start the same night does not overwrite the first
    try? data.write(to: fileURL(n), options: .atomic)
    saved = Date()
  }

  /// Settings › Alarm test: the system alarm (the one that rings at night) in 20 s, to hear its rise
  /// with the phone locked. Says where it stands; Stop ends it, and Snooze too (the test alarm is
  /// cancelled then, not left to ring again in 9 minutes). Not during a night; a night started while
  /// it runs ends it, and the test then leaves the alarm alone: it is tonight's.
  @Published private(set) var alarmTest = AlarmTest.idle
  func startAlarmTest() {
    guard night == nil, !alarmTest.busy else { return }
    alarmTest = .waiting(20)
    Task { @MainActor in
      // a night started meanwhile has replaced the test's alarm with its own: hands off
      var mine: Bool { night == nil && alarmTest != .idle }
      let at = Date().addingTimeInterval(20)
      guard await alarm.ask() else { alarmTest = .denied; return }
      await alarm.set(at: at)
      guard mine else { return }
      if let why = alarm.lastError { alarmTest = .failed(why); return }
      while mine, at.timeIntervalSinceNow > 0 { alarmTest = .waiting(max(1, Int(at.timeIntervalSinceNow.rounded(.up)))); try? await Task.sleep(for: .milliseconds(500)) }
      // it should be ringing within a few seconds of its time
      for _ in 0..<20 where mine && alarm.phase != .ringing { try? await Task.sleep(for: .milliseconds(500)) }
      guard mine else { return }
      guard alarm.phase == .ringing else { alarm.cancel(); alarmTest = .failed("the system did not ring it"); return }
      alarmTest = .ringing
      while mine, alarm.phase == .ringing { try? await Task.sleep(for: .milliseconds(500)) }
      guard mine else { return }
      alarm.cancel()   // snoozed: no second ring in 9 minutes
      alarmTest = .heard
    }
  }

  /// Stop and Snooze on the alarm screen: the system alarm's own (Stop ends the night, alarmChanged).
  func stopAlarm() { alarm.stop() }
  func snoozeAlarm() { alarm.snooze() }

  private func fileURL(_ n: Night) -> URL { Self.documents.appendingPathComponent("\(n.night)_\(n.start).json") }

  // MARK: what iOS does to the night

  private func watch() {
    let c = NotificationCenter.default
    func on(_ name: Notification.Name, _ f: @escaping @MainActor (Notification) -> Void) {
      observers.append(c.addObserver(forName: name, object: nil, queue: .main) { note in MainActor.assumeIsolated { f(note) } })
    }
    func log(_ type: String, _ data: [String: Any] = [:]) { if let n = night { queue.async { n.log(type, data, at: NightEngine.nowMs) } } }

    on(AVAudioSession.interruptionNotification) { [weak self] note in
      let info = note.userInfo ?? [:]
      let began = (info[AVAudioSessionInterruptionTypeKey] as? UInt) == AVAudioSession.InterruptionType.began.rawValue
      log(began ? "interruption-began" : "interruption-ended", [
        "reason": (info[AVAudioSessionInterruptionReasonKey] as? UInt).map { Int($0) } ?? -1,
        "resume": ((info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0) & AVAudioSession.InterruptionOptions.shouldResume.rawValue) != 0
      ])
      if !began { do { try self?.startAudio(reason: "interruption-ended") } catch { log("restart-failed", ["error": "\(error)"]) } }
    }
    on(AVAudioSession.routeChangeNotification) { note in
      log("route", ["reason": note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0, "inputs": AVAudioSession.sharedInstance().currentRoute.inputs.map(\.portType.rawValue)])
    }
    on(AVAudioSession.mediaServicesWereResetNotification) { [weak self] _ in
      log("media-reset")
      do { try self?.startAudio(reason: "media-reset") } catch { log("restart-failed", ["error": "\(error)"]) }
    }
    on(.AVAudioEngineConfigurationChange) { [weak self] _ in
      log("engine-config")
      do { try self?.startAudio(reason: "engine-config") } catch { log("restart-failed", ["error": "\(error)"]) }
    }
    on(UIApplication.didEnterBackgroundNotification) { _ in log("background") }
    on(UIApplication.willEnterForegroundNotification) { _ in log("foreground") }
    on(UIApplication.protectedDataWillBecomeUnavailableNotification) { _ in log("locked") }
    on(UIApplication.protectedDataDidBecomeAvailableNotification) { _ in log("unlocked") }
    on(UIApplication.didReceiveMemoryWarningNotification) { _ in log("memory-warning") }
    on(ProcessInfo.thermalStateDidChangeNotification) { _ in log("thermal", ["state": ProcessInfo.processInfo.thermalState.rawValue]) }
  }
}
