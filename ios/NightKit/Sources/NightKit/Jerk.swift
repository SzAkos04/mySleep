/// The accelerometer's readings (in g) as the step between each one and the one before: the phone on
/// the bed feels the sleeper move. Still, it reads zero whatever way it lies.
public struct Jerk {
  private var last: (Double, Double, Double)?
  public init() {}

  /// nil for the first reading since the start (or `reset`).
  public mutating func step(_ x: Double, _ y: Double, _ z: Double) -> Double? {
    defer { last = (x, y, z) }
    guard let l = last else { return nil }
    return ((x - l.0) * (x - l.0) + (y - l.1) * (y - l.1) + (z - l.2) * (z - l.2)).squareRoot()
  }

  public mutating func reset() { last = nil }
}
