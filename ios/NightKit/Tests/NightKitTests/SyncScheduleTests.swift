import Testing
import Foundation
@testable import NightKit

// While the app is open it syncs once a minute, and again in 30 s when the
// server did not answer; a refusal (the pairing is gone) is not retried until it is paired again.
@Suite struct SyncScheduleTests {
  @Test func aMinuteAfterASyncHalfAMinuteAfterAMiss() {
    #expect(SyncSchedule.next(after: .synced) == 60)
    #expect(SyncSchedule.next(after: .offline) == 30)
    #expect(SyncSchedule.next(after: .failed(500)) == 30)
    #expect(SyncSchedule.next(after: .unauthorized) == nil)
  }
}
