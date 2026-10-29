import Foundation
import JavaScriptCore

/// The web app's sound analysis (frontend/src/lib/analysis.js), run as it is by JavaScriptCore, so
/// both apps judge a night the same way and its tests cover both. The file has no imports; its
/// `export`s are dropped to run it as a plain script.
public final class Analysis {
  public struct Failure: Error, CustomStringConvertible { public let description: String }
  private let ctx: JSContext
  private let stir: JSValue

  public init(source: String) throws {
    guard let ctx = JSContext() else { throw Failure(description: "no JavaScript context") }
    var thrown: String?
    ctx.exceptionHandler = { _, e in thrown = e?.toString() }
    ctx.evaluateScript(source.replacingOccurrences(of: "export ", with: ""))
    if let thrown { throw Failure(description: "analysis.js: \(thrown)") }
    guard let stir = ctx.objectForKeyedSubscript("stirring"), stir.isObject else { throw Failure(description: "analysis.js has no stirring()") }
    self.ctx = ctx; self.stir = stir
  }

  /// Is the sleeper moving now? (the smart alarm). analysis.js looks at the last 11 minutes; only
  /// those cross into JavaScript, so it stays cheap every few seconds.
  public func stirring(_ n: Night) -> Bool {
    let k = 660
    let f: [String: [Double]] = ["db": Array(n.db.suffix(k)), "low": Array(n.low.suffix(k)), "mid": Array(n.mid.suffix(k)), "vr": Array(n.vr.suffix(k)), "at": Array(n.at.suffix(k))]
    return stir.call(withArguments: [f])?.toBool() ?? false
  }
}
