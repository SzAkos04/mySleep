import SwiftUI

// MARK: the night

/// Black, as the web app's night screen: on the OLED panel black pixels are off. Lit for 30 s after
/// a tap, then only a dim clock. Ending the night needs a held press, so a sleepy hand cannot.
struct NightScreen: View {
  @EnvironmentObject var engine: NightEngine
  @EnvironmentObject var alarm: AlarmController
  @State private var lit = true
  @State private var dimTask: Task<Void, Never>?

  var body: some View {
    // a minute is all it shows: redrawn once a minute, not every second, through the night
    TimelineView(.everyMinute) { ctx in
      ZStack {
        Color.black.ignoresSafeArea()
        VStack(spacing: 0) {
          if let n = engine.night {
            Status(hearing: engine.level != nil, minutes: Int((NightEngine.nowMs - n.start) / 60000)).opacity(lit ? 1 : 0)
              .offset(y: lit ? 0 : -8)
          }
          Spacer()
          Text(ctx.date, format: .dateTime.hour(.twoDigits(amPM: .omitted)).minute())
            .font(.system(size: 104, weight: .thin)).monospacedDigit().kerning(-3)
            .foregroundStyle(.white.opacity(lit ? 0.92 : 0.2))
            .contentTransition(.numericText()).animation(.smooth(duration: 0.8), value: ctx.date)
            .scaleEffect(lit ? 1 : 0.94)
          Group {
            if let plan = engine.plan {
              Text("Alarm \(plan.label())").font(.title3).foregroundStyle(.white.opacity(lit ? 0.75 : 0.18)).padding(.top, 14)
              if lit { Text("Up to \(duration(max(0, plan.at.timeIntervalSince(ctx.date) / 60))) of sleep").font(.subheadline).foregroundStyle(Theme.text2).padding(.top, 4) }
              if lit && alarm.phase == .none {
                Text("No loud backup: Alarms are off for mySleep Night. Keep it running, or set one in Clock.")
                  .font(.footnote).foregroundStyle(Theme.warn).multilineTextAlignment(.center).padding(.horizontal, 36).padding(.top, 10)
              }
            } else if lit {
              Text("No alarm").font(.title3).foregroundStyle(Theme.text2).padding(.top, 14)
            }
          }
          if lit { Meter(db: engine.level).padding(.top, 22) }
          Spacer()
          if lit {
            VStack(spacing: 0) {
              HoldButton(label: "Hold to wake up", systemImage: "sun.max") { engine.stop() }
              Text("Dims in 30 s · lock the phone, it keeps listening").font(.footnote).foregroundStyle(.white.opacity(0.4)).padding(.top, 16)
            }
            .transition(.opacity.combined(with: .offset(y: 12)))
          }
        }
        .padding(.top, 20).padding(.bottom, 28)
        .animation(.easeInOut(duration: lit ? 0.25 : 2.5), value: lit)
      }
      .contentShape(Rectangle())
      .onTapGesture { light() }
      .onAppear { light() }
    }
    .statusBarHidden(!lit)
  }

  private func light() {
    lit = true
    dimTask?.cancel()
    dimTask = Task { try? await Task.sleep(for: .seconds(30)); if !Task.isCancelled { lit = false } }
  }
}

private struct Status: View {
  let hearing: Bool, minutes: Int
  var body: some View {
    HStack(spacing: 8) {
      Circle().fill(hearing ? Theme.good : Theme.warn).frame(width: 8, height: 8)
      Text(hearing ? "Listening · \(minutes < 1 ? "just started" : duration(Double(minutes)))" : "Not hearing anything")
    }
    .font(.subheadline).foregroundStyle(hearing ? .white.opacity(0.85) : Theme.warn)
    .padding(.horizontal, 14).padding(.vertical, 8).background(.white.opacity(0.07), in: Capsule())
  }
}

/// What the microphone hears: 20–90 on the tracker's dB scale, like the web app's meter.
struct Meter: View {
  let db: Double?
  var body: some View {
    let fill = db.map { max(0, min(1, ($0 - 20) / 70)) } ?? 0
    Capsule().fill(.white.opacity(0.08)).frame(width: 140, height: 4)
      .overlay(alignment: .leading) { Capsule().fill(Theme.good.opacity(0.85)).frame(width: 140 * fill, height: 4).animation(.easeOut(duration: 0.25), value: fill) }
      .accessibilityElement().accessibilityLabel("Sound level").accessibilityValue("\(Int(fill * 100)) percent")
  }
}

