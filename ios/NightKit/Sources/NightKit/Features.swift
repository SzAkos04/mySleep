import Accelerate
import Foundation

/// One look at the microphone:
/// loudness on the tracker's scale (dBFS + 100) and the share of power under 500 Hz and between
/// 500 and 3000 Hz, counted over 50–4000 Hz with a Blackman window.
public struct Reading: Equatable, Sendable {
  public let db: Double
  public let low: Double
  public let mid: Double
}

public enum Features {
  /// nil for exact digital silence: a real room never is, so nothing reached the microphone.
  public static func read(_ frame: [Float], sampleRate: Double) -> Reading? {
    let n = frame.count
    var sum: Float = 0
    vDSP_svesq(frame, 1, &sum, vDSP_Length(n))
    guard sum > 0, n >= 64, n & (n - 1) == 0 else { return nil }
    let db = 20 * log10(Double((sum / Float(n)).squareRoot())) + 100

    let window = vDSP.window(ofType: Float.self, usingSequence: .blackman, count: n, isHalfWindow: false)
    let windowed = vDSP.multiply(frame, window)
    let half = n / 2
    var re = [Float](repeating: 0, count: half), im = [Float](repeating: 0, count: half)
    guard let fft = vDSP.FFT(log2n: vDSP_Length(log2(Double(n))), radix: .radix2, ofType: DSPSplitComplex.self) else { return nil }
    re.withUnsafeMutableBufferPointer { rp in
      im.withUnsafeMutableBufferPointer { ip in
        var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
        windowed.withUnsafeBufferPointer { wp in
          wp.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: half) { vDSP_ctoz($0, 2, &split, 1, vDSP_Length(half)) }
        }
        fft.forward(input: split, output: &split)
      }
    }
    let hz = sampleRate / Double(n)
    var lo = 0.0, mid = 0.0, all = 0.0
    for i in Int((50 / hz).rounded(.up))..<min(half, Int(4000 / hz)) {
      let p = Double(re[i] * re[i] + im[i] * im[i]), f = Double(i) * hz
      all += p
      if f < 500 { lo += p } else if f < 3000 { mid += p }
    }
    return Reading(db: db, low: all > 0 ? lo / all : 0, mid: all > 0 ? mid / all : 0)
  }
}
