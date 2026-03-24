// Playlist graph builder — computes playlist-arm positions and timeline
// Used CLIENT-SIDE only; no Next.js server imports

const TWO_PI = Math.PI * 2

function hashFloat(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) & 0xffffffff
  return Math.abs(h) / 0xffffffff
}

/**
 * Compute playlist-arm spiral positions for existing graph nodes.
 *
 * @param {Array}  nodes     — all nodes from buildMusicGraph (with node.id, node.type, node.x/y/z)
 * @param {Array}  playlists — from /api/spotify/playlists: [{id, name, tracks:[{id,added_at}]}]
 * @returns {Object} positions — { nodeId: {x, y, z} }
 *   Only nodes that can be placed in a playlist arm are included.
 *   Nodes not in any playlist keep their genre positions (not in this map).
 */
export function buildPlaylistPositions(nodes, playlists) {
  const capped = playlists.slice(0, 12)
  if (!capped.length) return {}

  // Map each track to its "primary" playlist arm: the one with the earliest added_at
  const trackPrimary = {} // trackId → { plIdx, addedAt }
  capped.forEach((pl, plIdx) => {
    ;(pl.tracks || []).forEach(t => {
      const ts = t.added_at ? new Date(t.added_at).getTime() : 0
      const existing = trackPrimary[t.id]
      if (!existing || ts < existing.addedAt) {
        trackPrimary[t.id] = { plIdx, addedAt: ts }
      }
    })
  })

  // Group tracks per arm and sort by addedAt ascending
  const armTracks = capped.map(() => []) // [plIdx] → [{id, addedAt}]
  Object.entries(trackPrimary).forEach(([id, { plIdx, addedAt }]) => {
    armTracks[plIdx].push({ id, addedAt })
  })
  armTracks.forEach(arr => arr.sort((a, b) => a.addedAt - b.addedAt))

  const totalArms = capped.length

  // Compute track positions
  const positions = {}
  armTracks.forEach((tracks, armIdx) => {
    const armAngle = (armIdx / totalArms) * TWO_PI
    tracks.forEach((t, ti) => {
      const count = tracks.length
      const frac  = count > 1 ? ti / (count - 1) : 0.5
      const r     = 18 + frac * 85              // r: 18-103
      const theta = armAngle + frac * 2.0 * TWO_PI + (hashFloat(t.id + "pl") - 0.5) * 0.35
      positions[t.id] = {
        x: r * Math.cos(theta),
        y: (hashFloat(t.id + "ply") - 0.5) * 12,
        z: r * Math.sin(theta),
      }
    })
  })

  // Artist nodes: place at centroid of their tracks in the arm
  const artistTrackPositions = {} // artistId → [positions]
  nodes.forEach(n => {
    if (n.type !== "artist" || !n.id) return
    const artistPositions = []
    capped.forEach(pl => {
      ;(pl.tracks || []).forEach(t => {
        if (t.artists?.some(a => a.id === n.id) && positions[t.id]) {
          artistPositions.push(positions[t.id])
        }
      })
    })
    if (artistPositions.length > 0) {
      const cx = artistPositions.reduce((s, p) => s + p.x, 0) / artistPositions.length
      const cy = artistPositions.reduce((s, p) => s + p.y, 0) / artistPositions.length
      const cz = artistPositions.reduce((s, p) => s + p.z, 0) / artistPositions.length
      positions[n.id] = {
        x: cx + (hashFloat(n.id + "ax") - 0.5) * 5,
        y: cy,
        z: cz + (hashFloat(n.id + "az") - 0.5) * 5,
      }
    }
  })

  return positions
}

/**
 * Build a flat timeline from playlist tracks, grouped into "sessions"
 * (tracks added within 24 hours of each other).
 *
 * @param {Array}  playlists — from /api/spotify/playlists
 * @returns {Array} sessions — chronological array of:
 *   { date, tracks: [{id,name,artists,added_at,playlistId,playlistName,albumArt}], playlistsAffected, sessionSize }
 */
export function buildPlaylistTimeline(playlists) {
  const all = []
  const seen = new Set()

  playlists.forEach(pl => {
    ;(pl.tracks || []).forEach(t => {
      if (!t.id || !t.added_at) return
      if (seen.has(t.id)) return
      seen.add(t.id)
      all.push({
        id:           t.id,
        name:         t.name,
        artists:      t.artists || [],
        added_at:     t.added_at,
        playlistId:   pl.id,
        playlistName: pl.name,
        albumArt:     t.albumArt || null,
      })
    })
  })

  all.sort((a, b) => new Date(a.added_at) - new Date(b.added_at))

  const sessions = []
  let sessionStart = null
  let current = null
  const SESSION_GAP_MS = 24 * 60 * 60 * 1000

  all.forEach(track => {
    const ts = new Date(track.added_at).getTime()
    if (!sessionStart || ts - sessionStart > SESSION_GAP_MS) {
      current = {
        date:    track.added_at.slice(0, 10),
        tracks:  [track],
        playlists: new Set([track.playlistName]),
      }
      sessions.push(current)
      sessionStart = ts
    } else {
      current.tracks.push(track)
      current.playlists.add(track.playlistName)
    }
  })

  return sessions.map(s => ({
    date:              s.date,
    tracks:            s.tracks,
    playlistsAffected: [...s.playlists],
    sessionSize:       s.tracks.length,
  }))
}