/// Ends something only after a press held for 1.5 s; letting go early does nothing.
struct HoldButton: View {
  let label: String, systemImage: String
  var light = false
  let action: () -> Void
  @State private var holding = false
  @State private var done = 0
  var body: some View {
    let size: CGFloat = light ? 120 : 96
    VStack(spacing: 12) {
      ZStack {
        Circle().fill(light ? Color(white: 0.97) : .white.opacity(0.06)).frame(width: size, height: size)
        Circle().stroke(.white.opacity(light ? 0 : 0.12), lineWidth: 2).frame(width: size - 4, height: size - 4)
        Circle().trim(from: 0, to: holding ? 1 : 0).stroke(light ? Theme.accent : .white.opacity(0.9), style: StrokeStyle(lineWidth: 3, lineCap: .round))
          .rotationEffect(.degrees(-90)).frame(width: size - 4, height: size - 4)
          .animation(holding ? .linear(duration: 1.5) : .easeOut(duration: 0.2), value: holding)
        Image(systemName: systemImage).font(.system(size: light ? 34 : 28, weight: .medium)).foregroundStyle(light ? Color(red: 0.1, green: 0.06, blue: 0.12) : .white)
          .symbolEffect(.bounce, value: done)
      }
      .scaleEffect(holding ? 1.05 : 1).animation(.spring(duration: 0.3), value: holding)
      .onLongPressGesture(minimumDuration: 1.5, perform: { done += 1; action() }, onPressingChanged: { holding = $0 })
      // a tap as the press starts, a firm one when it is done
      .sensoryFeedback(trigger: holding) { _, now in now ? .impact(weight: .light) : nil }
      .sensoryFeedback(.success, trigger: done)
      .accessibilityLabel(label).accessibilityAddTraits(.isButton)
      Text(holding ? "Keep holding" : label).font(.subheadline).foregroundStyle(.white.opacity(0.8))
        .contentTransition(.opacity).animation(.smooth(duration: 0.2), value: holding)
    }
  }
}

// MARK: the alarm

/// A sunrise behind the clock; stopping is held, snoozing is one tap.
struct RingingView: View {
  @EnvironmentObject var engine: NightEngine
  @Environment(\.accessibilityReduceMotion) private var still
  /// The sun comes up with the sound (RiseCurve: 25 s to full), once, then stays.
  @State private var risen = false
  @State private var snoozes = 0

  var body: some View {
    TimelineView(.everyMinute) { ctx in
      ZStack {
        Color(red: 0.07, green: 0.045, blue: 0.04).ignoresSafeArea()
        // gradients, not a blurred layer: soft edges for free, cheap to move
        GeometryReader { g in
          let w = g.size.width
          RadialGradient(colors: [Color(red: 0.8, green: 0.4, blue: 0.16).opacity(0.75), .clear], center: .center, startRadius: 0, endRadius: w)
            .frame(width: w * 2, height: w * 2).position(x: w / 2, y: g.size.height + (risen ? -w * 0.1 : w * 0.6))
          RadialGradient(colors: [Color(red: 0.98, green: 0.7, blue: 0.36).opacity(0.8), .clear], center: .center, startRadius: 0, endRadius: w * 0.65)
            .frame(width: w * 1.3, height: w * 1.3).position(x: w / 2, y: g.size.height + (risen ? w * 0.02 : w * 0.5))
        }
        .opacity(risen ? 1 : 0.35)
        .ignoresSafeArea().accessibilityHidden(true)

        VStack(spacing: 0) {
          HStack(spacing: 8) {
            Image(systemName: "sun.horizon.fill").symbolEffect(.pulse, options: .repeating, isActive: !still)
            Text(engine.ringingEarly > 0 ? "Smart alarm · rising gently" : "Alarm · rising gently")
          }
          .font(.subheadline).padding(.horizontal, 14).padding(.vertical, 8).background(.white.opacity(0.1), in: Capsule())
          .rise(0)
          Spacer()
          Text(ctx.date, format: .dateTime.hour(.twoDigits(amPM: .omitted)).minute())
            .font(.system(size: 104, weight: .thin)).monospacedDigit().kerning(-3)
            .contentTransition(.numericText()).animation(.smooth(duration: 0.8), value: ctx.date)
            .rise(1)
          Text("Good morning").font(.title.weight(.semibold)).padding(.top, 10).rise(2)
          if engine.ringingEarly > 0 {
            Text("You were stirring, so it rang \(engine.ringingEarly) min early").font(.callout).foregroundStyle(.white.opacity(0.85)).padding(.top, 6).rise(3)
          }
          Spacer()
          HoldButton(label: "Hold to stop", systemImage: "sun.max.fill", light: true) { engine.stopAlarm() }.rise(4)
          Button { snoozes += 1; engine.snoozeAlarm() } label: {
            Text("Snooze \(AlarmPlan.snoozeMinutes) min").font(.headline).padding(.horizontal, 28).frame(height: 50)
              .overlay(Capsule().stroke(.white.opacity(0.45), lineWidth: 1)).background(.black.opacity(0.18), in: Capsule())
          }
          .buttonStyle(Pressable()).padding(.top, 22)
          .sensoryFeedback(.impact(weight: .medium), trigger: snoozes)
          .rise(5)
        }
        .foregroundStyle(.white).padding(.top, 20).padding(.bottom, 32)
      }
    }
    .onAppear { if still { risen = true } else { withAnimation(.easeOut(duration: 25)) { risen = true } } }
  }
}
