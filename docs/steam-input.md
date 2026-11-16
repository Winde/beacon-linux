# Steam Controller and Steam Input

What the app has to do to feel native on a Steam Machine, and why.

## How Steam Input presents the controller

Steam never hands an app the raw Steam Controller. It presents a **virtual Xbox
pad** through Steam Input, and the app sees one standard gamepad.

From the Steamworks docs, the default legacy ("Gamepad") template maps:

| Physical input | Presented as |
|---|---|
| A / B / X / Y | XInput A / B / X / Y |
| Bumpers | LB / RB |
| Analog triggers | LT / RT (analog) |
| Start / Back | Start / Back |
| Left stick | Left stick |
| **Left trackpad** | **D-pad** (input source mode "Dpad") |
| **Right trackpad** | **Right stick** ("Mouse Joystick") |
| Right trackpad click | R3 |
| Grips (L4/L5/R4/R5) | *not exposed* |
| Steam button, Quick Access Menu | *consumed by Steam* |

The virtual device identifies itself with Valve's vendor id, `28de`, and a
product id of `11ff` for the virtual gamepad. In the browser Gamepad API its
`id` looks like:

```
Microsoft X-Box 360 pad (STANDARD GAMEPAD Vendor: 28de Product: 11ff)
```

The Steam Deck's built-in controls go through the same path in Game Mode, so one
code path covers both.

## What the app relies on

1. **`navigator.getGamepads()` with the `standard` mapping.** Polled every frame.
   No native modules, no SDL, no Steamworks SDK.
2. **D-pad *and* left stick for navigation**, with a deadzone and hold-to-repeat.
   The left trackpad arrives as the D-pad, so it works without extra code.
3. **Only one pad drives the UI.** Steam can expose both the virtual pad and the
   physical device. The app prefers the Steam pad (`28de`) and otherwise takes
   the first connected one, so a button never fires twice.
4. **Input stops when the window loses focus.** The Steam overlay and alt-tab
   must not move focus behind the player's back, and held buttons must not stick.
5. **Real `<input>` elements for text.** Steam's on-screen keyboard (`STEAM` + `X`)
   types into whatever has DOM focus, so the login form works without a keyboard.
6. **Keyboard parity.** Every action also has a key, so the app is usable in
   Desktop Mode and in a dev environment with no pad attached.

## Known Electron problem

There is a long-standing regression: **Electron 27+ (Chromium 114+) does not see
gamepads when launched through Steam with Steam Input enabled on Windows.** The
same build works when run directly, and native Linux builds are unaffected.

- [electron/electron#45989](https://github.com/electron/electron/issues/45989)
- [electron/electron#45732](https://github.com/electron/electron/issues/45732)

A Steam client patch (September 2025) is reported to have fixed it. This only
matters for testing on Windows; the target platform (SteamOS) is not affected.
If you hit it, set the game's controller layout to **Gamepad** or disable Steam
Input for that entry.

## Recommended setup

1. Add the app to Steam as a non-Steam game.
2. Properties → Controller → pick the **Gamepad** template. Do not use
   "Keyboard (WASD) and Mouse" — the app reads a real gamepad, not key presses.
3. Make sure **Enable the Steam Overlay while in-game** is on. Steam Input and
   the on-screen keyboard both depend on the overlay.
4. Launch from Game Mode.

## Packaging notes

- **Flatpak**: gamepad access needs udev. Add `--filesystem=/run/udev:ro` to the
  Flatpak permissions, or the Gamepad API sees nothing.
- **Steam Runtime**: Electron under the Steam Runtime may need `--no-sandbox`.
- **`uinput`**: Steam Input creates the virtual pad through `/dev/uinput`. On
  systems with systemd 258 the module failed to load, which broke controller
  input for every game. If no pad is detected at all, check `lsmod | grep uinput`.

## Why not the Steamworks SDK

The Steam Input API (action sets, native bindings) would give nicer glyphs and
per-action rebinding, but it requires the Steamworks SDK, a native module, and
the app to be launched by Steam. The plain Gamepad API already covers everything
this app needs, and it keeps the build dependency-free and portable. VacuumTube
makes the same trade-off.
