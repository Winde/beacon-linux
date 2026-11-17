/** GraphQL documents used against Beacon's CMS. */

export const PLAYABLE = ['video', 'videoPodcast']

/** Shared shape for anything that renders as a tile. */
const CARD = `
  fragment Card on Content {
    id title ottTitle duration slug contentType episodeNumber releaseDate
    contentTier { name planLevel }
    primaryCollection { id name slug isSeries }
    thumbnail { sizes { landscape { url } landscape2x { url } } }
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
      docs {
        id title duration episodeNumber
        primaryCollection { id isSeries }
        ${VIDEO}
      }
    }
    currentProgress(slug: $slug) { videoProgress videoProgressSeconds }
  }
`

export const SERIES = `
  query Series($collection: String!, $season: String, $content: String, $limit: Int) {
    fetchSeries(collection: $collection, season: $season, content: $content, limit: $limit) {
      series
      autoplayDisabled
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
        thumbnail { sizes { landscape { url } landscape2x { url } portrait { url } } }
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

/**
 * The member home as Beacon's editors arrange it. Only the blocks this client
 * can render are described; any other block still arrives with a __typename and
 * no fields, and is skipped.
 */
export const HOME_BLOCKS = `
  query HomeBlocks {
    MemberHomePage: MemberHomepage {
      pageContent {
        __typename
        ... on RedesignHeroCarousel {
          id
          items {
            item {
              relationTo
              value {
                ... on Content { ...BlockCard }
                ... on Collection { ...BlockCollection }
              }
            }
          }
          excludedPlatforms { ios android web }
        }
        ... on FeaturedCarousel {
          id
          title
          content { ...BlockCard }
          excludedPlatforms { ios android web }
        }
        ... on ContinueWatchingV2 {
          id
          limit
          excludedPlatforms { ios android web }
        }
        ... on SeriesCarousel {
          id
          title
          content { ...BlockCollection }
          excludedPlatforms { ios android web }
        }
        ... on LatestCarousel {
          id
          title
          content { ...BlockCard }
          excludedPlatforms { ios android web }
        }
      }
    }
  }

  fragment BlockCard on Content {
    __typename
    id title ottTitle slug duration contentType episodeNumber releaseDate
    contentTier { name planLevel }
    primaryCollection { id name slug isSeries }
    thumbnail { sizes { landscape { url } landscape2x { url } } }
  }

  fragment BlockCollection on Collection {
    __typename
    id name slug itemCount
    thumbnail { sizes { portrait { url } landscape { url } landscape2x { url } } }
  }
`

/** Every collection this member has favourited, one page at a time. */
export const FAVOURITE_COLLECTIONS = `
  query FavouriteCollections($limit: Int, $page: Int) {
    userCollectionFavourites(limit: $limit, page: $page) {
      totalPages totalDocs page
      docs { id name }
    }
  }
`

export const IS_COLLECTION_FAVOURITE = `
  query IsCollectionFavourite($id: String!) {
    isCollectionFavourite: hasCollectionFavourited(id: $id)
  }
`

/**
 * The field is an endpoint name, not the alias: Beacon renamed it without
 * renaming the mutation, and the alias keeps our call sites readable.
 */
export const TOGGLE_COLLECTION_FAVOURITE = `
  mutation ToggleCollectionFavourite($id: String!) {
    toggleCollectionFavourite: toggleCollectionFavouriteEndpoint(id: $id) {
      success
      reason
      isFavourite
    }
  }
`

/** The id and runtime a watch-state write needs, found by slug. */
export const LOOKUP = `
  query Lookup($slug: String!) {
    Contents(where: { slug: { equals: $slug } }, limit: 1, draft: false) {
      docs { id duration }
    }
  }
`

export const PROGRESS_FOR = `
  query P($ids: [String!]!) {
    getProgressForContent(id: $ids) { timeMap { contentId videoProgress videoProgressSeconds } }
  }
`

export const TRACK = `
  mutation Track($events: [EventInput!]!) { trackView(events: $events) { success reason } }
`

/** The one member-facing mutation that takes a title out of Continue watching. */
export const REMOVE_FROM_CONTINUE_WATCHING = `
  mutation RemoveContentFromContinueWatching($id: String!) {
    removeContentFromContinueWatching(id: $id) { success }
  }
`
