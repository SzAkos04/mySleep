import Testing
import Foundation
@testable import NightKit

// mySleep Night and the server: the links the web app opens it with, its pairing, when its free
// signature runs out, and its uploads (api/server.js: PUT /api/debug/<night>, /api/devices/status).

@Suite struct Links {
  @Test func pairCarriesTheServerAndTheToken() {
    let link = AppLink.parse(URL(string: "mysleepnight://pair?server=https%3A%2F%2Fhost.ts.net%3A8443&token=abcdefghijklmnopqrstuvwxyz012345")!)
    #expect(link == .pair(Pairing(server: URL(string: "https://host.ts.net:8443")!, token: "abcdefghijklmnopqrstuvwxyz012345")))
  }

  @Test func sleepCarriesTonightsAlarm() {
    #expect(AppLink.parse(URL(string: "mysleepnight://sleep?alarm=1&smart=0&wake=07%3A10")!) == .sleep(AlarmSettings(on: true, smart: false, hour: 7, minute: 10)))
    #expect(AppLink.parse(URL(string: "mysleepnight://sleep")!) == .sleep(nil))   // the app's own settings then
  }

  @Test func anythingElseIsIgnored() {
    #expect(AppLink.parse(URL(string: "mysleepnight://pair?server=ftp%3A%2F%2Fx&token=abcdefghijklmnopqrstuvwxyz012345")!) == nil)
    #expect(AppLink.parse(URL(string: "mysleepnight://pair?server=https%3A%2F%2Fx&token=short")!) == nil)
    #expect(AppLink.parse(URL(string: "mysleepnight://sleep?wake=25%3A99")!) == .sleep(nil))
    #expect(AppLink.parse(URL(string: "https://example.com/sleep")!) == nil)
    #expect(AppLink.parse(URL(string: "mysleepnight://elsewhere")!) == nil)
  }
}

@Suite struct Signature {
  // an embedded.mobileprovision is a signed envelope around a property list
  func profile(expires: String) -> Data {
    var d = Data([0x30, 0x82, 0x0f, 0x12, 0x06, 0x09])
    d.append("""
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0"><dict><key>Name</key><string>iOS Team Provisioning Profile</string>
    <key>ExpirationDate</key><date>\(expires)</date></dict></plist>
    """.data(using: .utf8)!)
    d.append(Data([0xa0, 0x82, 0x0c, 0x00]))
    return d
  }

  @Test func readsWhenTheAppStops() {
    #expect(Provisioning.expiry(of: profile(expires: "2026-11-05T12:46:13Z")) == ISO8601DateFormatter().date(from: "2026-11-05T12:46:13Z"))
  }

  @Test func noProfileNoDate() {
    #expect(Provisioning.expiry(of: Data("not a profile".utf8)) == nil)
    #expect(Provisioning.expiry(of: Data()) == nil)
  }
}

@Suite struct Requests {
  let pairing = Pairing(server: URL(string: "https://host.ts.net:8443")!, token: "abcdefghijklmnopqrstuvwxyz012345")

  @Test func aNightGoesUpWithTheDeviceToken() throws {
    let r = ServerAPI.upload(pairing, night: "2026-10-29", body: Data("{}".utf8))
    #expect(r.url?.absoluteString == "https://host.ts.net:8443/api/debug/2026-10-29")
    #expect(r.httpMethod == "PUT")
    #expect(r.value(forHTTPHeaderField: "Authorization") == "Bearer abcdefghijklmnopqrstuvwxyz012345")
    #expect(r.value(forHTTPHeaderField: "Content-Type") == "application/json")
    #expect(r.httpBody == Data("{}".utf8))
  }

  @Test func theStatusSaysWhenItStops() throws {
    let r = ServerAPI.status(pairing, expires: Date(timeIntervalSince1970: 1_793_900_000), build: "202610291200")
    #expect(r.url?.absoluteString == "https://host.ts.net:8443/api/devices/status")
    #expect(r.httpMethod == "POST")
    let body = try #require(try JSONSerialization.jsonObject(with: r.httpBody!) as? [String: Any])
    #expect(body["expires"] as? Int64 == 1_793_900_000_000)
    #expect(body["build"] as? String == "202610291200")
    let unknown = try #require(try JSONSerialization.jsonObject(with: ServerAPI.status(pairing, expires: nil, build: "x").httpBody!) as? [String: Any])
    #expect(unknown["expires"] is NSNull)
  }
}

@Suite struct Uploads {
  // the night logs in Documents; those the server took are remembered, the rest go next time
  @Test func sendsWhatTheServerHasNotTakenAndKeepsTheRestForLater() async {
    var sent: [String] = []
    var done: Set<String> = ["2026-10-27_1.json"]
    let files = ["2026-10-27_1.json", "2026-10-28_2.json", "2026-10-29_3.json", "notes.txt"]
    let ok = await Uploader.run(files: files, done: &done) { name in
      sent.append(name)
      return name.hasPrefix("2026-10-28") ? 200 : 503
    }
    #expect(sent == ["2026-10-28_2.json", "2026-10-29_3.json"])
    #expect(ok == 1)
    #expect(done == ["2026-10-27_1.json", "2026-10-28_2.json"])
  }

  @Test func aRefusalIsNotRetriedForeverButASignOutIs() async {
    var done: Set<String> = []
    _ = await Uploader.run(files: ["2026-10-28_2.json", "2026-10-29_3.json"], done: &done) { name in
      name.hasPrefix("2026-10-28") ? 400 : 401
    }
    #expect(done == ["2026-10-28_2.json"])   // 400: never going to work; 401: pair again, then it will
  }
}
