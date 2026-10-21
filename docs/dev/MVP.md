# mySleep MVP (v0.1)

A self-hosted sleep tracker and smart alarm for one iPhone, built the way myGym was: React PWA,
dependency-free Node API, JSON files, Docker on `csodabogar2` behind Tailscale. Deliberately an
early version: the point is to sleep with it and tune it, not to be complete.

## What a night holds

| Field | Source | Notes |
|---|---|---|
| `id` | evening date, `YYYY-MM-DD` | a night belongs to the evening it started (anything before noon is the day before) |
| `bed`, `wake` | tracking start / Wake up tap (ms) | editable |
| `on` | sound analysis (fell asleep) | editable, shown as "estimated" |
| `wakes`, `awakeMin` | sound analysis | wake-ups of 2 min or more between falling asleep and the last sleep |
| `asleepMin` | sound analysis; from the times if they are edited | |
| `snoreMin` | sound analysis | minutes with snoring in them |
| `q` | you, 1–5 | |
| `tags` | you (evening preview and morning review) | list in Settings |
| `note` | you | |
| `timeline` | sound analysis | `states` ('s'/'w'/'g' per 30 s), `events` ('n' snore, 'm' movement), `db` (loudest per minute) |
| `alarm` | `{ at, early }` when the alarm rang | |

No sleep stages: from sound they are about 68–70% right even with large hospital-trained models
(Hong et al. 2022, Asleep), which is not worth showing. No naps, no Apple Health import yet.

## Sound analysis (`frontend/src/lib/analysis.js`)

On the phone, nothing but the result leaves it. Every 250 ms the mic's loudness (dB, relative)
and the share of energy under 500 Hz are read with an `AnalyserNode`; per second the loudest
reading and the mean low share are kept.

1. **Noise floor:** the 10th percentile of the last 10 minutes.
2. **Events:** seconds 6 dB above the floor.
3. **Snoring:** events of ≤4 s, mostly low-pitched, at least 3 in a row 2–9 s apart (a breath).
4. **Movement:** every other event.
5. **Asleep/awake per 30 s:** movement seconds, weighted over the epoch's neighbours with
   Cole-Kripke weights (the wrist-actigraphy method); above 1.5 = awake. Sleep-from-breathing-sound
   work (Dafna et al. 2015) gets ~83% epoch agreement with this kind of sleep/wake split, with wake
   detected worst. Fell asleep = the first 10 minutes asleep in a row.
6. Runs under 2 minutes take their neighbours' state.

Every threshold is a named constant at the top of the file. They are set on paper; the first real
nights will move them. Unit tests run a synthetic night through it.

## Smart alarm

Window: `window` minutes (default 30) before the wake time. Inside it, every 10 s, if the last
minute had ≥3 movement seconds, it rings; at the end of the window it rings regardless.

iPhone details (none of this is verified on the phone yet):
- The AudioContext is created in the Start tap, which lets it play hours later.
- Ringing closes the mic first (with the mic open iOS may play through the earpiece), switches
  `navigator.audioSession.type` to `playback` (ignores the silent switch), then plays a three-note
  chime that rises from quiet to full over 60 s. Media volume, not ringer volume.
- **Backup:** tracking start arms `POST /api/alarm` for one minute after the window. Stop clears it.
  If the page died, the server sends a push then. Focus modes can silence it.

## Why the screen stays on

A home-screen web app loses the microphone when it is locked or backgrounded (WebKit bug 239602,
open). So: Wake Lock (works in home-screen apps since iOS 18.4), a black screen, phone on the
charger. If the stream ends anyway, it is reopened when the page is visible; the missing seconds
are gaps ('g'). Seconds are saved to `localStorage` every minute, so a page closed in the night
comes back with "Resume listening" or "Finish the night".

## Screens

- **Tonight:** bedtime card (time to lights out, alarm window, Start), last night (timeline,
  fell asleep, wake-ups, snoring, quality), this week's hours against the need, sleep debt. `+` logs
  a night by hand.