/**
 * Dominant mood label for a playlist based on average audio stats.
 * audioStats: { energy, valence } — averaged from nodes for tracks in the playlist.
 */
export function playlistDominantMood(audioStats) {
  const { energy = 0.5, valence = 0.5 } = audioStats
  if (energy > 0.6 && valence > 0.6) return "🎉 Hype"
  if (energy < 0.4 && valence > 0.6) return "😌 Chill"
  if (energy < 0.4 && valence < 0.4) return "🌧 Melancholic"
  if (energy > 0.6 && valence < 0.4) return "⚡ Intense"
  return "🎵 Mixed"
}

/**
 * Compute playlist insights from playlist data + added_at timestamps.
 * Returns { genreDiversity, mostEclectic, mostFocused, oldestPlaylist, timeOfDay }
 */
export function computePlaylistInsights(playlists, nodes) {
  if (!playlists?.length) return null

  const nodeById = {}
  nodes.forEach(n => { nodeById[n.id] = n })

  // Genre diversity per playlist
  const playlistGenreDiversity = playlists.map(pl => {
    const genres = new Set()
    ;(pl.tracks || []).forEach(t => {
      t.artists?.forEach(a => {
        const node = nodeById[a.id]
        if (node?.genres) node.genres.forEach(g => genres.add(g.toLowerCase()))
      })
    })
    return { name: pl.name, genreCount: genres.size }
  })

  const mostEclectic = playlistGenreDiversity.sort((a, b) => b.genreCount - a.genreCount)[0]

  // Most focused: playlist where avg mood is strongly in one quadrant
  let mostFocused = null
  let bestFocus = 0
  playlists.forEach(pl => {
    if (!pl.tracks?.length) return
    const energies = pl.tracks.map(t => {
      const n = nodeById[t.id]
      return n?.energy ?? 0.5
    })
    const valences = pl.tracks.map(t => {
      const n = nodeById[t.id]
      return n?.valence ?? 0.5
    })
    const avgE = energies.reduce((s, v) => s + v, 0) / energies.length
    const avgV = valences.reduce((s, v) => s + v, 0) / valences.length
    // Distance from center (0.5, 0.5) = "focus score"
    const focus = Math.sqrt((avgE - 0.5) ** 2 + (avgV - 0.5) ** 2)
    if (focus > bestFocus) {
      bestFocus = focus
      mostFocused = { name: pl.name, mood: playlistDominantMood({ energy: avgE, valence: avgV }), focus }
    }
  })

  // Oldest playlist: earliest added_at across all tracks
  let oldestDate = null
  let oldestPlaylist = null
  playlists.forEach(pl => {
    ;(pl.tracks || []).forEach(t => {
      if (!t.added_at) return
      if (!oldestDate || t.added_at < oldestDate) {
        oldestDate = t.added_at
        oldestPlaylist = pl.name
      }
    })
  })

  // Time of day analysis
  const buckets = { Morning: 0, Afternoon: 0, Evening: 0, Night: 0 }
  let totalTimestamped = 0
  playlists.forEach(pl => {
    ;(pl.tracks || []).forEach(t => {
      if (!t.added_at) return
      const hour = new Date(t.added_at).getHours()
      totalTimestamped++
      if (hour >= 6 && hour < 12)       buckets.Morning++
      else if (hour >= 12 && hour < 18) buckets.Afternoon++
      else if (hour >= 18 && hour < 22) buckets.Evening++
      else                              buckets.Night++
    })
  })

  let dominantPeriod = "Evening"
  let maxCount = 0
  Object.entries(buckets).forEach(([k, v]) => { if (v > maxCount) { maxCount = v; dominantPeriod = k } })
  const periodPct = totalTimestamped > 0 ? Math.round((maxCount / totalTimestamped) * 100) : 0
  const periodLabel = dominantPeriod === "Morning" ? "Morning person ☀️"
    : dominantPeriod === "Night" ? "Night owl 🌙"
    : dominantPeriod === "Evening" ? "Evening listener 🌆"
    : "Midday listener 🌤"

  return {
    mostEclectic:   mostEclectic ? { name: mostEclectic.name, genreCount: mostEclectic.genreCount } : null,
    mostFocused:    mostFocused  ? { name: mostFocused.name,  mood: mostFocused.mood } : null,
    oldestPlaylist: oldestPlaylist ? { name: oldestPlaylist, date: oldestDate?.slice(0, 10) } : null,
    timeOfDay:      { label: periodLabel, pct: periodPct, period: dominantPeriod },
  }
}
