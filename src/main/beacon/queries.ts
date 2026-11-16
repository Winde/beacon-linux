/** GraphQL documents used against Beacon's CMS. */

export const PLAYABLE = ['video', 'videoPodcast']

/** Shared shape for anything that renders as a tile. */
const CARD = `
  fragment Card on Content {
    id title duration slug contentType episodeNumber releaseDate
    contentTier { name planLevel }
    primaryCollection { id name slug isSeries }
    thumbnail { sizes { landscape { url } } }
  }
`

const VIDEO = `
  contentVideo { video { video videoData closedCaptions playlistUrl } }
`

export const ME = `
  query { meMember { user { username activeSubscription tier { name planLevel } } } }
`

export const CONTENT = `
  query Content($slug: String!) {
    Contents(where: { slug: { equals: $slug } }, limit: 1, draft: false) {
      docs {
        ...Card
        description
        collections { id name slug isSeries }
        content { ... on SuggestedContent { carouselContent: content { ...Card } } }
        ${VIDEO}
      }
    }
    currentProgress(slug: $slug) { videoProgress videoProgressSeconds }
  }
  ${CARD}
`

export const MEDIA = `
  query Media($slug: String!) {
    Contents(where: { slug: { equals: $slug } }, limit: 1, draft: false) {
      docs { id title duration ${VIDEO} }
    }
    currentProgress(slug: $slug) { videoProgress videoProgressSeconds }
  }
`

export const SERIES = `
  query Series($collection: String!, $season: String, $content: String, $limit: Int) {
    fetchSeries(collection: $collection, season: $season, content: $content, limit: $limit) {
      series
      docs { content { ...Card } }
      collection { id name slug isSeries series { id seasonNumber } }
      next { ...Card }
    }
  }
  ${CARD}
`

export const SEARCH = `
  query Search($q: String, $sort: String, $types: [String], $collection: String, $page: Int, $limit: Int) {
    search(search: $q, sort: $sort, contentTypes: $types, collection: $collection, page: $page, limit: $limit) {
      totalPages totalDocs page docs { ...Card }
    }
  }
  ${CARD}
`

export const COLLECTIONS = `
  query Collections($page: Int, $limit: Int) {
    collectionSearch(sort: "-releaseDate", page: $page, limit: $limit) {
      totalPages docs {
        id name slug isSeries itemCount releaseDate
        thumbnail { sizes { landscape { url } portrait { url } } }
      }
    }
  }
`

export const ALL_COLLECTIONS = `
  query {
    series: Collections(where: { isSeries: { equals: true } }, limit: 1000) { docs { id name slug } }
    other: Collections(where: { isSeries: { not_equals: true } }, limit: 1000) { docs { id name slug } }
  }
`

export const CONTINUE_WATCHING = `
  query CW($limit: Int) {
    continueWatching(limit: $limit, page: 1) {
      docs { videoProgress videoProgressSeconds content { ...Card } }
    }
  }
  ${CARD}
`

export const PROGRESS_FOR = `
  query P($ids: [String!]!) {
    getProgressForContent(id: $ids) { timeMap { contentId videoProgress videoProgressSeconds } }
  }
`

export const TRACK = `
  mutation Track($events: [EventInput!]!) { trackView(events: $events) { success reason } }
`
