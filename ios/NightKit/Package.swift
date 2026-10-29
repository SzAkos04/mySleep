// swift-tools-version: 6.0
// The night's logic without the iPhone: readings from audio frames, a value per second, the log.
// `swift test` here runs on the Mac; the app (ios/MySleepNight) compiles these same sources.
import PackageDescription

let package = Package(
  name: "NightKit",
  platforms: [.iOS(.v17), .macOS(.v14)],
  products: [.library(name: "NightKit", targets: ["NightKit"])],
  targets: [
    .target(name: "NightKit"),
    .testTarget(name: "NightKitTests", dependencies: ["NightKit"])
  ]
)
