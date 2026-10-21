// Runs a page in WebKit — the engine Safari uses — for a bug that shows only in Safari, when Safari
// itself cannot be automated. Opens a phone-sized WKWebView window, sets a cookie (a session from
// api/scripts/dev-session.mjs), loads the URL, waits, then runs a JS file as an async function body
// and prints what it returns. The flow is yours to write: click, wait, read the DOM, return a string.
//
//   swift frontend/scripts/webkit-run.swift <url> <name=value cookie> <flow.js> [wait seconds, 4]
//
// Needs a window, so it runs outside a sandbox. It reports as Safari 26 on a Mac, like the real one.
//
// To pose as something else, set WEBKIT_UA (a user agent) and WEBKIT_PRELUDE (a JS file run before
// the page's own scripts). The installed iPhone app, for instance: an iPhone UA plus a prelude that
// sets navigator.standalone = true, which is how an iOS home-screen app is told apart.
import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count >= 4, let url = URL(string: args[1]), let host = url.host else {
  print("usage: swift webkit-run.swift <url> <name=value cookie> <flow.js> [wait seconds]"); exit(2)
}
let kv = args[2].split(separator: "=", maxSplits: 1).map(String.init)
let js = try! String(contentsOfFile: args[3], encoding: .utf8)
let wait = Double(args.count > 4 ? args[4] : "4") ?? 4

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let win = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 393, height: 852), styleMask: [.titled], backing: .buffered, defer: false)
let cfg = WKWebViewConfiguration()
let web = WKWebView(frame: win.contentView!.bounds, configuration: cfg)
let env = ProcessInfo.processInfo.environment
web.customUserAgent = env["WEBKIT_UA"] ?? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
if let pre = env["WEBKIT_PRELUDE"], let src = try? String(contentsOfFile: pre, encoding: .utf8) {
  cfg.userContentController.addUserScript(WKUserScript(source: src, injectionTime: .atDocumentStart, forMainFrameOnly: true))
}
win.contentView!.addSubview(web)
win.makeKeyAndOrderFront(nil)

let cookie = HTTPCookie(properties: [.name: kv[0], .value: kv.count > 1 ? kv[1] : "", .domain: host, .path: "/"])!
cfg.websiteDataStore.httpCookieStore.setCookie(cookie) {
  web.load(URLRequest(url: url))
  DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
    web.callAsyncJavaScript(js, arguments: [:], in: nil, in: .page) { r in
      switch r {
      case .success(let v): print(v ?? "nil")
      case .failure(let e): print("JS error:", e)
      }
      exit(0)
    }
  }
}
// A flow that walks a whole menu takes a minute or two; past this it is stuck, not slow.
DispatchQueue.main.asyncAfter(deadline: .now() + 300) { print("timed out"); exit(1) }
app.run()
