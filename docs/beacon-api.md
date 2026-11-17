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
| `x-platform` | `web` | |
| `x-supports-drm` | `false` | **`false` returns plain HLS, no DRM.** `true` returns Widevine. |
| `x-has-waiting-room` | `true` | live-event waiting room |
| `authorization` | `Bearer <access_token>` | optional; required for member content |

Verified live: `query { __typename }` → `{"data":{"__typename":"Query"}}` (HTTP 200, no auth).

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
query Search($q: String, $sort: String, $types: [String], $collection: String, $page: Int, $limit: Int) {
  search(search: $q, sort: $sort, contentTypes: $types, collection: $collection, page: $page, limit: $limit) {
    totalPages totalDocs page docs { ...Card }
  }
}
```

`types: ["video", "videoPodcast"]` for playable items. `sort: "-releaseDate"`.
Beacon's own search only matches whole words — a local index is worth building.

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
separate watched flag and no mutation that deletes progress, so a finished state
is written with the same event:

- watched: `videoProgress: 99`, `videoProgressSeconds: <runtime - 1>`
- unwatched: `videoProgress: 1`, `videoProgressSeconds: 1`

Both extremes are a trap: an all-zero event and a 100% event are accepted
(`success: true`) but the next read still reports the old point. Staying one
step inside each end behaves like a real rewatch. Even then the read can lag, so
the client keeps the member's choice locally (`watch-state.json`, per sign-in
address) and drops it once `getProgressForContent` agrees. That leaves an
unwatched title at "started", so call the member mutation the web client uses to
keep it out of the row:

```graphql
mutation { removeContentFromContinueWatching(id: "<content id>") { success } }
```

Because the write is shared, a mark changes "Continue watching" and the progress
bars on every device signed in to the account. The client marks an episode only
when the member asks; finishing one by playback is detected from the progress
(`videoProgress` plus `videoProgressSeconds` against the runtime).

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
  (audio). A TV client that cannot show those should drop the items, not the
  whole row.

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
  (built at runtime, not string literals in the bundle).
