// Music graph builder — 4-tier node system
// Tier 1: User's top artists  (inner galaxy arms,  r: 20-65)
// Tier 2: User's top tracks   (orbit tier-1,        r: parent ± 8)
// Tier 3: Related/rec artists (outer ring,          r: 70-120)
// Tier 4: Genre neighbors     (outer halo,          r: 125-165)
// Tier 5: Discover extras     (outermost,           r: 170-210)

const TWO_PI = Math.PI * 2

function avgFeature(features, key) {
  if (!features.length) return 0.5
  return features.reduce((s, f) => s + (f?.[key] ?? 0.5), 0) / features.length
}

function normalizeTempo(bpm) {
  return Math.max(0, Math.min(1, (bpm - 60) / 140))
}

// Deterministic pseudo-random from a string (djb2 → 0-1)
function hashFloat(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) & 0xffffffff
  return Math.abs(h) / 0xffffffff
}

// Derive approximate audio properties from genres + popularity
function deriveFromGenres(genres, popularity) {
  const g = (genres || []).join(" ").toLowerCase()
  const pop = (popularity || 50) / 100

  let energy = 0.5
  if (/edm|electronic|dance|techno|house|trance|drum|bass|metal|punk|hardcore|rage|trap/.test(g)) energy = 0.75 + pop * 0.2
  else if (/classical|ambient|acoustic|folk|jazz|blues|soul|slow|soft|lofi/.test(g)) energy = 0.2 + pop * 0.2
  else energy = 0.4 + pop * 0.3

  let danceability = 0.5
  if (/dance|pop|hip.hop|r&b|funk|disco|edm|house|reggaeton|afrobeats/.test(g)) danceability = 0.7 + pop * 0.2
  else if (/classical|jazz|metal|punk|folk|ambient/.test(g)) danceability = 0.25 + pop * 0.2
  else danceability = 0.45 + pop * 0.25

  let valence = 0.5
  if (/happy|dance|pop|reggae|funk|disco|k-pop|j-pop/.test(g)) valence = 0.65 + pop * 0.2
  else if (/metal|emo|dark|doom|gothic|sad|post-punk|industrial|noise/.test(g)) valence = 0.2 + pop * 0.15
  else valence = 0.4 + pop * 0.2

  const tempo = 0.4 + hashFloat(g.slice(0, 8)) * 0.4

  let acousticness = 0.3
  if (/acoustic|folk|classical|country|bluegrass|singer-songwriter/.test(g)) acousticness = 0.7
  else if (/edm|electronic|synth|techno|house/.test(g)) acousticness = 0.05

  return {
    energy:       Math.min(1, Math.max(0, energy)),
    danceability: Math.min(1, Math.max(0, danceability)),
    valence:      Math.min(1, Math.max(0, valence)),
    tempo:        Math.min(1, Math.max(0, tempo)),
    acousticness: Math.min(1, Math.max(0, acousticness)),
  }
}

// Normalize genre names into 8 super-genre categories
const GENRE_SUPER_MAP = [
  { label: "Pop",        re: /\bpop\b|k-pop|j-pop|indie pop|synth.pop|electropop/ },
  { label: "Hip-Hop",    re: /hip.hop|rap|trap|drill|grime|r&b|soul/ },
  { label: "Rock",       re: /\brock\b|punk|grunge|metal|hardcore|emo|indie rock|alt/ },
  { label: "Electronic", re: /electr|edm|house|techno|trance|dubstep|drum.bass|dnb|bass/ },
  { label: "Folk",       re: /folk|acoustic|singer.songwriter|country|bluegrass|americana/ },
  { label: "Classical",  re: /classical|orchestral|opera|chamber|baroque/ },
  { label: "Jazz",       re: /jazz|blues|swing|bebop|soul jazz/ },
  { label: "Latin",      re: /latin|reggaeton|salsa|cumbia|afrobeat|bossa/ },
]

