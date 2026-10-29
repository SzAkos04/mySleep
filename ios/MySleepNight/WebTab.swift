import SwiftUI
import WebKit

/// The Journal and Trends tabs: the server's web app inside the app, signed in through a one-time
/// code (no passkey in an app), its own tab bar and Sleep button left out (?embed=1).
struct WebTab: View {
  let page: WebPage
  @EnvironmentObject var server: ServerLink
  @EnvironmentObject var nav: Navigation
  @State private var url: URL?
  @State private var failed = false
  @State private var loading = true

  var body: some View {
    ZStack {
      Theme.bg.ignoresSafeArea()
      if server.pairing == nil {
        Message(icon: "link", title: "Pair with your server first",
                text: "Open mySleep on the web once (Safari is fine), then Settings › Pair mySleep Night. Your nights will show here.")
      } else if failed {
        Message(icon: "icloud.slash", title: "Your server is not answering",
                text: "Is Tailscale on? Your nights are kept on this phone and go up when it answers.") { Task { await load() } }
      } else if let url {
        WebView(url: url, loading: $loading).ignoresSafeArea(edges: .top)
        if loading { ProgressView().tint(Theme.text2) }
      } else {
        ProgressView().tint(Theme.text2)
      }
    }
    .task(id: page) { await load() }
    .task(id: server.pairing) { if url == nil { await load() } }
  }

  private func load() async {
    guard server.pairing != nil else { return }
    failed = false; loading = true
    if let u = await server.signedIn(page) { url = u } else { failed = true }
  }
}

private struct Message: View {
  let icon: String, title: String, text: String
  var retry: (() -> Void)? = nil
  var body: some View {
    VStack(spacing: 12) {
      Image(systemName: icon).font(.system(size: 34, weight: .light)).foregroundStyle(Theme.text2)
      Text(title).font(.title3.weight(.semibold))
      Text(text).font(.subheadline).foregroundStyle(Theme.text2).multilineTextAlignment(.center)
      if let retry { Button("Try again", action: retry).buttonStyle(.bordered).padding(.top, 6) }
    }
    .padding(32)
  }
}

/// A WKWebView on the app's dark ground; links to other sites open in Safari.
private struct WebView: UIViewRepresentable {
  let url: URL
  @Binding var loading: Bool

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  func makeUIView(context: Context) -> WKWebView {
    let v = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
    v.isOpaque = false
    v.backgroundColor = UIColor(Theme.bg)
    v.scrollView.backgroundColor = UIColor(Theme.bg)
    v.allowsBackForwardNavigationGestures = true
    v.navigationDelegate = context.coordinator
    v.load(URLRequest(url: url))
    context.coordinator.loaded = url
    return v
  }

  func updateUIView(_ v: WKWebView, context: Context) {
    context.coordinator.parent = self
    if context.coordinator.loaded != url { context.coordinator.loaded = url; v.load(URLRequest(url: url)) }
  }

  final class Coordinator: NSObject, WKNavigationDelegate {
    var parent: WebView
    var loaded: URL?
    init(_ p: WebView) { parent = p }
    func webView(_ w: WKWebView, didFinish n: WKNavigation!) { parent.loading = false }
    func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { parent.loading = false }
    func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { parent.loading = false }
    // the server's own pages here; anything else (a link out) in Safari
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
      if let u = a.request.url, let host = u.host, host != parent.url.host, a.navigationType == .linkActivated {
        UIApplication.shared.open(u); return decisionHandler(.cancel)
      }
      decisionHandler(.allow)
    }
  }
}
