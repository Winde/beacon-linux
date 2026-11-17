# Beacon API — reverse-engineering notes

Reference notes for building an unofficial Beacon (Critical Role) client.
Everything here was observed against the live service.

> Unofficial. Not affiliated with Critical Role or Beacon. Uses Beacon's private
> API; it can change or be blocked at any time, and use may be against Beacon's
> terms. Use your own account, at your own risk.

## 1. Content API (GraphQL)

```
POST https://critrole-beacon-production-backend.clockhosting.com/api/graphql
```

Headers:

| Header | Value | Notes |
|---|---|---|
| `content-type` | `application/json` | |
| `x-platform` | `web` | Accepted, but the CMS does not vary its answers by it: `web` and `android` returned byte-identical documents (home, content, media, series, search, collections, progress, favourites) signed in and out. See [beacon-app-1.45.0.md](beacon-app-1.45.0.md) 3.2. |
| `x-supports-drm` | `false` | **`false` returns plain HLS, no DRM.** `true` returns Widevine. |
| `x-has-waiting-room` | `true` | live-event waiting room |
| `authorization` | `Bearer <access_token>` | optional; required for member content |

Verified live: `query { __typename }` → `{"data":{"__typename":"Query"}}` (HTTP 200, no auth).

**Introspection is enabled.** The standard `IntrospectionQuery` answers on the
same endpoint without auth: 9,843 types, all `Content` fields and the complete
`search` argument list. Use it to check a field before adding it to a document.

**CORS / origin.** The backend only accepts `https://beacon.tv` as a browser origin,
so a page running in a normal browser tab cannot call it. Requests from a non-browser
context (Node, Electron main process, Rust) work fine. This is the main reason to do
API calls outside the renderer.

## 2. Auth (Memberful OAuth)

```
POST https://pocketbeacon.memberful.com/oauth/token
```

`client_id=3Wdgxb5im239JhTBhS7KczZn` — beacon.tv's own public Memberful client.
Parameters go in the body, `application/x-www-form-urlencoded`. The endpoint
answers `307` to `members.beacon.tv`, so the body travels with the redirect and
nothing has to be in the URL: a query string is copied into the `Location`
header and logged by Cloudflare and both origins.

Password grant:

```
client_id=...&grant_type=password&username=<email>&password=<password>
```

Refresh grant:

```
client_id=...&grant_type=refresh_token&refresh_token=<token>
```

Response is a standard OAuth token body:

```json
{ "access_token": "...", "refresh_token": "...", "expires_in": 3600, "token_type": "Bearer" }
```

- 400/401 → credentials rejected (or refresh token revoked → sign out).
- Memberful redirects the token request on to `members.beacon.tv`; follow redirects.
- Accounts that sign in with an emailed link need a password set on beacon.tv first.
- Only tokens are stored; the password is never persisted.

The official phone app does **not** use the password grant: it runs an OAuth
authorization-code flow with PKCE in the browser (redirect `tv.beacon.app://`),
then refreshes with `grant_type=refresh_token`. Access tokens live 15 minutes.
Our client keeps the password grant, which still works but requires a password
on the account; see [beacon-app-1.45.0.md](beacon-app-1.45.0.md).

## 3. GraphQL operations

Fragments used below:

```graphql
fragment Card on Content {
  id title duration slug contentType episodeNumber releaseDate
  contentTier { name planLevel }
  primaryCollection { id name slug isSeries }
  thumbnail { sizes { landscape { url } } }
}
```

`duration` is milliseconds. `contentTier.planLevel` is the membership level needed;
`meMember.user.tier.planLevel` is what the signed-in user has (1 = free).

### Who am I

```graphql
query { meMember { user { username activeSubscription tier { name planLevel } } } }
```

### Content by slug (video page)

```graphql
query Content($slug: String!) {
  Contents(where: { slug: { equals: $slug } }, limit: 1, draft: false) {
    docs {
      ...Card
      description
      collections { id name slug isSeries }
      content { ... on SuggestedContent { carouselContent: content { ...Card } } }
      contentVideo { video { video videoData closedCaptions playlistUrl } }
    }
  }
  currentProgress(slug: $slug) { videoProgress videoProgressSeconds }
}
```

