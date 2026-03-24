import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getUserPlaylists, getPlaylistTracks } from "@/lib/spotify"
import { playlistCache, PLAYLIST_TTL_MS } from "@/lib/spotifyCache"

const delay = ms => new Promise(r => setTimeout(r, ms))

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.provider !== "spotify") {
      return NextResponse.json({ error: "Spotify session required" }, { status: 401 })
    }

    const accessToken = session.spotifyAccessToken
    if (!accessToken) {
      return NextResponse.json({ error: "No Spotify access token" }, { status: 401 })
    }

    // Get user profile for userId
    const profileRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const profile = await profileRes.json()
    const userId = profile.id

    // Check cache
    const cacheKey = `playlists:${userId}`
    const cached = playlistCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data)
    }

    // Fetch user's playlists (excluding Spotify-generated)
    const playlists = await getUserPlaylists(accessToken, userId)

    if (!playlists.length) {
      return NextResponse.json({ playlists: [], playlistTrackMap: {}, crossPlaylistTracks: [] })
    }

    // Lazy-fetch tracks for each playlist (10 concurrent, 100ms between batches)
    let loaded = 0
    for (let i = 0; i < playlists.length; i += 10) {
      const batch = playlists.slice(i, i + 10)
      await Promise.all(batch.map(async pl => {
        const maxTracks = Math.min(pl.tracks?.total || 0, 200)
        pl._tracks = maxTracks > 0 ? await getPlaylistTracks(accessToken, pl.id, maxTracks) : []
      }))
      loaded += batch.length
      if (loaded < playlists.length) await delay(100)
    }

    // Build playlistTrackMap: trackId → [playlistId, ...]
    const playlistTrackMap = {}
    playlists.forEach(pl => {
      ;(pl._tracks || []).forEach(({ track }) => {
        if (!playlistTrackMap[track.id]) playlistTrackMap[track.id] = []
        if (!playlistTrackMap[track.id].includes(pl.id)) {
          playlistTrackMap[track.id].push(pl.id)
        }
      })
    })

    const crossPlaylistTracks = Object.entries(playlistTrackMap)
      .filter(([, pls]) => pls.length >= 2)
      .map(([id]) => id)

    const result = {
      userId,
      playlists: playlists.map(pl => ({
        id:          pl.id,
        name:        pl.name,
        description: pl.description || "",
        imageUrl:    pl.images?.[0]?.url || null,
        trackCount:  pl.tracks?.total || 0,
        tracks: (pl._tracks || []).map(({ track, added_at }) => ({
          id:       track.id,
          name:     track.name,
          artists:  (track.artists || []).map(a => ({ id: a.id, name: a.name })),
          popularity: track.popularity,
          added_at,
          albumArt: track.album?.images?.[0]?.url || null,
        })),
      })),
      playlistTrackMap,
      crossPlaylistTracks,
    }

    playlistCache.set(cacheKey, { data: result, expiresAt: Date.now() + PLAYLIST_TTL_MS })
    return NextResponse.json(result)

  } catch (err) {
    console.error("[spotify/playlists]", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
