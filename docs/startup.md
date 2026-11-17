# Startup

`Loading Beacon` is shown in two places. This page maps what happens between a
launch and the first usable screen, so a slow launch can be attributed to a
phase instead of guessed at.

## The phases

1. **Electron starts.** The main process loads `./ipc`, which constructs the
   `Catalog`. Its constructor reads `catalog.json` (about 1 MB: 1,283 videos and
   60 collections) and builds the lookup and search maps. This runs before the
   window exists, so it is black-screen time.
2. **The window is created and loaded.** The window stays hidden until
   `ready-to-show`, so nothing appears until the renderer has loaded the
   bundle, executed it and painted the first React frame.
3. **The local boot.** `App` chooses the first screen from local data only:
   `auth.session()` (the stored session), `catalog:cachedHome` (the last feed),
   `favourites:cached` (the last Favourites row), `catalog:cachedPages` (the
   last collection and episode pages) and `app:initialSlug`, in parallel. A
   signed-in session goes straight to Home with both; a guest goes to Login,
   and Skip reuses the guest's cached feed. No CMS request is on this path.
4. **Behind the screen.** `auth.status()` confirms the session with `meMember`
   and, if needed, a token refresh. `favourites:list` starts immediately behind
   the screen as well, so a first launch after an upgrade can fill the cache
   without waiting on status. Home starts `catalog:home`: settle queued progress
   writes, then `HomeBlocks` and `Continue watching` in parallel. The cached
   feed and row stay on screen throughout and are replaced when the refresh
   lands.

The startup spinner is delayed by 300 ms. A local boot paints the app
background and goes straight to Home or Login, so a fast launch never flashes a
spinner; a slow keyring or a waiting feed still gets one once the wait is worth
acknowledging.

A signed-in first launch — including the first after upgrading — with no
`home-cache.json` still shows the Home spinner for the feed request, and its
Favourites row arrives with that first list. Every later launch paints the
previous feed and row before the network answers.

## Cached Home

The feed and the Favourites row are account-specific: progress badges, locked
flags, Continue watching, the member's series and the row's chosen position all
depend on the account. The one slot in `home-cache.json` is therefore keyed by
account and schema version. Each half is written atomically after a successful
read, merged with the other, and best-effort deleted when:

- the account signs out;
- the file belongs to another account or an older schema;
- the file cannot be read.

Deletion failures never block boot, sign-out or sign-in. A slot found for
another account is deleted on sight, not merely ignored, so a shared Deck does
not keep the previous member's rows around. A guest has no account row, so the
Favourites half is not written for one; the guest's feed may still be reused
when Skip leaves sign-in.

Because the row is painted from the same slot as the feed, it no longer appears
after the shelves and shifts the page down.

## Cached pages

`page-cache.json` keeps the collection and episode pages the member has opened,
so a launch — or a later visit in the same run — can paint one before the CMS
answers. It is one account-and-version-scoped slot, deleted on sign-out or any
mismatch, exactly like Home.

The request caches (`collectionCache`, 5 minutes; `contentCache`, 10 minutes)
are now only a **freshness** policy. After that window the page is fetched
again, not forgotten: the saved copy stays on screen while the request runs.
A failed request keeps the saved copy and labels it in the top-right note. A
response that says the page no longer exists (the CMS returns an empty `docs`
list) deletes both copies and shows the error instead of resurrecting it.

The store is bounded by **2 MiB** with a 60-per-kind guard, evicting the least
recently used page across both kinds. The budget comes from live measurements
on 2026-11-17:

| Page | p50 | p95 | max |
|---|---|---|---|
| `CollectionData` | 4.3 KiB | 10.4 KiB | 68.4 KiB (123 episodes) |
| `ContentData` | 7.5 KiB | 9.4 KiB | 9.9 KiB |

A typical 20 collection + 20 episode working set is about 330 KiB, so 2 MiB is
roughly six times that, and about twice the 932 KiB catalog index. The 60-entry
guard only stops thousands of tiny entries (an empty collection is under 500 B);
the byte budget is the real bound.

