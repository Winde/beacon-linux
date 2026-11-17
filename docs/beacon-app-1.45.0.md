# Pocket Beacon 1.45.0 — APK notes

Notes from taking apart the official Android app, to check our client and our
[API notes](beacon-api.md) against what Beacon itself ships.

> Unofficial. Not affiliated with Critical Role or Beacon. Taken apart from a
> copy of the public APK for interoperability notes only.

| | |
|---|---|
| File | `Pocket+Beacon_1.45.0_APKPure.xapk` (XAPK = zip of split APKs) |
| Package | `tv.beacon.app` (versionCode 508) |
| Version | 1.45.0 |
| Target SDK | 36, minSdk 24 |
| Built with | Expo SDK 55 / React Native, Hermes bytecode |
| Checked | 2026-11-17 |

**Not the TV app.** Our API notes assumed the Android TV client is
`tv.beacon.ott`. This bundle is the phone app (`tv.beacon.app`, portrait,
PiP, Chromecast). The device-code / QR sign-in question for the TV app is
therefore still open.

## 1. How to take it apart

```bash
unzip Pocket+Beacon_1.45.0_APKPure.xapk -d xapk      # base + config.* splits
unzip xapk/tv.beacon.app.apk -d base                 # assets/index.android.bundle
```

`assets/index.android.bundle` is **Hermes bytecode** (magic `c61fbc03`,
version 96), not JavaScript, so `jadx`/`apktool` on it is useless. Anything
that reads it needs a Hermes-aware tool:

- `hermes -b -dump-bytecode assets/index.android.bundle > dis.txt` with a
  matching CLI (Hermes v0.13.0 has bytecode version 96). The dump is ~150 MB
  and contains every string and instruction, with function names preserved.
- The string table alone is enough for most protocol work: it yielded the
  GraphQL documents, endpoints, header names and storage keys below.
- GraphQL documents are stored verbatim as single strings, so they can be
  extracted exactly rather than reconstructed from fragments.

The app is an Apollo Client front end over the same CMS we use; almost
everything in [beacon-api.md](beacon-api.md) is confirmed by it.

## 2. What matches what we already do

Confirmed against the app, no change needed:

- CMS endpoint `https://critrole-beacon-production-backend.clockhosting.com/api/graphql`.
- Memberful origin `https://pocketbeacon.memberful.com` and its `/oauth` endpoint.
- `contents` by slug, `currentProgress`, `fetchSeries(collection, season, content, limit)`,
  `search(...)`, `collectionSearch`, `continueWatching(page, limit)`,
  `getProgressForContent(id: [...])` with `timeMap`, `trackView(events)`,
  `removeContentFromContinueWatching(id)`.
- Progress schema: `videoProgress` percent + `videoProgressSeconds`;
  `EventInput` carries `content`, `viewedAt`, `sessionId`, duration and both
  progress values.
- The request header names `x-platform`, `x-supports-drm` and
  `x-has-waiting-room` all exist in the app.
- `fetchSeries` takes the collection **id** and `content: <id>` to return `next`.
- **The live schema can be introspected.** The standard `IntrospectionQuery`
  answers on the same endpoint (no auth needed) with 9,843 types, every
  `Content` field and the full `search` argument list. Use that for field
  questions; the APK is still needed for documents and client behaviour.

## 3. Where we differ

### 3.1 Sign-in: the app never sees a password

The app signs in with **OAuth 2.0 authorization code + PKCE** in a browser,
not the password grant:

- `grant_type=authorization_code` with `code` and `code_verifier`;
- `code_challenge` built from a per-attempt verifier (S256);
- refresh with `grant_type=refresh_token` (also carrying a `code_verifier`);
- access-token lifetime **15 minutes** (`ACCESS_TOKEN_EXPIRY`, 60 s leeway)
  rather than the hour Memberful's `expires_in` suggests;
- redirect target `tv.beacon.app://` (app scheme), so the browser hands the
  code back to the app;
- tokens live in `expo-secure-store` (Android Keystore), and the member's data
  is read from `https://pocketbeacon.memberful.com/api/graphql/member`.

