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

Working end to end: sign-in, home, series, episode pages, search, favourites, and
video playback with resume and progress sync. Controller navigation is in place
but has only been exercised with a keyboard so far.

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
│    favourites.ts  Beacon favourites, hydrated from the catalog         │
│    hls.ts         master playlist reordered best-first                 │
│                          │ IPC                                          │
│  renderer (React)        ▼                                             │
│    focus engine   spatial navigation from d-pad / stick / arrows       │
│    screens        login, home, series, episode, search, player         │
│    hls.js         plays the reordered playlist                         │
└────────────────────────────────────────────────────────────────────────┘
```

### Home

Home is Beacon's own editorial page: `MemberHomePage.pageContent` supplies the
hero and the shelves — Featured, Continue watching, Watch by Series, Latest
Videos — in the order the editors set. Blocks the client cannot use on a TV
(articles, audio for now) are filtered out, `excludedPlatforms` is honoured per
block, and a block the client has no fragment for is skipped without taking the
page down.

### Favourites

Favourites are Beacon's, not ours. Series and collections can be favourited
from the hero on Home or from their own page, and a **Favourites** row appears
on Home just below *Continue watching* by default. The arrows in that row's
heading move it among the shelves; the row remembers which shelf it follows
(`preferences.json`), so editorial changes to the home do not shift it. That
anchor is the only part kept on the device, because it is a layout choice and
not account data.

The list itself comes from `userCollectionFavourites` and is written back with
`toggleCollectionFavouriteEndpoint`, so it is the same list beacon.tv and the
official apps show. The control flips as soon as it is pressed and shows a
spinner until the account confirms the write; a refused write puts it back.
Items are hydrated from the local catalog index each launch, which keeps titles
and artwork current. Nothing is cached for an offline session: with no account,
or no network, there is no favourites row.

Episodes have no favourite of their own, so an episode page offers no button;
favourite the series instead. Signing out leaves the account's favourites
untouched.

API calls live in the main process for two reasons: Beacon's CMS only accepts
`beacon.tv` as a browser origin (so the renderer would be blocked by CORS), and
tokens stay out of the renderer. The session is encrypted at rest with the OS
keyring via Electron's `safeStorage`. Where no real keyring is reachable
(SteamOS Game Mode, or a machine with none at all) nothing is written — the
tokens live in memory for that run and you sign in again next launch. The
sign-in screen says so when that is the case.

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
| Player controls | D-pad up / down, Y / Start | ↑ / ↓, M |
| Scrub while paused | ↑ then ← / →, A to jump, A again to play | ↑ then ← / →, Enter to jump, Enter again to play |
| Choose in a player menu | D-pad + A | Arrows + Enter |
| Ending card (last 15s) | A plays next, B keeps watching | Enter / Escape |
| Quit | — | Ctrl+Q |
| Fullscreen | — | F11 |

In the player, ↑/↓ (or Y/Start) reaches the controls, where ←/→ moves
between them. While the bar is unfocused, ←/→ seek. When paused, ↑ goes
instead to the progress bar: ←/→ move the seek marker and A/Enter jumps to that
time. Press A/Enter again without moving the marker to play from there. ↓ leaves
the scrubber for the controls. The bar has
subtitles, audio track, quality, playback speed and fullscreen; a chosen
subtitle language is remembered for the next video.

### Build

```bash
npm run build          # compile
npm run build:linux    # AppImage (run on Linux or CI)
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
the Linux AppImage and checksums and attaches them to that release. If the build
fails, nothing is uploaded. The workflow can also be run with `dry_run` to build
and test everything without touching the release. See
[docs/releasing.md](docs/releasing.md) for versioning rules and the checklist.

On a Steam Machine or Deck, see [docs/install-steamos.md](docs/install-steamos.md)
for the one-time Desktop Mode setup.

### Dev helpers

`BEACON_OPEN=<slug>` opens a video or series directly. `BEACON_SHOT=<path>` renders
the app, saves a PNG of the page and quits — useful for checking layout without a
second monitor. `BEACON_SHOT_SCRIPT` runs JavaScript before the capture, and
`BEACON_SHOT_DELAY` / `BEACON_SHOT_SETTLE` control the timing.

## Roadmap

- [ ] Verify on SteamOS with a real Steam Controller
- [ ] Steam Input profile shipped with the app
- [ ] Suspend / resume handling
- [ ] Update check from inside the app (manual, no silent install)
- [x] "Next episode" autoplay at the end of an episode
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
