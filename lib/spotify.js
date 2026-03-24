// Spotify API helper functions

const SPOTIFY_BASE = "https://api.spotify.com/v1"

async function spotifyFetch(accessToken, path) {
  const res = await fetch(`${SPOTIFY_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(`Spotify API error ${res.status}: ${err?.error?.message || path}`)
  }
  return res.json()
}

export async function getTopArtists(accessToken, timeRange = "medium_term") {
  const data = await spotifyFetch(
    accessToken,
    `/me/top/artists?limit=50&time_range=${timeRange}`
  )
  return data.items || []
}

export async function getTopTracks(accessToken, timeRange = "medium_term") {
  const data = await spotifyFetch(
    accessToken,
    `/me/top/tracks?limit=50&time_range=${timeRange}`
  )
  return data.items || []
}

export async function getAudioFeatures(accessToken, trackIds) {
  if (!trackIds.length) return []
  // Spotify deprecated /audio-features for new apps (2024).
  // Gracefully return empty array on 403/404 so the graph still builds.
  const results = []
  for (let i = 0; i < trackIds.length; i += 100) {
    const batch = trackIds.slice(i, i + 100)
    try {
      const res = await fetch(
        `${SPOTIFY_BASE}/audio-features?ids=${batch.join(",")}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (res.status === 403 || res.status === 404 || res.status === 401) {
        // Endpoint not available for this app — skip silently
        break
      }
      if (!res.ok) break
      const data = await res.json()
      results.push(...(data.audio_features || []))
    } catch {
      break
    }
  }
  return results.filter(Boolean)
}

export async function getRelatedArtists(accessToken, artistId) {
  try {
    const data = await spotifyFetch(
      accessToken,
      `/artists/${artistId}/related-artists`
    )
    return data.artists || []
  } catch {
    return []
  }
}

export async function getRecentlyPlayed(accessToken) {
  try {
    const data = await spotifyFetch(
      accessToken,
      `/me/player/recently-played?limit=50`
    )
    return data.items || []
  } catch {
    return []
  }
}

export async function getArtistTopTracks(accessToken, artistId) {
  try {
    const data = await spotifyFetch(
      accessToken,
      `/artists/${artistId}/top-tracks?market=US`
    )
    return data.tracks || []
  } catch {
    return []
  }
}

// Get recommended tracks seeded from one artist (replaces deprecated related-artists endpoint)
export async function getRecommendedTracks(accessToken, seedArtistId) {
  try {
    const data = await spotifyFetch(
      accessToken,
      `/recommendations?seed_artists=${seedArtistId}&limit=20&market=US`
    )
    return data.tracks || []
  } catch {
    return []
  }
}

// Batch-fetch full artist objects (up to 50 per call) to get genres, images, popularity
export async function getArtistsBatch(accessToken, artistIds) {
  if (!artistIds.length) return []
  const results = []
  for (let i = 0; i < artistIds.length; i += 50) {
    const batch = artistIds.slice(i, i + 50)
    try {
      const data = await spotifyFetch(accessToken, `/artists?ids=${batch.join(",")}`)
      results.push(...(data.artists || []).filter(Boolean))
    } catch {
      // skip batch on error
    }
  }
  return results
}

export async function searchGenreArtists(accessToken, genre) {
  try {
    const q = encodeURIComponent(`genre:"${genre}"`)
    const data = await spotifyFetch(accessToken, `/search?q=${q}&type=artist&limit=10`)
    return data.artists?.items || []
  } catch {
    return []
  }
}

/**
 * Get user's own playlists (excludes Spotify-generated).
 * Returns up to 30 playlists sorted by track count descending.
 */
export async function getUserPlaylists(accessToken, userId) {
  const playlists = []
  let offset = 0
  while (offset <= 50) {
    try {
      const data = await spotifyFetch(accessToken, `/me/playlists?limit=50&offset=${offset}`)
      if (!data.items?.length) break
      playlists.push(...data.items.filter(p =>
        p && p.owner?.id !== "spotify" &&
        (p.owner?.id === userId || p.collaborative === true)
      ))
      if (!data.next) break
      offset += 50
    } catch { break }
  }
  return playlists
    .sort((a, b) => (b.tracks?.total || 0) - (a.tracks?.total || 0))
    .slice(0, 30)
}

/**
 * Fetch tracks from a playlist, paginating up to maxTracks.
 * Each result: { track: {id,name,artists,album,popularity}, added_at }
 */
export async function getPlaylistTracks(accessToken, playlistId, maxTracks = 200) {
  const tracks = []
  let offset = 0
  while (tracks.length < maxTracks) {
    const limit = Math.min(100, maxTracks - tracks.length)
    try {
      const fields = encodeURIComponent(
        "items(added_at,track(id,name,artists(id,name),album(name,images),popularity,duration_ms)),next"
      )
      const data = await spotifyFetch(
        accessToken,
        `/playlists/${playlistId}/tracks?limit=${limit}&offset=${offset}&fields=${fields}`
      )
      if (!data.items?.length) break
      tracks.push(
        ...data.items
          .filter(item => item?.track?.id)
          .map(item => ({ track: item.track, added_at: item.added_at }))
      )
      if (!data.next) break
      offset += 100
    } catch { break }
  }
  return tracks
}
