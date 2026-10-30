import Testing
import Foundation
@testable import NightKit

// mySleep Night and the server: the links that open it, its pairing, when its free
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

@Suite struct SyncRequest {
  @Test func isAPostToTheSyncRouteWithTheDeviceToken() {
    let p = Pairing(server: URL(string: "https://host.example:8443/")!, token: "t".padding(toLength: 40, withPad: "t", startingAt: 0))
    let r = ServerAPI.sync(p, body: Data(#"{"since":0,"changes":[]}"#.utf8))
    #expect(r.httpMethod == "POST")
    #expect(r.url?.absoluteString == "https://host.example:8443/api/sync")
    #expect(r.value(forHTTPHeaderField: "Authorization") == "Bearer " + p.token)
    #expect(r.httpBody == Data(#"{"since":0,"changes":[]}"#.utf8))
  }
}

@Suite struct Uploads {
  // the night logs in Documents, each with its version (when it was last written); the versions the
  // server took are remembered, the rest go next time
  @Test func sendsWhatTheServerHasNotTakenAndKeepsTheRestForLater() async {
    var sent: [String] = []
    var done: Set<String> = ["2026-10-27_1.json@5"]
    let files = [("2026-10-27_1.json", "5"), ("2026-10-28_2.json", "6"), ("2026-10-29_3.json", "7"), ("notes.txt", "8")]
    let ok = await Uploader.run(files: files, done: &done) { name in
      sent.append(name)
      return name.hasPrefix("2026-10-28") ? 200 : 503
    }
    #expect(sent == ["2026-10-28_2.json", "2026-10-29_3.json"])
    #expect(ok == 1)
    #expect(done == ["2026-10-27_1.json@5", "2026-10-28_2.json@6"])
  }

  @Test func aRefusalIsNotRetriedForeverButASignOutIs() async {
    var done: Set<String> = []
    _ = await Uploader.run(files: [("2026-10-28_2.json", "1"), ("2026-10-29_3.json", "1")], done: &done) { name in
      name.hasPrefix("2026-10-28") ? 400 : 401
    }
    #expect(done == ["2026-10-28_2.json@1"])   // 400: never going to work; 401: pair again, then it will
  }

  @Test func aLogWrittenAgainGoesUpAgain() async {
    // the night is saved every minute under one name: opening the app in the night sends a partial
    // log; the finished one, under the same name, must still go up in the morning
    var done: Set<String> = [], sent: [String] = []
    for version in ["100", "100", "160"] {
      _ = await Uploader.run(files: [("2026-10-29_1.json", version)], done: &done) { sent.append($0); return 200 }
    }
    #expect(sent == ["2026-10-29_1.json", "2026-10-29_1.json"])
    #expect(done == ["2026-10-29_1.json@160"])   // old versions forgotten: the list does not grow
  }

  @Test func oldLogsTheServerHasAreDeletedTheRestKept() {
    // about 1 MB a night: kept a month on the phone, and never one the server has not taken
    let now = Date(timeIntervalSince1970: 100 * 86400), day = 86400.0
    let files = [
      (name: "a.json", version: "1", modified: now.addingTimeInterval(-40 * day)),   // up, old: goes
      (name: "b.json", version: "1", modified: now.addingTimeInterval(-40 * day)),   // never went up: stays
      (name: "c.json", version: "1", modified: now.addingTimeInterval(-3 * day)),    // up, recent: stays
      (name: "d.json", version: "2", modified: now.addingTimeInterval(-40 * day))    // an older version went up: stays
    ]
    #expect(Uploader.old(files: files, done: ["a.json@1", "c.json@1", "d.json@1"], now: now) == ["a.json"])
  }
}
