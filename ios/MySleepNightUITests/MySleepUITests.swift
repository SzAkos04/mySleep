import XCTest

/// The real app, tapped through in demo mode (MYSLEEP_DEMO=1: a month of made-up nights, nothing read
/// from or written to the phone, no server, animations off). What unit tests cannot see: a screen that
/// does not open, a button that does nothing, text that cannot be read. The microphone, the alarm and
/// the lock screen are not here: they run only on an iPhone.
final class MySleepUITests: XCTestCase {
  var app: XCUIApplication!

  override func setUp() {
    continueAfterFailure = false
    app = XCUIApplication()
    app.launchEnvironment["MYSLEEP_DEMO"] = "1"
    app.launch()
  }

  func tab(_ name: String) { app.tabBars.buttons[name].firstMatch.tap() }
  /// XCTest's waits look once a second: look at once first.
  func shows(_ e: XCUIElement, timeout: TimeInterval = 5) -> Bool { e.exists || e.waitForExistence(timeout: timeout) }

  func testEveryTabOpens() {
    XCTAssertTrue(shows(app.staticTexts["Tonight"]))
    XCTAssertTrue(app.buttons["Sleep"].exists)
    tab("Journal")
    XCTAssertTrue(shows(app.buttons["nightCard"]))
    tab("Trends")
    XCTAssertTrue(shows(app.staticTexts["THIS WEEK"]) || shows(app.staticTexts["This week"]))
    tab("Settings")
    XCTAssertTrue(shows(app.staticTexts["Settings"]))
  }

  func testTheJournalOpensANightsReportAndGoesBack() {
    tab("Journal")
    XCTAssertTrue(shows(app.buttons["nightCard"]))
    app.buttons["nightCard"].tap()
    XCTAssertTrue(shows(app.buttons["How the score adds up"]))
    XCTAssertTrue(app.staticTexts["An okay night"].exists || app.staticTexts["A good night"].exists || app.staticTexts["A great night"].exists || app.staticTexts["A rough night"].exists)
    app.navigationBars.buttons.element(boundBy: 0).tap()
    XCTAssertTrue(shows(app.buttons["nightCard"]))
  }

  /// Deleting a night asks first, in the middle of the screen (24 November: the question was tied to
  /// the whole page and showed up in an odd place); Cancel leaves the night be.
  func testDeletingANightAsksInTheMiddleOfTheScreen() {
    tab("Journal")
    XCTAssertTrue(shows(app.buttons["nightCard"]))
    app.buttons["nightCard"].tap()
    XCTAssertTrue(shows(app.buttons["More"]))
    app.buttons["More"].tap()
    XCTAssertTrue(shows(app.buttons["Delete night"]))
    app.buttons["Delete night"].tap()
    let ask = app.alerts.firstMatch
    XCTAssertTrue(shows(ask))
    XCTAssertTrue(ask.buttons["Delete"].exists && ask.buttons["Cancel"].exists)
    let screen = app.windows.firstMatch.frame
    XCTAssertEqual(ask.frame.midX, screen.midX, accuracy: 20)
    XCTAssertEqual(ask.frame.midY, screen.midY, accuracy: screen.height / 6)
    ask.buttons["Cancel"].tap()
    XCTAssertFalse(ask.exists)
    XCTAssertTrue(app.buttons["How the score adds up"].exists)
  }

  func testTheJournalGoesBackAMonthAndForward() {
    tab("Journal")
    XCTAssertTrue(shows(app.buttons["Previous month"]))
    let next = app.buttons["Next month"]
    XCTAssertFalse(next.isEnabled)   // this month: nothing ahead
    app.buttons["Previous month"].tap()
    XCTAssertTrue(next.isEnabled)
    next.tap()
    XCTAssertFalse(next.isEnabled)
  }

  func testTrendsForAWeekAMonthAndAYear() {
    tab("Trends")
    for (period, title) in [("Month", "THIS MONTH"), ("Year", "THIS YEAR"), ("Week", "THIS WEEK")] {
      app.buttons[period].tap()
      XCTAssertTrue(shows(app.staticTexts[title]) || shows(app.staticTexts[title.capitalized]), period)
    }
  }

  /// Text must stand out from its background on every main screen, with the phone in light and in
  /// dark mode (iOS's own contrast audit).
  func testContrastInLightAndDarkMode() throws {
    let before = XCUIDevice.shared.appearance   // the Simulator as it was, for the tests after this one
    addTeardownBlock { XCUIDevice.shared.appearance = before == .unspecified ? .light : before }
    for appearance in [XCUIDevice.Appearance.light, .dark] {
      XCUIDevice.shared.appearance = appearance
      // each screen audited once it has shown its content, not while it loads
      for (name, loaded) in [("Tonight", app.buttons["Sleep"]), ("Journal", app.buttons["nightCard"]), ("Trends", app.staticTexts["THIS WEEK"]), ("Settings", app.staticTexts["Settings"])] {
        tab(name)
        XCTAssertTrue(shows(loaded), name)
        try app.performAccessibilityAudit(for: .contrast) { issue in
          // iOS's own greys "nearly pass"; disabled controls and what sits under the tab bar are not text to read.
          // A lone narrow letter (the calendar's "T") has too few pixels for the audit to measure: Theme.text2 on
          // Theme.card is 6.7:1, and even white at 80% (12:1) only "nearly passed" (2026-11-23).
          guard let e = issue.element else { return true }
          let ignore = issue.compactDescription.localizedCaseInsensitiveContains("nearly") || !e.isEnabled
            || e.frame.maxY > self.app.tabBars.firstMatch.frame.minY || e.label.count == 1
          if !ignore { print("contrast, \(appearance == .light ? "light" : "dark") mode, \(name): \(issue.compactDescription): \"\(e.label)\" at \(e.frame)") }
          return ignore
        }
      }
    }
  }
}
