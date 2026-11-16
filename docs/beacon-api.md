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

### Home page

beacon.tv's member home page is a single large query (`MemberHomePage.pageContent`),
a list of blocks whose shapes vary. Blocks contain arrays under keys like `items`,
`carouselContent`, `latestCarouselContent`, `collections`, `content`,
`interestsCollections`, and items are either `Content` (video) or `Collection` (series).

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

- Exact queries the official Android TV app (`tv.beacon.ott`) uses — to be confirmed
  by decompiling the APK.
- Whether the TV app has a device-code / QR sign-in flow instead of the password grant.
- Live-event ("waiting room") behaviour.
- Downloads / offline playback (mobile app only, per Beacon's release notes).
