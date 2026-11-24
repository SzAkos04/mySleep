#!/usr/bin/env python3
"""ios/MySleepNight/alarm-rise.wav from scripts/alarm-piano.wav: the piano looped to 28 s (AlarmKit takes at
most 30), its loudness smooth in decibels: -42 dB easing (quadratically) to full over 25 s, then
held. The system alarm cannot rise a sound, so the rise is in the file. Run after changing either."""
import array, math, wave

SRC, DST = 'scripts/alarm-piano.wav', 'ios/MySleepNight/alarm-rise.wav'
FROM_DB, RISE, LENGTH = -42.0, 25.0, 28.0

w = wave.open(SRC)
assert w.getnchannels() == 1 and w.getsampwidth() == 2
rate = w.getframerate()
piano = array.array('h', w.readframes(w.getnframes()))
out = array.array('h')
for i in range(int(LENGTH * rate)):
    x = min(i / rate / RISE, 1)
    out.append(round(piano[i % len(piano)] * 10 ** (FROM_DB * (1 - x) ** 2 / 20)))
o = wave.open(DST, 'wb')
o.setnchannels(1); o.setsampwidth(2); o.setframerate(rate)
o.writeframes(out.tobytes())