The renderer loads the whole slot at boot and uses a matching page as the
screen's `initial` value. It still revalidates, and the screen shows a skeleton
rather than a spinner only when there is no saved copy. The tile that opened the
page supplies the title, art, series and runtime, so the header is already
correct while the shelves fill in.

A relaunch starts with an empty request cache, so the first open of a saved page
revalidates even if the file is minutes old; the saved copy paints meanwhile.
Within a run, the 5- and 10-minute windows are what decide whether an open needs
a request at all.

## Freshness and local writes

There is no clean state for account data. Another client can add or remove a
favourite, move a progress point or mark an episode watched at any moment, so a
cached screen is a last-known-good copy, not a claim about the server. A
persistent clean/dirty flag would be a promise the client cannot keep. Instead:

- Every launch, reconnect and window focus revalidates. The cached screen is
  shown while the read runs and is never treated as fresh.
- Favourites are write-through: a list read, add, remove or row move updates the
  slot. A read waits for a write already queued, and a read that started before
  a newer write is handed back to its caller but cannot replace the row or the
  cache.
- Progress and watch marks bump a feed generation. A feed read that was already
  in flight when a write landed is still shown to that caller, but it cannot
  become the next cached Home. The saved feed may lag the last progress tick;
  the next revalidation is what reconciles it.
- Cross-client changes are only observable by reading again. A failed read
  leaves the saved screen in place and labels it offline or failed.

The Favourites row re-reads on focus and reconnect at most once every ten
seconds, so a boot read is not repeated by an immediate alt-tab.

## What the viewer sees

- A quick refresh is silent: the cached feed or page looks like any other.
- If the refresh is still running after 1.5 s, a quiet `Updating…` pill appears
  in the top-right. It is not focusable and does not take a d-pad press.
- If the refresh fails, the cached feed or page stays and the pill says
  `You're offline` (no connection) or `Couldn't refresh — saved copy` (server
  failure). It stays until a later refresh succeeds.
- A page with no saved copy shows its skeleton: the title, art, series and
  runtime from the selected tile, plus the shelves' shape. There is no pill
  while the skeleton is up; there is nothing stale to label.
- Returning online, focusing the window, or coming back from another app
  triggers the same refresh, and a favourites read if the last one is old
  enough.

## Measured baseline before the cached feed

Two warm, signed-in runs on 2026-11-17, one built and one through the dev
server:

| Mark | Built | Dev |
|---|---|---|
| First frame / spinner | 192 ms | 1,455 ms |
| Boot requests done | 1,699 ms | 3,259 ms |
| Home on screen | 2,062 ms | 3,645 ms |

What dominated those runs:

| Work | Time | Notes |
|---|---|---|
| `meMember` query | 1.36–1.39 s | Was on the boot path |
| `FavouriteCollections` | ~0.18 s | Was sequential, after status |
| `HomeBlocks` | 0.33–0.53 s | After the route was set |
| `Continue watching` | 0.29–0.87 s | Same fetch; varies the most |
| Catalog snapshot + index | 12–23 ms | Synchronous, before the window |
| Keyring + session decrypt | ~2 ms | Small when the keyring is up |

The dev run adds two costs that production does not have: Vite's module graph
(~1.2 s before the first frame) and React StrictMode running the boot effect
twice, which repeats the boot requests.

## Remaining limits

- `catalog:ensure()` returns immediately when a snapshot exists, even a stale
  one. Only a machine without `catalog.json` waits for the first build; the
  Favourites list waits with it, but the cached row covers the screen meanwhile.
- `Continue watching` is fetched alongside `HomeBlocks`, so the refreshed feed
  waits for the slower of the two. The cached feed makes that wait invisible
  until the refresh chip appears.
- A page that has never been opened has no saved copy. It paints its skeleton
  from the tile immediately, but the episode list or shelves still wait for the
  request. There is no focus prefetch: resting on a tile does not warm its page,
  so the request starts when the page opens.
