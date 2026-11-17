# Installing on SteamOS (Steam Machine, Steam Deck)

The AppImage is the only published build. SteamOS is image-based: keep
everything in `/home` and do not copy files into `/usr`. What follows lives in
`/home`, so it survives system updates.

## Fast path

In Desktop Mode, with Steam running:

```sh
curl -LO https://github.com/Winde/beacon-linux/releases/latest/download/install.sh
less install.sh
bash install.sh
```

The script downloads and verifies the AppImage, installs it to
`~/Applications/Beacon.AppImage`, adds a Steam shortcut, and applies the
library artwork. Re-run it to update. `--no-steam` installs without the
shortcut; `--version vX.Y.Z` pins a release; `--uninstall` removes the local
files. It does not write outside `$HOME`.

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
   template. Leave **Enable the Steam Overlay while in-game** on: Steam Input and
   the on-screen keyboard both depend on it.
6. Return to Game Mode (**Return to Gaming Mode** on the desktop, or Steam →
   Power) and launch Beacon from the Non-Steam section of your library.

The first launch shows the sign-in screen. Free videos work without an account.
On a Steam Machine or Deck, `STEAM` + `X` opens the on-screen keyboard for the
password field.

## Updates

Re-run the installer; it replaces `~/Applications/Beacon.AppImage` in place, so
the Steam entry and its appid stay valid. Manually, download the new AppImage
over the old file at the same path. Check the release notes for anything that
needs doing first.

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
- **Controller does nothing**: confirm the Steam entry uses the **Gamepad**
  template and the Steam Overlay is enabled. The app reads a real gamepad, not
  keyboard input.
- **Wrong icon or name in the library**: edit the entry's properties in Desktop
  Mode; Steam remembers it.

## Library art

The installer applies the project's own artwork. For community art, use the
SteamGridDB Decky plugin or set it manually in Desktop Mode; this project does
not bundle or download third-party art.
