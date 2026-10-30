# Night sounds, sleep score, wake-up sounds (v0.2)

Asked for: "a sleeping sound analyzer like Asleep, so I know what I do during the night, a
sleep score and a rough estimation about my sleep after a whole night, more wake-up sounds".

## What "like Asleep" can and cannot mean here

Asleep stages sleep from breathing sounds with a deep model trained on >1,000 hospital nights
(~70% four-stage agreement, Hong et al. 2022). We have no such data, so no trained model. What
we can do on the phone, with no new dependency:

- Tell sounds apart by measurable traits, per second, from the microphone (100 ms readings:
  loudness, share of energy under 500 Hz and in 500–3000 Hz, the spread of the readings within the
  second, and the largest jump from one reading to the next). First guesses were wrong (speech
  was taken for coughing); the thresholds now come from `shared/scripts/replay.mjs`, which runs
  a WAV through the same analysis:

  | measured (room at -45 dBFS) | jump | 500–3000 Hz | < 500 Hz | spread | length |
  |---|---|---|---|---|---|
  | speech (macOS `say`) | 30–37 dB | 0.29–0.44 | 0.41–0.65 | 11–15 dB | 2 s+ |
  | snoring (synthetic) | 13–17 dB | 0.33 | 0.55–0.58 | ~10 dB | 1–2 s every 4 s |
  | cough (synthetic) | 38 dB | 0.66 | 0.15–0.18 | ~14 dB | ≤ 1 s |

  | kind | rule |
  |---|---|
  | room noise | one sound ≥ 20 s (fan, traffic): not counted as you moving |
  | coughing | ≤ 1 s, jump ≥ 25 dB, ≥ 0.5 of the energy in 500–3000 Hz |
  | talking | jump ≥ 20 dB and spread ≥ 8 dB |
  | snoring | ≤ 4 s, ≥ 0.5 under 500 Hz, jump < 22 dB, ≥ 3 in a row 2–9 s apart |
  | movement | every other sound |

  Synthetic snores and coughs are rough; the first real clips will move these. The iOS Simulator
  cannot test this: its microphone input is a steady tone with a click every second, not the
  Mac's microphone (tried 2026-10-21: it came out as "snoring").
- Keep **clips** (a 30 s rolling buffer of 16 kHz audio in an AudioWorklet; a few seconds around
  each talk, cough and snoring episode, at most 6/3/3 a night), uploaded to the server after the
  night, kept 7 days. They are how you check what it heard, and how the thresholds get tuned.
- A **rough estimate** of the night per 30 s: awake (as before), *restful* (10+ minutes without
  a movement, talk or cough) and *light* (the rest of sleep). Labelled as an estimate; no REM.

A trained classifier (YAMNet has Snoring, Speech, Cough, Breathing classes) can replace the
rules later, run on the clips, once real clips show where the rules go wrong.

## Sleep score (0–100), derived, not stored

| part | points | full marks |
|---|---|---|
| Duration | 35 | asleep ≥ your need |
| Efficiency | 20 | asleep ≥ 90% of time in bed (0 at 60%) |
| Continuity | 15 | no time awake after falling asleep (0 at 40 min) |
| Falling asleep | 10 | ≤ 15 min (0 at 60) |
| Restfulness | 10 | ≥ 35% of sleep restful (tracked nights only) |
| Routine | 10 | asleep within 15 min of your bedtime (0 at 90 min off) |

Parts a night has no data for are left out and the rest scaled to 100. Your own 1–5 rating is
shown beside it, not mixed in. Plus a few plain sentences: when you fell asleep, wake-ups with
times, snoring and when, talking, coughing, the longest restful stretch.

## Wake-up sounds

Made in Web Audio, no files: Chime, Bells, Marimba, Birds, Waves, Classic beep. Settings: the
sound (tap to preview), fade-in 30 s / 1 min / 2 min.

## Server

`PUT/GET /api/clips/<night>/<id>` (WAV, ≤2 MB), files in `DATA_DIR/clips/<uid>/`, removed after
`CLIP_DAYS` (7) and when their night is deleted.