Ours uses the password grant, which works, but it means the password crosses
our process and, for anyone whose account has no password set, sign-in is
impossible. PKCE would remove both problems and matches how Beacon expects
clients to behave. Cost: a browser window and a localhost loopback listener
in the main process. Worth doing.

### 3.2 We identify as `web`

We send `x-platform: web` (and `x-supports-drm: false`,
`x-has-waiting-room: true`). The header names exist in the app, but the
*values* are built at runtime, so the bundle does not show them as literals.
Almost certainly the app sends its own platform (`android`), which is what a
Beacon-engineer reading their logs would expect from a native client.

This matters beyond manners: home blocks carry `excludedPlatforms { ios
android web }`, and content can be flagged app-only (`appOnly` prompts). A
`web` client can legitimately be shown different home content than the app.

**Tested live (2026-11-17), and it makes no difference today.** Every document
the client sends — `meMember`, `GetMemberHomePage`, `search`,
`collectionSearch`, a 1000-item `Collections` listing, `continueWatching`,
`userCollectionFavourites`, and `Contents`/`Contents.media`/`fetchSeries` for
four recent items — came back byte-identical under `x-platform: web` and
`x-platform: android`, signed in and signed out. The locked answer for a
Member-tier item is also identical: access is decided by the bearer token, not
the platform header.

The editorial home is the same too, signed in or not. All five live blocks
have `excludedPlatforms` false for every platform, and all 1,759 content docs
have an empty `Content.excludedPlatforms`, so the server never varies these
responses by `x-platform`; only the client's own filtering would, and that is
also unchanged. `Content.excludedPlatforms` does carry an `ott` flag, but
nothing is flagged today. Sending `android` would be more honest in Beacon's
logs; staying on `web` changes nothing. `x-supports-drm: false` still matters:
it is what keeps the stream plain HLS.

### 3.3 There is a real favourites system

Our README says "Beacon has no watchlist", and we built a local one. The app
has *server-side favourites* for both content and collections:

```graphql
query  { isContentFavourite: hasContentFavourited(id: "<id>") }
mutation ToggleContentFavourite($id: String!) {
  toggleContentFavourite: toggleContentFavourite(id: $id) { success reason isFavourite }
}
# and the collection equivalents: hasCollectionFavourited / toggleCollectionFavourite
query { favourited: favouriteCollections ... }   # GetUserCollectionFavourites / GetFavouritesPage
```

This is not the same feature as a watchlist: favourites are for series and
collections you follow, and there is no "saved episodes" list. The client used
to keep a local watchlist; it now uses these favourites for series and
collections, and no longer saves individual episodes. That makes saved shows
visible on beacon.tv and in the app, and removes the device-local list and its
sign-out prompt.

The one local part left is where the Favourites row sits on Home
(`preferences.json`), because that is layout, not account data. Verified live
(unauthenticated): the fields exist, both mutations answer
`"You must be logged in to favourite …"`, and the list exposes
`totalPages`/`totalDocs`/`page` but no `hasNextPage`.

### 3.4 Progress reporting is batched and offline-tolerant

The app does not fire one `trackView` per event. It has a small queue:

- events are appended to a local store and sent on a **20 s** timer
  (`setInterval(..., 20000)`), on app state changes (background/inactive), as
  soon as ten are waiting, on player ready (a forced bare `{ content }` event),
  on unmount, and when a cast session ends;
- a flush sends **at most 10 events per mutation**, but drains in a loop: the
  whole queue goes out in ten-event batches, so one flush can be several
  mutations; positions are queued after **10 s** of playback movement (the first
  tick always queues), and the queue keeps only the first event per content per
  ten-second bucket;
- a failed send (thrown, or `success: false`) keeps the events stored, stops
  that flush, and retries on the next trigger, with console error logging; a
  NetInfo check skips the attempt entirely while offline; the queue holds at
  most **500** events and drops the oldest;
- the store is AsyncStorage key `unsentEvents` in production builds and is
  loaded at startup, so a position survives the app being closed — but it is
  one global key, not per account, so pending events are sent with whichever
  member signs in next;
