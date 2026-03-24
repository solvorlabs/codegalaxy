import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import {
  getTopArtists,
  getTopTracks,
  getRecentlyPlayed,
  getAudioFeatures,
  getRelatedArtists,
} from "@/lib/spotify"
import { buildMusicGraph } from "@/lib/musicGraphBuilder"
import {
  spotifySessionCache,
  publicGalaxyStore,
  SESSION_TTL_MS,
  PUBLIC_TTL_MS,
} from "@/lib/spotifyCache"

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.provider !== "spotify") {
      return NextResponse.json({ error: "Spotify session required" }, { status: 401 })
    }

    const { timeRange = "medium_term" } = await request.json()
    const accessToken = session.spotifyAccessToken
    if (!accessToken) {
      return NextResponse.json({ error: "No Spotify access token" }, { status: 401 })
    }

    // Get Spotify user profile for userId
    const profileRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const profile = await profileRes.json()
    const userId = profile.id
    const userName = profile.display_name || profile.id
    const userAvatar = profile.images?.[0]?.url || null

    const cacheKey = `spotify:${userId}:${timeRange}`
    const cached = spotifySessionCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cached.data)
    }

    // Parallel fetch: top artists, top tracks, recently played
    const [topArtists, topTracks, recentItems] = await Promise.all([
      getTopArtists(accessToken, timeRange),
      getTopTracks(accessToken, timeRange),
      getRecentlyPlayed(accessToken),
    ])

    // Collect all unique track IDs
    const recentTracks = recentItems.map(i => i.track).filter(Boolean)
    const allTrackIds = [
      ...new Set([
        ...topTracks.map(t => t.id),
        ...recentTracks.map(t => t.id),
      ]),
    ]

    // Fetch audio features for all unique tracks
    const rawFeatures = await getAudioFeatures(accessToken, allTrackIds)
    const audioFeaturesMap = {}
    rawFeatures.forEach(f => {
      if (f?.id) audioFeaturesMap[f.id] = f
    })

    // Fetch related artists for top 10 artists (avoid rate limits)
    const relatedArtistsMap = {}
    const top10 = topArtists.slice(0, 10)
    await Promise.all(
      top10.map(async artist => {
        try {
          const related = await getRelatedArtists(accessToken, artist.id)
          relatedArtistsMap[artist.id] = related
        } catch {
          relatedArtistsMap[artist.id] = []
        }
      })
    )

    // Build the music graph
    const { nodes, edges, meta } = buildMusicGraph(
      topArtists,
      topTracks,
      audioFeaturesMap,
      relatedArtistsMap
    )

    // Find most-played recent track
    const trackCounts = {}
    recentTracks.forEach(t => { trackCounts[t.id] = (trackCounts[t.id] || 0) + 1 })
    const topRecentId = Object.entries(trackCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
    const topRecentTrack = recentTracks.find(t => t.id === topRecentId)

    const result = {
      nodes,
      edges,
      meta: {
        ...meta,
        timeRange,
        userName,
        userAvatar,
        userId,
        topRecentTrack: topRecentTrack
          ? { name: topRecentTrack.name, artist: topRecentTrack.artists?.[0]?.name }
          : null,
      },
    }

    // Store in session cache (10 min)
    spotifySessionCache.set(cacheKey, { data: result, expiresAt: Date.now() + SESSION_TTL_MS })

    // Store in public galaxy store (24h)
    publicGalaxyStore.set(userId, {
      data: result,
      expiresAt: Date.now() + PUBLIC_TTL_MS,
    })

    return NextResponse.json(result)
  } catch (err) {
    console.error("[spotify/analyze]", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