- **Before you sleep** (sheet): checklist, tonight's tags, Start tracking.
- **Night screen:** black, dim clock, listening state, Wake up.
- **Alarm:** time, "rang N min early", Stop, Snooze.
- **Morning review** (sheet): the filled-in night to correct, quality, tags, note, Save.
- **History:** nights, 20 at a time. **Night:** tiles, full timeline with legend, notes, edit, delete.
- **Trends:** 7/30 nights: average asleep, sleep debt, mean fall-asleep and wake time with spread,
  hours per night, the asleep window per night against the target, snoring per night.
- **Settings:** schedule, alarm, bedtime reminder, notifications, tags, account, build.

## API (`api/server.js`)

| Route | |
|---|---|
| `GET /api/health` | container health |
| `GET /api/me` | the signed-in user, or 401 with `signup: true` while the server has no profile |
| `POST /api/register/options`, `/verify` | passkey sign-up: only the first profile (or `ALLOW_SIGNUP=1`) |
| `POST /api/login/options`, `/verify` | passkey sign-in |
| `POST /api/logout` | |
| `POST /api/sync` | `{ since, changes }` → `{ rev, changes }` |
| `GET /api/push/key`, `POST /api/push/subscribe`, `POST /api/push/test` | Web Push |
| `POST /api/alarm` | `{ at }` arms the backup alarm push, `{ at: null }` clears it |

State: `DATA_DIR/db.json` (users, passkeys, push subscriptions, armed alarms), `state-<uid>.json`
(nights and settings), `secret` (session HMAC key), `vapid.json`. Temp file, then rename.
Every 20 s the server sends due backup alarms and the bedtime reminder (in the user's time zone,
from the synced settings). Dependencies: `@simplewebauthn/server`, `web-push`.

## Sync

Built in from the start, simpler than myGym's because the document is a set of independent
entries: every night and the settings record carry `ts` (last edit on the device), and the server
stamps each stored entry with a revision. `POST /api/sync` sends only the entries edited since the
last confirmed push and gets back every entry with a revision above the device's `since`. The
newer `ts` wins per entry, on the server and on the device, so two devices editing different
nights both keep their change, and nobody sends the whole history. No 409 round trip is needed:
the merge happens where the write lands. Deletions are tombstones. The night in progress stays on
the phone. Pushes are a debounced 800 ms after an edit; a pull happens on every return to the app.
Payloads are a few KB (a night with its timeline is ~3 KB), so no request gzip; nginx gzips
responses.

## Hosting

- `docker-compose.yml`: `api` (Node 22 alpine, `./data` volume) and `web` (multi-stage build of
  `frontend/`, nginx serves it and proxies `/api`). Web listens on `127.0.0.1:8081` only.
- Tailscale: `tailscale serve --bg --https=8443 http://127.0.0.1:8081` on `csodabogar2`, so the
  app is `https://csodabogar2.tailbd3336.ts.net:8443`. `RP_ID` is that hostname (shared with
  myGym: both apps' passkeys appear in the same iPhone list). Changing it later invalidates them.
- Server checkout: `~/mySleep` on `main`. Deploy (only when asked):
  `ssh szakos@csodabogar2 '~/mySleep/scripts/server-update.sh'`.
- Backup before touching data: `docker compose exec -T api tar -C /data -cf - . > ~/mysleep-data-backup-<date>.tar`.

## Build order

1. Repo with `dev`/`main`; this plan. ✔
2. API skeleton with passkeys and sync, tests. ✔
3. Frontend shell in myGym's design, the screens above, lib tests. ✔
4. Docker, nginx, CI (tests, build, images boot). ✔
5. `server-update.sh`; server checkout, `.env`, Tailscale serve.
6. First deploy, create the profile on the phone, add to home screen.
7. Sleep with it; tune the analysis constants on real nights (record a few nights' seconds, replay
   them on the Mac).

## Not in v0.1 (add when a real night asks for it)

Snore/talk clips, sleep-talk detection, Apple Health import, naps, light theme, request gzip,
analysis by tag.