- `viewedAt` is `new Date().toISOString()` at **enqueue** time (the send-time
  stamp is overwritten by the spread), `sessionId` is generated per app run,
  and the rest of the event object is copied from the caller (`content`,
  `duration`, `videoProgress`, `videoProgressSeconds`).

Our main process now uses the same shape, with one deliberate change: the
queue is stored per account (`progress-queue.json`), never under whichever
token signs in next. The player queues a started view and a position every
10 s of playback; the client sends ten at a time on a 20 s timer, on window
blur/hide, on suspend and lock, and on quit (with a short bounded wait), and a
screen read flushes first. Failed or offline events stay on disk instead of
being dropped.

Marks use the same queue. An explicit watched/unwatched mark first drops any
older position still queued for that title, then queues its 99%/1% point with
an internal flag; the Continue-watching removal is sent only after that point
lands. Playback reports in the other direction drop an unsent mark for the
title, because starting to watch is the newer decision.

### 3.5 The home page is block-driven, and we build it ourselves

The app asks for one document and renders whatever blocks come back:

```graphql
query GetMemberHomePage { MemberHomePage: MemberHomepage { pageContent {
  ...ContentHero ...SkipTo ...FeaturedCarousel ...SeriesCarousel ...ForYou
  ...CategoriesGrid ...PopularCollectionsCarousel ...LatestCarousel
  ...ContinueWatchingV2 ...WatchCarousel ...ListenCarousel ...YourInterests
  ...ReadCarousel ...HeroCarousel ...ButtonRow ...RedesignHeroCarousel
} } }
```

Notable block details:

- every block has `excludedPlatforms { ios android web }`; the app hides the
  block per platform;
- `ContinueWatchingV2` carries editor-set `limit` and `color`;
- heroes come in several shapes (`ContentHero`, `HeroCarousel`,
  `RedesignHeroCarousel`, `CustomHero`) with CTA labels and either a single
  content item or mixed `Content`/`Collection` items;
- `LatestCarousel` has `carouselTitle`, `latestColor`, CTA and content.

Our home is assembled from `search(-releaseDate)` + `collectionSearch` +
`continueWatching`. That is stable and cheap, but it cannot show editorial
rows (For You, Watch/Listen/Read carousels, categories) and its hero is our
own pick. If we want the real home, `MemberHomePage.pageContent` is the
query, and the block shapes are all in the appendix.

**Update (2026-11-17):** the client now renders the block home. The hero,
Featured, Continue watching, Watch by Series and Latest Videos come from
`pageContent` in editorial order, keyed by each block's CMS `id`;
`excludedPlatforms` is honoured and editorial/audio items are filtered out
until those screens exist. The old search-based builder is gone, not kept as a
fallback — a block failure shows an error instead of a different home.

### 3.6 Content page fields we do not ask for

`GetContentPage` requests, besides what we already fetch:

- `ottTitle` — a second, display-oriented title (see the table below);
- `publishedAt`, `contentVisibleAt`, `msUntilVisible`, `secondsAfterAvailable`,
  `continuedSummary`, `comingSoonTagDate` — scheduling / "coming soon";
- `contentLivestream { currentStream, player, main { ... on MuxAsset { playbackUrl } | on Video { ... } }, fallback { ... } }`
  — how live video is delivered (Mux asset, not just JW);
- `contentPodcast { podcast { source audio player audioData } }`;
- `freeContent { ...FreeLink ...ButtonRow }` — what a locked item offers free;
- `primaryCollection { ... podcastFeed }`, `tags { id name slug }`;
- `thumbnail.sizes.square` and `portrait`, plus `podcastThumbnail`;
- on `contentVideo.video`: `player` and `playlistUrl` (we use `video` and
  `videoData`).

`RefetchMedia` is the reduced version the app re-runs before playback: id,
contentType, duration and the three media unions plus
`currentProgress`. Worth copying as our media-only query — it is smaller
than our `MEDIA` + `LOOKUP` pair and gives us livestream/podcast sources.

**Live check (2026-11-17, Member account, all 1,759 content docs).** Which of
these are worth asking for:

| Field | Reality | Use? |
|---|---|---|
| `ottTitle` | Non-null on all 1,759 docs; differs from `title` on 1,156. Strips series/episode prefixes (`C4 E043 \| The Water's Edge` → `The Water's Edge`) and sometimes adds the show (`Abubakar Salim \| Shirts off Sam's Back`). | **Yes** — card/hero/up-next title, `title` as fallback. Keep `title` for the catalog index and episode-code parsing; an editor's `ottTitle` is occasionally wrong (`Comics!` on an unrelated Weird Kids episode). |
| `continuedSummary` | 142 of 300 recent docs; about 1,086 characters against a 125-character `description`. It is the rest of the page body (credits, sponsors, health note), not a one-line synopsis. | **Yes** — append it below `description` on the content page. |
| `contentVisibleAt`, `msUntilVisible` | `contentVisibleAt` set on 43 docs, all past except the CMS test doc `coming-soon-test` (visible 2035). Search still returns not-yet-visible docs. | **Yes** — treat a future `contentVisibleAt` as "not playable yet". |
| `comingSoonTagDate` | The card badge date, 15 minutes before `contentVisibleAt` (e.g. 01:45 for a 02:00 release); all in the past right now. | **Yes** — "Coming soon" badge / premiere label, paired with the guard above. |
| `contentLivestream` | Present on every doc, but `currentStream`, `main` and `fallback` are null on everything sampled; `enableMonitoring: true` and a JW `player` URL are always set. No `livestream` docs exist today. | **Only for live.** Presence is not a signal; use `contentType: livestream` + `currentStream`. When live, read `main`/`fallback` `MuxAsset.playbackUrl`. |
| `contentPodcast` | 990 `videoPodcast` docs also have `contentVideo`; 93 `podcast` docs are audio-only (`audio` HLS + podcast `player`). | **Later** — only needed for audio playback. |
| `freeContent` | Empty `[]` on every sample, Free and Member tier alike. | **No, for now.** |
| `tags` | 8 of 300 recent docs. | **No, for now.** |
| `thumbnail.sizes.square` / `portrait`, `podcastThumbnail` | Square and portrait exist on all 1,759 docs. | Only for a square grid or audio row; TV stays on `landscape`/`landscape2x`. |
| `primaryCollection.podcastFeed` | Present (an external `members.beacon.tv` feed URL). | **No** — that is podcast-app plumbing, not playback. |
| `video.player`, `video.playlistUrl` | `player` is the JW library URL, not a stream; `playlistUrl` is null on samples. | **No** — keep `video` + `videoData`. |
| `isTrailer`, `ottIsHero` | `false` on all 1,759 docs. | **No** — unused CMS fields. |
| `rating`, `popularity` | Not star ratings: engagement counters (`rating` up to 2,027, `popularity` up to 46,474). | **As sort keys only** (`sort: "-popularity"`, `"-rating"`); never render them as a score. |
| `secondsAfterAvailable` | `-1` on every doc. | Live sync only. |
| `Content.excludedPlatforms` | Empty on all 1,759 docs (it also carries an `ott` flag). | Not yet. |

Pre-roll exists as a content flag, not a setting on the video:
`Videos(where: { prerollVideo: { equals: true } })` returns the pre-roll
item(s). We ignore pre-roll today.

### 3.7 Series pages

`GetEpisodesList` adds `autoplayDisabled` next to `series`, and `next`
returns `ottTitle`, `contentType`, `contentTier`, `thumbnail.square`,
`episodeNumber`, `updatedAt`. `autoplayDisabled` is per series and is the
editor's switch: the app always renders its `NextEpisodeCard`, but only starts
the five-second countdown when the flag is false. A click still plays the next
item. We now read the flag from `fetchSeries`, suppress automatic advance when
it is true, and leave the card as a manual offer.

The app also trusts `next` as-is: it does not check the candidate's collection
or episode number. Our player now does the same.

### 3.8 Search has filters we do not expose

`GetContentSearch` takes `searchTerm`, `category`, `collection`, `sort`,
`contentTier`, `contentTypes`, `page`, `limit` and `hideFromLatest`. We use
search term, collection, sort, types, page and limit.