`contentVideo.video.video` is the **HLS master playlist URL** (JW Player). It is
`null` when the account's tier is too low for that item.

For the page itself, request three more fields (verified live on all 1,759
content docs):

- `ottTitle` — the display title the app puts on cards: non-null everywhere,
  different from `title` on 1,156 docs, with series/episode prefixes stripped
  (`C4 E043 | The Water's Edge` → `The Water's Edge`). Show it on tiles, heroes
  and up-next, falling back to `title`; keep `title` for the catalog index,
  episode-code parsing and the content header, where the long form is useful.
- `continuedSummary` — the rest of the page body. `description` is a
  ~125-character blurb; on 142 of 300 recent docs `continuedSummary` adds the
  credits/sponsor text (~1 KB). The app shows `description` clamped to three
  lines with a `...See More` toggle; expanding removes the clamp and renders
  `continuedSummary` (and the tags) below it, and the label becomes
  `See Less`. (This client clamps only when `continuedSummary` exists, so a
  description-only page is never hidden behind a no-op toggle.)
- `contentVisibleAt` / `msUntilVisible` / `comingSoonTagDate` — scheduling.
  `search` and `Contents` still return a doc whose `contentVisibleAt` is in the
  future (the CMS `coming-soon-test` doc is visible in 2035), so treat a future
  value as not playable, and use `comingSoonTagDate` (15 minutes before
  visibility) for a "Coming soon" badge.

`secondsAfterAvailable` is `-1` on every doc and only matters during a live
event.

`videoData` is a JSON string containing the JW Player playlist, including caption
tracks: `playlist[0].tracks[]` with `{ kind, label, file }` where `kind` is
`captions` or `subtitles`.

### Stream only

```graphql
query Media($slug: String!) {
  Contents(where: { slug: { equals: $slug } }, limit: 1, draft: false) {
    docs { id duration contentVideo { video { video videoData closedCaptions playlistUrl } } }
  }
  currentProgress(slug: $slug) { videoProgress videoProgressSeconds }
}
```

### Series / collection

```graphql
query Series($collection: String!, $season: String, $content: String, $limit: Int) {
  fetchSeries(collection: $collection, season: $season, content: $content, limit: $limit) {
    series
    docs { content { ...Card } }
    collection { id name slug isSeries series { id seasonNumber } }
    next { ...Card }
  }
}
```

- `collection` is the collection **id**, not the slug.
- Omit `season` to get everything; `collection.series[]` lists seasons.
- Pass `content: <id>` to get `next` — the next episode after that one.

### Search

```graphql
query Search(
  $q: String, $sort: String, $types: [String], $collection: String,
  $category: String, $contentTier: String, $hideFromLatest: Boolean,
  $page: Int, $limit: Int
) {
  search(
    search: $q, sort: $sort, contentTypes: $types, collection: $collection,
    category: $category, contentTier: $contentTier,
    hideFromLatest: $hideFromLatest, page: $page, limit: $limit
  ) {
    totalPages totalDocs page docs { ...Card }
  }
}
```

`types: ["video", "videoPodcast"]` for playable items. `sort: "-releaseDate"`.
Beacon's own search only matches whole words — a local index is worth building.

Other arguments the live field accepts: `collections: [String]`,
`collectionMatch`, `tag`, `season`, `idsToRemove`, `featured`, `previewDate`,
`preview`.

Verified live (2026-11-17, 1,759 docs / 1,283 playable):

- `category`, `contentTier` and `tag` take the **CMS id**, not a slug or a name
  (a slug returns zero). Categories: Critical Role 526 playable, Beacon
  Exclusives and Early Access 105, Midst 62, Candela Obscura 26; Behind the
  Scenes, Darrington Press and Programming Schedule are editorial-only.
  `Content.category` labels an item.
- `hideFromLatest: true` drops 153 playable docs (1,283 → 1,130). 586 docs are
  flagged overall — trailers, one-off panels, editorial — but not Cooldown
  versions. Use it for "Latest" shelves, not for text search or the catalog.