function superGenre(genres) {
  const g = (genres || []).join(" ").toLowerCase()
  for (const { label, re } of GENRE_SUPER_MAP) {
    if (re.test(g)) return label
  }
  return "Other"
}

function resolveAudioProps(artist, trackIds, audioFeaturesMap, hasAudioFeatures) {
  if (hasAudioFeatures && trackIds?.length) {
    const features = trackIds.map(id => audioFeaturesMap[id]).filter(Boolean)
    if (features.length) {
      return {
        energy:       avgFeature(features, "energy"),
        danceability: avgFeature(features, "danceability"),
        valence:      avgFeature(features, "valence"),
        tempo:        normalizeTempo(avgFeature(features, "tempo")),
        acousticness: avgFeature(features, "acousticness"),
      }
    }
  }
  return deriveFromGenres(artist.genres, artist.popularity)
}

/**
 * @param {Array}  topArtists           Tier-1: user's top 50 artists
 * @param {Array}  topTracks            Tier-2: user's top tracks
 * @param {Object} audioFeaturesMap     track id → audio features
 * @param {Object} relatedArtistsMap    unused (deprecated API), kept for compat
 * @param {Array}  relatedArtists       Tier-3: recommendation/feature artists
 * @param {Object} relatedTracksByArtist artistId → [track]  (tier-3 child tracks)
 * @param {Array}  genreNeighbors       Tier-4/5: discover genre artists
 */