The live `search` field also accepts `collections: [String]`,
`collectionMatch`, `tag`, `season`, `idsToRemove`, `featured`, `previewDate`
and `preview`. Those are editorial/plumbing except where noted below.

**Tested live (2026-11-17, 1,759 docs, 1,283 playable).** All the string
filters take the **CMS id**, not the slug or the name — a slug returns zero
results, an id returns the right set:

| Filter | What it does | Use? |
|---|---|---|
| `category: <id>` | Exact category, editorial included. Playable counts: Critical Role 526, Beacon Exclusives and Early Access 105, Midst 62, Candela Obscura 26 (Behind the Scenes 7, Darrington Press 3, Programming Schedule 2 are editorial-only). | **Yes** — the best new filter; a Browse/Search category selector. `Content.category` gives each item its label. |
| `hideFromLatest: true` | 1,283 → 1,130 playable. 586 docs are flagged overall (372 editorial, 94 `videoPodcast`, 61 `podcast`, 59 `video`), including trailers and one-off panels. Default is `false`; cooldown episodes are **not** flagged. | **Yes, but only for "Latest" rows.** Never on the catalog index or a text search — it would hide real matches. |
| `contentTier: <id>` | Free 209 / Member 1,550, an exact partition. | Optional — a "Free to watch" filter or row for free members; our lock handling already covers playback. |
| `sort` | Any field works. `-popularity` and `-rating` produce genuinely different, sensible orders (recent C4 episodes / highest-rated C4 episodes), though main and Cooldown versions sit next to each other. | **Worth exposing** as a "Popular" / "Top rated" sort — with cooldown de-duplication. |
| `featured: true` | 608 playable docs. | Fallback only if the Featured block is missing. |
| `tag: <id>` | Works, but sparse and id-only (e.g. Ashley Johnson 257 docs). | Not yet. |
| `collections`, `collectionMatch`, `season`, `idsToRemove`, `previewDate`, `preview` | Editorial/plumbing; `fetchSeries` already covers seasons. | No. |

### 3.9 Live events

Beyond `x-has-waiting-room`, the app has:

- `GetActiveLivestream { getActiveLivestream { id slug msUntilEnd } }`
- `GetLivestreamStatus(id, slug) { getLivestreamStatus { id currentStream contentType } }`
- `ContentSync(contentId) { sync: Content(id) { id secondsAfterAvailable msUntilLiveSyncEnd } }`
- `Livestream` fragment: `livestreamSource`, `twitchId`, `youtubeId`, `jwplayerUrl`
- `fragment ContinueWatchingV2 { ... limit ... }` with `excludedPlatforms`.

`secondsAfterAvailable` / `msUntilLiveSyncEnd` are the clock the app uses to
start and stop live playback; that is the waiting-room behaviour our notes
list as unknown, and it is worth a follow-up with a live event.

### 3.10 Account features on the member API

The app also uses `MeMember`-adjacent operations we do not touch:
`GetUserProfile`, `UpdateProfile`, `PersonaliseProfile` (interests),
`GetProfilePictures`, `GetInterestSuggestions`, `GetFavouritesPage`,
`GetContentRating`/`RateContent` (a numeric rating per item),
`GetMembershipPlans`, `GetAccessTiers`, `GetJoinPage`, `GetJoinBeaconContent`,
`GetLockedContentPrompt` (with an `appOnly` variant), `GetContactPage` and
`SubmitForm`. Ratings and favourites are the only two that would change how
our screens behave.

## 4. Smaller things worth knowing

- **Thumbnails**: `ContentCard` uses `square` (and `landscape`), and
  collections use `portrait`/`landscape`, while heroes use
  `landscape2x`. We already request `landscape` + `landscape2x`; square is
  the app's grid shape.
