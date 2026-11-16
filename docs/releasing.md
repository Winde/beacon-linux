# Releasing

Releases are cut from tags, but nothing is automatic. Pushing a tag builds
nothing. You create the release yourself, then run
[`.github/workflows/release.yml`](../.github/workflows/release.yml) by hand for
that tag, and it attaches the artifacts.

## Versioning

Semantic versioning, tagged `vMAJOR.MINOR.PATCH`.

| Bump | When |
|---|---|
| MAJOR | A stored format changes incompatibly (session file, catalog cache), or the app is reorganised in a way that breaks muscle memory |
| MINOR | A new user-facing capability |
| PATCH | Fixes only, no new behaviour |

Pre-releases use a suffix: `v0.2.0-beta.1`, `v0.2.0-rc.1`. Any tag containing a
hyphen is published as a GitHub pre-release, so it does not become the "latest"
download.

## What a release contains

| Platform | Artifacts |
|---|---|
| Linux x64 | `.AppImage`, `.deb`, `.tar.gz` |
| Windows x64 | NSIS installer (`.exe`) |
| all | `SHA256SUMS.txt` |

Linux is the supported target. The Windows build exists because development
happens there and it is the easiest way to test a change; it is not the product.

## Cutting a release

1. Bump `version` in `package.json`.
2. Commit it on `main` and push.
3. Tag and push the tag. This does not start a build:

   ```sh
   git tag -a v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   ```

4. Create the release in the GitHub UI for that tag, with whatever notes you want.
5. Go to **Actions → Release → Run workflow** and enter the tag (`v0.2.0`).

The run checks out that tag, fails immediately if it disagrees with
`package.json`, builds both platforms, and uploads the artifacts and checksums to
the release you created. If the release does not exist yet, the `publish` job
stops with a message telling you to create it.

Artifacts only appear if every build succeeds, so a failed run leaves your
release empty rather than half-populated.

## Re-running

Run the workflow again with the same tag. Uploads use `--clobber`, so artifacts
are replaced rather than duplicated.

To abandon a release, delete it in the GitHub UI and delete the tag:

```sh
git tag -d v0.2.0
git push origin :refs/tags/v0.2.0
```

## Distribution channels

**GitHub Releases** is the primary channel and the only one wired up in CI.
Users on SteamOS add the AppImage as a non-Steam game, or install the `.deb` on a
Debian-based desktop.

**Flathub** is the better long-term path for SteamOS: it installs into Game Mode
without the user managing a file, and it survives system updates. It is a
separate repository and a manual submission, not something CI can push to.

## Flatpak

`packaging/flatpak/` holds the manifest, launcher and desktop metadata. **None of
it has been built or tested yet** — treat it as a starting point, not a working
package.

Two generated files are required and are deliberately not committed:

```sh
# npm packages, vendored for offline builds
flatpak-node-generator npm package-lock.json -o packaging/flatpak/flatpak-sources.json
```

`flatpak-node-generator` comes from
[flatpak-builder-tools](https://github.com/flatpak/flatpak-builder-tools).

To build locally on Linux:

```sh
flatpak-builder --user --install --force-clean build-dir \
  packaging/flatpak/io.github.Winde.BeaconLinux.yml
```

To publish, open a pull request against `flathub/io.github.Winde.BeaconLinux`
with the manifest and generated sources. Flathub requires:

- an app id you control — `io.github.Winde.BeaconLinux` follows their GitHub
  convention;
- an icon at `io.github.Winde.BeaconLinux.svg` (or `.png`) — **not yet drawn**;
- AppStream metadata that passes `appstreamcli validate`;
- a tagged git source, so the manifest must point at a real release tag.

The manifest pins `tag:` in its git source. Bump it alongside each release.

## Checklist

- [ ] `package.json` version bumped and committed
- [ ] `npm run typecheck` passes
- [ ] App runs and plays a video
- [ ] Tag matches the version exactly
- [ ] Release notes read sensibly
- [ ] Flatpak manifest tag bumped (when Flatpak is in use)
