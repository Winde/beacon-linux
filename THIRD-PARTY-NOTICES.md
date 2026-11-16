# Third-party notices

This application bundles the following open source components. Their licenses
apply to those components; the rest of the application is MIT (see `LICENSE`).

Full license texts are in [`licenses/`](licenses/).

## Bundled in the application

| Component | Version | License | Copyright |
|---|---|---|---|
| [React](https://github.com/facebook/react) | see `package.json` | MIT | Meta Platforms, Inc. and affiliates |
| [React DOM](https://github.com/facebook/react) | see `package.json` | MIT | Meta Platforms, Inc. and affiliates |
| [hls.js](https://github.com/video-dev/hls.js) | see `package.json` | Apache-2.0 | Dailymotion |
| [Electron](https://github.com/electron/electron) | see `package.json` | MIT | Electron contributors |
| [Iconoir](https://github.com/iconoir-icons/iconoir) | `hexagon-dice` | MIT | Luca Burgio |

`licenses/react.txt` covers both React and React DOM.

The app icon (`packaging/flatpak/io.github.Winde.BeaconLinux.svg`, rasterised to
`build/icon.png`) is Iconoir's `hexagon-dice` glyph placed on a square canvas —
recoloured, rescaled and padded, with no other changes. It is not derived from
any Critical Role or Beacon artwork. `licenses/iconoir.txt` covers it.

Electron ships its own notices with the packaged app — `LICENSE.electron.txt` and
`LICENSES.chromium.html` — which cover Electron itself and Chromium, including
the codecs used for video playback. Those files are produced by the packager and
are not duplicated here.

## hls.js

hls.js is licensed under the Apache License, Version 2.0. The full text is in
[`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt); the upstream notice is in
[`licenses/hls.js.txt`](licenses/hls.js.txt).

hls.js is bundled into the renderer as part of the build, unmodified apart from
minification.

## Development only

These are used to build the application and are not distributed with it:

Vite, electron-vite, electron-builder, TypeScript, `@vitejs/plugin-react`, and the
`@types/*` packages. All are MIT or Apache-2.0 licensed.
