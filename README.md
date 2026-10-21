# mySleep

A self-hosted sleep tracker and smart alarm. The phone listens through the night (nothing but the
result leaves it), works out when you fell asleep, woke up and snored, and wakes you inside a
window when you start to stir. Passkey sign-in, your data in a folder on your own server.

```bash
cp .env.example .env    # set RP_ID and ORIGIN to your HTTPS address
docker compose up -d --build
```

The app is then on `127.0.0.1:8081`; put HTTPS in front of it (passkeys need it), for example
`tailscale serve --bg --https=8443 http://127.0.0.1:8081`. Install it from Safari with Share › Add
to Home Screen. How it works: [docs/dev/MVP.md](docs/dev/MVP.md).

Alarm sound: "Soft Piano Loop" by Ncone, [freesound.org #710546](https://freesound.org/people/Ncone/sounds/710546/), CC0.
