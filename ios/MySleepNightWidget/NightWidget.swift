import ActivityKit
import AlarmKit
import SwiftUI
import WidgetKit

// The lock screen during the night: what mySleep Night is doing, since when, and when it wakes you.
// Clock times, not running counters: no seconds at night, and nothing to go wrong between the app's
// minute updates or after it hands the card over (NightKit's LivePlan: iOS's 8-hour limit).
@main struct NightWidgets: WidgetBundle {
  var body: some Widget {
    NightLiveActivity()
    SnoozeLiveActivity()
  }
}

private let accent = Color(red: 0x8b / 255, green: 0x8c / 255, blue: 0xf8 / 255)
private let good = Color(red: 0.36, green: 0.82, blue: 0.5)

struct NightLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: NightActivity.self) { context in
      NightCard(card: context.state, stale: context.isStale)
        .activityBackgroundTint(.black.opacity(0.88))
        .activitySystemActionForegroundColor(accent)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) { Image(systemName: "moon.fill").foregroundStyle(accent) }
        DynamicIslandExpandedRegion(.bottom) { NightCard(card: context.state, stale: context.isStale, compact: true) }
      } compactLeading: {
        Image(systemName: "moon.fill").foregroundStyle(accent)
      } compactTrailing: {
        if let ringAt = context.state.ringAt { clock(ringAt).monospacedDigit() }
      } minimal: {
        Image(systemName: "moon.fill").foregroundStyle(accent)
      }
    }
  }
}

/// A clock time: stays right all night without updates (iOS updates a card for 8 hours at most).
private func clock(_ d: Date) -> Text { Text(d, format: .dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits)) }

private struct NightCard: View {
  let card: LiveCard
  let stale: Bool
  var compact = false

  var body: some View {
    let status = card.status(stale: stale)
    let warn = status != .listening && status != .handedOver && status != .ringing
    VStack(alignment: .leading, spacing: compact ? 6 : 12) {
      if !compact {
        HStack(spacing: 6) {
          Image(systemName: "moon.fill").foregroundStyle(accent)
          Text("mySleep Night").font(.caption.weight(.semibold)).foregroundStyle(.white.opacity(0.6))
        }
      }
      HStack(alignment: .firstTextBaseline) {
        VStack(alignment: .leading, spacing: 2) {
          clock(card.started).font(.system(size: compact ? 24 : 34, weight: .light)).monospacedDigit().foregroundStyle(.white)
          Text("in bed since").font(.caption2).foregroundStyle(.white.opacity(0.5))
        }
        Spacer()
        VStack(alignment: .trailing, spacing: 2) {
          if let ringAt = card.ringAt {
            Group {
              if let from = card.ringFrom, from != ringAt { clock(from) + Text(" – ") + clock(ringAt) } else { clock(ringAt) }
            }
            .font(.system(size: compact ? 20 : 26, weight: .light)).monospacedDigit().foregroundStyle(.white.opacity(0.85))
            Text(card.ringFrom != nil && card.ringFrom != ringAt ? "smart alarm" : "alarm").font(.caption2).foregroundStyle(.white.opacity(0.5))
          } else {
            Text("No alarm").font(.system(size: compact ? 18 : 22, weight: .light)).foregroundStyle(.white.opacity(0.6))
          }
        }
      }
      if status == .ringing {
        // the app's own alarm, rising gently: snooze here, stop in the app (held, as in the app)
        HStack(spacing: 10) {
          Image(systemName: "sun.max.fill").foregroundStyle(.orange)
          VStack(alignment: .leading, spacing: 1) {
            Text(status.text).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
            if let hint = status.hint { Text(hint).font(.caption2).foregroundStyle(.white.opacity(0.55)) }
          }
          Spacer()
          Button(intent: SnoozeIntent()) { Label("Snooze \(AlarmPlan.snoozeMinutes) min", systemImage: "zzz").font(.footnote.weight(.semibold)) }
            .buttonStyle(.borderedProminent).tint(accent)
        }
      } else {
        HStack(spacing: 6) {
          Circle().fill(warn ? Color.orange : good).frame(width: 7, height: 7)
          Text(status.text).font(.footnote).foregroundStyle(warn ? Color.orange : .white.opacity(0.8)).lineLimit(1)
        }
      }
    }
    .padding(compact ? 0 : 16)
  }
}

/// The alarm's own card (AlarmKit): ringing, snoozed (when it rings again) or paused.
struct SnoozeLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: AlarmAttributes<NightAlarm>.self) { context in
      SnoozeCard(state: context.state)
        .activityBackgroundTint(.black.opacity(0.88))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.bottom) { SnoozeCard(state: context.state) }
      } compactLeading: {
        if case .countdown = context.state.mode { Image(systemName: "zzz").foregroundStyle(accent) } else { Image(systemName: "sun.max.fill").foregroundStyle(.orange) }
      } compactTrailing: {
        if case .countdown(let c) = context.state.mode { clock(c.fireDate).monospacedDigit() }
      } minimal: {
        Image(systemName: "zzz").foregroundStyle(accent)
      }
    }
  }
}

private struct SnoozeCard: View {
  let state: AlarmPresentationState
  var body: some View {
    // AlarmKit's state: ringing, snoozed (counting down to the next ring) or paused
    let (phase, at): (AlarmCard.Phase, Date?) = switch state.mode {
    case .countdown(let c): (.snoozing, c.fireDate)
    case .paused: (.paused, nil)
    default: (.ringing, nil)
    }
    let t = AlarmCard.text(phase)
    HStack {
      Image(systemName: phase == .ringing ? "sun.max.fill" : "zzz").font(.title2).foregroundStyle(phase == .ringing ? .orange : accent)
      VStack(alignment: .leading, spacing: 2) {
        Text(t.title).font(.headline).foregroundStyle(.white)
        Text(t.subtitle).font(.caption).foregroundStyle(.white.opacity(0.6))
      }
      Spacer()
      if t.showsTime, let at {
        clock(at).font(.system(size: 34, weight: .light)).monospacedDigit().foregroundStyle(.white)
      }
    }
    .padding(16)
  }
}
