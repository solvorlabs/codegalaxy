import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import {
  getTopArtists,
  getTopTracks,
  getRecentlyPlayed,
  getAudioFeatures,
  getArtistTopTracks,
  getRecommendedTracks,
  getArtistsBatch,
  searchGenreArtists,
} from "@/lib/spotify"
import { buildMusicGraph } from "@/lib/musicGraphBuilder"
import {
  spotifySessionCache,
  publicGalaxyStore,
  jobStore,
  SESSION_TTL_MS,
  PUBLIC_TTL_MS,
  JOB_TTL_MS,
} from "@/lib/spotifyCache"

function genJobId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function setJobProgress(jobId, progress, step, stepLabel) {
  const job = jobStore.get(jobId)
  if (job) jobStore.set(jobId, { ...job, progress, step, stepLabel })
}

const delay = ms => new Promise(r => setTimeout(r, ms))

function buildTimeMachineData(short, medium, long) {
  const shortMap  = new Map(short.map((a, i)  => [a.id, { rank: i, artist: a }]))
  const mediumMap = new Map(medium.map((a, i) => [a.id, { rank: i, artist: a }]))
  const longMap   = new Map(long.map((a, i)   => [a.id, { rank: i, artist: a }]))

  const allIds = new Set([...shortMap.keys(), ...mediumMap.keys(), ...longMap.keys()])
  const artists = []

  allIds.forEach(id => {
    const s = shortMap.get(id)
    const m = mediumMap.get(id)
    const l = longMap.get(id)
    const artist = (s || m || l).artist

    let status
    if (s && m && l)            status = "consistent"
    else if (s && !l)           status = "new"
    else if (!s && l && !m)     status = "classic"
    else if (!s && l)           status = "fading"
    else if (s && l && s.rank < l.rank - 8) status = "rising"
    else                        status = "consistent"

    artists.push({
      id,
      name:       artist.name,
      imageUrl:   artist.images?.[0]?.url || null,
      genres:     artist.genres || [],
      popularity: artist.popularity,
      shortRank:  s?.rank ?? null,
      mediumRank: m?.rank ?? null,
      longRank:   l?.rank ?? null,
      status,
    })
  })

  artists.sort((a, b) => {
    const aMin = Math.min(a.shortRank ?? 999, a.mediumRank ?? 999, a.longRank ?? 999)
    const bMin = Math.min(b.shortRank ?? 999, b.mediumRank ?? 999, b.longRank ?? 999)
    return aMin - bMin
  })

  return {
    artists,
    summary: {
      new:        artists.filter(a => a.status === "new").length,
      rising:     artists.filter(a => a.status === "rising").length,
      consistent: artists.filter(a => a.status === "consistent").length,
      fading:     artists.filter(a => a.status === "fading").length,
      classic:    artists.filter(a => a.status === "classic").length,
    },
  }
}

function computePersonalizationScore(topArtists, short, medium, long, nodes) {
  const SUPER_GENRE_MAP = [
    { label: "Pop",        re: /\bpop\b|k-pop|j-pop|indie pop|synth.pop|electropop/ },
    { label: "Hip-Hop",    re: /hip.hop|rap|trap|drill|grime|r&b|soul/ },
    { label: "Rock",       re: /\brock\b|punk|grunge|metal|hardcore|emo|indie rock|alt/ },
    { label: "Electronic", re: /electr|edm|house|techno|trance|dubstep|drum.bass|dnb|bass/ },
    { label: "Folk",       re: /folk|acoustic|singer.songwriter|country|bluegrass|americana/ },
    { label: "Classical",  re: /classical|orchestral|opera|chamber|baroque/ },
    { label: "Jazz",       re: /jazz|blues|swing|bebop|soul jazz/ },
    { label: "Latin",      re: /latin|reggaeton|salsa|cumbia|afrobeat|bossa/ },
  ]
  const genreSet = new Set()
  topArtists.forEach(a => {
    const g = (a.genres || []).join(" ").toLowerCase()
    SUPER_GENRE_MAP.forEach(({ label, re }) => { if (re.test(g)) genreSet.add(label) })
  })
  const diversity    = Math.min(100, Math.round((genreSet.size / 8) * 100))
  const avgPop       = topArtists.reduce((s, a) => s + (a.popularity || 50), 0) / Math.max(topArtists.length, 1)
  const depth        = Math.round(Math.max(0, Math.min(100, 100 - avgPop)))
  const tier3Plus    = nodes.filter(n => n.tier >= 3).length
  const discovery    = Math.round(Math.min(100, (tier3Plus / Math.max(nodes.length, 1)) * 200))
  const shortTop20   = new Set(short.slice(0, 20).map(a => a.id))
  const longTop20    = new Set(long.slice(0, 20).map(a => a.id))
  const overlap      = [...shortTop20].filter(id => longTop20.has(id)).length
  const consistency  = Math.round(Math.min(100, (overlap / 20) * 100))
  const overall      = Math.round(diversity * 0.25 + depth * 0.25 + discovery * 0.25 + consistency * 0.25)
  return { diversity, depth, discovery, consistency, overall }
}

