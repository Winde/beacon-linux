# Releasing

Releases are cut from tags, but nothing is automatic. Pushing a tag builds
nothing and publishes nothing. You create the release yourself, then run
[`.github/workflows/release.yml`](../.github/workflows/release.yml) by hand for
that tag, and it attaches the artifacts.

## Versioning

Semantic versioning, tagged `vMAJOR.MINOR.PATCH`.

| Bump | When |
|---|---|
| MAJOR | A stored format changes incompatibly (session file, catalog cache), or the app is reorganised in a way that breaks muscle memory |
| MINOR | A new user-facing capability |
| PATCH | Fixes only, no new behaviour |

Pre-releases use a suffix: `v0.2.0-beta.1`, `v0.2.0-rc.1`. Mark them **Set as a
pre-release** when creating the release. The workflow refuses to upload a
hyphenated tag to a release that is not marked pre-release (and a plain tag to
one that is), so a beta cannot become the "latest" download.

## What a release contains

| Platform | Artifacts |
|---|---|
| Linux x64 | `Beacon-<version>-x86_64.AppImage` |
| all | `SHA256SUMS.txt` |

The AppImage is the only published artifact. It is self-contained and runs on
SteamOS and other glibc-based distributions; FUSE 2 is its only system
dependency (SteamOS has it, and `--appimage-extract-and-run` works without it).

## Cutting a release

1. Bump `version` in `package.json`.
2. Commit it on `main` and push.
3. Tag and push the tag. This does not start a build:

   ```sh
   git tag -a v0.2.0 -m "v0.2.0"
   git push origin v0.2.0
   ```

4. Create the release in the GitHub UI for that tag. Tick **Set as a
   pre-release** if the tag has a hyphen.
5. Go to **Actions → Release → Run workflow**, enter the tag, and leave
   `dry_run` off.
6. Check the run and the assets on the release.

The run checks out that tag, fails immediately if it disagrees with
`package.json`, runs typecheck and tests, builds the AppImage, and uploads it and
the checksums to the release you created. If the release does not exist, the
publish job stops with a message telling you to create it.

The publish job only runs after the Linux build passes, so a failed build leaves
the release untouched.

## Testing the process

The tag must match `package.json` exactly, so choose the version first. A
rehearsal uses a prerelease version and `dry_run`; that runs the same checks and
the AppImage build but skips the publish job, so no release is needed and
nothing is modified.

1. Set `version` in `package.json` to the prerelease you are rehearsing, for
   example `0.2.0-rc.1`. Commit it and push.
2. Tag that commit and push the tag:

   ```sh
   git tag -a v0.2.0-rc.1 -m "release rehearsal"
   git push origin v0.2.0-rc.1
   ```

3. Run **Actions → Release** with that tag and `dry_run` on.
4. Download the `linux` artifact from the run.
5. Install and run the AppImage on a Steam Machine or Deck: sign in, play a
   video, use the controller. See [install-steamos.md](install-steamos.md).
6. If the build is not what you want, fix it, delete the tag and repeat:

   ```sh
   git tag -d v0.2.0-rc.1
   git push origin :refs/tags/v0.2.0-rc.1
   ```

7. To ship, either keep the prerelease version and create the release with
   **Set as a pre-release** ticked, or bump to the stable version, commit, tag
   and rehearse once more. Then create the release and run the workflow with
   `dry_run` off.

If you are already on the version you intend to ship, you can rehearse on its
tag directly: tag it, run with `dry_run` on, then create the release and run
again with `dry_run` off.

## Re-running

Run the workflow again with the same tag. Uploads use `--clobber`, so artifacts
are replaced rather than duplicated.

To abandon a release, delete it in the GitHub UI and delete the tag:

```sh
git tag -d v0.2.0
git push origin :refs/tags/v0.2.0
```

## Distribution channels

**GitHub Releases** is the only channel. There is no store, no package
repository, and no CI job that publishes anywhere else.

**SteamOS** needs one Desktop Mode trip: download the AppImage, make it
executable, add it to Steam, then launch it from Game Mode. The AppImage lives
in `/home`, so it survives system updates. Updates are manual for now: download
the new AppImage over the old one; the Steam entry keeps working.

**Other glibc distributions** run the same AppImage. FUSE 2 is the only system
dependency; where it is missing (some Ubuntu installs), `--appimage-extract-and-run`
works without it. Packagers can extract the AppImage with `--appimage-extract`
or build from the tag.

### Why not Flatpak

Flatpak is not shipped, and adding it back should start with a fresh decision:

- Discover is Desktop Mode only, and a Flatpak still has to be added to Steam by
  hand before it appears in Game Mode. It does not remove the setup step.
- Flatpak updates run in Desktop Mode, which a Game Mode user does not visit. An
  in-app update check is the better path for this app.
- The sandbox needs broad holes for controllers, GPU decode, the keyring, MPRIS
  and the Steam overlay, and a Flatpak would be a second build system
  (`flatpak-builder`, the Electron base app, a vendored Electron, generated npm
  sources) to keep green through every Electron upgrade.

Revisit only if reaching non-technical users becomes the goal, and then in a
separate Flathub repository.

## Checklist

- [ ] `package.json` version bumped and committed on `main`
- [ ] `npm run typecheck` and `npm test` pass
- [ ] `dry_run` workflow passed on the release tag or a prerelease of it
- [ ] AppImage installs and plays a video on a Steam Machine
- [ ] Tag matches `package.json` exactly (`v` prefix)
- [ ] Release created; pre-release checkbox matches the tag suffix
- [ ] Release notes read sensibly
- [ ] Run finished; assets and `SHA256SUMS.txt` are on the release
