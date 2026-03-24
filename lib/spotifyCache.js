// Shared in-memory caches for Spotify galaxy data
// Uses globalThis to survive Next.js dev-mode module re-evaluation
// (each API route handler can get a fresh module instance in dev; globalThis persists)

if (!globalThis.__spotifyCache) {
  globalThis.__spotifyCache = {
    sessionCache:  new Map(),
    publicStore:   new Map(),
    jobStore:      new Map(),
    playlistCache: new Map(),
  }
}
// Add playlistCache if missing (upgrade for existing instances)
if (!globalThis.__spotifyCache.playlistCache) {
  globalThis.__spotifyCache.playlistCache = new Map()
}

/** 10-minute session cache: "spotify:{userId}:{timeRange}" → { data, expiresAt } */
export const spotifySessionCache = globalThis.__spotifyCache.sessionCache

/** 24-hour public galaxy store: userId → { data, expiresAt } */
export const publicGalaxyStore = globalThis.__spotifyCache.publicStore

/** Job store: jobId → { status, progress, step, stepLabel, result, error } */
export const jobStore = globalThis.__spotifyCache.jobStore

/** 30-minute playlist cache: "playlists:{userId}" → { data, expiresAt } */
export const playlistCache = globalThis.__spotifyCache.playlistCache

export const SESSION_TTL_MS  = 10 * 60 * 1000        // 10 minutes
export const PUBLIC_TTL_MS   = 24 * 60 * 60 * 1000   // 24 hours
export const JOB_TTL_MS      = 30 * 60 * 1000        // 30 minutes
export const PLAYLIST_TTL_MS = 30 * 60 * 1000        // 30 minutes
