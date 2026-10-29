import Foundation
import JavaScriptCore

/// The web app's night rules (frontend/src/lib/rules.js: analysis, record, score, sentences,
/// statistics, times), bundled into one script (ios/MySleepNight/rules.js) and run as they are by
/// JavaScriptCore, so both apps judge a night the same way and the web app's tests cover both.
/// The script defines `MySleepRules`.
public final class Rules {
  public struct Failure: Error, CustomStringConvertible { public let description: String }
  private let ctx: JSContext
  private let stir: JSValue

  public init(source: String) throws {
    guard let ctx = JSContext() else { throw Failure(description: "no JavaScript context") }
    ctx.evaluateScript(source)
    if let e = ctx.exception { throw Failure(description: "rules.js: \(e.toString() ?? "error")") }
    guard let stir = ctx.objectForKeyedSubscript("MySleepRules")?.objectForKeyedSubscript("stirring"), stir.isObject else { throw Failure(description: "rules.js has no stirring()") }
    self.ctx = ctx; self.stir = stir
  }

  /// Runs a script after the bundle; its value as text (a string as it is, anything else as JSON),
  /// nil for nothing. An exception in it is thrown.
  @discardableResult
  public func evaluate(_ script: String) throws -> String? {
    ctx.exception = nil
    let v = ctx.evaluateScript(script)
    if let e = ctx.exception { ctx.exception = nil; throw Failure(description: e.toString() ?? "error") }
    guard let v, !v.isUndefined, !v.isNull else { return nil }
    if v.isString { return v.toString() }
    return ctx.objectForKeyedSubscript("JSON")?.invokeMethod("stringify", withArguments: [v])?.toString()
  }

  /// Is the sleeper moving now? (the smart alarm). The rules look at the last 11 minutes; only
  /// those cross into JavaScript, so it stays cheap every few seconds.
  public func stirring(_ n: Night) -> Bool {
    let k = 660
    let f: [String: [Double]] = ["db": Array(n.db.suffix(k)), "low": Array(n.low.suffix(k)), "mid": Array(n.mid.suffix(k)), "vr": Array(n.vr.suffix(k)), "at": Array(n.at.suffix(k))]
    return stir.call(withArguments: [f])?.toBool() ?? false
  }
}