- **`ottTitle`** is the app's card/hero title, not a TV-only field: non-null on
  all 1,759 docs and different from `title` on 1,156. It drops the series and
  episode prefix (`C4 E043 | The Water's Edge` → `The Water's Edge`, `S4 E2 |
  Kyoto, Nara Osaka: Oh My! | AWNP` → `Kyoto, Nara Osaka: Oh My!`) and adds a
  show suffix where the short name would be ambiguous (`Abubakar Salim |
  Shirts off Sam's Back`). Use it for tiles, the hero and up-next, with `title`
  as the fallback; keep the raw `title` for the catalog index and
  `episodeCode()` parsing, and on the content page, where the longer title
  carries the episode number. It is editor-maintained, so it has mistakes: two
  unrelated items both carry `Comics!`, and a trailer currently reuses a whole
  backstage-pass `ottTitle`.
- **`preview`**: both page queries take `draft: $preview`; the app passes a
  preview flag for editors. We hard-code `draft: false`, which is right for
  members.
- **`findBookById`** and `IntrospectionQuery` in the appendix are Apollo
  library noise, not Beacon operations.
- **Token storage**: `expo-secure-store` (Keystore-backed), with
  `ACCESS_TOKEN_EXPIRY` 15 min and `oneYearInMilliseconds` for the refresh
  token's nominal life. Our keyring-only policy (nothing written without a
  real keyring) is stricter than the app's, and fine.
- **Bundle hygiene**: Sentry DSN, Firebase config and OneSignal app id are in
  the APK; no secrets were found beyond public client ids.

## 5. Suggested order of work

1. ~~Try `x-platform: android`~~ — done, and no change: every document is
   byte-identical under `web` and `android`, signed in or out, and no block or
   content item is excluded per platform today. Nothing to unlock; see 3.2.
2. ~~Adopt favourites for collections/series~~ — done: the client now reads
   `userCollectionFavourites` and writes through
   `toggleCollectionFavouriteEndpoint`, and the local watchlist is gone.
3. ~~Respect `autoplayDisabled`~~ — done: the series query returns it, the
   player disables automatic advance while keeping the manual next card.
4. **Move media loading to a `RefetchMedia`-shaped query** and add the
   `contentLivestream` / `contentPodcast` unions, so live and podcast items
   can play at all.
5. ~~Batch progress writes (10 per call, 20 s flush, retry from store)~~ — done:
   the main process now keeps a bounded, per-account queue, sends ten per
   mutation, flushes on a 20 s timer / window blur / quit, and flushes before
   any read that would show the result.
6. **PKCE sign-in** — the largest change, but it removes password handling
   entirely and matches the official client.
7. **Small wins verified above, in order of cost:**
   - display `ottTitle` (fall back to `title`) on tiles, the hero and up-next;
   - append `continuedSummary` under `description` on the content page;
   - skip `contentVisibleAt > now` in cards and playback (the CMS test doc is
     searchable today and cannot play), and show `comingSoonTagDate` as the
     "Coming soon" badge;
   - add a category selector built on `search(category: <id>)`, and
     `hideFromLatest: true` only for Latest-style rows;
   - expose `-popularity` / `-rating` sorts (de-duplicating Cooldown versions).
8. Later: ratings, pre-roll, live-event clock.

## 6. Still open

- The exact `x-platform` / `x-supports-drm` *values* the app builds are still
  not in the bundle, but the live test shows the server does not vary its
  answers by `x-platform`; only DRM is left to check.
- Whether `tv.beacon.ott` (Android TV) uses the same OAuth flow, a device
  code, or a QR hand-off. This XAPK is the phone app.
- Download/offline playback: not present in this bundle.
- Whether `x-supports-drm: true` on Android yields Widevine for the app; we
  stay on `false` and plain HLS, which is what our client relies on.

## Appendix — GraphQL operations in 1.45.0

43 queries, 49 fragments, 8 mutations, extracted verbatim from the string
table. Line counts are as shipped (documents are pretty-printed).