async function runJob(jobId, accessToken, userId, userName, userAvatar, timeRange) {
  try {
    // ── Stage 1: Core data + all 3 time ranges ──────────────────────────────
    setJobProgress(jobId, 5, 1, "Fetching your top artists and tracks…")
    const [topArtists, topTracks, topArtistsShort, topArtistsMedium, topArtistsLong, recentItems] =
      await Promise.all([
        getTopArtists(accessToken, timeRange),
        getTopTracks(accessToken, timeRange),
        getTopArtists(accessToken, "short_term"),
        getTopArtists(accessToken, "medium_term"),
        getTopArtists(accessToken, "long_term"),
        getRecentlyPlayed(accessToken),
      ])
    setJobProgress(jobId, 15, 1, `Found ${topArtists.length} top artists, ${topTracks.length} tracks…`)

    const topArtistSet = new Set(topArtists.map(a => a.id))

    // ── Stage 2: Build related artist network ────────────────────────────────
    // Approach A — Recommendations API (replaces deprecated related-artists)
    setJobProgress(jobId, 18, 2, "Getting recommendations for your taste…")
    const recommendedArtistIds = new Set() // IDs only from recommendation track artists

    // Feature artists from top 50 tracks (always works, no API rate limit issues)
    topTracks.forEach(track => {
      track.artists?.forEach(a => {
        if (!topArtistSet.has(a.id)) recommendedArtistIds.add(a.id)
      })
    })

    // Recommendation tracks for top 20 artists (5 concurrent batches)
    const top20 = topArtists.slice(0, 20)
    for (let i = 0; i < top20.length; i += 5) {
      const batch = top20.slice(i, i + 5)
      const trackArrays = await Promise.all(
        batch.map(artist => getRecommendedTracks(accessToken, artist.id))
      )
      trackArrays.forEach(tracks => {
        tracks.forEach(t => {
          t.artists?.forEach(a => {
            if (!topArtistSet.has(a.id)) recommendedArtistIds.add(a.id)
          })
        })
      })
      await delay(100)
      const done = Math.min(i + 5, top20.length)
      setJobProgress(jobId, 18 + Math.round((done / top20.length) * 14), 2,
        `Collected ${recommendedArtistIds.size} candidate artists…`)
    }

    // Batch-fetch full artist objects (genres + images + popularity)
    const idsToFetch = [...recommendedArtistIds].slice(0, 200)
    setJobProgress(jobId, 34, 2, `Loading details for ${idsToFetch.length} artists…`)
    const fullArtists = await getArtistsBatch(accessToken, idsToFetch)
    const relatedArtists = fullArtists.filter(a => a && !topArtistSet.has(a.id))
    setJobProgress(jobId, 44, 2, `Got ${relatedArtists.length} related artists!`)

    // ── Stage 3: Top tracks for related artists ──────────────────────────────
    setJobProgress(jobId, 46, 3, "Loading tracks for related artists…")
    const relatedTracksByArtist = {}
    // Only fetch for up to 60 related artists to keep total time reasonable
    const relatedSample = relatedArtists.slice(0, 60)
    for (let i = 0; i < relatedSample.length; i += 10) {
      const batch = relatedSample.slice(i, i + 10)
      await Promise.all(batch.map(async artist => {
        const tracks = await getArtistTopTracks(accessToken, artist.id)
        relatedTracksByArtist[artist.id] = tracks.slice(0, 3)
      }))
      await delay(120)
      const done = Math.min(i + 10, relatedSample.length)
      setJobProgress(jobId, 46 + Math.round((done / relatedSample.length) * 14), 3,
        `Loaded tracks for ${done}/${relatedSample.length} related artists…`)
    }

    // ── Stage 4: Genre search to fill outer galaxy ───────────────────────────
    setJobProgress(jobId, 62, 4, "Searching genre space…")
    const topGenres = [...new Set(topArtists.flatMap(a => a.genres || []))].slice(0, 5)
    const allKnownIds = new Set([
      ...topArtistSet,
      ...relatedArtists.map(a => a.id),
    ])
    const genreNeighbors = []
    for (const genre of topGenres.slice(0, 4)) {
      try {
        const found = await searchGenreArtists(accessToken, genre)
        found.filter(a => !allKnownIds.has(a.id)).slice(0, 8).forEach(a => {
          genreNeighbors.push({ ...a, _genreSource: genre })
          allKnownIds.add(a.id)
        })
        await delay(80)
      } catch { /* skip */ }
    }
    setJobProgress(jobId, 70, 4, `Galaxy has ${1 + relatedArtists.length + genreNeighbors.length} artists total…`)

    // ── Stage 5: Audio features (best-effort) ───────────────────────────────
    setJobProgress(jobId, 72, 5, "Analyzing audio signatures…")
    const recentTracks = recentItems.map(i => i.track).filter(Boolean)
    const relatedTracksFlat = Object.values(relatedTracksByArtist).flat()
    const allTrackIds = [...new Set([
      ...topTracks.map(t => t.id),
      ...recentTracks.map(t => t.id),
      ...relatedTracksFlat.map(t => t.id),
    ])]
    const rawFeatures = await getAudioFeatures(accessToken, allTrackIds)
    const audioFeaturesMap = {}
    rawFeatures.forEach(f => { if (f?.id) audioFeaturesMap[f.id] = f })

    // ── Build graph ──────────────────────────────────────────────────────────
    setJobProgress(jobId, 80, 5, "Building your galaxy…")
    const { nodes, edges, meta } = buildMusicGraph(
      topArtists,
      topTracks,
      audioFeaturesMap,
      {}, // relatedArtistsMap: empty since related-artists API is deprecated
      relatedArtists,
      relatedTracksByArtist,
      genreNeighbors
    )

    const timeMachineData      = buildTimeMachineData(topArtistsShort, topArtistsMedium, topArtistsLong)
    const personalizationScore = computePersonalizationScore(
      topArtists, topArtistsShort, topArtistsMedium, topArtistsLong, nodes
    )

    const trackCounts = {}
    recentTracks.forEach(t => { trackCounts[t.id] = (trackCounts[t.id] || 0) + 1 })
    const topRecentId    = Object.entries(trackCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
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
          ? { name: topRecentTrack.name, artist: topRecentTrack.artists?.[0]?.name, url: topRecentTrack.external_urls?.spotify }
          : null,
        timeMachineData,
        personalizationScore,
      },
    }

    const cacheKey = `spotify:${userId}:${timeRange}`
    spotifySessionCache.set(cacheKey, { data: result, expiresAt: Date.now() + SESSION_TTL_MS })
    publicGalaxyStore.set(userId, { data: result, expiresAt: Date.now() + PUBLIC_TTL_MS })

    setJobProgress(jobId, 100, 5, `Complete! ${nodes.length} nodes in your galaxy.`)
    const job = jobStore.get(jobId)
    if (job) jobStore.set(jobId, { ...job, progress: 100, status: "done", result })
    setTimeout(() => jobStore.delete(jobId), JOB_TTL_MS)

  } catch (err) {
    console.error("[spotify/analyze/start] job error:", err)
    const job = jobStore.get(jobId)
    if (job) jobStore.set(jobId, { ...job, status: "error", error: err.message })
  }
}

