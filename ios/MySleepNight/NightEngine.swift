import AVFoundation
import UIKit

/// The microphone all night, with the phone locked: an audio session for recording, kept alive by
/// the `audio` background mode, an engine whose input is read in frames into a `Night` (NightKit).
/// Everything iOS does to it is logged: interruptions, route changes, media services resets, the
/// screen locking, the app going to the background, battery and heat, once a minute a heartbeat.
/// The log is saved every minute to Documents/<night>.json, in the web app's format.
@MainActor final class NightEngine: ObservableObject {
  @Published private(set) var night: Night?
  @Published private(set) var level: Double?       // the last second's loudness, nil = nothing heard
  @Published private(set) var saved: Date?
  @Published private(set) var plan: AlarmPlan?     // tonight's alarm, nil = none
  @Published private(set) var lastNight: (file: URL, minutes: Int, heard: Int)?   // the night just finished

  let alarm = AlarmController()
  @Published private(set) var selfRinging = false   // no system alarm: the app rings itself
  private var smart = false, rangEarly = false, lastCheck: Int64 = 0
  private var player: AVAudioPlayer?, ramp: Timer?, ringStart = Date()
  // the web app's analysis.js, copied into the app when it is built: the smart alarm's judge
  private let analysis: Analysis? = Bundle.main.url(forResource: "analysis", withExtension: "js")
    .flatMap { try? String(contentsOf: $0, encoding: .utf8) }.flatMap { try? Analysis(source: $0) }

  init() {
    alarm.log = { [weak self] type, data in self?.logNow(type, data) }
    // Stop on the lock screen ends the night: nothing to do on waking but get up
    alarm.onStopped = { [weak self] in self?.stop() }
  }

  private func logNow(_ type: String, _ data: [String: Any]) {
    guard let n = night else { return }
    queue.async { n.log(type, data, at: NightEngine.nowMs) }
  }

  private let engine = AVAudioEngine()
  private let queue = DispatchQueue(label: "night")   // every Night call runs here
  private var timer: Timer?, observers: [NSObjectProtocol] = [], restarts = 0, lastRestart: Int64 = 0, lastBeat: Int64 = 0

  static let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
  static var nowMs: Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

  // The evening's date, as the web app names nights (lib/time.js nightIdOf: before noon is the night before).
  static func nightId(_ ms: Int64) -> String {
    let d = Date(timeIntervalSince1970: Double(ms) / 1000 - 12 * 3600)
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = .current
    return f.string(from: d)
  }

  func start(_ settings: AlarmSettings) async throws {
    guard await AVAudioApplication.requestRecordPermission() else { throw NSError(domain: "mySleep", code: 1, userInfo: [NSLocalizedDescriptionKey: "mySleep Night needs the microphone: allow it in Settings."]) }
    let start = Self.nowMs, device = UIDevice.current
    device.isBatteryMonitoringEnabled = true
    let n = Night(start: start, night: Self.nightId(start), env: [
      "app": "native", "build": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "?",
      "system": "\(device.systemName) \(device.systemVersion)", "model": device.model
    ])
    night = n; nightForQueue = n; lastBeat = start
    n.log("start", ["battery": device.batteryLevel, "charging": device.batteryState == .charging || device.batteryState == .full])
    try startAudio(reason: "start")
    watch()
    smart = settings.smart; rangEarly = false
    plan = AlarmPlan.make(settings, from: Date())
    if let p = plan {
      n.log("night", ["ringFrom": Int64(p.from.timeIntervalSince1970 * 1000), "ringAt": Int64(p.at.timeIntervalSince1970 * 1000), "smart": smart, "analysis": analysis != nil])
      await alarm.set(at: p.at)
    }
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
    silence()
    queue.sync { n.tick(at: Self.nowMs); n.log("finish") }
    save(final: true)
    let heard = queue.sync { n.db.filter { !$0.isNaN }.count }
    lastNight = (fileURL(n), n.db.count / 60, heard / 60)
    night = nil; nightForQueue = nil; level = nil; plan = nil
  }

  // MARK: audio

  private func startAudio(reason: String) throws {
    let session = AVAudioSession.sharedInstance()
    // .measurement: no automatic gain or noise suppression, as the web app asks for
    try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .mixWithOthers])
    try session.setActive(true)
    let input = engine.inputNode, format = input.outputFormat(forBus: 0), rate = format.sampleRate
    input.removeTap(onBus: 0)
    input.installTap(onBus: 0, bufferSize: 4800, format: format) { [queue, weak self] buffer, _ in
      guard let ch = buffer.floatChannelData?[0] else { return }
      let n = Int(buffer.frameLength), take = min(n, 2048)
      // the last 2048 samples, as the web app's analyser looks at its last 2048
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
    // nothing arriving for 10 s: restart the audio, at most once a minute, logged
    if silent && now - lastRestart > 60_000 {
      lastRestart = now; restarts += 1
      engine.stop()
      do { try startAudio(reason: "silent") } catch { queue.async { n.log("restart-failed", ["error": "\(error)"]) } }
    }
    if now - lastBeat >= 60_000 { lastBeat = now; minute(now) }
    // every 10 s: the wake time, or the smart window once the sleeper stirs
    if let p = plan, !rangEarly, !selfRinging, now - lastCheck >= 10_000 {
      lastCheck = now
      let date = Date(), early = max(0, Int(p.at.timeIntervalSince(date) / 60))
      if p.shouldRing(at: date, smart: smart, isStirring: { [queue, analysis] in queue.sync { analysis?.stirring(n) ?? false } }) {
        if alarm.phase == .set {
          // the system alarm rings by itself at the wake time; earlier, it is brought forward
          if date < p.at { rangEarly = true; queue.async { n.log("wake", ["early": early], at: now) }; Task { await alarm.ringNow() } }
        } else if alarm.phase == .none {
          ringItself(early: early)
        }
      }
    }
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

  // MARK: ringing without the system alarm (Alarms off for the app): the piano through the audio
  // session kept all night, rising as in the web app. It can only be stopped here, in the app.

  private func ringItself(early: Int) {
    guard let url = Bundle.main.url(forResource: "alarm-piano", withExtension: "wav"), let p = try? AVAudioPlayer(contentsOf: url) else {
      logNow("ring-failed", ["reason": "no piano"]); return
    }
    p.numberOfLoops = -1
    p.volume = Float(RiseCurve.gain(at: 0))
    p.play()
    player = p; selfRinging = true; ringStart = Date()
    ramp = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
      Task { @MainActor in guard let self, let p = self.player else { return }; p.volume = Float(RiseCurve.gain(at: Date().timeIntervalSince(self.ringStart))) }
    }
    logNow("ring", ["self": true, "early": early])
  }

  private func silence() {
    ramp?.invalidate(); ramp = nil
    player?.stop(); player = nil
    selfRinging = false
  }

  /// Stop, from the alarm screen: the night is over.
  func stopAlarm() {
    if selfRinging { silence(); logNow("silence", [:]); stop() } else { alarm.stop() }
  }

  func snoozeAlarm() {
    guard selfRinging else { return alarm.snooze() }
    silence()
    let at = Date().addingTimeInterval(Double(AlarmPlan.snoozeMinutes) * 60)
    plan = AlarmPlan(from: at, at: at); smart = false; lastCheck = 0
    logNow("snooze", [:])
  }

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
