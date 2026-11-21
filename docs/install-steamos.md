# Installing on SteamOS (Steam Machine, Steam Deck)

The AppImage is the only published build. SteamOS is image-based: keep
everything in `/home` and do not copy files into `/usr`. What follows lives in
`/home`, so it survives system updates.

## Fast path

In Desktop Mode, with Steam running:

```sh
curl -fsSL https://github.com/Winde/beacon-linux/releases/latest/download/install.sh | bash
```

Prefer to read it first:

```sh
curl -fsSLO https://github.com/Winde/beacon-linux/releases/latest/download/install.sh
less install.sh
bash install.sh
```

The script downloads and verifies the AppImage, installs it to
`~/Applications/Beacon.AppImage`, adds a Steam shortcut, and applies the
library artwork. After that the app keeps itself current (see
[Updates](#updates)); re-run the installer to repair an install or to make the
one-time jump from a build that predates the updater. `--no-steam` installs
without the shortcut; `--version vX.Y.Z` pins a release; `--force-art` replaces
artwork you changed in Steam with the packaged set; `--uninstall` removes the
local files. It installs nothing outside `$HOME`; the only files elsewhere are
temporary ones it cleans up.

It cannot choose the controller layout (Steam owns that per-shortcut setting),
so do this once: **Beacon → Properties → Controller → Gamepad** (or **Gamepad
with Joystick Trackpad**). Use one of those two templates; the app reads a
standard gamepad.

The manual steps below remain as the fallback.

## One-time setup

1. Switch to Desktop Mode: **Steam button → Power → Switch to Desktop**.
2. Download `Beacon-<version>-x86_64.AppImage` from the latest
   [release](https://github.com/Winde/beacon-linux/releases).
3. Put it in `~/Applications` (create the folder if it is not there) and make it
   executable. In Dolphin: right-click → **Properties → Permissions → Is
   executable**. Or from a terminal:

   ```sh
   mkdir -p ~/Applications
   mv ~/Downloads/Beacon-*.AppImage ~/Applications/Beacon.AppImage
   chmod +x ~/Applications/Beacon.AppImage
   ```

4. Open Steam in Desktop Mode, then **Games → Add a Non-Steam Game → Browse**
   and pick `~/Applications/Beacon.AppImage`.
5. Open the new entry's **Properties → Controller** and choose the **Gamepad**
   template (or **Gamepad with Joystick Trackpad**), so the app receives a
   standard gamepad. Leave **Enable the Steam Overlay while in-game** on: Steam
   Input and the on-screen keyboard both depend on it.
6. Return to Game Mode (**Return to Gaming Mode** on the desktop, or Steam →
   Power) and launch Beacon from the Non-Steam section of your library.

The first launch shows the sign-in screen. Free videos work without an account.
On a Steam Machine or Deck, `STEAM` + `X` opens the on-screen keyboard for the
password field.

## Updates

Beacon updates itself: **Check for updates** at the foot of the left menu
compares this build with the latest stable release, downloads the new AppImage
beside the running one, verifies it against the release's `SHA256SUMS.txt`,
swaps it in and closes. Open Beacon again from Steam to use the new version. It
is a manual check; nothing installs silently.
Builds before 0.2.0 have no updater, so they need the installer once.

Re-running the installer also replaces `~/Applications/Beacon.AppImage` in
place, so the Steam entry and its appid stay valid; so does downloading the new
AppImage over the old file at the same path. Use either when the app cannot
replace itself, for example if the AppImage lives somewhere read-only.

The installer detects the existing Steam shortcut instead of adding a second
one, and does not touch what Steam stores for it: a renamed entry, a chosen
controller layout and library artwork you replaced or removed stay as they are.
Artwork it installed itself is refreshed on update. Use `--force-art` to put the
packaged hero, logo, header and icons back. The desktop entry is also only
written when it does not exist.

## Staying signed in

SteamOS Game Mode has no keyring, so Beacon saves the session with Electron's
`basic_text` fallback: you stay signed in across launches, but the key is baked
into Chromium, so it is obfuscation rather than real encryption. In Desktop Mode
a real keyring may be available and the session is encrypted with it. The
sign-in screen says which case you are in.

## If it will not start

- **"Cannot mount AppImage"**: FUSE is unhappy. Add
  `--appimage-extract-and-run` to the Steam entry's launch options.
- **Nothing happens**: check the file is executable (`chmod +x`), and try
  launching it once from Desktop Mode to see the error.
- **A/B do nothing**: confirm the shortcut uses **Gamepad** or **Gamepad with
  Joystick Trackpad** in **Properties → Controller**. The app reads a real
  gamepad, not key presses.
- **Controller does nothing at all**: check the same setting and make sure the
  Steam Overlay is enabled.
- **Wrong icon or name in the library**: edit the entry's properties in Desktop
  Mode; Steam remembers it.

## Library art

The installer applies the project's own artwork. For community art, use the
SteamGridDB Decky plugin or set it manually in Desktop Mode; this project does
not bundle or download third-party art.