export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.provider !== "spotify") {
      return NextResponse.json({ error: "Spotify session required" }, { status: 401 })
    }

    const { timeRange = "medium_term" } = await request.json().catch(() => ({}))
    const accessToken = session.spotifyAccessToken
    if (!accessToken) {
      return NextResponse.json({ error: "No Spotify access token" }, { status: 401 })
    }

    const profileRes = await fetch("https://api.spotify.com/v1/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    const profile    = await profileRes.json()
    const userId     = profile.id
    const userName   = profile.display_name || profile.id
    const userAvatar = profile.images?.[0]?.url || null

    const cacheKey = `spotify:${userId}:${timeRange}`
    const cached   = spotifySessionCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      const fakeJobId = `cached:${cacheKey}`
      jobStore.set(fakeJobId, {
        status: "done", progress: 100, step: 5,
        stepLabel: "Loaded from cache", result: cached.data, error: null,
      })
      return NextResponse.json({ jobId: fakeJobId })
    }

    const jobId = genJobId()
    jobStore.set(jobId, { status: "running", progress: 0, step: 0, stepLabel: "Starting…", result: null, error: null })

    runJob(jobId, accessToken, userId, userName, userAvatar, timeRange).catch(err => {
      console.error("[runJob unhandled]", err)
    })

    return NextResponse.json({ jobId })
  } catch (err) {
    console.error("[spotify/analyze/start]", err)
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