- `contentTier` partitions exactly: Free 209, Member 1,550.
- `sort` accepts any field; `-popularity` and `-rating` give sensible
  "Popular"/"Top rated" orders (with Cooldown and main versions adjacent).
- `featured: true` returns 608 playable docs.

### Collections

```graphql
query Collections($page: Int, $limit: Int) {
  collectionSearch(sort: "-releaseDate", page: $page, limit: $limit) {
    totalPages docs {
      id name slug isSeries itemCount releaseDate
      thumbnail { sizes { landscape { url } portrait { url } } }
    }
  }
}
```

`collectionSearch` skips some series; this lists them all:

```graphql
query {
  series: Collections(where: { isSeries: { equals: true } }, limit: 1000) { docs { id name slug } }
  other:  Collections(where: { isSeries: { not_equals: true } }, limit: 1000) { docs { id name slug } }
}
```

### Continue watching

```graphql
query CW($limit: Int) {
  continueWatching(limit: $limit, page: 1) {
    docs { videoProgress videoProgressSeconds content { ...Card } }
  }
}
```

### Progress for a set of ids

```graphql
query P($ids: [String!]!) {
  getProgressForContent(id: $ids) { timeMap { contentId videoProgress videoProgressSeconds } }
}
```

`videoProgress` is a percentage (0–100). Max 100 ids per call.

### Report progress

```graphql
mutation Track($events: [EventInput!]!) { trackView(events: $events) { success reason } }
```

```json
{
  "content": "<content id>",
  "viewedAt": "<ISO 8601>",
  "sessionId": "tv-<random>",
  "duration": 0,
  "videoProgressSeconds": 1234,
  "videoProgress": 42
}
```

This is what keeps "Continue watching" in sync across beacon.tv and the apps.

Beacon keeps the **latest** report, not the furthest: reporting an earlier
position moves the saved point back (backtracking an episode saves). There is no
separate watched flag, so a finished state is written with the same event. Both
ends are a trap, measured against the live CMS (2026-11-17, Campaign 4
episodes):

- a 0% report and a **98% or higher near-end report** are accepted
  (`success: true`, "All events have been tracked successfully") but the saved
  point is left alone, or only its seconds are updated with `videoProgress`
  coming back `null`;
- `removeContentFromContinueWatching` **zeroes** the point it is called for
  (`97%`/`<runtime - 1>` became `0`/`null`), so it undoes a watched mark. It is
  only safe for an unwatched mark, where zero is the wanted state.

So the working pair is:

- watched: `videoProgress: 97`, `videoProgressSeconds: <runtime - 1>` and
  **no** Continue-watching removal (`97` at the last second is stored and reads
  back as finished);
- unwatched: `videoProgress: 1`, `videoProgressSeconds: 1`, then
  `removeContentFromContinueWatching` to keep the zeroed title out of the row.

Even then the read can lag, so the client keeps the member's choice locally
(`watch-state.json`, per sign-in address) and drops it once
`getProgressForContent` agrees.

Because the write is shared, a mark changes the progress bars and Continue
watching on every device signed in to the account. The row already ignores a
finished point: measured on 2026-11-17, `continueWatching` listed a 93% title
(13860 s of 14840 s) but none of the 97-100% points, so a watched mark needs no
removal to stay out of it. Calling `removeContentFromContinueWatching` anyway
only zeroes the point; then re-sending the 97% point restores the state, which
is the same as never calling it. The client marks an episode only when the
member asks; finishing one by playback is detected from the progress
(`videoProgress` plus `videoProgressSeconds` against the runtime).

`trackView` success does not prove the point was stored, so the local mark is
also a retry record: each mark keeps the point the member was looking at, and on
launch the client re-sends a carried-over mark only when that point is unchanged.
A point that moved means a watch on another device is newer, so the mark is
dropped instead of rolling progress back. A mark with no recorded point is only
filled in over an episode that was never started. A mark Beacon will not take is
re-sent at most three times, once per launch, and then left alone; a screen read
can still confirm it, and marking again starts the count over.