export function buildMusicGraph(
  topArtists,
  topTracks,
  audioFeaturesMap,
  relatedArtistsMap = {},
  relatedArtists = [],
  relatedTracksByArtist = {},
  genreNeighbors = []
) {
  const hasAudioFeatures = audioFeaturesMap && Object.keys(audioFeaturesMap).length > 0

  // ── Super-genre grouping ────────────────────────────────────────────────────
  const genreMap = {}
  topArtists.forEach(a => {
    const g = superGenre(a.genres)
    if (!genreMap[g]) genreMap[g] = []
    genreMap[g].push(a)
  })

  const genres = Object.keys(genreMap).sort((a, b) => genreMap[b].length - genreMap[a].length)
  const totalGenres = genres.length

  // Pre-compute arm hue per genre (evenly spread 30–330°, avoids red)
  const genreHue = {}
  genres.forEach((g, i) => {
    genreHue[g] = Math.round(30 + (i / Math.max(totalGenres - 1, 1)) * 300) % 360
  })

  const nodes = []
  const edges = []
  const artistIdSet = new Set(topArtists.map(a => a.id))

  // Map to track tier-1 artist spiral data for tier-2 orbit calculation
  // { artistId → { r, theta, x, y, z } }
  const artistSpiralData = {}

  // ──────────────────────────────────────────────────────────────────────
  // TIER 1: User's Top Artists (inner arms, r: 20-65)
  // ──────────────────────────────────────────────────────────────────────
  topArtists.forEach((artist, globalIdx) => {
    const genre    = superGenre(artist.genres)
    const genreIdx = genres.indexOf(genre)
    const armArtists = genreMap[genre] || []
    const sortedArm  = [...armArtists].sort((a, b) => b.popularity - a.popularity)
    const posInArm   = sortedArm.findIndex(a => a.id === artist.id)
    const armCount   = sortedArm.length

    // Audio properties
    const artistTrackIds = (topTracks || []).filter(t => t.artists?.[0]?.id === artist.id).map(t => t.id)
    const audio = resolveAudioProps(artist, artistTrackIds, audioFeaturesMap, hasAudioFeatures)

    // Tier-1 color: index-based hue spread 30°–330°, avoids red
    const hue        = Math.round(30 + (globalIdx / Math.max(topArtists.length - 1, 1)) * 300) % 360
    const saturation = Math.round(70 + audio.energy * 15)
    const lightness  = Math.round(50 + audio.valence * 15)

    const isCore = globalIdx === 0

    // Size: rank 1 ≈ 8.5, rank 50 ≈ 3
    const rank   = globalIdx + 1
    const radius = isCore ? 9
      : 3 + (topArtists.length - rank) * 0.12 + (artist.popularity / 100) * 2

    // Spiral position in arm (r: 20-65)
    let x = 0, y = 0, z = 0, r = 0, theta = 0
    if (!isCore) {
      const armAngle = (genreIdx / Math.max(totalGenres, 1)) * TWO_PI
      const t = armCount <= 1 ? 0.5 : posInArm / (armCount - 1)
      r = 20 + t * 45
      theta = armAngle + t * 2.2 * TWO_PI + (hashFloat(artist.id) - 0.5) * 0.25
      x = r * Math.cos(theta)
      z = r * Math.sin(theta)
      y = (hashFloat(artist.id + "y") - 0.5) * 12  // ±6
    }

    artistSpiralData[artist.id] = { r, theta, x, y, z }

    nodes.push({
      id:           artist.id,
      label:        artist.name,
      type:         "artist",
      tier:         1,
      folder:       genre,
      genres:       artist.genres || [],
      popularity:   artist.popularity,
      radius,
      imageUrl:     artist.images?.[0]?.url || null,
      ...audio,
      color:        `hsl(${hue},${saturation}%,${lightness}%)`,
      hue,
      size:         isCore ? 10 : Math.max(2, Math.round(artist.popularity / 12)),
      opacity:      1.0,
      isCore,
      genreHue:     genreHue[genre] ?? hue,
      x, y, z,
    })
  })

  // Super-genre map for tracks
  const artistGenreMap = {}
  topArtists.forEach(a => { artistGenreMap[a.id] = superGenre(a.genres) })

  // ──────────────────────────────────────────────────────────────────────
  // TIER 2: User's Top Tracks (orbit tier-1 artists, tightly)
  // ──────────────────────────────────────────────────────────────────────
  const top20Tracks = (topTracks || []).slice(0, 20)
  top20Tracks.forEach(track => {
    const af       = audioFeaturesMap?.[track.id]
    const parentId = track.artists?.[0]?.id
    const parentNode = nodes.find(n => n.id === parentId)
    if (!parentNode) return

    const parent = artistSpiralData[parentId] || { r: parentNode.x ? Math.sqrt(parentNode.x**2 + parentNode.z**2) : 20, theta: 0, x: parentNode.x, y: parentNode.y, z: parentNode.z }
    const angle  = parent.theta + (hashFloat(track.id) - 0.5) * 0.6
    const dr     = (hashFloat(track.id + "r") - 0.5) * 16  // ±8
    const tr     = Math.max(15, parent.r + dr)
    const tx     = tr * Math.cos(angle)
    const tz     = tr * Math.sin(angle)
    const ty     = (parent.y || 0) + (hashFloat(track.id + "y") - 0.5) * 6  // ±3

    // Tier-2 size based on energy
    const energy = af?.energy ?? parentNode.energy
    const trackRadius = 0.8 + energy * 0.8

    nodes.push({
      id:           track.id,
      label:        track.name,
      type:         "track",
      tier:         2,
      folder:       artistGenreMap[parentId] || "Other",
      albumArt:     track.album?.images?.[0]?.url || null,
      albumName:    track.album?.name || "",
      radius:       trackRadius,
      energy,
      danceability: af?.danceability ?? parentNode.danceability,
      valence:      af?.valence      ?? parentNode.valence,
      tempo:        normalizeTempo(af?.tempo ?? 120),
      key:          af?.key ?? -1,
      duration_ms:  track.duration_ms,
      parentArtist: parentId,
      size:         2,
      opacity:      0.88,
      color:        parentNode.color,
      hue:          parentNode.hue,
      genreHue:     parentNode.genreHue,
      x: tx, y: ty, z: tz,
    })
  })

  // Track → artist edges for top-20 tracks
  top20Tracks.forEach(track => {
    const parentId = track.artists?.[0]?.id
    if (parentId && artistIdSet.has(parentId)) {
      edges.push({ source: track.id, target: parentId, type: "belongs_to" })
    }
  })

  // ──────────────────────────────────────────────────────────────────────
  // TIER 3: Related/Rec Artists (outer ring, r: 70-120)
  // ──────────────────────────────────────────────────────────────────────
  const relatedArtistIdSet = new Set(relatedArtists.map(a => a.id))

  // Group related artists by super-genre for arm placement
  const relatedByGenre = {}
  relatedArtists.forEach(a => {
    const g = superGenre(a.genres)
    const armGenre = genres.includes(g) ? g : (genres[0] || "Other")
    if (!relatedByGenre[armGenre]) relatedByGenre[armGenre] = []
    relatedByGenre[armGenre].push(a)
  })

  relatedArtists.forEach((artist, idx) => {
    const audio = deriveFromGenres(artist.genres, artist.popularity)
    const g = superGenre(artist.genres)
    const armGenre = genres.includes(g) ? g : (genres[0] || "Other")
    const genreIdx = genres.indexOf(armGenre)
    const armArtists = relatedByGenre[armGenre] || []
    const posInArm   = armArtists.findIndex(a => a.id === artist.id)
    const armCount   = armArtists.length

    // Inherit hue from genre arm, with reduced saturation
    const baseHue   = genreHue[armGenre] ?? Math.round((genreIdx / Math.max(totalGenres, 1)) * 300 + 30)
    const hue       = baseHue
    const saturation = Math.round(35 + audio.energy * 20)  // -25 vs tier-1
    const lightness  = Math.round(38 + audio.valence * 15)

    const armAngle = (genreIdx / Math.max(totalGenres, 1)) * TWO_PI
    const t = armCount <= 1 ? 0.5 : posInArm / (armCount - 1)
    const r = 70 + t * 50  // r: 70-120
    const theta = armAngle + t * 2.5 * TWO_PI + (hashFloat(artist.id) - 0.5) * 0.4
    const x = r * Math.cos(theta)
    const z = r * Math.sin(theta)
    const y = (hashFloat(artist.id + "y3") - 0.5) * 24  // ±12

    const radius = 1.2 + (artist.popularity / 100) * 1.8

    nodes.push({
      id:           artist.id,
      label:        artist.name,
      type:         "artist",
      tier:         3,
      folder:       armGenre,
      genres:       artist.genres || [],
      popularity:   artist.popularity,
      radius,
      imageUrl:     artist.images?.[0]?.url || null,
      ...audio,
      color:        `hsl(${hue},${saturation}%,${lightness}%)`,
      hue,
      size:         Math.max(1.5, Math.round(artist.popularity / 16)),
      opacity:      0.55,
      isCore:       false,
      genreHue:     baseHue,
      x, y, z,
    })
  })

  // ──────────────────────────────────────────────────────────────────────
  // TIER 3 CHILD TRACKS: Orbit their related artist
  // ──────────────────────────────────────────────────────────────────────
  Object.entries(relatedTracksByArtist).forEach(([artistId, tracks]) => {
    const parentNode = nodes.find(n => n.id === artistId)
    if (!parentNode) return
    const pR = Math.sqrt(parentNode.x**2 + parentNode.z**2) || 80
    const pTheta = Math.atan2(parentNode.x, parentNode.z)
    tracks.slice(0, 3).forEach((track, ti) => {
      const af    = audioFeaturesMap?.[track.id]
      const angle = pTheta + (hashFloat(track.id + "a3") - 0.5) * 0.5
      const dr    = (hashFloat(track.id + "r3") - 0.5) * 12
      const tr    = Math.max(65, pR + dr)
      nodes.push({
        id:           track.id,
        label:        track.name,
        type:         "track",
        tier:         3,
        folder:       parentNode.folder,
        albumArt:     track.album?.images?.[0]?.url || null,
        albumName:    track.album?.name || "",
        radius:       0.7,
        energy:       af?.energy ?? parentNode.energy,
        danceability: af?.danceability ?? parentNode.danceability,
        valence:      af?.valence ?? parentNode.valence,
        tempo:        normalizeTempo(af?.tempo ?? 120),
        key:          af?.key ?? -1,
        duration_ms:  track.duration_ms,
        parentArtist: artistId,
        size:         1,
        opacity:      0.42,
        color:        parentNode.color,
        hue:          parentNode.hue,
        genreHue:     parentNode.genreHue,
        x: tr * Math.sin(angle),
        y: parentNode.y + (hashFloat(track.id + "y3") - 0.5) * 10,
        z: tr * Math.cos(angle),
      })
    })
  })

  // ──────────────────────────────────────────────────────────────────────
  // TIER 4: Genre neighbors (outer halo, r: 125-165)
  // ──────────────────────────────────────────────────────────────────────
  const allKnownIds = new Set([...artistIdSet, ...relatedArtistIdSet])
  genreNeighbors.forEach((artist, i) => {
    if (allKnownIds.has(artist.id)) return
    const audio = deriveFromGenres(artist.genres, artist.popularity)
    const g = superGenre(artist.genres)
    const armGenre = genres.includes(g) ? g : (genres[i % genres.length] || "Other")
    const genreIdx = genres.indexOf(armGenre)

    // Tier-4 uses genre arm hue with heavy desaturation
    const baseHue   = genreHue[armGenre] ?? 200
    const saturation = Math.round(20 + audio.energy * 10)  // very muted
    const lightness  = Math.round(30 + audio.valence * 12)

    const armAngle = (genreIdx / Math.max(totalGenres, 1)) * TWO_PI
    const hashR    = hashFloat(artist.id + "R4") * 40  // 0-40 spread
    const r        = 125 + hashR
    const theta    = armAngle + hashFloat(artist.id + "T4") * TWO_PI
    const radius   = 0.6 + (artist.popularity / 100) * 0.8

    nodes.push({
      id:           artist.id,
      label:        artist.name,
      type:         "artist",
      tier:         4,
      folder:       armGenre,
      genres:       artist.genres || [],
      popularity:   artist.popularity,
      radius,
      imageUrl:     artist.images?.[0]?.url || null,
      ...audio,
      color:        `hsl(${baseHue},${saturation}%,${lightness}%)`,
      hue:          baseHue,
      size:         Math.max(1, Math.round(artist.popularity / 22)),
      opacity:      0.38,
      isDiscover:   true,
      genreSource:  artist._genreSource || g,
      isCore:       false,
      genreHue:     baseHue,
      x: r * Math.cos(theta),
      y: (hashFloat(artist.id + "y4") - 0.5) * 36,  // ±18
      z: r * Math.sin(theta),
    })
    allKnownIds.add(artist.id)
  })

  // ──────────────────────────────────────────────────────────────────────
  // Meta
  // ──────────────────────────────────────────────────────────────────────
  const tier1Nodes = nodes.filter(n => n.tier === 1)
  const avgOf = key => tier1Nodes.reduce((s, n) => s + (n[key] ?? 0.5), 0) / Math.max(tier1Nodes.length, 1)

  const topGenres = genres.slice(0, 8)
  const topArtist = topArtists[0]

  const meta = {
    topArtist: {
      id:         topArtist?.id,
      name:       topArtist?.name,
      imageUrl:   topArtist?.images?.[0]?.url || null,
      genres:     topArtist?.genres || [],
      popularity: topArtist?.popularity,
    },
    totalArtists:         topArtists.length,
    totalRelatedArtists:  relatedArtists.length,
    totalTracks:          topTracks?.length || 0,
    totalNodes:           nodes.length,
    topGenres,
    superGenres:          genres,
    genreArtistCounts:    Object.fromEntries(genres.map(g => [g, genreMap[g]?.length || 0])),
    avgEnergy:            avgOf("energy"),
    avgValence:           avgOf("valence"),
    avgDanceability:      avgOf("danceability"),
    avgTempo:             avgOf("tempo"),
    avgAcousticness:      avgOf("acousticness"),
    audioFeaturesAvailable: hasAudioFeatures,
  }

  return { nodes, edges, meta }
}
