# beacon-linux (Unofficial)

An unofficial, controller-first Beacon (Critical Role) client for Linux and SteamOS.

Launch it from Steam Game Mode and drive the whole thing from a Steam Controller:
browse, search, resume, watch — the way [VacuumTube](https://github.com/shy1132/VacuumTube)
does for YouTube.

> **Unofficial.** Not made by, affiliated with or endorsed by Critical Role or Beacon.
> It talks to Beacon's private API with your own account. Beacon can change or block
> it at any time, and using it may be against Beacon's terms. No content is
> redistributed and no paywall or DRM is bypassed — playback uses the same non-DRM
> HLS streams Beacon serves its own TV clients.

## Status

Working end to end: sign-in, home, series, episode pages, search, and video
playback with resume and progress sync. Controller navigation is in place but has
only been exercised with a keyboard so far.

Verified against the live service on 2026-11-16.

## How it works

Beacon's TV clients ask for streams with `x-supports-drm: false` and get back plain
HLS from JW Player — no Widevine. That makes a native client straightforward. See
[docs/beacon-api.md](docs/beacon-api.md) for the full API reference.

```
┌─────────────────────────────── Electron ───────────────────────────────┐
│  main process                                                          │
│    BeaconClient   Memberful OAuth, GraphQL, watch progress             │
│    Catalog        local index of ~1,300 videos, fuzzy search           │
│    hls.ts         master playlist reordered best-first                 │
│                          │ IPC                                          │
│  renderer (React)        ▼                                             │
│    focus engine   spatial navigation from d-pad / stick / arrows       │
│    screens        login, home, series, episode, search, player         │
│    hls.js         plays the reordered playlist                         │
└────────────────────────────────────────────────────────────────────────┘
```

API calls live in the main process for two reasons: Beacon's CMS only accepts
`beacon.tv` as a browser origin (so the renderer would be blocked by CORS), and
tokens are encrypted at rest with the OS keyring via Electron's `safeStorage`.

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

The first launch shows the sign-in screen. Free videos work without an account.
On a Steam Deck, `STEAM` + `X` opens the on-screen keyboard for the password field.

### Controls

| Action | Gamepad | Keyboard |
|---|---|---|
| Move | D-pad / left stick | Arrow keys |
| Select | A | Enter |
| Back | B / Back | Escape |
| Search | left on the edge | `/` |
| Play / pause | A | Space |
| Seek ±10s | D-pad left / right | ← / → |
| Seek ±1min | LT / RT | — |
| Subtitles | X | — |
| Quit | — | Ctrl+Q |
| Fullscreen | — | F11 |

### Build

```bash
npm run build          # compile
npm run build:win      # Windows installer
npm run build:linux    # AppImage + .deb
```

### Test

```bash
npm test               # unit tests (Vitest)
npm run test:watch     # re-run on change
npm run typecheck      # type-check app and tests
```

Tests sit next to the code they cover (`*.test.ts`). Most run in Node; files that
need the DOM start with `// @vitest-environment jsdom`. Component and screen tests
use Testing Library (`@testing-library/react`).

### Releases

Releases are started by hand, not by pushing a tag: tag the commit, create the
release in the GitHub UI, then run the Release workflow with that tag. It builds
an AppImage, `.deb` and `.tar.gz` for Linux plus an installer for Windows and
checksums, and attaches them to that release. If any build fails, nothing is
uploaded. See [docs/releasing.md](docs/releasing.md) for versioning rules and the
checklist.

### Dev helpers

`BEACON_OPEN=<slug>` opens a video or series directly. `BEACON_SHOT=<path>` renders
the app, saves a PNG of the page and quits — useful for checking layout without a
second monitor. `BEACON_SHOT_SCRIPT` runs JavaScript before the capture, and
`BEACON_SHOT_DELAY` / `BEACON_SHOT_SETTLE` control the timing.

## Roadmap

- [ ] Verify on SteamOS with a real Steam Controller
- [ ] Steam Input profile shipped with the app
- [ ] Suspend / resume handling
- [ ] Flatpak packaging
- [ ] "Next episode" autoplay at the end of an episode
- [ ] Live-event support (Beacon's waiting room)

## Legal

This project is unofficial and unaffiliated. Beacon and Critical Role are
trademarks of Critical Role Productions LLC.

It is a client, not a mirror. It talks to Beacon's own API using your own
account, and plays the same non-DRM HLS streams Beacon serves its own TV clients.
It does not redistribute, re-host, or circumvent access to any content, and it
bundles no Beacon artwork, logos, or media — titles, images and video are loaded
at runtime from Beacon's servers and remain the property of their owners.

Beacon's API is private and undocumented. Using it may be against Beacon's terms
of service, and it can change or be blocked at any time.

See [ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md) for third-party credits.

## License

MIT for this project's own code. See [LICENSE](LICENSE).