### Favourites and ratings

Server-side, per member; not to be confused with Continue watching.

```graphql
query  IsContentFavourite($id: String!) { isContentFavourite: hasContentFavourited(id: $id) }
query  IsCollectionFavourite($id: String!) { isCollectionFavourite: hasCollectionFavourited(id: $id) }

mutation ToggleContentFavourite($id: String!) {
  toggleContentFavourite: toggleContentFavourite(id: $id) { success reason isFavourite }
}
mutation ToggleCollectionFavourite($id: String!) {
  toggleCollectionFavourite: toggleCollectionFavouriteEndpoint(id: $id) { success reason isFavourite }
}

query CurrentRating($id: String!) { currentRating(id: $id) }
mutation RateContent($id: String!, $rating: Int!) { rateContent(id: $id, rating: $rating) { success } }
```

`GetFavouritesPage` and `GetUserCollectionFavourites` read the lists back.
Observed in the official app; see [beacon-app-1.45.0.md](beacon-app-1.45.0.md).

### Home page

beacon.tv's member home page is a single query (`MemberHomePage.pageContent`),
a list of blocks in editorial order. Each block has a stable CMS `id` and
`excludedPlatforms { ios android web }`; the booleans mean "hide here", and the
server does not filter them by `x-platform` — the client must. The endpoint
answers without an account, so guests get the same editorial page.

Live block types (all eight), in the order seen on 2026-11-17:

```
RedesignHeroCarousel, FeaturedCarousel, ContinueWatchingV2, SeriesCarousel,
ReadCarousel, LatestCarousel, HeroCarousel, ListenCarousel
```

- `RedesignHeroCarousel` and `HeroCarousel` mix `Content` and `Collection`
  items through `items[].item.value`; the rest use `content` (`carouselContent`).
- `ContinueWatchingV2` carries only `limit` (5 today) and a colour. The items
  still come from `continueWatching`.
- `FeaturedCarousel` can mix `video`, `videoPodcast` and `editorial` items;
  `LatestCarousel` is video; `SeriesCarousel` is Collections.
- `ReadCarousel` is `editorial` (articles) and `ListenCarousel` is `podcast`
  (audio). A TV client that cannot show those should skip a block whose items
  are all unshowable, and drop just the unshowable items from a mixed block.

Blocks whose type is not described in the query still arrive with a
`__typename` and no fields, so an unknown block is skipped rather than breaking
the document.

## 4. Media

- Streams are **plain HLS** from JW Player (`cdn.jwplayer.com`, `*.jwplayer.com`,
  `*.jwpsrv.com`, `*.jwpcdn.com`). No Widevine when `x-supports-drm: false`.
- JW Player's master playlist lists the 640×360 variant **first**, so naive players
  start blurry. Fetch the master playlist and reorder variants by `BANDWIDTH`
  descending before handing it to the player.
- Caption files are served by JW Player without CORS headers, so fetch them outside
  the renderer (or proxy them) if you need the text.
- Images come from Cloudflare Images; URLs end in `/format=auto` and accept
  `,width=<n>` (e.g. `format=auto,width=480`) to request a specific size.

## 5. Open questions

- Exact queries the official Android TV app (`tv.beacon.ott`) uses. The phone
  app (`tv.beacon.app`) has been decompiled — see
  [beacon-app-1.45.0.md](beacon-app-1.45.0.md) — but the TV app is a separate
  package and has not been checked.
- Whether the TV app has a device-code / QR sign-in flow instead of the
  browser OAuth + PKCE flow the phone app uses.
- Live-event ("waiting room") behaviour: `getActiveLivestream`,
  `getLivestreamStatus` and `ContentSync` (with `msUntilLiveSyncEnd`) exist;
  the timing rules still need a live event to confirm.
- Downloads / offline playback (mobile app only, per Beacon's release notes).
- The values the official app sends for `x-platform` and `x-supports-drm`
  (built at runtime, not string literals). The server's answers do not vary by
  `x-platform` — a live `web`/`android` diff is identical — so only the DRM
  value still matters.
