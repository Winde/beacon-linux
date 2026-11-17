# Acknowledgements

## VacuumTube

[shy1132/VacuumTube](https://github.com/shy1132/VacuumTube) — MIT License,
Copyright (c) 2025-2026 shy.

Reference for the platform shape, not the implementation: an Electron shell, a
frameless window, a controller-first UI and AppImage distribution. VacuumTube
wraps YouTube Leanback and drives it with synthetic key events; this app has its
own screens and spatial navigation.

Its controller module was read for Steam Input behaviour — prefer the virtual
pad, ignore input while unfocused, hold-to-repeat. No source code is included;
`src/renderer/src/input/useInput.ts` is an independent implementation that
emits semantic actions.

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
- [Iconoir](https://github.com/iconoir-icons/iconoir) — MIT, for the `hexagon-dice` app icon
