# mySleep

A self-hosted sleep tracker and smart alarm for one iPhone. **mySleep Night**, a native app, listens
through the night with the phone locked (nothing but the result leaves it), works out when you fell asleep,
woke up and snored, and wakes you gently inside a window when you start to stir. It keeps your nights on
the phone and syncs them to a small server on your own machine: the history and the backup.

```bash
cp .env.example .env              # set ORIGIN to the address the phone reaches the server at
docker compose up -d --build      # the API on 127.0.0.1:8083
tailscale serve --bg --https=8443 http://127.0.0.1:8083
scripts/ios-install.sh            # the app onto the iPhone (a free Apple ID: reinstall weekly)
scripts/pair.sh                   # a link that pairs the app with the server: paste it on the iPhone, tap it
```

How it works: [docs/dev/MVP.md](docs/dev/MVP.md) (the first version), [docs/dev/NATIVE_PLAN.md](docs/dev/NATIVE_PLAN.md)
(how the web app was retired for the app), [CLAUDE.md](CLAUDE.md) (how to work on it).

Alarm sound: "Soft Piano Loop" by Ncone, [freesound.org #710546](https://freesound.org/people/Ncone/sounds/710546/), CC0.
