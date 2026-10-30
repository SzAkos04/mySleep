# Master prompt: a self-hosted Rubik's cube algorithm collection (JPerm.net style)

Paste everything below the line into a new chat, started in an empty folder `~/Projects/myAlgs`.

---

You are building a personal, **self-hosted Rubik's cube algorithm collection** with me (Ákos), in the
spirit of jperm.net/algs: browse the algorithm sets, see each case as a picture, and read its
algorithms, but with **my own algorithms**, which I can edit, mark as learned and practise. It runs in
Docker on my home server and I use it mostly on my iPhone 11 Pro Max. I write Hungarian; **answer me in
Hungarian**; the UI, code, commit messages and file names are English. Keep replies short: the result,
then a few lines.

## What it is

A web app (installable on the iPhone home screen, works offline once loaded) with:

1. **Sets** on the home page, as cards, for the 3x3 first: OLL, PLL, F2L, 2-look OLL, 2-look PLL, COLL,
   ZBLL, ZBLS, plus a free-form "My sets" (a set I define myself: name + cases). The set list is data,
   not code: I must be able to add a set without a deploy.
2. **A set page**: a grid of case cards, each with the case picture, its name (e.g. "OLL 21", "T-perm")
   and my main algorithm; search and filter (all / learned / learning / to learn / favourites).
3. **A case page**: the picture large; **all my algorithms for the case**, one marked as the main one;
   for each: the notation, move count (HTM, STM, QTM), a note (fingertricks, grip, when to use it), a
   source/credit field, an optional link (e.g. a video). A way to **add, edit, reorder, delete** an
   algorithm, and to copy it. Status per case: to learn / learning / learned, and a favourite star.
4. **Pictures made by my own code**, not copied: from the algorithm, apply its inverse to a solved
   cube and draw the result. Last-layer cases as the familiar top view with the side stickers
   (OLL), PLL with arrows, F2L as a corner-edge pair view; also a small 3D/animated playback of the
   algorithm (step, play, speed) so I can see what it does.
5. **Case detection**: paste an algorithm and the app finds which case of which set it solves, and
   offers to file it there (or says it matches none). This is how I fill the collection quickly.
6. **A practice mode**: pick sets or cases, get a scramble that produces the case (the inverse of an
   algorithm, so it is always solvable), show the case, reveal my algorithm, time myself, mark it
   learned / not yet. Keep the history (a simple spaced repetition: cases I miss come back sooner).
7. **Import / export** of everything as one JSON file (my backup and the way I seed it with my
   algorithms: I will paste or give you a text/CSV list), plus a seed with the case lists of the
   standard sets (names and numbering only, no algorithms: the algorithms are mine).

Out of scope until I ask: accounts and logins (it is reachable only over my Tailscale network), other
puzzles, a timer app with solves, sharing, a public site.

## About JPerm's site

Use it only as a **model of the structure and feel** (open the public pages and look: sets, case grids,
case pages, a clean dark look). Do **not** copy its text, videos, images, algorithm lists, or the
fingertrick notes: the content here is mine. Draw everything yourself.

## The cube engine (the heart: test it hard)

A small, pure, dependency-free module, used by the app and by the tests:

- A parser for standard notation: faces `U D L R F B`, `'`, `2`, wide moves (`Rw`, `r`), slices
  `M E S`, rotations `x y z`, with a clear error for what it cannot read. Brackets/commutator notation
  is a later extra.
- A cube state (permutation + orientation of corners and edges, centres), applying a move, inverting
  and mirroring an algorithm, canonical form, and move counts (HTM, STM, QTM).
- Last-layer and F2L **case recognition** from a state (which set, which case, up to the usual AUF /
  rotations that the sets define), with the case tables kept as data.
- A scramble generator for a case.

Verify it against known identities (e.g. `R U R' U'` has order 6; a named PLL really solves its case;
`(alg)(alg^-1)` is the identity; all 21 PLL and 57 OLL cases are distinct and each is recognised).

## How to build it

- **Look at `~/Projects/myGym` first, read-only (never change it)**: it is my previous app, built the
  way I like (React PWA, a small dependency-free Node API, JSON files, Docker, behind Tailscale). Reuse
  its patterns and its CLAUDE.md conventions; do not copy the content. Do the same for
  `~/Projects/mySleep` (its `CLAUDE.md`, `docs/dev/SERVER_MASTER_PROMPT.md`, `docker-compose.yml`,
  `scripts/`): it is the model for the repo layout, the scripts and the test rules.
