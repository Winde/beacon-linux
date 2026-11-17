# Steam library artwork

Deterministic, not generative: every asset is the existing app icon plus a flat
gradient and typography. No Beacon, Critical Role, or third-party artwork is
included.

| File | Size | Steam name |
|---|---|---|
| `hero.png` | 1920×620 | `<appid>_hero.png` |
| `portrait.png` | 600×900 | `<appid>p.png` |
| `header.png` | 460×215 | `<appid>.png` |
| `logo.png` | 512×512, transparent | `<appid>_logo.png` |
| `icon.png` | 256×256, transparent corners | `<appid>_icon.png` |

The icon is `build/icon.png` (Iconoir `hexagon-dice`, MIT, see
`THIRD-PARTY-NOTICES.md`). The logo is the same SVG with the background
`<rect>` removed, rendered on transparency. The wordmark uses Segoe UI Bold;
the gradient is `#191B1F` to `#0E0F12` with the icon's `#F5A524` accent.

`generate/` holds the reference scripts used to produce the PNGs. They are
Windows-only (`System.Drawing` and Electron) and are not part of the release
archive; the committed PNGs are the source of truth.

The release workflow zips only the five PNGs into `steam-art.zip`. The
installer reads the shortcut appid from Steam's `shortcuts.vdf` and copies
them into `userdata/<id>/config/grid/`.
