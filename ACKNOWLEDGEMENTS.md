# Acknowledgements

## VacuumTube

[shy1132/VacuumTube](https://github.com/shy1132/VacuumTube) — MIT License,
Copyright (c) 2025-2026 shy.

VacuumTube is the reference for how a media app should feel on SteamOS: an
Electron shell, a frameless fullscreen window, controller-first navigation, and
AppImage/Flatpak packaging. This project follows that approach.

No VacuumTube source code is included here. Its controller module was read to
understand how Steam Input presents a pad and which pitfalls matter (preferring
the Steam virtual device, ignoring input while unfocused, holding a repeat
delay); the implementation in `src/renderer/src/input/useInput.ts` is written
from scratch for React and emits semantic actions rather than synthetic key
events, because this app owns its own navigation instead of driving a vendor UI.

If any VacuumTube code is ever copied in, the MIT notice above must be carried
with it.

## Beacon (Critical Role)

Beacon and Critical Role are trademarks of Critical Role Productions LLC.

This project is unofficial and unaffiliated. It is a client: it talks to Beacon's
own API with the user's own account, and it plays the same non-DRM HLS streams
Beacon serves its own TV clients. It does not redistribute, re-host, or
circumvent access to any content, and it bundles no Beacon artwork, logos, or
media. All titles, images and video are loaded at runtime from Beacon's servers
and remain the property of their owners.

## Open source dependencies

- [Electron](https://github.com/electron/electron) — MIT
- [React](https://github.com/facebook/react) — MIT
- [hls.js](https://github.com/video-dev/hls.js) — Apache-2.0
- [Vite](https://github.com/vitejs/vite) and [electron-vite](https://github.com/alex8088/electron-vite) — MIT