| Operation | Kind | Lines |
|---|---|---|
| AllContent | fragment | 28 |
| BeaconMembership | fragment | 17 |
| ButtonRow | fragment | 14 |
| CategoriesGrid | fragment | 10 |
| Checkbox | fragment | 7 |
| CollectionsCarousel | fragment | 36 |
| content | fragment | 46 |
| ContentCard | fragment | 43 |
| ContentHero | fragment | 29 |
| ContinueWatchingV2 | fragment | 10 |
| CustomHero | fragment | 22 |
| Date | fragment | 7 |
| EditorialHero | fragment | 13 |
| Email | fragment | 6 |
| Faqs | fragment | 13 |
| FeaturedCarousel | fragment | 13 |
| FeaturedCollectionCarousel | fragment | 18 |
| Form | fragment | 20 |
| ForYou | fragment | 31 |
| FreeLink | fragment | 7 |
| HeroCarousel | fragment | 68 |
| ImageBlock | fragment | 18 |
| ImageGallery | fragment | 31 |
| InitializeCollectionEntity | fragment | 4 |
| JoinBeacon | fragment | 12 |
| LatestCarousel | fragment | 17 |
| ListenCarousel | fragment | 16 |
| Livestream | fragment | 7 |
| Message | fragment | 4 |
| Number | fragment | 7 |
| PopularCollectionsCarousel | fragment | 35 |
| ReadCachedReactiveVarFragment | fragment | 4 |
| ReadCarousel | fragment | 16 |
| ReasonToJoin | fragment | 10 |
| RedesignHeroCarousel | fragment | 68 |
| RedesignJoinBeacon | fragment | 9 |
| RedesignWelcomeHero | fragment | 58 |
| RichText | fragment | 9 |
| Select | fragment | 12 |
| SeriesCarousel | fragment | 27 |
| SkipTo | fragment | 20 |
| SuggestedContent | fragment | 7 |
| Testimonials | fragment | 15 |
| Text | fragment | 7 |
| Textarea | fragment | 7 |
| VideoBlock | fragment | 9 |
| WatchCarousel | fragment | 16 |
| WelcomeHero | fragment | 54 |
| YourInterests | fragment | 38 |
| PersonaliseProfile | mutation | 8 |
| RateContent | mutation | 5 |
| RemoveContentFromContinueWatching | mutation | 5 |
| SubmitForm | mutation | 5 |
| ToggleCollectionFavourite | mutation | 7 |
| ToggleContentFavourite | mutation | 7 |
| Track | mutation | 6 |
| UpdateProfile | mutation | 5 |
| ContentSync | query | 7 |
| ContinueWatching | query | 15 |
| CurrentProgress | query | 6 |
| GetAccessTiers | query | 9 |
| GetActiveLivestream | query | 7 |
| GetCategoriesSearch | query | 20 |
| GetCategoryPage | query | 18 |
| GetCollectionPage | query | 38 |
| GetCollectionsSearch | query | 32 |
| GetContactPage | query | 9 |
| GetContentGrid | query | 32 |
| GetContentPage | query | 135 |
| GetContentRating | query | 3 |
| GetContentSearch | query | 30 |
| GetEpisodesList | query | 47 |
| GetFavouritesPage | query | 9 |
| GetInterestSuggestions | query | 8 |
| GetIsCollectionFavourite | query | 3 |
| GetIsConttentFavourite | query | 3 |
| GetJoinBeaconContent | query | 37 |
| GetJoinPage | query | 12 |
| GetLandingPage | query | 25 |
| GetLivestreamStatus | query | 7 |
| GetLockedContentPrompt | query | 40 |
| GetLoggedOutSidebarPromo | query | 8 |
| GetMemberHomePage | query | 22 |
| GetMembershipPlans | query | 16 |
| GetPagesSearch | query | 12 |
| GetPreRollVideo | query | 11 |
| GetProfilePictures | query | 14 |
| GetSearchFilterCategories | query | 8 |
| GetSearchFilterCollections | query | 8 |
| GetSearchFilterSeries | query | 8 |
| GetSearchPage | query | 6 |
| GetStaticContentPage | query | 13 |
| GetTagPage | query | 16 |
| GetTagsSearch | query | 12 |
| GetUserCollectionFavourites | query | 9 |
| GetUserProfile | query | 30 |
| IntrospectionQuery | query | 2 |
| ProgressForContent | query | 9 |
| RefetchMedia | query | 63 |
| findBookById | query | 1 |
