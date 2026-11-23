// Night tools on the Mac, running the app's own code (NightKit):
//   swift run --package-path ios/NightKit -c release night-tool analyse <night log.json>
//     the analysis run again on a log's readings (so a change to Analysis can be tried on a real night)
//   swift run --package-path ios/NightKit -c release night-tool replay <recording.wav> [--room -60]
//     a recording read the way the app reads the microphone (every 100 ms the last 2048 samples),
//     after a minute of room noise (dBFS), and every sound found in it with its traits: for tuning
//     Analysis on real recordings, e.g. `say -o x.wav --data-format=LEI16@48000 "…"`.
import AVFoundation
import Foundation
import NightKit

let args = CommandLine.arguments.dropFirst()
func fail(_ s: String) -> Never { FileHandle.standardError.write(Data((s + "\n").utf8)); exit(1) }
guard let cmd = args.first, let file = args.dropFirst().first else { fail("usage: night-tool analyse <log.json> | replay <file.wav> [--room -60]") }
func clock(_ ms: Double) -> String {
  let c = Calendar.current.dateComponents([.hour, .minute, .second], from: Date(timeIntervalSince1970: ms / 1000))
  return String(format: "%02d:%02d:%02d", c.hour ?? 0, c.minute ?? 0, c.second ?? 0)
}

switch cmd {
case "analyse":
  guard let data = FileManager.default.contents(atPath: file) else { fail("cannot read \(file)") }
  let log: NightLog
  do { log = try JSONDecoder().decode(NightLog.self, from: data) } catch { fail("not a night log with readings: \(error)") }
  let n = NightRecord(log: log)
  print("analysis run again on the readings")
  print("  on: \(n.on.map(clock) ?? "none")  asleepMin: \(n.asleepMin ?? 0)  restfulMin: \(n.restfulMin ?? 0)  wakes: \(n.wakes ?? 0)  awakeMin: \(n.awakeMin ?? 0)  snoreMin: \(n.snoreMin ?? 0)  talks: \(n.talks ?? 0)  coughs: \(n.coughs ?? 0)")
  let states = Array(n.timeline?.states ?? "")
  let tens = stride(from: 0, to: states.count, by: 20).map { i in
    var seen: [Character] = []
    for c in states[i..<min(states.count, i + 20)] where !seen.contains(c) { seen.append(c) }
    return String(seen)
  }
  print("  states per 10 min:", tens.joined(separator: " "))
  let ev = n.events ?? []
  print("  sounds: \(ev.count)", ev.prefix(30).map { "\($0.kind)@\(clock($0.t))/\(Int($0.sec))s" }.joined(separator: "  "))

case "replay":
  let room = args.firstIndex(of: "--room").flatMap { i in args.index(after: i) < args.endIndex ? Double(args[args.index(after: i)]) : nil } ?? -60
  let audio: AVAudioFile
  do { audio = try AVAudioFile(forReading: URL(fileURLWithPath: file)) } catch { fail("cannot read \(file): \(error)") }
  let format = audio.processingFormat, rate = format.sampleRate
  guard let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(audio.length)) else { fail("no buffer") }
  do { try audio.read(into: buf) } catch { fail("cannot read \(file): \(error)") }
  let ch = Int(format.channelCount), len = Int(buf.frameLength)
  let pcm = (0..<len).map { i in (0..<ch).reduce(Float(0)) { $0 + buf.floatChannelData![$1][i] } / Float(ch) }
  // a quiet minute of room before the recording, so there is a noise floor to stand out from
  let lead = Int(rate) * 60, amp = Float(pow(10, room / 20))
  let sig = (0..<(lead + pcm.count)).map { i in (i >= lead ? pcm[i - lead] : 0) + Float.random(in: -1...1) * amp }
  let night = Night(start: 0), hop = Int((rate / 10).rounded())
  for end in stride(from: 2048, through: sig.count, by: hop) {
    night.add(Array(sig[(end - 2048)..<end]), sampleRate: rate, at: Int64(Double(end) / rate * 1000))
  }
  night.tick(at: Int64(Double(sig.count) / rate * 1000) + 1000)
  let f = Readings(night, last: .max)
  print("start  len  kind   low   mid   spread  jump")
  for b in Analysis.sounds(f) {
    print(String(format: "%5d %4d  %@ %.2f  %.2f  %5.1f  %5.1f", b.start - 60, b.end - b.start, b.kind.name.padding(toLength: 6, withPad: " ", startingAt: 0), b.low, b.mid, b.vr, b.at))
  }
  let ev = Analysis.events(f, start: 0)
  print("\nevents:", ev.isEmpty ? "none" : ev.map { "\($0.kind)@\(Int($0.t / 1000) - 60)s/\(Int($0.sec))s" }.joined(separator: "  "))

default: fail("unknown command \(cmd)")
}