- **Keep the data simple and mine:** JSON files in a data folder (sets, cases, algorithms, my progress),
  written atomically (temp file then rename), no database unless you can show it is needed. Keep the
  engine and the data format free of any UI.
- **Offline and fast on the phone:** a service worker, the whole app and the case pictures cached;
  pictures drawn as SVG on the client (or pre-rendered once), no external CDN, no tracking, no analytics.
  Light work for an A13 chip: opacity/offset/scale animations only, nothing running all the time, and
  respect Reduce Motion. Large tap targets, one column, dark by default with a light option.
- **No new dependency without a reason.** A cube-rendering library is allowed if it is open source, runs
  offline and you say why writing it is not better. Name the exact version and licence.

### Test-driven (my rule)

Every change starts with a test: write it, run it, see it fail for the reason you expect, then the
least code that passes, then tidy. A bug is fixed only after a test reproduces it. One command runs
everything (`scripts/test.sh`); a pre-commit hook runs it and you never bypass it (`--no-verify`).
The engine gets exhaustive tests, the API every route and its refusals, the screens' logic is kept in
pure code so it can be tested. Say plainly what only the iPhone can show and was not verified.

## Docker and the server

- Repo `~/Projects/myAlgs` on the Mac, branch `dev`; the server runs `~/myAlgs` on `main`.
  **Merge `dev` into `main` and deploy only when I say so** ("mergeld, telepítsd").
- `docker compose` with the same shape as mySleep: an `api` (Node 22, no dependencies, data in a mounted
  volume `./data`) and a small `web` (nginx) serving the built app and proxying `/api`. The images run
  the tests while building, so a failing change cannot be deployed. Bind only to `127.0.0.1:<port>`.
- The server is `csodabogar2` (Arch, Docker only), `ssh szakos@csodabogar2`, reached over Tailscale.
  It already runs other things: Kuma (443), myGym (`:8081`), Vaultwarden (`:10000`), mySleep (`:8443`;
  host ports 8080–8083 are taken). **Pick a free host port, check with `docker ps` and
  `tailscale serve status` first, and ask me before you add a Tailscale serve entry or touch any other
  container**; never touch Vaultwarden or myGym.
- A `scripts/server-update.sh` like mySleep's (pull `main`, rebuild, restart), a **backup** command for
  `data/` into `~/backups` (do it before every deploy and say so), and a health endpoint
  (`GET /api/health`) that I can add to Uptime Kuma (which sees containers by name on a shared Docker
  network; you may suggest it, I log in to Kuma myself).
- Never type, ask for or print passwords, tokens or `.env` values.

## How to start

1. Read `~/Projects/myGym/CLAUDE.md` and `~/Projects/mySleep/CLAUDE.md` (and look at jperm.net/algs).
2. In **one message**, give me: the folder layout, the data format (a sample case with two algorithms),
   the phases below with what each one proves, and at most three real questions (e.g. which sets first,
   the app's name, brightness preference). Wait for my answer.
3. Then work phase by phase, test-first, committing to `dev` as you go, and tell me what is done and
   what was not verified after each one.

### Phases

1. **Engine:** notation, cube state, moves, inverse/mirror, counts, with exhaustive tests. *Proof:* the
   identities above; every OLL and PLL case recognised from its algorithm.
2. **Data and API:** sets/cases/algorithms/progress as JSON, CRUD routes, import/export, the seed of case
   lists. *Proof:* every route and refusal tested; an exported file imports back identically.
3. **The app, read-only:** home → set → case with SVG pictures and playback, search and filters, PWA and
   offline. *Proof:* it runs in the iOS Simulator; check the screens at iPhone size.
4. **Editing:** add/edit/reorder algorithms, the main one, status and favourites, case detection from a
   pasted algorithm. *Proof:* a pasted PLL lands in the right case.
5. **Practice:** scrambles for a case, timing, the review queue. *Proof:* every generated scramble is
   solved by the case's algorithm.
6. **Docker and deploy:** compose, the images with the tests inside, update and backup scripts, health.
   *Proof:* it runs on the server over Tailscale on a free port, and survives a restart with its data.
7. **My algorithms:** seed the collection from the list I give you, check each is a valid solve for its
   case and report the ones that are not.

Write a `CLAUDE.md` (layout, commands, rules, the test-first rule) and a `PROJECT_STRUCTURE.md` in the
first commit, keep both current, and keep token use low: read files in parts, filter command output,
no broad recursive searches.
